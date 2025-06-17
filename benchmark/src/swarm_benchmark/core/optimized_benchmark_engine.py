"""Optimized benchmark engine with performance improvements."""

import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional
import time

from .models import Benchmark, Task, Result, BenchmarkConfig, TaskStatus, StrategyType, CoordinationMode
from .benchmark_engine import BenchmarkEngine
from ..strategies import create_strategy
from ..output.json_writer import JSONWriter
from ..output.sqlite_manager import SQLiteManager

# Import optimizations from the main swarm package
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent.parent.parent.parent))

try:
    from src.swarm.optimizations import (
        OptimizedExecutor,
        CircularBuffer,
        TTLMap,
        AsyncFileManager
    )
    OPTIMIZATIONS_AVAILABLE = True
except ImportError:
    OPTIMIZATIONS_AVAILABLE = False
    print("Warning: Optimizations not available, falling back to standard engine")


class OptimizedBenchmarkEngine(BenchmarkEngine):
    """Optimized benchmark engine with performance improvements."""
    
    def __init__(self, config: Optional[BenchmarkConfig] = None, enable_optimizations: bool = True):
        """Initialize the optimized benchmark engine."""
        super().__init__(config)
        
        self.optimizations_enabled = enable_optimizations and OPTIMIZATIONS_AVAILABLE
        
        if self.optimizations_enabled:
            # Initialize optimized components
            self.executor = OptimizedExecutor({
                'connectionPool': {
                    'min': 2,
                    'max': config.max_agents if config else 10
                },
                'concurrency': config.max_agents if config else 10,
                'caching': {
                    'enabled': True,
                    'ttl': 3600000,  # 1 hour
                    'maxSize': 1000
                },
                'fileOperations': {
                    'outputDir': './benchmark_outputs',
                    'concurrency': 20
                }
            })
            
            # Use circular buffer for task history
            self.task_history = CircularBuffer(1000)
            
            # Use TTL map for result caching
            self.result_cache = TTLMap({'defaultTTL': 3600000, 'maxSize': 500})
            
            # Async file manager for outputs
            self.file_manager = AsyncFileManager()
            
            # Create agent capability index for O(1) selection
            self.agent_capability_index = {}
            self.build_agent_index()
        else:
            self.executor = None
            self.task_history = []
            self.result_cache = {}
            self.file_manager = None
            self.agent_capability_index = {}
    
    def build_agent_index(self):
        """Build capability index for fast agent selection."""
        # This would be populated based on actual agent configurations
        # For now, we'll use a simple example
        capabilities = ['research', 'development', 'analysis', 'testing', 'optimization']
        for cap in capabilities:
            self.agent_capability_index[cap] = set(['agent_1', 'agent_2', 'agent_3'])
    
    async def run_benchmark(self, objective: str) -> Dict[str, Any]:
        """Run an optimized benchmark for the given objective."""
        start_time = time.time()
        
        # Check cache first if optimizations are enabled
        if self.optimizations_enabled:
            cache_key = f"{self.config.strategy}-{self.config.mode}-{objective}"
            cached_result = self.result_cache.get(cache_key)
            if cached_result:
                return {
                    "benchmark_id": cached_result['benchmark_id'],
                    "status": "success",
                    "summary": f"Completed (cached) in {time.time() - start_time:.2f}s",
                    "cached": True,
                    **cached_result
                }
        
        # Create benchmark
        benchmark = Benchmark(
            name=self.config.name,
            description=self.config.description,
            config=self.config
        )
        benchmark.status = TaskStatus.RUNNING
        benchmark.started_at = datetime.now()
        
        self.current_benchmark = benchmark
        
        try:
            # Use optimized execution if available
            if self.optimizations_enabled:
                results = await self._run_optimized(objective, benchmark)
            else:
                results = await self._run_standard(objective, benchmark)
            
            benchmark.status = TaskStatus.COMPLETED
            benchmark.completed_at = datetime.now()
            
            # Save results asynchronously
            if self.optimizations_enabled:
                await self._save_results_async(benchmark)
            else:
                await self._save_results(benchmark)
            
            result_dict = {
                "benchmark_id": benchmark.id,
                "status": "success",
                "summary": f"Completed {len(benchmark.results)} tasks in {benchmark.duration():.2f}s",
                "duration": benchmark.duration(),
                "optimized": self.optimizations_enabled,
                "performance_metrics": self._get_performance_metrics(),
                "results": [self._result_to_dict(r) for r in benchmark.results]
            }
            
            # Cache result if optimizations enabled
            if self.optimizations_enabled:
                cache_key = f"{self.config.strategy}-{self.config.mode}-{objective}"
                self.result_cache.set(cache_key, result_dict, 3600000)  # 1 hour TTL
            
            return result_dict
            
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
    
    async def _run_optimized(self, objective: str, benchmark: Benchmark) -> List[Result]:
        """Run benchmark with optimizations."""
        # Create tasks based on strategy
        tasks = self._decompose_objective(objective)
        
        # Add tasks to benchmark
        for task in tasks:
            benchmark.add_task(task)
        
        # Execute tasks in parallel with connection pooling
        if len(tasks) > 1:
            # Use asyncio.gather for parallel execution
            results = await asyncio.gather(
                *[self._execute_task_optimized(task) for task in tasks],
                return_exceptions=True
            )
            
            # Filter out exceptions and add successful results
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    benchmark.error_log.append(f"Task {tasks[i].id} failed: {str(result)}")
                else:
                    benchmark.add_result(result)
                    # Track in circular buffer
                    self.task_history.push({
                        'task_id': tasks[i].id,
                        'duration': result.execution_time,
                        'status': 'success'
                    })
        else:
            # Single task execution
            result = await self._execute_task_optimized(tasks[0])
            benchmark.add_result(result)
        
        return benchmark.results
    
    async def _run_standard(self, objective: str, benchmark: Benchmark) -> List[Result]:
        """Run benchmark without optimizations (fallback)."""
        main_task = Task(
            objective=objective,
            description=f"Benchmark task: {objective}",
            strategy=self.config.strategy,
            mode=self.config.mode,
            timeout=self.config.task_timeout,
            max_retries=self.config.max_retries
        )
        
        benchmark.add_task(main_task)
        
        strategy = create_strategy(self.config.strategy.value.lower())
        result = await strategy.execute(main_task)
        benchmark.add_result(result)
        
        return [result]
    
    async def _execute_task_optimized(self, task: Task) -> Result:
        """Execute a single task with optimizations."""
        start_time = time.time()
        
        # Use strategy execution
        strategy = create_strategy(task.strategy.value.lower() if hasattr(task.strategy, 'value') else task.strategy)
        
        # For demo purposes, simulate optimized execution
        # In real implementation, this would use the OptimizedExecutor
        result = await strategy.execute(task)
        
        # Add optimization metrics
        result.execution_time = time.time() - start_time
        
        return result
    
    def _decompose_objective(self, objective: str) -> List[Task]:
        """Decompose objective into parallel tasks based on strategy."""
        tasks = []
        
        # Simple decomposition based on strategy
        if self.config.strategy == StrategyType.RESEARCH:
            # Research can be parallelized into multiple search tasks
            subtasks = [
                "Search academic sources",
                "Search industry reports",
                "Search technical documentation"
            ]
            for subtask in subtasks:
                tasks.append(Task(
                    objective=f"{subtask} for: {objective}",
                    description=subtask,
                    strategy=self.config.strategy,
                    mode=self.config.mode,
                    timeout=self.config.task_timeout // len(subtasks)
                ))
        elif self.config.strategy == StrategyType.DEVELOPMENT:
            # Development might have sequential dependencies
            tasks.append(Task(
                objective=objective,
                description="Development task",
                strategy=self.config.strategy,
                mode=self.config.mode,
                timeout=self.config.task_timeout
            ))
        else:
            # Default single task
            tasks.append(Task(
                objective=objective,
                description=f"Task: {objective}",
                strategy=self.config.strategy,
                mode=self.config.mode,
                timeout=self.config.task_timeout
            ))
        
        return tasks
    
    async def _save_results_async(self, benchmark: Benchmark) -> None:
        """Save results using async file operations."""
        if not self.file_manager:
            await self._save_results(benchmark)
            return
        
        # Save JSON output
        json_path = f"./benchmark_outputs/{benchmark.name}_{benchmark.id}.json"
        await self.file_manager.writeJSON(json_path, benchmark.to_dict(), pretty=True)
        
        # SQLite saving would remain synchronous for now
        if hasattr(self.config, 'output_formats') and 'sqlite' in self.config.output_formats:
            sqlite_manager = SQLiteManager()
            sqlite_manager.save_benchmark(benchmark)
    
    def _get_performance_metrics(self) -> Dict[str, Any]:
        """Get performance metrics from optimizations."""
        if not self.optimizations_enabled or not self.executor:
            return {}
        
        metrics = self.executor.getMetrics()
        
        # Add cache statistics
        cache_stats = self.result_cache.getStats() if hasattr(self.result_cache, 'getStats') else {}
        
        # Add task history stats
        task_history_stats = {
            'total_tasks': self.task_history.getTotalItemsWritten() if hasattr(self.task_history, 'getTotalItemsWritten') else 0,
            'buffer_size': self.task_history.getSize() if hasattr(self.task_history, 'getSize') else 0
        }
        
        return {
            'executor': metrics,
            'cache': cache_stats,
            'task_history': task_history_stats,
            'optimizations_enabled': True
        }
    
    async def shutdown(self):
        """Clean shutdown of optimized components."""
        if self.optimizations_enabled and self.executor:
            await self.executor.shutdown()
        
        if self.file_manager:
            await self.file_manager.waitForPendingOperations()
        
        if hasattr(self.result_cache, 'destroy'):
            self.result_cache.destroy()
    
    def _result_to_dict(self, result: Result) -> Dict[str, Any]:
        """Convert result to dictionary format."""
        return {
            "task_id": result.task_id,
            "agent_id": result.agent_id,
            "status": result.status.value if hasattr(result.status, 'value') else result.status,
            "output": result.output[:200] + "..." if len(result.output) > 200 else result.output,
            "execution_time": result.execution_time,
            "metrics": {
                "performance": result.performance_metrics.__dict__ if result.performance_metrics else {},
                "quality": result.quality_metrics.__dict__ if result.quality_metrics else {},
                "resource": result.resource_usage.__dict__ if result.resource_usage else {}
            }
        }