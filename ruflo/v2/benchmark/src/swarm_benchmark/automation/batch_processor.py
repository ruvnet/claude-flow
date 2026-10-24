"""
BatchProcessor for parallel task execution without human interaction.

This module provides comprehensive batch processing capabilities that can handle
hundreds of concurrent tasks with automatic resource management, retry logic,
and progress tracking.
"""

import asyncio
import time
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Callable, Union
from dataclasses import dataclass, field
from enum import Enum
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
import psutil

from ..core.models import Task as BenchmarkTask, Result as BenchmarkResult


class BatchStatus(Enum):
    """Status of batch processing operations."""
    PENDING = "pending"
    RUNNING = "running" 
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class BatchConfig:
    """Configuration for batch processing operations."""
    max_parallel: int = 50
    max_parallel_per_type: int = 10
    max_resources: int = 100
    timeout_seconds: int = 300
    retry_attempts: int = 3
    retry_delay: float = 1.0
    retry_exponential_base: float = 2.0
    progress_update_interval: int = 5
    memory_limit_mb: int = 8192
    cpu_limit_percent: int = 80
    enable_checkpointing: bool = True
    checkpoint_interval: int = 60
    auto_scale: bool = True
    scale_threshold: float = 0.8
    
    # Resource allocation strategies
    resource_strategy: str = "adaptive"  # adaptive, fixed, balanced
    priority_scheduling: bool = True
    load_balancing: bool = True
    
    # Monitoring and logging
    detailed_logging: bool = True
    metrics_collection: bool = True
    performance_tracking: bool = True


@dataclass 
class TaskExecution:
    """Individual task execution tracking."""
    task: BenchmarkTask
    status: BatchStatus = BatchStatus.PENDING
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    attempts: int = 0
    result: Optional[BenchmarkResult] = None
    error: Optional[str] = None
    resource_id: Optional[str] = None
    
    @property
    def duration(self) -> Optional[float]:
        """Get execution duration in seconds."""
        if self.start_time and self.end_time:
            return (self.end_time - self.start_time).total_seconds()
        return None
    
    @property
    def is_complete(self) -> bool:
        """Check if task execution is complete."""
        return self.status in [BatchStatus.COMPLETED, BatchStatus.FAILED, BatchStatus.CANCELLED]


@dataclass
class BatchResult:
    """Result of batch processing operation."""
    batch_id: str
    total_tasks: int
    completed_tasks: int
    failed_tasks: int
    cancelled_tasks: int
    start_time: datetime
    end_time: Optional[datetime] = None
    total_duration: Optional[float] = None
    success_rate: float = 0.0
    avg_execution_time: float = 0.0
    throughput: float = 0.0  # tasks per second
    resource_utilization: Dict[str, float] = field(default_factory=dict)
    error_summary: Dict[str, int] = field(default_factory=dict)
    performance_metrics: Dict[str, Any] = field(default_factory=dict)
    
    def calculate_metrics(self, executions: List[TaskExecution]):
        """Calculate derived metrics from task executions."""
        if self.end_time:
            self.total_duration = (self.end_time - self.start_time).total_seconds()
            
        self.success_rate = self.completed_tasks / self.total_tasks if self.total_tasks > 0 else 0
        
        # Calculate average execution time for completed tasks
        completed_durations = [
            exec.duration for exec in executions 
            if exec.is_complete and exec.duration is not None
        ]
        if completed_durations:
            self.avg_execution_time = sum(completed_durations) / len(completed_durations)
            
        # Calculate throughput
        if self.total_duration and self.total_duration > 0:
            self.throughput = self.completed_tasks / self.total_duration
            
        # Aggregate error summary
        self.error_summary = {}
        for exec in executions:
            if exec.error:
                error_type = type(exec.error).__name__ if hasattr(exec.error, '__name__') else "Unknown"
                self.error_summary[error_type] = self.error_summary.get(error_type, 0) + 1


class ParallelStage:
    """A stage that executes tasks in parallel."""
    
    def __init__(self, name: str, tasks: List[BenchmarkTask], max_parallel: int = 10):
        self.name = name
        self.tasks = tasks
        self.max_parallel = max_parallel
        self.semaphore = asyncio.Semaphore(max_parallel)
        
    async def execute(self, processor: 'BatchProcessor') -> List[TaskExecution]:
        """Execute all tasks in this stage."""
        return await processor._execute_tasks_parallel(self.tasks, self.semaphore)


