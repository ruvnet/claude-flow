"""
Real Benchmark Scenarios - Execute actual Claude Flow commands and measure performance.

This module implements benchmarks that:
1. Execute real Claude Flow commands via subprocess
2. Measure actual performance metrics (execution time, token usage, memory)
3. Parse real JSON streaming responses 
4. Track token usage from actual Claude responses
5. Provide comprehensive performance analysis

NO simulations - only real Claude Flow executions.
"""

import subprocess
import json
import time
import tempfile
import os
import re
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import psutil
import threading
from contextlib import contextmanager

from ..core.claude_flow_executor import ClaudeFlowExecutor, SwarmConfig, SparcConfig, ExecutionStrategy, CoordinationMode, SparcMode

logger = logging.getLogger(__name__)


@dataclass
class RealBenchmarkResult:
    """Result from a real benchmark execution."""
    benchmark_name: str
    success: bool
    execution_time: float
    tokens_used: int
    agents_spawned: int
    memory_usage_mb: float
    cpu_usage_percent: float
    output_size_bytes: int
    error_count: int
    warning_count: int
    command_executed: List[str]
    stdout_excerpt: str
    stderr_excerpt: str
    metrics_raw: Dict[str, Any]
    timestamp: str
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return asdict(self)


@dataclass
class SystemMetrics:
    """System resource metrics during execution."""
    cpu_percent: float
    memory_mb: float
    disk_io_read_mb: float
    disk_io_write_mb: float
    network_bytes_sent: int
    network_bytes_recv: int
    
    
class ResourceMonitor:
    """Monitor system resources during benchmark execution."""
    
    def __init__(self):
        self.metrics = []
        self.monitoring = False
        self.monitor_thread = None
        
    def start_monitoring(self, interval: float = 1.0):
        """Start monitoring system resources."""
        self.monitoring = True
        self.metrics.clear()
        self.monitor_thread = threading.Thread(target=self._monitor_loop, args=(interval,))
        self.monitor_thread.start()
        
    def stop_monitoring(self) -> List[SystemMetrics]:
        """Stop monitoring and return collected metrics."""
        self.monitoring = False
        if self.monitor_thread:
            self.monitor_thread.join()
        return self.metrics.copy()
        
    def _monitor_loop(self, interval: float):
        """Monitor loop that collects metrics."""
        process = psutil.Process()
        
        while self.monitoring:
            try:
                # CPU and memory
                cpu_percent = process.cpu_percent(interval=None)
                memory_mb = process.memory_info().rss / (1024 * 1024)
                
                # Disk I/O
                disk_io = process.io_counters()
                disk_read_mb = disk_io.read_bytes / (1024 * 1024)
                disk_write_mb = disk_io.write_bytes / (1024 * 1024)
                
                # Network (system-wide approximation)
                net_io = psutil.net_io_counters()
                
                metrics = SystemMetrics(
                    cpu_percent=cpu_percent,
                    memory_mb=memory_mb,
                    disk_io_read_mb=disk_read_mb,
                    disk_io_write_mb=disk_write_mb,
                    network_bytes_sent=net_io.bytes_sent,
                    network_bytes_recv=net_io.bytes_recv
                )
                
                self.metrics.append(metrics)
                time.sleep(interval)
                
            except Exception as e:
                logger.warning(f"Resource monitoring error: {e}")
                break


