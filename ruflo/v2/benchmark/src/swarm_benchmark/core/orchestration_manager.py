"""Orchestration manager for coordinating parallel benchmark execution."""

import asyncio
import logging
import time
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field

from .models import (
    Benchmark, Task, Agent, Result, TaskStatus, AgentStatus, 
    BenchmarkConfig, StrategyType, CoordinationMode, AgentType,
    PerformanceMetrics, ResourceUsage
)
from .parallel_executor import (
    ParallelExecutor, ExecutionMode, ResourceLimits, 
    ExecutionMetrics, BatchExecutor
)
from .task_scheduler import (
    TaskScheduler, SchedulingAlgorithm, SchedulingMetrics
)
from .benchmark_engine import BenchmarkEngine
from .optimized_benchmark_engine import OptimizedBenchmarkEngine


logger = logging.getLogger(__name__)


@dataclass
class OrchestrationConfig:
    """Configuration for orchestration manager."""
    execution_mode: ExecutionMode = ExecutionMode.HYBRID
    scheduling_algorithm: SchedulingAlgorithm = SchedulingAlgorithm.DYNAMIC
    enable_work_stealing: bool = True
    enable_optimizations: bool = True
    max_parallel_benchmarks: int = 10
    max_agents_per_benchmark: int = 5
    resource_limits: ResourceLimits = field(default_factory=ResourceLimits)
    monitoring_interval: float = 1.0
    progress_reporting: bool = True
    auto_scaling: bool = True
    load_balancing: bool = True