class BatchProcessor:
    """
    Process multiple benchmark tasks in batch mode without interaction.
    
    Supports:
    - Parallel execution with configurable limits
    - Automatic retry with exponential backoff
    - Resource monitoring and management
    - Progress tracking and checkpointing
    - Dynamic scaling based on performance
    """
    
    def __init__(self, config: BatchConfig):
        self.config = config
        self.logger = logging.getLogger(self.__class__.__name__)
        self._setup_logging()
        
        # Core components
        self.task_queue: asyncio.Queue = asyncio.Queue()
        self.result_collector = ResultCollector()
        self.resource_monitor = ResourceMonitor(config)
        self.checkpoint_manager = CheckpointManager(config)
        
        # Execution tracking
        self.current_batch_id: Optional[str] = None
        self.executions: Dict[str, TaskExecution] = {}
        self.is_running = False
        self.is_paused = False
        
        # Performance metrics
        self.metrics = {
            "batches_processed": 0,
            "total_tasks_processed": 0,
            "total_execution_time": 0.0,
            "average_throughput": 0.0,
            "resource_efficiency": 0.0
        }
        
    def _setup_logging(self):
        """Configure logging for batch processor."""
        if self.config.detailed_logging:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)
            self.logger.setLevel(logging.INFO)
    
    async def process_batch(self, tasks: List[BenchmarkTask], batch_id: Optional[str] = None) -> BatchResult:
        """
        Process a batch of tasks in parallel.
        
        Features:
        - Dynamic resource allocation
        - Automatic retry on failure
        - Progress tracking
        - Result aggregation
        - Checkpointing for resume capability
        
        Args:
            tasks: List of benchmark tasks to execute
            batch_id: Optional identifier for the batch
            
        Returns:
            BatchResult containing execution metrics and results
        """
        if not batch_id:
            batch_id = f"batch_{int(time.time())}"
            
        self.current_batch_id = batch_id
        start_time = datetime.now()
        
        self.logger.info(f"Starting batch processing: {batch_id} with {len(tasks)} tasks")
        
        # Initialize tracking
        self.executions = {task.id: TaskExecution(task=task) for task in tasks}
        
        try:
            # Create optimized execution pipeline
            pipeline = self._create_pipeline(tasks)
            
            # Execute with resource management
            async with self.resource_monitor:
                results = await self._execute_pipeline(pipeline)
            
            # Aggregate and analyze results
            batch_result = self._create_batch_result(batch_id, start_time, datetime.now())
            
            self.logger.info(f"Batch completed: {batch_id}, Success rate: {batch_result.success_rate:.2%}")
            
            return batch_result
            
        except Exception as e:
            self.logger.error(f"Batch processing failed: {batch_id}, Error: {str(e)}")
            return self._create_failed_batch_result(batch_id, start_time, str(e))
        
        finally:
            self.current_batch_id = None
            self.is_running = False
    
    def _create_pipeline(self, tasks: List[BenchmarkTask]) -> 'Pipeline':
        """Create optimized execution pipeline."""
        from .pipeline_manager import Pipeline
        
        pipeline = Pipeline(f"batch_pipeline_{self.current_batch_id}")
        
        # Group tasks by type for efficiency
        grouped = self._group_tasks_by_type(tasks)
        
        # Create parallel execution stages
        for task_type, task_group in grouped.items():
            stage = ParallelStage(
                name=f"stage_{task_type}",
                tasks=task_group,
                max_parallel=self.config.max_parallel_per_type
            )
            pipeline.add_stage(stage)
        
        return pipeline
    
    def _group_tasks_by_type(self, tasks: List[BenchmarkTask]) -> Dict[str, List[BenchmarkTask]]:
        """Group tasks by type for optimized execution."""
        grouped = {}
        for task in tasks:
            task_type = getattr(task, 'type', 'default')
            if task_type not in grouped:
                grouped[task_type] = []
            grouped[task_type].append(task)
        return grouped
    
    async def _execute_pipeline(self, pipeline) -> Dict[str, TaskExecution]:
        """Execute the task pipeline with monitoring."""
        self.is_running = True
        
        # Start resource monitoring
        monitor_task = asyncio.create_task(self._monitor_resources())
        
        # Start progress tracking
        progress_task = asyncio.create_task(self._track_progress())
        
        # Start checkpointing if enabled
        checkpoint_task = None
        if self.config.enable_checkpointing:
            checkpoint_task = asyncio.create_task(self._periodic_checkpoint())
        
        try:
            # Execute stages in pipeline
            for stage in pipeline.stages:
                if not self.is_running:
                    break
                    
                self.logger.info(f"Executing stage: {stage.name}")
                stage_results = await stage.execute(self)
                
                # Update execution tracking
                for result in stage_results:
                    self.executions[result.task.id] = result
                    
                # Check for auto-scaling
                if self.config.auto_scale:
                    await self._check_auto_scale()
            
            return self.executions
            
        finally:
            # Cleanup monitoring tasks
            monitor_task.cancel()
            progress_task.cancel()
            if checkpoint_task:
                checkpoint_task.cancel()
                
            try:
                await monitor_task
            except asyncio.CancelledError:
                pass
                
            try:
                await progress_task
            except asyncio.CancelledError:
                pass
                
            if checkpoint_task:
                try:
                    await checkpoint_task
                except asyncio.CancelledError:
                    pass
    
    async def _execute_tasks_parallel(self, tasks: List[BenchmarkTask], semaphore: asyncio.Semaphore) -> List[TaskExecution]:
        """Execute tasks in parallel with resource limits."""
        async def execute_single_task(task: BenchmarkTask) -> TaskExecution:
            execution = self.executions[task.id]
            
            async with semaphore:
                # Resource allocation
                resource_id = await self.resource_monitor.allocate_resource()
                execution.resource_id = resource_id
                
                try:
                    # Execute with retry logic
                    result = await self._execute_with_retry(task, execution)
                    execution.result = result
                    execution.status = BatchStatus.COMPLETED
                    
                except Exception as e:
                    execution.error = str(e)
                    execution.status = BatchStatus.FAILED
                    self.logger.error(f"Task failed: {task.id}, Error: {str(e)}")
                    
                finally:
                    # Release resource
                    await self.resource_monitor.release_resource(resource_id)
                    execution.end_time = datetime.now()
            
            return execution
        
        # Execute all tasks concurrently
        results = await asyncio.gather(
            *[execute_single_task(task) for task in tasks],
            return_exceptions=True
        )
        
        # Process results and handle exceptions
        processed_results = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                execution = self.executions[tasks[i].id]
                execution.error = str(result)
                execution.status = BatchStatus.FAILED
                execution.end_time = datetime.now()
                processed_results.append(execution)
            else:
                processed_results.append(result)
        
        return processed_results
    
    async def _execute_with_retry(self, task: BenchmarkTask, execution: TaskExecution) -> BenchmarkResult:
        """Execute a task with retry logic."""
        last_exception = None
        
        for attempt in range(self.config.retry_attempts):
            execution.attempts = attempt + 1
            execution.start_time = datetime.now()
            
            try:
                # Execute the actual task
                result = await self._execute_task(task)
                return result
                
            except Exception as e:
                last_exception = e
                self.logger.warning(f"Task attempt {attempt + 1} failed: {task.id}, Error: {str(e)}")
                
                if attempt < self.config.retry_attempts - 1:
                    # Exponential backoff
                    delay = self.config.retry_delay * (self.config.retry_exponential_base ** attempt)
                    await asyncio.sleep(delay)
        
        # All attempts failed
        raise last_exception if last_exception else Exception("Task execution failed after all retries")
    
    async def _execute_task(self, task: BenchmarkTask) -> BenchmarkResult:
        """Execute a single benchmark task."""
        # This is a placeholder implementation
        # In practice, this would integrate with the actual benchmark execution engine
        
        start_time = time.time()
        
        # Simulate task execution
        await asyncio.sleep(0.1)  # Simulate work
        
        execution_time = time.time() - start_time
        
        # Create mock result
        result = BenchmarkResult(
            task_id=task.id,
            status="completed",
            execution_time=execution_time,
            metrics={
                "task_type": getattr(task, 'type', 'unknown'),
                "resource_usage": {
                    "cpu_percent": 25.0,
                    "memory_mb": 128.0
                }
            },
            timestamp=datetime.now()
        )
        
        return result
    
    async def _monitor_resources(self):
        """Monitor system resources during batch execution."""
        while self.is_running:
            try:
                cpu_percent = psutil.cpu_percent(interval=1)
                memory = psutil.virtual_memory()
                
                # Check resource limits
                if cpu_percent > self.config.cpu_limit_percent:
                    self.logger.warning(f"High CPU usage: {cpu_percent:.1f}%")
                    
                if memory.percent > (self.config.memory_limit_mb / memory.total * 100 * 1024 * 1024):
                    self.logger.warning(f"High memory usage: {memory.percent:.1f}%")
                
                # Update metrics
                self.metrics["resource_efficiency"] = min(cpu_percent / 100.0, 1.0)
                
                await asyncio.sleep(5)  # Monitor every 5 seconds
                
            except Exception as e:
                self.logger.error(f"Resource monitoring error: {str(e)}")
                await asyncio.sleep(5)
    
    async def _track_progress(self):
        """Track and log progress during batch execution."""
        while self.is_running:
            try:
                total_tasks = len(self.executions)
                completed = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.COMPLETED)
                failed = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.FAILED)
                running = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.RUNNING)
                
                progress_percent = (completed + failed) / total_tasks * 100 if total_tasks > 0 else 0
                
                self.logger.info(
                    f"Batch Progress: {progress_percent:.1f}% "
                    f"(Completed: {completed}, Failed: {failed}, Running: {running}, Total: {total_tasks})"
                )
                
                await asyncio.sleep(self.config.progress_update_interval)
                
            except Exception as e:
                self.logger.error(f"Progress tracking error: {str(e)}")
                await asyncio.sleep(self.config.progress_update_interval)
    
    async def _periodic_checkpoint(self):
        """Create periodic checkpoints for resume capability."""
        while self.is_running:
            try:
                await self.checkpoint_manager.create_checkpoint(self.current_batch_id, self.executions)
                await asyncio.sleep(self.config.checkpoint_interval)
                
            except Exception as e:
                self.logger.error(f"Checkpoint creation error: {str(e)}")
                await asyncio.sleep(self.config.checkpoint_interval)
    
    async def _check_auto_scale(self):
        """Check if auto-scaling should be triggered."""
        if not self.config.auto_scale:
            return
            
        # Calculate current load
        running_tasks = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.RUNNING)
        load_ratio = running_tasks / self.config.max_parallel
        
        if load_ratio > self.config.scale_threshold:
            # Could trigger scale-up logic here
            self.logger.info(f"High load detected: {load_ratio:.2%}, considering scale-up")
        elif load_ratio < (self.config.scale_threshold / 2):
            # Could trigger scale-down logic here
            self.logger.info(f"Low load detected: {load_ratio:.2%}, considering scale-down")
    
    def _create_batch_result(self, batch_id: str, start_time: datetime, end_time: datetime) -> BatchResult:
        """Create batch result from execution data."""
        total_tasks = len(self.executions)
        completed_tasks = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.COMPLETED)
        failed_tasks = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.FAILED) 
        cancelled_tasks = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.CANCELLED)
        
        result = BatchResult(
            batch_id=batch_id,
            total_tasks=total_tasks,
            completed_tasks=completed_tasks,
            failed_tasks=failed_tasks,
            cancelled_tasks=cancelled_tasks,
            start_time=start_time,
            end_time=end_time,
            resource_utilization=self.resource_monitor.get_utilization_metrics(),
            performance_metrics=self.metrics.copy()
        )
        
        result.calculate_metrics(list(self.executions.values()))
        
        # Update global metrics
        self.metrics["batches_processed"] += 1
        self.metrics["total_tasks_processed"] += completed_tasks
        self.metrics["total_execution_time"] += result.total_duration or 0
        
        return result
    
    def _create_failed_batch_result(self, batch_id: str, start_time: datetime, error: str) -> BatchResult:
        """Create batch result for failed execution."""
        return BatchResult(
            batch_id=batch_id,
            total_tasks=len(self.executions),
            completed_tasks=0,
            failed_tasks=len(self.executions),
            cancelled_tasks=0,
            start_time=start_time,
            end_time=datetime.now(),
            error_summary={"BatchExecutionError": 1}
        )
    
    async def pause_batch(self):
        """Pause the current batch execution."""
        self.is_paused = True
        self.logger.info("Batch execution paused")
    
    async def resume_batch(self):
        """Resume paused batch execution."""
        self.is_paused = False
        self.logger.info("Batch execution resumed")
    
    async def cancel_batch(self):
        """Cancel the current batch execution."""
        self.is_running = False
        
        # Cancel all pending tasks
        for execution in self.executions.values():
            if execution.status == BatchStatus.PENDING:
                execution.status = BatchStatus.CANCELLED
                execution.end_time = datetime.now()
        
        self.logger.info("Batch execution cancelled")
    
    def get_execution_status(self) -> Dict[str, Any]:
        """Get current execution status."""
        if not self.executions:
            return {"status": "idle"}
        
        total = len(self.executions)
        completed = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.COMPLETED)
        failed = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.FAILED)
        running = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.RUNNING)
        pending = sum(1 for ex in self.executions.values() if ex.status == BatchStatus.PENDING)
        
        return {
            "batch_id": self.current_batch_id,
            "status": "running" if self.is_running else "stopped",
            "total_tasks": total,
            "completed": completed,
            "failed": failed,
            "running": running,
            "pending": pending,
            "progress_percent": (completed + failed) / total * 100 if total > 0 else 0,
            "is_paused": self.is_paused
        }


