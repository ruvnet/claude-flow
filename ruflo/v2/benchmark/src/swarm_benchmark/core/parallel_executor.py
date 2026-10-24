"""Parallel execution system for concurrent benchmark runs with resource management."""

import asyncio
import time
import psutil
import threading
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from queue import PriorityQueue, Queue, Empty
from typing import Dict, List, Optional, Any, Callable, Tuple, Set
import multiprocessing
import logging
import signal
import sys

from .models import (
    Task, Agent, Result, TaskStatus, AgentStatus, ResultStatus,
    ResourceUsage, PerformanceMetrics, BenchmarkConfig
)


# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ExecutionMode(Enum):
    """Execution modes for parallel processing."""
    THREAD = "thread"
    PROCESS = "process"
    ASYNCIO = "asyncio"
    HYBRID = "hybrid"


@dataclass
class ResourceLimits:
    """Resource limits for execution."""
    max_cpu_percent: float = 80.0
    max_memory_mb: float = 1024.0
    max_concurrent_tasks: int = 10
    max_queue_size: int = 1000
    task_timeout: int = 300  # seconds
    monitoring_interval: float = 1.0  # seconds


@dataclass
class ExecutionMetrics:
    """Metrics for execution monitoring."""
    tasks_queued: int = 0
    tasks_running: int = 0
    tasks_completed: int = 0
    tasks_failed: int = 0
    total_execution_time: float = 0.0
    average_execution_time: float = 0.0
    peak_cpu_usage: float = 0.0
    peak_memory_usage: float = 0.0
    current_cpu_usage: float = 0.0
    current_memory_usage: float = 0.0
    queue_wait_time: float = 0.0
    throughput: float = 0.0
    last_updated: datetime = field(default_factory=datetime.now)


class TaskPriority:
    """Task priority wrapper for priority queue."""
    
    def __init__(self, priority: int, task: Task, enqueue_time: float):
        self.priority = priority
        self.task = task
        self.enqueue_time = enqueue_time
    
    def __lt__(self, other):
        # Higher priority value = higher priority (reverse normal order)
        if self.priority != other.priority:
            return self.priority > other.priority
        # For same priority, FIFO based on enqueue time
        return self.enqueue_time < other.enqueue_time