class ClaudeFlowRealExecutor:
    """Real executor for Claude Flow commands with comprehensive metrics."""
    
    def __init__(self, 
                 claude_flow_path: Optional[str] = None,
                 working_dir: Optional[str] = None):
        """
        Initialize real executor.
        
        Args:
            claude_flow_path: Path to claude-flow executable
            working_dir: Working directory for execution
        """
        self.executor = ClaudeFlowExecutor(
            claude_flow_path=claude_flow_path,
            working_dir=working_dir
        )
        self.resource_monitor = ResourceMonitor()
        
    def execute_swarm(self,
                     objective: str,
                     strategy: str = "auto",
                     mode: str = "hierarchical", 
                     max_agents: int = 5,
                     timeout: int = 10,
                     non_interactive: bool = True) -> RealBenchmarkResult:
        """
        Execute real swarm with ./claude-flow and measure performance.
        
        Args:
            objective: Task objective
            strategy: Execution strategy 
            mode: Coordination mode
            max_agents: Maximum agents
            timeout: Timeout in minutes
            non_interactive: Run non-interactively
            
        Returns:
            RealBenchmarkResult with actual metrics
        """
        start_time = time.time()
        
        # Configure swarm
        config = SwarmConfig(
            objective=objective,
            strategy=ExecutionStrategy(strategy),
            mode=CoordinationMode(mode),
            max_agents=max_agents,
            timeout=timeout,
            output_dir="./benchmark_results"
        )
        
        # Start resource monitoring
        self.resource_monitor.start_monitoring()
        
        try:
            # Execute real command
            result = self.executor.execute_swarm(config)
            execution_time = time.time() - start_time
            
            # Stop monitoring and get metrics
            resource_metrics = self.resource_monitor.stop_monitoring()
            
            # Parse real output for metrics
            tokens_used = self._extract_token_usage(result.stdout)
            agents_spawned = self._extract_agent_count(result.stdout)
            output_size = len(result.stdout.encode('utf-8'))
            
            # Calculate resource averages
            avg_memory = sum(m.memory_mb for m in resource_metrics) / len(resource_metrics) if resource_metrics else 0
            avg_cpu = sum(m.cpu_percent for m in resource_metrics) / len(resource_metrics) if resource_metrics else 0
            
            return RealBenchmarkResult(
                benchmark_name=f"swarm_{strategy}_{mode}",
                success=result.success,
                execution_time=execution_time,
                tokens_used=tokens_used,
                agents_spawned=agents_spawned,
                memory_usage_mb=avg_memory,
                cpu_usage_percent=avg_cpu,
                output_size_bytes=output_size,
                error_count=result.metrics.get('errors', 0) if result.metrics else 0,
                warning_count=result.metrics.get('warnings', 0) if result.metrics else 0,
                command_executed=result.command,
                stdout_excerpt=result.stdout[:500],
                stderr_excerpt=result.stderr[:500],
                metrics_raw=result.metrics or {},
                timestamp=datetime.now().isoformat()
            )
            
        except Exception as e:
            self.resource_monitor.stop_monitoring()
            logger.error(f"Swarm execution failed: {e}")
            
            return RealBenchmarkResult(
                benchmark_name=f"swarm_{strategy}_{mode}",
                success=False,
                execution_time=time.time() - start_time,
                tokens_used=0,
                agents_spawned=0,
                memory_usage_mb=0,
                cpu_usage_percent=0,
                output_size_bytes=0,
                error_count=1,
                warning_count=0,
                command_executed=[],
                stdout_excerpt="",
                stderr_excerpt=str(e),
                metrics_raw={},
                timestamp=datetime.now().isoformat()
            )
    
    def execute_hive_mind(self,
                         task: str,
                         collective_mode: str = "consensus",
                         agent_count: int = 8,
                         timeout: int = 15) -> RealBenchmarkResult:
        """
        Execute real hive-mind with ./claude-flow.
        
        Args:
            task: Hive-mind task
            collective_mode: Collective intelligence mode
            agent_count: Number of agents
            timeout: Timeout in minutes
            
        Returns:
            RealBenchmarkResult with actual metrics
        """
        start_time = time.time()
        
        # Start resource monitoring
        self.resource_monitor.start_monitoring()
        
        try:
            # Build hive-mind command 
            command = [
                self.executor.claude_flow_path,
                "hive-mind",
                task,
                "--mode", collective_mode,
                "--agents", str(agent_count),
                "--timeout", str(timeout),
                "--non-interactive"
            ]
            
            # Execute real command
            result = subprocess.run(
                command,
                cwd=str(self.executor.working_dir),
                env=self.executor.env,
                capture_output=True,
                text=True,
                timeout=timeout * 60
            )
            
            execution_time = time.time() - start_time
            
            # Stop monitoring and get metrics
            resource_metrics = self.resource_monitor.stop_monitoring()
            
            # Parse real output
            tokens_used = self._extract_token_usage(result.stdout)
            agents_spawned = self._extract_agent_count(result.stdout)
            output_size = len(result.stdout.encode('utf-8'))
            
            # Calculate resource averages
            avg_memory = sum(m.memory_mb for m in resource_metrics) / len(resource_metrics) if resource_metrics else 0
            avg_cpu = sum(m.cpu_percent for m in resource_metrics) / len(resource_metrics) if resource_metrics else 0
            
            return RealBenchmarkResult(
                benchmark_name=f"hive_mind_{collective_mode}",
                success=result.returncode == 0,
                execution_time=execution_time,
                tokens_used=tokens_used,
                agents_spawned=agents_spawned,
                memory_usage_mb=avg_memory,
                cpu_usage_percent=avg_cpu,
                output_size_bytes=output_size,
                error_count=self._count_errors(result.stderr),
                warning_count=self._count_warnings(result.stderr),
                command_executed=command,
                stdout_excerpt=result.stdout[:500],
                stderr_excerpt=result.stderr[:500],
                metrics_raw=self._parse_json_metrics(result.stdout),
                timestamp=datetime.now().isoformat()
            )
            
        except Exception as e:
            self.resource_monitor.stop_monitoring()
            logger.error(f"Hive-mind execution failed: {e}")
            
            return RealBenchmarkResult(
                benchmark_name=f"hive_mind_{collective_mode}",
                success=False,
                execution_time=time.time() - start_time,
                tokens_used=0,
                agents_spawned=0,
                memory_usage_mb=0,
                cpu_usage_percent=0,
                output_size_bytes=0,
                error_count=1,
                warning_count=0,
                command_executed=[],
                stdout_excerpt="",
                stderr_excerpt=str(e),
                metrics_raw={},
                timestamp=datetime.now().isoformat()
            )
    
    def execute_sparc_mode(self,
                          mode: str,
                          task: str,
                          timeout: int = 10) -> RealBenchmarkResult:
        """
        Execute real SPARC mode with ./claude-flow.
        
        Args:
            mode: SPARC mode to run
            task: Task description
            timeout: Timeout in minutes
            
        Returns:
            RealBenchmarkResult with actual metrics
        """
        start_time = time.time()
        
        # Start resource monitoring
        self.resource_monitor.start_monitoring()
        
        try:
            # Build SPARC command
            command = [
                self.executor.claude_flow_path,
                "sparc",
                "run",
                mode,
                task,
                "--timeout", str(timeout),
                "--non-interactive"
            ]
            
            # Execute real command
            result = subprocess.run(
                command,
                cwd=str(self.executor.working_dir),
                env=self.executor.env,
                capture_output=True,
                text=True,
                timeout=timeout * 60
            )
            
            execution_time = time.time() - start_time
            
            # Stop monitoring and get metrics
            resource_metrics = self.resource_monitor.stop_monitoring()
            
            # Parse real output
            tokens_used = self._extract_token_usage(result.stdout)
            agents_spawned = self._extract_agent_count(result.stdout)
            output_size = len(result.stdout.encode('utf-8'))
            
            # Calculate resource averages
            avg_memory = sum(m.memory_mb for m in resource_metrics) / len(resource_metrics) if resource_metrics else 0
            avg_cpu = sum(m.cpu_percent for m in resource_metrics) / len(resource_metrics) if resource_metrics else 0
            
            return RealBenchmarkResult(
                benchmark_name=f"sparc_{mode}",
                success=result.returncode == 0,
                execution_time=execution_time,
                tokens_used=tokens_used,
                agents_spawned=agents_spawned,
                memory_usage_mb=avg_memory,
                cpu_usage_percent=avg_cpu,
                output_size_bytes=output_size,
                error_count=self._count_errors(result.stderr),
                warning_count=self._count_warnings(result.stderr),
                command_executed=command,
                stdout_excerpt=result.stdout[:500],
                stderr_excerpt=result.stderr[:500],
                metrics_raw=self._parse_json_metrics(result.stdout),
                timestamp=datetime.now().isoformat()
            )
            
        except Exception as e:
            self.resource_monitor.stop_monitoring()
            logger.error(f"SPARC execution failed: {e}")
            
            return RealBenchmarkResult(
                benchmark_name=f"sparc_{mode}",
                success=False,
                execution_time=time.time() - start_time,
                tokens_used=0,
                agents_spawned=0,
                memory_usage_mb=0,
                cpu_usage_percent=0,
                output_size_bytes=0,
                error_count=1,
                warning_count=0,
                command_executed=[],
                stdout_excerpt="",
                stderr_excerpt=str(e),
                metrics_raw={},
                timestamp=datetime.now().isoformat()
            )
    
    def _extract_token_usage(self, output: str) -> int:
        """Extract token usage from Claude Flow output."""
        # Look for token patterns in output
        patterns = [
            r'tokens?[:\s]+(\d+)',
            r'total[_\s]tokens?[:\s]+(\d+)',
            r'consumed[_\s]tokens?[:\s]+(\d+)',
            r'token[_\s]count[:\s]+(\d+)'
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, output, re.IGNORECASE)
            if matches:
                return int(matches[-1])  # Return last match
                
        return 0
    
    def _extract_agent_count(self, output: str) -> int:
        """Extract agent count from Claude Flow output."""
        patterns = [
            r'(\d+)\s+agents?\s+(?:spawned|created|active)',
            r'agents?[:\s]+(\d+)',
            r'spawned[_\s](\d+)[_\s]agents?'
        ]
        
        for pattern in patterns:
            matches = re.findall(pattern, output, re.IGNORECASE)
            if matches:
                return int(matches[-1])  # Return last match
                
        return 0
    
    def _count_errors(self, text: str) -> int:
        """Count error occurrences in text."""
        return len(re.findall(r'error', text, re.IGNORECASE))
    
    def _count_warnings(self, text: str) -> int:
        """Count warning occurrences in text."""
        return len(re.findall(r'warning', text, re.IGNORECASE))
    
    def _parse_json_metrics(self, output: str) -> Dict[str, Any]:
        """Parse JSON metrics from output."""
        # Look for JSON blocks in output
        json_pattern = r'\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
        matches = re.findall(json_pattern, output)
        
        for match in matches:
            try:
                data = json.loads(match)
                if any(key in data for key in ['metrics', 'performance', 'stats', 'tokens']):
                    return data
            except json.JSONDecodeError:
                continue
                
        return {}