class ResultCollector:
    """Collect and aggregate batch execution results."""
    
    def __init__(self):
        self.results = []
        
    def add_result(self, result: BenchmarkResult):
        """Add a benchmark result."""
        self.results.append(result)
        
    def get_aggregated_metrics(self) -> Dict[str, Any]:
        """Get aggregated metrics from all results."""
        if not self.results:
            return {}
        
        total_time = sum(r.execution_time for r in self.results if r.execution_time)
        avg_time = total_time / len(self.results) if self.results else 0
        
        return {
            "total_results": len(self.results),
            "total_execution_time": total_time,
            "average_execution_time": avg_time,
            "success_rate": len([r for r in self.results if r.status == "completed"]) / len(self.results)
        }


class ResourceMonitor:
    """Monitor and manage system resources."""
    
    def __init__(self, config: BatchConfig):
        self.config = config
        self.allocated_resources = set()
        self.resource_semaphore = asyncio.Semaphore(config.max_resources)
        
    async def __aenter__(self):
        """Async context manager entry."""
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        pass
        
    async def allocate_resource(self) -> str:
        """Allocate a computational resource."""
        await self.resource_semaphore.acquire()
        resource_id = f"resource_{len(self.allocated_resources)}_{int(time.time())}"
        self.allocated_resources.add(resource_id)
        return resource_id
        
    async def release_resource(self, resource_id: str):
        """Release a computational resource."""
        if resource_id in self.allocated_resources:
            self.allocated_resources.remove(resource_id)
            self.resource_semaphore.release()
            
    def get_utilization_metrics(self) -> Dict[str, float]:
        """Get resource utilization metrics."""
        try:
            cpu_percent = psutil.cpu_percent(interval=None)
            memory = psutil.virtual_memory()
            
            return {
                "cpu_percent": cpu_percent,
                "memory_percent": memory.percent,
                "allocated_resources": len(self.allocated_resources),
                "max_resources": self.config.max_resources,
                "resource_utilization": len(self.allocated_resources) / self.config.max_resources
            }
        except:
            return {"error": "Failed to collect resource metrics"}


class CheckpointManager:
    """Manage execution checkpoints for resume capability."""
    
    def __init__(self, config: BatchConfig):
        self.config = config
        
    async def create_checkpoint(self, batch_id: str, executions: Dict[str, TaskExecution]):
        """Create a checkpoint of current execution state."""
        if not self.config.enable_checkpointing:
            return
            
        checkpoint_data = {
            "batch_id": batch_id,
            "timestamp": datetime.now().isoformat(),
            "executions": {
                task_id: {
                    "task_id": exec.task.id,
                    "status": exec.status.value,
                    "attempts": exec.attempts,
                    "start_time": exec.start_time.isoformat() if exec.start_time else None,
                    "end_time": exec.end_time.isoformat() if exec.end_time else None,
                    "error": exec.error
                }
                for task_id, exec in executions.items()
            }
        }
        
        # In practice, this would save to persistent storage
        # For now, we'll just log the checkpoint creation
        logging.info(f"Checkpoint created for batch {batch_id}")
        
    async def restore_checkpoint(self, batch_id: str) -> Optional[Dict[str, Any]]:
        """Restore execution state from checkpoint."""
        # In practice, this would load from persistent storage
        # For now, return None to indicate no checkpoint available
        return None