class OrchestrationManager:
    """Manages parallel benchmark execution with advanced orchestration."""
    
    def __init__(self, config: Optional[OrchestrationConfig] = None):
        self.config = config or OrchestrationConfig()
        
        # Initialize components
        self.scheduler = TaskScheduler(
            algorithm=self.config.scheduling_algorithm,
            enable_work_stealing=self.config.enable_work_stealing
        )
        
        self.executor = ParallelExecutor(
            mode=self.config.execution_mode,
            limits=self.config.resource_limits
        )
        
        # Agent pool
        self.agent_pool: List[Agent] = []
        self.active_agents: Dict[str, Agent] = {}
        
        # Benchmark tracking
        self.active_benchmarks: Dict[str, Benchmark] = {}
        self.benchmark_results: Dict[str, Dict[str, Any]] = {}
        
        # Progress tracking
        self.progress_tracker = ProgressTracker()
        
        # Metrics
        self.orchestration_metrics = {
            'total_benchmarks': 0,
            'completed_benchmarks': 0,
            'failed_benchmarks': 0,
            'total_tasks': 0,
            'completed_tasks': 0,
            'average_completion_time': 0.0,
            'resource_utilization': 0.0
        }
        
        self._running = False
        self._monitor_task = None
    
    async def initialize(self):
        """Initialize the orchestration manager."""
        logger.info("Initializing OrchestrationManager...")
        
        # Create agent pool
        self._create_agent_pool()
        
        # Start executor
        await self.executor.start()
        
        # Start monitoring
        if self.config.progress_reporting:
            self._monitor_task = asyncio.create_task(self._monitor_progress())
        
        self._running = True
        logger.info("OrchestrationManager initialized successfully")
    
    async def shutdown(self):
        """Shutdown the orchestration manager."""
        logger.info("Shutting down OrchestrationManager...")
        self._running = False
        
        # Cancel monitoring
        if self._monitor_task:
            self._monitor_task.cancel()
            try:
                await self._monitor_task
            except asyncio.CancelledError:
                pass
        
        # Stop executor
        await self.executor.stop()
        
        logger.info("OrchestrationManager shutdown complete")
    
    def _create_agent_pool(self):
        """Create a pool of agents with diverse capabilities."""
        agent_configs = [
            (AgentType.RESEARCHER, 2),
            (AgentType.DEVELOPER, 3),
            (AgentType.ANALYZER, 2),
            (AgentType.TESTER, 2),
            (AgentType.COORDINATOR, 1),
            (AgentType.SPECIALIST, 2)
        ]
        
        for agent_type, count in agent_configs:
            for i in range(count):
                agent = Agent(
                    type=agent_type,
                    name=f"{agent_type.value}-{i+1}",
                    status=AgentStatus.IDLE
                )
                self.agent_pool.append(agent)
                self.active_agents[agent.id] = agent
        
        logger.info(f"Created agent pool with {len(self.agent_pool)} agents")
    
    async def run_benchmark_suite(self, 
                                 objectives: List[str],
                                 config: Optional[BenchmarkConfig] = None) -> Dict[str, Any]:
        """Run a suite of benchmarks in parallel."""
        if not self._running:
            await self.initialize()
        
        suite_start_time = time.time()
        config = config or BenchmarkConfig()
        
        # Create benchmarks for each objective
        benchmarks = []
        for i, objective in enumerate(objectives):
            benchmark = Benchmark(
                name=f"{config.name}-{i}",
                description=f"Benchmark for: {objective}",
                config=config
            )
            
            # Create main task
            main_task = Task(
                objective=objective,
                description=f"Benchmark task: {objective}",
                strategy=config.strategy,
                mode=config.mode,
                timeout=config.task_timeout,
                priority=i + 1
            )
            
            benchmark.add_task(main_task)
            benchmarks.append(benchmark)
            self.active_benchmarks[benchmark.id] = benchmark
        
        # Execute benchmarks in parallel
        results = await self._execute_parallel_benchmarks(benchmarks)
        
        # Aggregate results
        suite_duration = time.time() - suite_start_time
        
        return {
            'suite_id': f"suite-{int(time.time())}",
            'total_objectives': len(objectives),
            'completed_objectives': len([r for r in results.values() if r.get('status') == 'success']),
            'failed_objectives': len([r for r in results.values() if r.get('status') == 'failed']),
            'duration': suite_duration,
            'throughput': len(objectives) / suite_duration if suite_duration > 0 else 0,
            'results': results,
            'orchestration_metrics': self.orchestration_metrics,
            'scheduling_metrics': self.scheduler.get_metrics().__dict__,
            'execution_metrics': self.executor.get_metrics().__dict__
        }
    
    async def _execute_parallel_benchmarks(self, 
                                         benchmarks: List[Benchmark]) -> Dict[str, Dict[str, Any]]:
        """Execute multiple benchmarks in parallel."""
        # Decompose benchmarks into tasks
        all_tasks = []
        task_to_benchmark = {}
        
        for benchmark in benchmarks:
            benchmark.status = TaskStatus.RUNNING
            benchmark.started_at = datetime.now()
            
            for task in benchmark.tasks:
                all_tasks.append(task)
                task_to_benchmark[task.id] = benchmark
        
        # Schedule tasks across agents
        available_agents = [a for a in self.agent_pool if a.status != AgentStatus.OFFLINE]
        task_assignments = self.scheduler.schedule_tasks(all_tasks, available_agents)
        
        # Submit tasks to executor
        task_priorities = []
        for agent, tasks in task_assignments.items():
            for task in tasks:
                task.assigned_agents.append(agent.id)
                agent.status = AgentStatus.BUSY
                agent.current_task = task.id
                
                # Calculate priority based on benchmark and task priority
                priority = task.priority
                task_priorities.append((task, priority))
        
        # Submit all tasks
        task_ids = await self.executor.submit_batch(task_priorities)
        
        logger.info(f"Submitted {len(task_ids)} tasks across {len(benchmarks)} benchmarks")
        
        # Monitor and collect results
        results = {}
        
        # Wait for all tasks with timeout
        timeout = max(b.config.timeout for b in benchmarks)
        completed = await self.executor.wait_for_completion(timeout=timeout)
        
        if not completed:
            logger.warning("Benchmark execution timed out")
        
        # Collect results for each benchmark
        all_results = await self.executor.get_all_results()
        
        for benchmark in benchmarks:
            benchmark_results = []
            
            for task in benchmark.tasks:
                if task.id in all_results:
                    result = all_results[task.id]
                    benchmark_results.append(result)
                    benchmark.add_result(result)
                    
                    # Update agent metrics
                    for agent_id in task.assigned_agents:
                        if agent_id in self.active_agents:
                            agent = self.active_agents[agent_id]
                            agent.update_performance(result.performance_metrics)
                else:
                    # Create timeout result
                    timeout_result = Result(
                        task_id=task.id,
                        status=ResultStatus.TIMEOUT,
                        errors=["Task execution timed out"]
                    )
                    benchmark_results.append(timeout_result)
                    benchmark.add_result(timeout_result)
            
            # Complete benchmark
            benchmark.status = TaskStatus.COMPLETED
            benchmark.completed_at = datetime.now()
            
            # Create benchmark result summary
            results[benchmark.id] = {
                'benchmark_id': benchmark.id,
                'name': benchmark.name,
                'status': 'success' if all(r.status == ResultStatus.SUCCESS for r in benchmark_results) else 'partial',
                'total_tasks': len(benchmark.tasks),
                'completed_tasks': len([r for r in benchmark_results if r.status == ResultStatus.SUCCESS]),
                'failed_tasks': len([r for r in benchmark_results if r.status in [ResultStatus.FAILURE, ResultStatus.ERROR]]),
                'duration': benchmark.duration(),
                'metrics': benchmark.metrics.__dict__,
                'results': [self._result_to_dict(r) for r in benchmark_results]
            }
            
            # Update orchestration metrics
            self.orchestration_metrics['total_benchmarks'] += 1
            if results[benchmark.id]['status'] == 'success':
                self.orchestration_metrics['completed_benchmarks'] += 1
            else:
                self.orchestration_metrics['failed_benchmarks'] += 1
        
        # Reset agent states
        for agent in self.agent_pool:
            if agent.status == AgentStatus.BUSY:
                agent.status = AgentStatus.IDLE
                agent.current_task = None
        
        return results
    
    async def run_adaptive_benchmark(self, 
                                   objective: str,
                                   config: Optional[BenchmarkConfig] = None) -> Dict[str, Any]:
        """Run a benchmark with adaptive scaling and optimization."""
        if not self._running:
            await self.initialize()
        
        config = config or BenchmarkConfig()
        
        # Use optimized engine if enabled
        if self.config.enable_optimizations:
            engine = OptimizedBenchmarkEngine(config, enable_optimizations=True)
        else:
            engine = BenchmarkEngine(config)
        
        # Run benchmark with monitoring
        start_time = time.time()
        
        try:
            # Execute benchmark
            result = await engine.run_benchmark(objective)
            
            # Auto-scale if needed
            if self.config.auto_scaling:
                await self._auto_scale_resources(result)
            
            return result
            
        finally:
            if hasattr(engine, 'shutdown'):
                await engine.shutdown()
    
    async def _auto_scale_resources(self, benchmark_result: Dict[str, Any]):
        """Auto-scale resources based on benchmark results."""
        metrics = self.executor.get_metrics()
        
        # Scale up if high utilization
        if metrics.current_cpu_usage > 70 or metrics.queue_wait_time > 5.0:
            logger.info("High resource utilization detected, scaling up...")
            
            # Add more agents
            new_agents = min(3, self.config.max_agents_per_benchmark - len(self.agent_pool))
            for i in range(new_agents):
                agent = Agent(
                    type=AgentType.SPECIALIST,
                    name=f"auto-scaled-{i+1}",
                    status=AgentStatus.IDLE
                )
                self.agent_pool.append(agent)
                self.active_agents[agent.id] = agent
            
            logger.info(f"Added {new_agents} new agents")
        
        # Scale down if low utilization
        elif metrics.current_cpu_usage < 20 and len(self.agent_pool) > 5:
            logger.info("Low resource utilization detected, scaling down...")
            
            # Remove idle agents
            idle_agents = [a for a in self.agent_pool if a.status == AgentStatus.IDLE]
            remove_count = min(2, len(idle_agents))
            
            for i in range(remove_count):
                agent = idle_agents[i]
                self.agent_pool.remove(agent)
                del self.active_agents[agent.id]
            
            logger.info(f"Removed {remove_count} idle agents")
    
    async def _monitor_progress(self):
        """Monitor and report progress periodically."""
        while self._running:
            try:
                # Get current metrics
                exec_metrics = self.executor.get_metrics()
                sched_metrics = self.scheduler.get_metrics()
                
                # Update progress tracker
                self.progress_tracker.update(
                    tasks_completed=exec_metrics.tasks_completed,
                    tasks_running=exec_metrics.tasks_running,
                    tasks_queued=exec_metrics.tasks_queued
                )
                
                # Log progress
                if self.progress_tracker.should_report():
                    progress_info = self.progress_tracker.get_progress_report()
                    logger.info(f"Progress: {progress_info}")
                
                # Check for issues
                if exec_metrics.tasks_failed > 10:
                    logger.warning(f"High failure rate detected: {exec_metrics.tasks_failed} tasks failed")
                
                if exec_metrics.queue_wait_time > 10.0:
                    logger.warning(f"High queue wait time: {exec_metrics.queue_wait_time:.2f}s")
                
                await asyncio.sleep(self.config.monitoring_interval)
                
            except Exception as e:
                logger.error(f"Progress monitoring error: {e}")
                await asyncio.sleep(self.config.monitoring_interval)
    
    def _result_to_dict(self, result: Result) -> Dict[str, Any]:
        """Convert result to dictionary format."""
        return {
            "task_id": result.task_id,
            "agent_id": result.agent_id,
            "status": result.status.value if hasattr(result.status, 'value') else str(result.status),
            "output": result.output,
            "errors": result.errors,
            "warnings": result.warnings,
            "performance": {
                "execution_time": result.performance_metrics.execution_time,
                "queue_time": result.performance_metrics.queue_time,
                "throughput": result.performance_metrics.throughput
            },
            "resource_usage": {
                "cpu_percent": result.resource_usage.cpu_percent,
                "memory_mb": result.resource_usage.memory_mb,
                "peak_memory_mb": result.resource_usage.peak_memory_mb
            },
            "duration": result.duration()
        }
    
    def get_agent_status(self) -> List[Dict[str, Any]]:
        """Get current status of all agents."""
        return [
            {
                'id': agent.id,
                'name': agent.name,
                'type': agent.type.value,
                'status': agent.status.value,
                'current_task': agent.current_task,
                'tasks_completed': agent.total_tasks_completed,
                'tasks_failed': agent.total_tasks_failed,
                'success_rate': agent.success_rate,
                'average_execution_time': agent.average_execution_time
            }
            for agent in self.agent_pool
        ]
    
    def get_orchestration_metrics(self) -> Dict[str, Any]:
        """Get comprehensive orchestration metrics."""
        exec_metrics = self.executor.get_metrics()
        sched_metrics = self.scheduler.get_metrics()
        
        return {
            'orchestration': self.orchestration_metrics,
            'execution': exec_metrics.__dict__,
            'scheduling': sched_metrics.__dict__,
            'agents': self.get_agent_status(),
            'resource_usage': {
                'cpu_current': exec_metrics.current_cpu_usage,
                'cpu_peak': exec_metrics.peak_cpu_usage,
                'memory_current': exec_metrics.current_memory_usage,
                'memory_peak': exec_metrics.peak_memory_usage
            },
            'performance': {
                'throughput': exec_metrics.throughput,
                'average_execution_time': exec_metrics.average_execution_time,
                'queue_wait_time': exec_metrics.queue_wait_time,
                'load_balance_score': sched_metrics.load_balance_score
            }
        }