class RealSwarmBenchmark:
    """Real swarm benchmark scenarios."""
    
    def __init__(self, 
                 claude_flow_path: Optional[str] = None,
                 working_dir: Optional[str] = None):
        """Initialize real swarm benchmark."""
        self.executor = ClaudeFlowRealExecutor(claude_flow_path, working_dir)
        
    def benchmark_swarm_task(self, objective: str) -> RealBenchmarkResult:
        """
        Run real swarm with ./claude-flow and measure performance.
        
        Args:
            objective: Task objective
            
        Returns:
            RealBenchmarkResult with actual metrics
        """
        return self.executor.execute_swarm(
            objective=objective,
            strategy="auto",
            mode="hierarchical",
            max_agents=5,
            non_interactive=True
        )
    
    def benchmark_development_swarm(self, task: str) -> RealBenchmarkResult:
        """Benchmark development-focused swarm."""
        return self.executor.execute_swarm(
            objective=task,
            strategy="development",
            mode="centralized",
            max_agents=4,
            timeout=15
        )
    
    def benchmark_research_swarm(self, topic: str) -> RealBenchmarkResult:
        """Benchmark research-focused swarm.""" 
        return self.executor.execute_swarm(
            objective=f"Research {topic}",
            strategy="research",
            mode="distributed",
            max_agents=6,
            timeout=12
        )
    
    def benchmark_optimization_swarm(self, target: str) -> RealBenchmarkResult:
        """Benchmark optimization-focused swarm."""
        return self.executor.execute_swarm(
            objective=f"Optimize {target}",
            strategy="optimization",
            mode="hybrid",
            max_agents=3,
            timeout=8
        )


