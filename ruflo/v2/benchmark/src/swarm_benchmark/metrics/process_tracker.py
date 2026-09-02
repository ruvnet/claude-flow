"""Process tracking for claude-flow executions."""

from __future__ import annotations
import subprocess
import asyncio
import time
import os
import signal
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
import json
import psutil

from .performance_collector import PerformanceCollector
from .resource_monitor import ResourceMonitor
from ..core.models import PerformanceMetrics, ResourceUsage


@dataclass
class ProcessExecutionResult:
    """Result of a process execution."""
    command: List[str]
    exit_code: int
    stdout: str
    stderr: str
    start_time: float
    end_time: float
    duration: float
    performance_metrics: PerformanceMetrics
    resource_usage: ResourceUsage
    output_size: int
    error_count: int
    success: bool
    

@dataclass
class CommandMetrics:
    """Metrics for a specific command execution."""
    command_type: str  # init, swarm, status, etc.
    args: Dict[str, Any]
    execution_count: int = 0
    total_duration: float = 0.0
    success_count: int = 0
    failure_count: int = 0
    average_memory_mb: float = 0.0
    peak_memory_mb: float = 0.0
    

class ProcessTracker:
    """Tracks claude-flow process executions with metrics."""
    
    def __init__(self, claude_flow_path: str = "claude-flow"):
        """Initialize process tracker.
        
        Args:
            claude_flow_path: Path to claude-flow executable
        """
        self.claude_flow_path = claude_flow_path
        self._command_metrics: Dict[str, CommandMetrics] = {}
        self._execution_history: List[ProcessExecutionResult] = []
        
    def execute_command(
        self,
        command: List[str],
        timeout: Optional[float] = None,
        env: Optional[Dict[str, str]] = None,
        cwd: Optional[str] = None
    ) -> ProcessExecutionResult:
        """Execute a claude-flow command and collect metrics.
        
        Args:
            command: Command arguments (without claude-flow prefix)
            timeout: Command timeout in seconds
            env: Environment variables
            cwd: Working directory
            
        Returns:
            ProcessExecutionResult with metrics
        """
        # Build full command
        full_command = [self.claude_flow_path] + command
        
        # Set up environment
        process_env = os.environ.copy()
        if env:
            process_env.update(env)
            
        # Create collectors
        perf_collector = PerformanceCollector(sample_interval=0.05)
        resource_monitor = ResourceMonitor()
        
        # Track execution
        start_time = time.time()
        stdout_lines = []
        stderr_lines = []
        exit_code = -1
        
        try:
            # Start process
            process = subprocess.Popen(
                full_command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=process_env,
                cwd=cwd
            )
            
            # Start monitoring
            perf_collector.start_collection(process)
            resource_monitor.start_monitoring(process.pid)
            
            try:
                # Wait for completion
                stdout, stderr = process.communicate(timeout=timeout)
                exit_code = process.returncode
                stdout_lines = stdout.splitlines() if stdout else []
                stderr_lines = stderr.splitlines() if stderr else []
                
            except subprocess.TimeoutExpired:
                # Kill process on timeout
                process.kill()
                stdout, stderr = process.communicate()
                exit_code = -15  # SIGTERM
                stdout_lines = stdout.splitlines() if stdout else []
                stderr_lines = stderr.splitlines() if stderr else []
                stderr_lines.append(f"Process timed out after {timeout} seconds")
                
        except Exception as e:
            stderr_lines.append(f"Process execution failed: {str(e)}")
            
        finally:
            # Stop monitoring
            performance_metrics = perf_collector.stop_collection()
            resource_usage = resource_monitor.stop_monitoring()
            
        end_time = time.time()
        duration = end_time - start_time
        
        # Count errors in output
        error_count = sum(
            1 for line in stderr_lines + stdout_lines
            if any(err in line.lower() for err in ["error", "failed", "exception"])
        )
        
        # Create result
        result = ProcessExecutionResult(
            command=full_command,
            exit_code=exit_code,
            stdout="\n".join(stdout_lines),
            stderr="\n".join(stderr_lines),
            start_time=start_time,
            end_time=end_time,
            duration=duration,
            performance_metrics=performance_metrics,
            resource_usage=resource_usage,
            output_size=len(stdout_lines) + len(stderr_lines),
            error_count=error_count,
            success=(exit_code == 0)
        )
        
        # Update metrics
        self._update_command_metrics(command, result)
        self._execution_history.append(result)
        
        return result
        
    async def execute_command_async(
        self,
        command: List[str],
        timeout: Optional[float] = None,
        env: Optional[Dict[str, str]] = None,
        cwd: Optional[str] = None
    ) -> ProcessExecutionResult:
        """Execute command asynchronously."""
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(
            None,
            self.execute_command,
            command,
            timeout,
            env,
            cwd
        )
        
    def _update_command_metrics(self, command: List[str], result: ProcessExecutionResult) -> None:
        """Update command-specific metrics."""
        if not command:
            return
            
        command_type = command[0]
        args = self._parse_command_args(command)
        
        key = f"{command_type}:{json.dumps(args, sort_keys=True)}"
        
        if key not in self._command_metrics:
            self._command_metrics[key] = CommandMetrics(
                command_type=command_type,
                args=args
            )
            
        metrics = self._command_metrics[key]
        metrics.execution_count += 1
        metrics.total_duration += result.duration
        
        if result.success:
            metrics.success_count += 1
        else:
            metrics.failure_count += 1
            
        # Update memory metrics
        if metrics.execution_count == 1:
            metrics.average_memory_mb = result.resource_usage.memory_mb
            metrics.peak_memory_mb = result.resource_usage.peak_memory_mb
        else:
            # Running average
            metrics.average_memory_mb = (
                (metrics.average_memory_mb * (metrics.execution_count - 1) + 
                 result.resource_usage.memory_mb) / metrics.execution_count
            )
            metrics.peak_memory_mb = max(
                metrics.peak_memory_mb,
                result.resource_usage.peak_memory_mb
            )
            
    def _parse_command_args(self, command: List[str]) -> Dict[str, Any]:
        """Parse command arguments into a dictionary."""
        args = {}
        i = 1  # Skip command name
        
        while i < len(command):
            arg = command[i]
            
            if arg.startswith("--"):
                key = arg[2:]
                if i + 1 < len(command) and not command[i + 1].startswith("-"):
                    args[key] = command[i + 1]
                    i += 2
                else:
                    args[key] = True
                    i += 1
            elif arg.startswith("-"):
                key = arg[1:]
                args[key] = True
                i += 1
            else:
                if "positional" not in args:
                    args["positional"] = []
                args["positional"].append(arg)
                i += 1
                
        return args
        
    def get_command_statistics(self) -> Dict[str, Any]:
        """Get statistics for all executed commands."""
        stats = {}
        
        for key, metrics in self._command_metrics.items():
            avg_duration = (
                metrics.total_duration / metrics.execution_count
                if metrics.execution_count > 0 else 0
            )
            success_rate = (
                metrics.success_count / metrics.execution_count
                if metrics.execution_count > 0 else 0
            )
            
            stats[key] = {
                "command_type": metrics.command_type,
                "args": metrics.args,
                "execution_count": metrics.execution_count,
                "success_count": metrics.success_count,
                "failure_count": metrics.failure_count,
                "success_rate": success_rate,
                "average_duration": avg_duration,
                "total_duration": metrics.total_duration,
                "average_memory_mb": metrics.average_memory_mb,
                "peak_memory_mb": metrics.peak_memory_mb
            }
            
        return stats
        
    def get_execution_summary(self) -> Dict[str, Any]:
        """Get summary of all executions."""
        if not self._execution_history:
            return {
                "total_executions": 0,
                "successful_executions": 0,
                "failed_executions": 0,
                "overall_success_rate": 0.0,
                "total_duration": 0.0,
                "average_duration": 0.0,
                "peak_memory_mb": 0.0,
                "average_memory_mb": 0.0
            }
            
        successful = sum(1 for r in self._execution_history if r.success)
        failed = len(self._execution_history) - successful
        total_duration = sum(r.duration for r in self._execution_history)
        
        memory_values = [r.resource_usage.memory_mb for r in self._execution_history]
        peak_memory_values = [r.resource_usage.peak_memory_mb for r in self._execution_history]
        
        return {
            "total_executions": len(self._execution_history),
            "successful_executions": successful,
            "failed_executions": failed,
            "overall_success_rate": successful / len(self._execution_history),
            "total_duration": total_duration,
            "average_duration": total_duration / len(self._execution_history),
            "peak_memory_mb": max(peak_memory_values) if peak_memory_values else 0.0,
            "average_memory_mb": sum(memory_values) / len(memory_values) if memory_values else 0.0,
            "total_output_lines": sum(r.output_size for r in self._execution_history),
            "total_errors": sum(r.error_count for r in self._execution_history)
        }
        
    def save_execution_report(self, filepath: Path) -> None:
        """Save detailed execution report."""
        report = {
            "summary": self.get_execution_summary(),
            "command_statistics": self.get_command_statistics(),
            "executions": [
                {
                    "command": " ".join(r.command),
                    "exit_code": r.exit_code,
                    "success": r.success,
                    "duration": r.duration,
                    "start_time": r.start_time,
                    "output_size": r.output_size,
                    "error_count": r.error_count,
                    "cpu_percent": r.resource_usage.cpu_percent,
                    "memory_mb": r.resource_usage.memory_mb,
                    "peak_memory_mb": r.resource_usage.peak_memory_mb
                }
                for r in self._execution_history
            ]
        }
        
        with open(filepath, "w") as f:
            json.dump(report, f, indent=2)