@dataclass
class ProgressTracker:
    """Tracks and reports progress of benchmark execution."""
    
    total_tasks: int = 0
    completed_tasks: int = 0
    running_tasks: int = 0
    queued_tasks: int = 0
    last_report_time: float = field(default_factory=time.time)
    report_interval: float = 5.0  # seconds
    
    def update(self, tasks_completed: int, tasks_running: int, tasks_queued: int):
        """Update progress metrics."""
        self.completed_tasks = tasks_completed
        self.running_tasks = tasks_running
        self.queued_tasks = tasks_queued
        self.total_tasks = tasks_completed + tasks_running + tasks_queued
    
    def should_report(self) -> bool:
        """Check if it's time to report progress."""
        return time.time() - self.last_report_time >= self.report_interval
    
    def get_progress_report(self) -> str:
        """Get formatted progress report."""
        self.last_report_time = time.time()
        
        if self.total_tasks == 0:
            return "No tasks in progress"
        
        completion_percent = (self.completed_tasks / self.total_tasks) * 100 if self.total_tasks > 0 else 0
        
        return (
            f"Progress: {completion_percent:.1f}% "
            f"({self.completed_tasks}/{self.total_tasks} completed, "
            f"{self.running_tasks} running, {self.queued_tasks} queued)"
        )
    
    def get_estimated_time_remaining(self, average_task_time: float) -> float:
        """Estimate time remaining based on average task time."""
        remaining_tasks = self.total_tasks - self.completed_tasks
        if remaining_tasks <= 0 or average_task_time <= 0:
            return 0.0
        
        # Account for parallel execution
        parallel_factor = max(1, self.running_tasks)
        return (remaining_tasks * average_task_time) / parallel_factor