class RealHiveMindBenchmark:
    """Real hive-mind benchmark scenarios."""
    
    def __init__(self,
                 claude_flow_path: Optional[str] = None,
                 working_dir: Optional[str] = None):
        """Initialize real hive-mind benchmark."""
        self.executor = ClaudeFlowRealExecutor(claude_flow_path, working_dir)
        
    def benchmark_hive_mind(self, task: str) -> RealBenchmarkResult:
        """
        Run real hive-mind with ./claude-flow and measure performance.
        
        Args:
            task: Hive-mind task
            
        Returns:
            RealBenchmarkResult with actual metrics
        """
        return self.executor.execute_hive_mind(
            task=task,
            collective_mode="consensus",
            agent_count=8,
            timeout=15
        )
    
    def benchmark_collective_intelligence(self, problem: str) -> RealBenchmarkResult:
        """Benchmark collective intelligence mode."""
        return self.executor.execute_hive_mind(
            task=f"Solve: {problem}",
            collective_mode="collective-intelligence",
            agent_count=12,
            timeout=20
        )
    
    def benchmark_swarm_memory(self, task: str) -> RealBenchmarkResult:
        """Benchmark swarm with shared memory."""
        return self.executor.execute_hive_mind(
            task=task,
            collective_mode="memory-shared",
            agent_count=6,
            timeout=10
        )


