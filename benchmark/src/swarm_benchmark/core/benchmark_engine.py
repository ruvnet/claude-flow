"""Main benchmark engine for orchestrating swarm tests."""

import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional
from pathlib import Path

from .models import Benchmark, Task, Result, BenchmarkConfig, TaskStatus, StrategyType, CoordinationMode
from ..strategies import create_strategy
from ..output.json_writer import JSONWriter
from ..output.sqlite_manager import SQLiteManager


class BenchmarkEngine:
    """Main engine for running swarm benchmarks."""
    
    def __init__(self, config: Optional[BenchmarkConfig] = None):
        """Initialize the benchmark engine."""
        self.config = config or BenchmarkConfig()
        self.status = "READY"
        self.task_queue = []
        self.current_benchmark: Optional[Benchmark] = None
    
    def submit_task(self, task: Task) -> None:
        """Submit a task to the benchmark queue."""
        self.task_queue.append(task)
    
    async def run_benchmark(self, objective: str) -> Dict[str, Any]:
        """Run a complete benchmark for the given objective.
        
        Args:
            objective: The main objective for the benchmark
            
        Returns:
            Benchmark results dictionary
        """
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
            # Execute the task using the specified strategy
            strategy = create_strategy(self.config.strategy.value.lower())
            result = await strategy.execute(main_task)
            
            # Add result to benchmark
            benchmark.add_result(result)
            benchmark.status = TaskStatus.COMPLETED
            benchmark.completed_at = datetime.now()
            
            # Save results
            await self._save_results(benchmark)
            
            return {
                "benchmark_id": benchmark.id,
                "status": "success",
                "summary": f"Completed {len(benchmark.results)} tasks",
                "duration": benchmark.duration(),
                "results": [self._result_to_dict(r) for r in benchmark.results]
            }
            
        except Exception as e:
            benchmark.status = TaskStatus.FAILED
            benchmark.completed_at = datetime.now()
            benchmark.error_log.append(str(e))
            
            return {
                "benchmark_id": benchmark.id,
                "status": "failed",
                "error": str(e),
                "duration": benchmark.duration()
            }
    
    async def execute_batch(self, tasks: List[Task]) -> List[Result]:
        """Execute a batch of tasks."""
        results = []
        
        for task in tasks:
            try:
                strategy = create_strategy(task.strategy.value.lower() if hasattr(task.strategy, 'value') else task.strategy)
                result = await strategy.execute(task)
                results.append(result)
            except Exception as e:
                # Create error result
                error_result = Result(
                    task_id=task.id,
                    agent_id="error-agent",
                    status="ERROR",
                    output={},
                    errors=[str(e)]
                )
                results.append(error_result)
        
        return results
    
    async def _save_results(self, benchmark: Benchmark) -> None:
        """Save benchmark results to configured output formats."""
        output_dir = Path(self.config.output_directory)
        output_dir.mkdir(exist_ok=True)
        
        for format_type in self.config.output_formats:
            if format_type == "json":
                writer = JSONWriter()
                await writer.save_benchmark(benchmark, output_dir)
            elif format_type == "sqlite":
                manager = SQLiteManager()
                await manager.save_benchmark(benchmark, output_dir)
    
    def _result_to_dict(self, result: Result) -> Dict[str, Any]:
        """Convert result to dictionary for JSON serialization."""
        return {
            "id": result.id,
            "task_id": result.task_id,
            "agent_id": result.agent_id,
            "status": result.status.value,
            "output": result.output,
            "errors": result.errors,
            "warnings": result.warnings,
            "execution_time": result.performance_metrics.execution_time,
            "resource_usage": {
                "cpu_percent": result.resource_usage.cpu_percent,
                "memory_mb": result.resource_usage.memory_mb
            },
            "created_at": result.created_at.isoformat(),
            "completed_at": result.completed_at.isoformat() if result.completed_at else None
        }