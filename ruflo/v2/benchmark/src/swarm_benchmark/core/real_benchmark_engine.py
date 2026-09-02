"""Enhanced benchmark engine with real metrics collection."""

import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path
import subprocess
import json

from .models import (
    Benchmark, Task, Result, BenchmarkConfig, TaskStatus, 
    StrategyType, CoordinationMode, ResultStatus, PerformanceMetrics,
    ResourceUsage
)
from .benchmark_engine import BenchmarkEngine
from ..metrics.metrics_aggregator import MetricsAggregator
from ..metrics.process_tracker import ProcessTracker, ProcessExecutionResult
from ..strategies import create_strategy
from ..output.json_writer import JSONWriter
from ..output.sqlite_manager import SQLiteManager


class RealBenchmarkEngine(BenchmarkEngine):
    """Benchmark engine with real metrics collection for claude-flow."""
    
    def __init__(self, config: Optional[BenchmarkConfig] = None):
        """Initialize the real benchmark engine."""
        super().__init__(config)
        self.metrics_aggregator = MetricsAggregator()
        self.process_tracker = self.metrics_aggregator.get_process_tracker()
        
    async def run_benchmark(self, objective: str) -> Dict[str, Any]:
        """Run a complete benchmark with real metrics collection.
        
        Args:
            objective: The main objective for the benchmark
            
        Returns:
            Benchmark results dictionary with real metrics
        """
        # Start metrics collection
        self.metrics_aggregator.start_collection()
        
        # Create the main task
        main_task = Task(
            objective=objective,
            description=f"Benchmark task: {objective}",
            strategy=self.config.strategy,
            mode=self.config.mode,
            timeout=self.config.task_timeout,
            max_retries=self.config.max_retries
        )
        
        # Create benchmark
        benchmark = Benchmark(
            name=self.config.name,
            description=self.config.description,
            config=self.config
        )
        benchmark.add_task(main_task)
        benchmark.status = TaskStatus.RUNNING
        benchmark.started_at = datetime.now()
        
        self.current_benchmark = benchmark
        
        try:
            # Execute the task with real process tracking
            result = await self._execute_task_with_metrics(main_task)
            
            # Add result to benchmark
            benchmark.add_result(result)
            benchmark.status = TaskStatus.COMPLETED
            benchmark.completed_at = datetime.now()
            
            # Stop metrics collection and get aggregated metrics
            aggregated_metrics = self.metrics_aggregator.stop_collection()
            
            # Update benchmark metrics with real data
            benchmark.metrics = self.metrics_aggregator.aggregate_benchmark_results(benchmark.results)
            
            # Save results
            await self._save_results(benchmark)
            
            # Save detailed metrics report
            metrics_path = Path(self.config.output_directory) / f"metrics_{benchmark.id}.json"
            self.metrics_aggregator.save_detailed_report(metrics_path)
            
            # Save process execution report
            process_report_path = Path(self.config.output_directory) / f"process_report_{benchmark.id}.json"
            self.process_tracker.save_execution_report(process_report_path)
            
            return {
                "benchmark_id": benchmark.id,
                "status": "success",
                "summary": f"Completed {len(benchmark.results)} tasks",
                "duration": benchmark.duration(),
                "metrics": {
                    "wall_clock_time": aggregated_metrics.wall_clock_time,
                    "tasks_per_second": aggregated_metrics.tasks_per_second,
                    "success_rate": aggregated_metrics.success_rate,
                    "peak_memory_mb": aggregated_metrics.peak_memory_mb,
                    "average_cpu_percent": aggregated_metrics.average_cpu_percent,
                    "total_output_lines": aggregated_metrics.total_output_size
                },
                "results": [self._result_to_dict(r) for r in benchmark.results]
            }
            
        except Exception as e:
            # Stop metrics collection even on failure
            aggregated_metrics = self.metrics_aggregator.stop_collection()
            
            benchmark.status = TaskStatus.FAILED
            benchmark.completed_at = datetime.now()
            benchmark.error_log.append(str(e))
            
            return {
                "benchmark_id": benchmark.id,
                "status": "failed",
                "error": str(e),
                "duration": benchmark.duration(),
                "metrics": {
                    "wall_clock_time": aggregated_metrics.wall_clock_time,
                    "peak_memory_mb": aggregated_metrics.peak_memory_mb
                }
            }
    
    async def _execute_task_with_metrics(self, task: Task) -> Result:
        """Execute a task with real metrics collection."""
        # Convert task to claude-flow command
        command = self._task_to_command(task)
        
        # Create performance collector for this task
        perf_collector = self.metrics_aggregator.create_performance_collector(task.id)
        resource_monitor = self.metrics_aggregator.create_resource_monitor(task.id)
        
        # Execute command with process tracking
        execution_result = await self.process_tracker.execute_command_async(
            command,
            timeout=task.timeout,
            env={"CLAUDE_FLOW_BENCHMARK": "true"}
        )
        
        # Create result from execution
        result = Result(
            task_id=task.id,
            agent_id="claude-flow",
            status=ResultStatus.SUCCESS if execution_result.success else ResultStatus.FAILURE,
            output=self._parse_output(execution_result.stdout),
            errors=execution_result.stderr.splitlines() if execution_result.stderr else [],
            performance_metrics=execution_result.performance_metrics,
            resource_usage=execution_result.resource_usage,
            started_at=datetime.fromtimestamp(execution_result.start_time),
            completed_at=datetime.fromtimestamp(execution_result.end_time),
            execution_details={
                "command": " ".join(execution_result.command),
                "exit_code": execution_result.exit_code,
                "output_lines": execution_result.output_size,
                "error_count": execution_result.error_count
            }
        )
        
        # Update quality metrics based on output
        result.quality_metrics.completeness_score = 1.0 if execution_result.success else 0.0
        result.quality_metrics.accuracy_score = 1.0 - (execution_result.error_count / max(1, execution_result.output_size))
        result.quality_metrics.overall_quality = (result.quality_metrics.completeness_score + result.quality_metrics.accuracy_score) / 2
        
        return result
    
    def _task_to_command(self, task: Task) -> List[str]:
        """Convert a task to claude-flow command arguments."""
        command = []
        
        # Check if we should use swarm (based on config or task objective)
        use_swarm = (
            task.parameters.get("use_swarm", False) or
            self.config.parameters.get("force_swarm", False)
        )
        
        if use_swarm:
            # Use swarm command with executor for non-interactive mode
            command.extend(["swarm", task.objective])
            command.extend(["--strategy", task.strategy.value])
            command.extend(["--mode", task.mode.value])
            command.append("--executor")  # Use built-in executor for non-interactive
        else:
            # Determine command type based on task strategy
            # Map strategies to valid SPARC modes: spec, architect, tdd, integration, refactor
            if task.strategy == StrategyType.RESEARCH:
                command.extend(["sparc", "spec", task.objective])
            elif task.strategy == StrategyType.DEVELOPMENT:
                command.extend(["sparc", "tdd", task.objective])
            elif task.strategy == StrategyType.ANALYSIS:
                command.extend(["sparc", "architect", task.objective])
            elif task.strategy == StrategyType.TESTING:
                command.extend(["sparc", "integration", task.objective])
            elif task.strategy == StrategyType.OPTIMIZATION:
                command.extend(["sparc", "refactor", task.objective])
            else:
                # Default to swarm for unknown strategies with executor
                command.extend(["swarm", task.objective])
                command.extend(["--strategy", task.strategy.value])
                command.extend(["--mode", task.mode.value])
                command.append("--executor")  # Use built-in executor for non-interactive
        
        # Add common parameters
        if task.parameters.get("parallel"):
            command.append("--parallel")
        if task.parameters.get("max_agents"):
            command.extend(["--max-agents", str(task.parameters["max_agents"])])
        if task.parameters.get("monitor"):
            command.append("--monitor")
            
        return command
    
    def _parse_output(self, stdout: str) -> Dict[str, Any]:
        """Parse claude-flow output into structured data."""
        output = {
            "raw_output": stdout,
            "lines": stdout.splitlines(),
            "sections": {}
        }
        
        # Try to extract structured sections
        current_section = None
        section_lines = []
        
        for line in output["lines"]:
            # Detect section headers
            if line.startswith("##") or line.startswith("**"):
                if current_section and section_lines:
                    output["sections"][current_section] = "\n".join(section_lines)
                current_section = line.strip("#* ")
                section_lines = []
            elif current_section:
                section_lines.append(line)
                
        # Add last section
        if current_section and section_lines:
            output["sections"][current_section] = "\n".join(section_lines)
            
        # Try to extract JSON data if present
        try:
            # Look for JSON blocks in output
            import re
            json_pattern = r'```json\n(.*?)\n```'
            json_matches = re.findall(json_pattern, stdout, re.DOTALL)
            if json_matches:
                output["json_data"] = []
                for match in json_matches:
                    try:
                        output["json_data"].append(json.loads(match))
                    except json.JSONDecodeError:
                        pass
        except Exception:
            pass
            
        return output
    
    async def execute_batch(self, tasks: List[Task]) -> List[Result]:
        """Execute a batch of tasks with metrics collection."""
        results = []
        
        # Start overall metrics collection
        self.metrics_aggregator.start_collection()
        
        try:
            # Execute tasks (potentially in parallel based on config)
            if self.config.parallel:
                # Parallel execution with semaphore to limit concurrency
                semaphore = asyncio.Semaphore(self.config.max_agents)
                
                async def execute_with_limit(task):
                    async with semaphore:
                        return await self._execute_task_with_metrics(task)
                
                results = await asyncio.gather(*[execute_with_limit(task) for task in tasks])
            else:
                # Sequential execution
                for task in tasks:
                    result = await self._execute_task_with_metrics(task)
                    results.append(result)
        finally:
            # Stop metrics collection
            self.metrics_aggregator.stop_collection()
            
        return results
    
    def cleanup(self):
        """Clean up resources used by the benchmark engine."""
        try:
            # Stop metrics collection if still running
            if hasattr(self, 'metrics_aggregator'):
                self.metrics_aggregator.stop_collection()
            
            # Clean up any process trackers if they have cleanup method
            if hasattr(self, 'process_tracker') and hasattr(self.process_tracker, 'cleanup'):
                self.process_tracker.cleanup()
                
            # Any other cleanup needed
            pass
        except Exception as e:
            # Log but don't raise - cleanup should be safe
            import logging
            logging.warning(f"Error during cleanup: {e}")