class RealSparcBenchmark:
    """Real SPARC benchmark scenarios."""
    
    def __init__(self,
                 claude_flow_path: Optional[str] = None,
                 working_dir: Optional[str] = None):
        """Initialize real SPARC benchmark."""
        self.executor = ClaudeFlowRealExecutor(claude_flow_path, working_dir)
        
    def benchmark_sparc_modes(self, mode: str, task: str) -> RealBenchmarkResult:
        """
        Run real SPARC modes with ./claude-flow and measure performance.
        
        Args:
            mode: SPARC mode to run
            task: Task description
            
        Returns:
            RealBenchmarkResult with actual metrics
        """
        return self.executor.execute_sparc_mode(mode, task)
    
    def benchmark_coder_mode(self, task: str) -> RealBenchmarkResult:
        """Benchmark SPARC coder mode."""
        return self.executor.execute_sparc_mode("coder", task)
    
    def benchmark_tdd_mode(self, feature: str) -> RealBenchmarkResult:
        """Benchmark SPARC TDD mode."""
        return self.executor.execute_sparc_mode("tdd", f"Implement {feature} with TDD")
    
    def benchmark_architect_mode(self, system: str) -> RealBenchmarkResult:
        """Benchmark SPARC architect mode."""
        return self.executor.execute_sparc_mode("architect", f"Design architecture for {system}")
    
    def benchmark_optimizer_mode(self, target: str) -> RealBenchmarkResult:
        """Benchmark SPARC optimizer mode."""
        return self.executor.execute_sparc_mode("optimizer", f"Optimize {target}")


# Comprehensive benchmark runner
class RealBenchmarkSuite:
    """Suite of real benchmarks for comprehensive testing."""
    
    def __init__(self,
                 claude_flow_path: Optional[str] = None,
                 working_dir: Optional[str] = None,
                 output_dir: str = "./real_benchmark_results"):
        """Initialize benchmark suite."""
        self.swarm_bench = RealSwarmBenchmark(claude_flow_path, working_dir)
        self.hive_bench = RealHiveMindBenchmark(claude_flow_path, working_dir)
        self.sparc_bench = RealSparcBenchmark(claude_flow_path, working_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        
    def run_comprehensive_benchmark(self) -> Dict[str, List[RealBenchmarkResult]]:
        """Run comprehensive benchmark suite."""
        results = {
            "swarm_benchmarks": [],
            "hive_mind_benchmarks": [],
            "sparc_benchmarks": []
        }
        
        # Swarm benchmarks
        swarm_scenarios = [
            ("Create a simple API endpoint", "development"),
            ("Analyze performance bottlenecks", "analysis"),
            ("Research machine learning trends", "research"),
            ("Optimize database queries", "optimization")
        ]
        
        for task, strategy in swarm_scenarios:
            result = self.swarm_bench.executor.execute_swarm(
                objective=task,
                strategy=strategy,
                mode="hierarchical",
                max_agents=4,
                timeout=8
            )
            results["swarm_benchmarks"].append(result)
        
        # Hive-mind benchmarks  
        hive_scenarios = [
            ("Design distributed system architecture", "consensus"),
            ("Solve complex optimization problem", "collective-intelligence"),
            ("Collaborate on code review", "memory-shared")
        ]
        
        for task, mode in hive_scenarios:
            result = self.hive_bench.executor.execute_hive_mind(
                task=task,
                collective_mode=mode,
                agent_count=6,
                timeout=12
            )
            results["hive_mind_benchmarks"].append(result)
        
        # SPARC benchmarks
        sparc_scenarios = [
            ("coder", "Implement user authentication"),
            ("tdd", "Create payment processor"),
            ("architect", "Design microservices system"),
            ("optimizer", "Improve API response times")
        ]
        
        for mode, task in sparc_scenarios:
            result = self.sparc_bench.executor.execute_sparc_mode(mode, task)
            results["sparc_benchmarks"].append(result)
        
        # Save results
        self._save_results(results)
        return results
    
    def _save_results(self, results: Dict[str, List[RealBenchmarkResult]]):
        """Save benchmark results to file."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = self.output_dir / f"comprehensive_benchmark_{timestamp}.json"
        
        # Convert to serializable format
        serializable_results = {}
        for category, result_list in results.items():
            serializable_results[category] = [r.to_dict() for r in result_list]
        
        with open(output_file, 'w') as f:
            json.dump(serializable_results, f, indent=2)
        
        logger.info(f"Benchmark results saved to {output_file}")