class ResourceMonitor:
    """Monitors system resources and enforces limits."""
    
    def __init__(self, limits: ResourceLimits):
        self.limits = limits
        self.process = psutil.Process()
        self.running = False
        self.monitor_thread = None
        self.resource_lock = threading.Lock()
        self.current_usage = ResourceUsage()
        self.violation_count = 0
        self.max_violations = 5
        
    def start(self):
        """Start resource monitoring."""
        self.running = True
        self.monitor_thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.monitor_thread.start()
        
    def stop(self):
        """Stop resource monitoring."""
        self.running = False
        if self.monitor_thread:
            self.monitor_thread.join(timeout=5)
    
    def _monitor_loop(self):
        """Main monitoring loop."""
        while self.running:
            try:
                with self.resource_lock:
                    # CPU usage
                    self.current_usage.cpu_percent = self.process.cpu_percent(interval=None)
                    
                    # Memory usage
                    memory_info = self.process.memory_info()
                    self.current_usage.memory_mb = memory_info.rss / (1024 * 1024)
                    
                    # Network usage (if available)
                    try:
                        net_io = psutil.net_io_counters()
                        self.current_usage.network_bytes_sent = net_io.bytes_sent
                        self.current_usage.network_bytes_recv = net_io.bytes_recv
                    except:
                        pass
                    
                    # Check for violations
                    if self.current_usage.cpu_percent > self.limits.max_cpu_percent:
                        self.violation_count += 1
                        logger.warning(f"CPU usage {self.current_usage.cpu_percent:.1f}% exceeds limit {self.limits.max_cpu_percent}%")
                    
                    if self.current_usage.memory_mb > self.limits.max_memory_mb:
                        self.violation_count += 1
                        logger.warning(f"Memory usage {self.current_usage.memory_mb:.1f}MB exceeds limit {self.limits.max_memory_mb}MB")
                    
                    # Update peak values
                    self.current_usage.peak_memory_mb = max(
                        self.current_usage.peak_memory_mb,
                        self.current_usage.memory_mb
                    )
                    
                time.sleep(self.limits.monitoring_interval)
                
            except Exception as e:
                logger.error(f"Resource monitoring error: {e}")
                time.sleep(self.limits.monitoring_interval)
    
    def check_resources(self) -> bool:
        """Check if resources are within limits."""
        with self.resource_lock:
            return (self.current_usage.cpu_percent <= self.limits.max_cpu_percent and
                    self.current_usage.memory_mb <= self.limits.max_memory_mb and
                    self.violation_count < self.max_violations)
    
    def get_usage(self) -> ResourceUsage:
        """Get current resource usage."""
        with self.resource_lock:
            return ResourceUsage(**self.current_usage.__dict__)
    
    def wait_for_resources(self, timeout: float = 30.0) -> bool:
        """Wait for resources to become available."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            if self.check_resources():
                return True
            time.sleep(0.5)
        return False


class ParallelExecutor:
    """Manages parallel execution of benchmark tasks with resource management."""
    
    def __init__(self, 
                 mode: ExecutionMode = ExecutionMode.HYBRID,
                 limits: Optional[ResourceLimits] = None,
                 config: Optional[BenchmarkConfig] = None):
        self.mode = mode
        self.limits = limits or ResourceLimits()
        self.config = config
        
        # Task management
        self.task_queue = PriorityQueue(maxsize=self.limits.max_queue_size)
        self.running_tasks: Dict[str, asyncio.Task] = {}
        self.completed_tasks: Dict[str, Result] = {}
        self.failed_tasks: Dict[str, Tuple[Task, Exception]] = {}
        
        # Executors
        self.thread_executor: Optional[ThreadPoolExecutor] = None
        self.process_executor: Optional[ProcessPoolExecutor] = None
        
        # Resource monitoring
        self.resource_monitor = ResourceMonitor(self.limits)
        self.metrics = ExecutionMetrics()
        
        # Control flags
        self.running = False
        self.shutdown_event = asyncio.Event()
        self._lock = asyncio.Lock()
        
        # Task execution tracking
        self.task_start_times: Dict[str, float] = {}
        self.task_results: Queue = Queue()
        
        # Initialize executors based on mode
        self._initialize_executors()
    
    def _initialize_executors(self):
        """Initialize execution pools based on mode."""
        if self.mode in [ExecutionMode.THREAD, ExecutionMode.HYBRID]:
            self.thread_executor = ThreadPoolExecutor(
                max_workers=self.limits.max_concurrent_tasks,
                thread_name_prefix="benchmark-thread-"
            )
        
        if self.mode in [ExecutionMode.PROCESS, ExecutionMode.HYBRID]:
            # Use fewer processes to avoid overhead
            max_processes = min(
                self.limits.max_concurrent_tasks // 2,
                multiprocessing.cpu_count()
            )
            self.process_executor = ProcessPoolExecutor(
                max_workers=max_processes
            )
    
    async def start(self):
        """Start the parallel executor."""
        self.running = True
        self.resource_monitor.start()
        
        # Start worker coroutines
        workers = []
        for i in range(self.limits.max_concurrent_tasks):
            worker = asyncio.create_task(self._worker(f"worker-{i}"))
            workers.append(worker)
        
        # Start metrics updater
        metrics_task = asyncio.create_task(self._update_metrics())
        workers.append(metrics_task)
        
        # Store workers for cleanup
        self._workers = workers
        
        logger.info(f"Started ParallelExecutor with {self.limits.max_concurrent_tasks} workers")
    
    async def stop(self):
        """Stop the parallel executor."""
        logger.info("Stopping ParallelExecutor...")
        self.running = False
        self.shutdown_event.set()
        
        # Wait for workers to finish
        if hasattr(self, '_workers'):
            await asyncio.gather(*self._workers, return_exceptions=True)
        
        # Shutdown executors
        if self.thread_executor:
            self.thread_executor.shutdown(wait=True, cancel_futures=True)
        if self.process_executor:
            self.process_executor.shutdown(wait=True, cancel_futures=True)
        
        # Stop resource monitor
        self.resource_monitor.stop()
        
        logger.info("ParallelExecutor stopped")
    
    async def submit_task(self, task: Task, priority: int = 1) -> str:
        """Submit a task for execution."""
        if not self.running:
            raise RuntimeError("Executor is not running")
        
        # Check queue size
        if self.task_queue.full():
            raise RuntimeError(f"Task queue is full (max: {self.limits.max_queue_size})")
        
        # Create priority wrapper
        task_priority = TaskPriority(priority, task, time.time())
        
        # Add to queue
        await asyncio.get_event_loop().run_in_executor(
            None, self.task_queue.put, task_priority
        )
        
        async with self._lock:
            self.metrics.tasks_queued += 1
        
        logger.debug(f"Submitted task {task.id} with priority {priority}")
        return task.id
    
    async def submit_batch(self, tasks: List[Tuple[Task, int]]) -> List[str]:
        """Submit multiple tasks as a batch."""
        task_ids = []
        for task, priority in tasks:
            task_id = await self.submit_task(task, priority)
            task_ids.append(task_id)
        return task_ids
    
    async def get_result(self, task_id: str, timeout: Optional[float] = None) -> Optional[Result]:
        """Get result for a specific task."""
        start_time = time.time()
        
        while True:
            # Check completed tasks
            if task_id in self.completed_tasks:
                return self.completed_tasks[task_id]
            
            # Check failed tasks
            if task_id in self.failed_tasks:
                task, error = self.failed_tasks[task_id]
                # Create error result
                return Result(
                    task_id=task_id,
                    status=ResultStatus.ERROR,
                    errors=[str(error)],
                    completed_at=datetime.now()
                )
            
            # Check timeout
            if timeout and (time.time() - start_time) > timeout:
                return None
            
            # Wait a bit before checking again
            await asyncio.sleep(0.1)
    
    async def get_all_results(self) -> Dict[str, Result]:
        """Get all completed results."""
        async with self._lock:
            return dict(self.completed_tasks)
    
    async def wait_for_completion(self, timeout: Optional[float] = None) -> bool:
        """Wait for all tasks to complete."""
        start_time = time.time()
        
        while True:
            async with self._lock:
                if (self.metrics.tasks_queued == 
                    self.metrics.tasks_completed + self.metrics.tasks_failed):
                    return True
            
            if timeout and (time.time() - start_time) > timeout:
                return False
            
            await asyncio.sleep(0.5)
    
    async def _worker(self, worker_id: str):
        """Worker coroutine that processes tasks from the queue."""
        logger.debug(f"Worker {worker_id} started")
        
        while self.running:
            try:
                # Get task from queue with timeout
                task_priority = await asyncio.get_event_loop().run_in_executor(
                    None, self._get_task_with_timeout, 1.0
                )
                
                if task_priority is None:
                    continue
                
                task = task_priority.task
                queue_wait_time = time.time() - task_priority.enqueue_time
                
                # Update metrics
                async with self._lock:
                    self.metrics.tasks_running += 1
                    self.metrics.queue_wait_time = (
                        self.metrics.queue_wait_time * 0.9 + queue_wait_time * 0.1
                    )
                
                # Wait for resources if needed
                if not await self._wait_for_resources_async():
                    # Put task back in queue
                    await self.submit_task(task, task_priority.priority)
                    continue
                
                # Execute task
                logger.debug(f"Worker {worker_id} executing task {task.id}")
                start_time = time.time()
                self.task_start_times[task.id] = start_time
                
                try:
                    result = await self._execute_task(task)
                    execution_time = time.time() - start_time
                    
                    # Update result metrics
                    result.performance_metrics.execution_time = execution_time
                    result.performance_metrics.queue_time = queue_wait_time
                    result.resource_usage = self.resource_monitor.get_usage()
                    
                    # Store result
                    async with self._lock:
                        self.completed_tasks[task.id] = result
                        self.metrics.tasks_completed += 1
                        self.metrics.total_execution_time += execution_time
                        self.metrics.average_execution_time = (
                            self.metrics.total_execution_time / self.metrics.tasks_completed
                        )
                    
                    logger.info(f"Task {task.id} completed in {execution_time:.2f}s")
                    
                except Exception as e:
                    logger.error(f"Task {task.id} failed: {e}")
                    async with self._lock:
                        self.failed_tasks[task.id] = (task, e)
                        self.metrics.tasks_failed += 1
                
                finally:
                    async with self._lock:
                        self.metrics.tasks_running -= 1
                    if task.id in self.task_start_times:
                        del self.task_start_times[task.id]
                
            except Exception as e:
                logger.error(f"Worker {worker_id} error: {e}")
                await asyncio.sleep(1)
        
        logger.debug(f"Worker {worker_id} stopped")
    
    def _get_task_with_timeout(self, timeout: float) -> Optional[TaskPriority]:
        """Get task from queue with timeout."""
        try:
            return self.task_queue.get(timeout=timeout)
        except Empty:
            return None
    
    async def _wait_for_resources_async(self) -> bool:
        """Async wrapper for resource waiting."""
        return await asyncio.get_event_loop().run_in_executor(
            None, self.resource_monitor.wait_for_resources, 5.0
        )
    
    async def _execute_task(self, task: Task) -> Result:
        """Execute a single task based on execution mode."""
        if self.mode == ExecutionMode.ASYNCIO:
            return await self._execute_async(task)
        elif self.mode == ExecutionMode.THREAD:
            return await self._execute_in_thread(task)
        elif self.mode == ExecutionMode.PROCESS:
            return await self._execute_in_process(task)
        elif self.mode == ExecutionMode.HYBRID:
            # Choose execution mode based on task characteristics
            if task.strategy.value in ['research', 'analysis']:
                # I/O bound tasks use threads
                return await self._execute_in_thread(task)
            else:
                # CPU bound tasks use processes
                return await self._execute_in_process(task)
        else:
            raise ValueError(f"Unknown execution mode: {self.mode}")
    
    async def _execute_async(self, task: Task) -> Result:
        """Execute task using asyncio."""
        # Import strategy dynamically
        from ..strategies import create_strategy
        
        strategy = create_strategy(task.strategy.value.lower())
        result = await strategy.execute(task)
        return result
    
    async def _execute_in_thread(self, task: Task) -> Result:
        """Execute task in thread pool."""
        loop = asyncio.get_event_loop()
        
        # Import strategy dynamically
        from ..strategies import create_strategy
        
        def run_task():
            strategy = create_strategy(task.strategy.value.lower())
            # Create new event loop for thread
            thread_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(thread_loop)
            try:
                return thread_loop.run_until_complete(strategy.execute(task))
            finally:
                thread_loop.close()
        
        return await loop.run_in_executor(self.thread_executor, run_task)
    
    async def _execute_in_process(self, task: Task) -> Result:
        """Execute task in process pool."""
        loop = asyncio.get_event_loop()
        
        # Use a wrapper function that can be pickled
        return await loop.run_in_executor(
            self.process_executor,
            _execute_task_in_process,
            task
        )
    
    async def _update_metrics(self):
        """Periodically update execution metrics."""
        while self.running:
            try:
                async with self._lock:
                    # Update resource metrics
                    usage = self.resource_monitor.get_usage()
                    self.metrics.current_cpu_usage = usage.cpu_percent
                    self.metrics.current_memory_usage = usage.memory_mb
                    self.metrics.peak_cpu_usage = max(
                        self.metrics.peak_cpu_usage,
                        usage.cpu_percent
                    )
                    self.metrics.peak_memory_usage = max(
                        self.metrics.peak_memory_usage,
                        usage.memory_mb
                    )
                    
                    # Calculate throughput
                    if self.metrics.total_execution_time > 0:
                        self.metrics.throughput = (
                            self.metrics.tasks_completed / self.metrics.total_execution_time
                        )
                    
                    self.metrics.last_updated = datetime.now()
                
                await asyncio.sleep(1.0)
                
            except Exception as e:
                logger.error(f"Metrics update error: {e}")
                await asyncio.sleep(1.0)
    
    def get_metrics(self) -> ExecutionMetrics:
        """Get current execution metrics."""
        return ExecutionMetrics(**self.metrics.__dict__)
    
    def get_queue_size(self) -> int:
        """Get current queue size."""
        return self.task_queue.qsize()


def _execute_task_in_process(task: Task) -> Result:
    """Execute task in a separate process (pickleable function)."""
    # Import inside function to avoid pickling issues
    import asyncio
    from ..strategies import create_strategy
    
    # Create new event loop for process
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        strategy = create_strategy(task.strategy.value.lower())
        result = loop.run_until_complete(strategy.execute(task))
        return result
    finally:
        loop.close()


class BatchExecutor:
    """High-level batch executor for running multiple benchmarks."""
    
    def __init__(self, 
                 parallel_executor: Optional[ParallelExecutor] = None,
                 config: Optional[BenchmarkConfig] = None):
        self.executor = parallel_executor or ParallelExecutor(
            mode=ExecutionMode.HYBRID,
            config=config
        )
        self.config = config or BenchmarkConfig()
        self.results: Dict[str, List[Result]] = {}
    
    async def run_benchmarks(self, 
                           objectives: List[str],
                           priorities: Optional[List[int]] = None) -> Dict[str, Any]:
        """Run multiple benchmarks in parallel."""
        if not priorities:
            priorities = [1] * len(objectives)
        
        # Start executor
        await self.executor.start()
        
        try:
            # Create tasks for each objective
            tasks = []
            for i, objective in enumerate(objectives):
                task = Task(
                    objective=objective,
                    description=f"Benchmark: {objective}",
                    strategy=self.config.strategy,
                    mode=self.config.mode,
                    timeout=self.config.task_timeout,
                    max_retries=self.config.max_retries,
                    priority=priorities[i]
                )
                tasks.append((task, priorities[i]))
            
            # Submit all tasks
            task_ids = await self.executor.submit_batch(tasks)
            
            logger.info(f"Submitted {len(tasks)} benchmark tasks")
            
            # Wait for completion
            completed = await self.executor.wait_for_completion(
                timeout=self.config.timeout
            )
            
            if not completed:
                logger.warning("Benchmark execution timed out")
            
            # Collect results
            all_results = await self.executor.get_all_results()
            
            # Organize results by objective
            for task, _ in tasks:
                if task.id in all_results:
                    if task.objective not in self.results:
                        self.results[task.objective] = []
                    self.results[task.objective].append(all_results[task.id])
            
            # Get metrics
            metrics = self.executor.get_metrics()
            
            return {
                "status": "completed" if completed else "timeout",
                "total_objectives": len(objectives),
                "completed_objectives": len(self.results),
                "execution_metrics": metrics.__dict__,
                "results": self.results
            }
            
        finally:
            await self.executor.stop()
    
    async def run_benchmark_suite(self, 
                                suite_config: Dict[str, Any]) -> Dict[str, Any]:
        """Run a complete benchmark suite with different configurations."""
        suite_results = {}
        
        for suite_name, suite_objectives in suite_config.items():
            logger.info(f"Running benchmark suite: {suite_name}")
            
            results = await self.run_benchmarks(
                objectives=suite_objectives.get('objectives', []),
                priorities=suite_objectives.get('priorities', None)
            )
            
            suite_results[suite_name] = results
        
        return {
            "suites": suite_results,
            "total_suites": len(suite_config),
            "timestamp": datetime.now().isoformat()
        }