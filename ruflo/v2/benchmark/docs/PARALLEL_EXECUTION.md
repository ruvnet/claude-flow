# Parallel Execution System for Swarm Benchmarking

## Overview

The parallel execution system provides efficient, scalable execution of multiple benchmark tasks with comprehensive resource management, task scheduling, and progress monitoring.

## Key Components

### 1. ParallelExecutor (`parallel_executor.py`)

The core execution engine that manages concurrent task execution with multiple execution modes:

- **Thread-based execution**: For I/O-bound tasks
- **Process-based execution**: For CPU-bound tasks  
- **Asyncio-based execution**: For async/await compatible tasks
- **Hybrid execution**: Automatically chooses the best mode based on task characteristics

#### Features:
- Priority-based task queue with configurable size limits
- Resource monitoring and enforcement (CPU, memory)
- Automatic resource violation detection and throttling
- Execution metrics tracking (throughput, latency, resource usage)
- Graceful shutdown with task cleanup

### 2. TaskScheduler (`task_scheduler.py`)

Advanced task scheduling with multiple algorithms:

#### Scheduling Algorithms:
- **Round Robin**: Simple fair distribution
- **Least Loaded**: Assigns tasks to least busy agents
- **Capability-Based**: Matches task requirements to agent capabilities
- **Priority-Based**: Assigns high-priority tasks to best-performing agents
- **Dynamic**: Multi-factor scheduling considering capabilities, workload, and performance
- **Work Stealing**: Allows idle agents to steal tasks from busy agents

#### Features:
- Task dependency resolution with topological sorting
- Agent capability indexing for O(1) capability matching
- Work stealing queue for load balancing
- Scheduling metrics (load balance score, capability match score)
- Dynamic workload rebalancing

### 3. OrchestrationManager (`orchestration_manager.py`)

High-level orchestration for managing complex benchmark suites:

#### Features:
- Parallel benchmark suite execution
- Auto-scaling based on resource utilization
- Progress tracking and reporting
- Agent pool management with diverse agent types
- Comprehensive metrics aggregation
- Adaptive execution with optimization support

## Usage Examples

### Basic Parallel Execution

```python
from swarm_benchmark.core import ParallelExecutor, ExecutionMode, ResourceLimits

# Configure resource limits
limits = ResourceLimits(
    max_cpu_percent=80.0,
    max_memory_mb=1024.0,
    max_concurrent_tasks=10
)

# Create executor
executor = ParallelExecutor(
    mode=ExecutionMode.HYBRID,
    limits=limits
)

# Start executor
await executor.start()

# Submit tasks
task_ids = []
for task in tasks:
    task_id = await executor.submit_task(task, priority=1)
    task_ids.append(task_id)

# Wait for completion
await executor.wait_for_completion(timeout=300)

# Get results
results = await executor.get_all_results()

# Shutdown
await executor.stop()
```

### Advanced Orchestration

```python
from swarm_benchmark.core import (
    OrchestrationManager, 
    OrchestrationConfig,
    SchedulingAlgorithm
)

# Configure orchestration
config = OrchestrationConfig(
    execution_mode=ExecutionMode.HYBRID,
    scheduling_algorithm=SchedulingAlgorithm.DYNAMIC,
    enable_work_stealing=True,
    auto_scaling=True,
    max_parallel_benchmarks=10
)

# Create manager
orchestrator = OrchestrationManager(config)

# Run benchmark suite
results = await orchestrator.run_benchmark_suite(
    objectives=["objective1", "objective2", "objective3"],
    config=benchmark_config
)

# Get comprehensive metrics
metrics = orchestrator.get_orchestration_metrics()
```

## Resource Management

### Resource Monitoring
- Real-time CPU and memory usage tracking
- Network I/O monitoring (when available)
- Resource violation detection and logging
- Peak usage tracking for capacity planning

### Resource Limits
```python
ResourceLimits(
    max_cpu_percent=80.0,      # Maximum CPU usage percentage
    max_memory_mb=1024.0,      # Maximum memory in MB
    max_concurrent_tasks=10,   # Maximum parallel tasks
    max_queue_size=1000,       # Maximum queued tasks
    task_timeout=300,          # Task timeout in seconds
    monitoring_interval=1.0    # Resource check interval
)
```

## Task Scheduling

### Task Priority
Tasks can be assigned priorities (higher number = higher priority):
- Priority 1-3: Low priority (eligible for work stealing)
- Priority 4-6: Normal priority
- Priority 7-9: High priority (assigned to best agents)
- Priority 10: Critical (immediate execution)

### Agent Capabilities
Agents have capabilities that are matched to task requirements:
- Research: `research`, `analysis`, `web_search`
- Development: `development`, `coding`, `architecture`
- Analysis: `analysis`, `data_processing`, `statistics`
- Testing: `testing`, `validation`, `quality_assurance`
- Optimization: `optimization`, `performance`, `profiling`

## Metrics and Monitoring

### Execution Metrics
```python
ExecutionMetrics(
    tasks_queued=0,            # Number of tasks waiting
    tasks_running=0,           # Currently executing tasks
    tasks_completed=0,         # Successfully completed tasks
    tasks_failed=0,            # Failed tasks
    total_execution_time=0.0,  # Total execution time
    average_execution_time=0.0,# Average per task
    peak_cpu_usage=0.0,        # Peak CPU percentage
    peak_memory_usage=0.0,     # Peak memory in MB
    throughput=0.0             # Tasks per second
)
```

### Scheduling Metrics
```python
SchedulingMetrics(
    total_scheduled=0,         # Total tasks scheduled
    scheduling_time=0.0,       # Time spent scheduling
    load_balance_score=0.0,    # Load distribution quality (0-1)
    capability_match_score=0.0,# Capability matching quality (0-1)
    max_agent_load=0,          # Maximum tasks per agent
    min_agent_load=0           # Minimum tasks per agent
)
```

## Performance Optimization

### Execution Modes
Choose the appropriate execution mode based on your workload:

1. **ASYNCIO**: Best for I/O-bound tasks with async/await support
2. **THREAD**: Good for I/O-bound tasks without async support
3. **PROCESS**: Best for CPU-bound tasks that can be parallelized
4. **HYBRID**: Automatically selects based on task characteristics

### Optimization Tips

1. **Use Work Stealing** for dynamic workloads with varying task durations
2. **Enable Auto-scaling** for unpredictable workloads
3. **Set appropriate resource limits** to prevent system overload
4. **Use capability-based scheduling** for heterogeneous tasks
5. **Monitor metrics** to identify bottlenecks and optimize

## Error Handling

The system provides comprehensive error handling:

1. **Task Failures**: Failed tasks are tracked separately with error details
2. **Resource Violations**: Automatic throttling when limits are exceeded
3. **Timeout Handling**: Tasks exceeding timeout are cancelled gracefully
4. **Graceful Shutdown**: All running tasks are completed or cancelled properly

## Integration with Benchmark Engine

The parallel execution system integrates seamlessly with the benchmark engine:

```python
# Using OptimizedBenchmarkEngine with parallel execution
engine = OptimizedBenchmarkEngine(
    config=benchmark_config,
    enable_optimizations=True
)

# The engine automatically uses parallel execution
result = await engine.run_benchmark(objective)
```

## Best Practices

1. **Start with conservative resource limits** and increase based on monitoring
2. **Use priority levels** to ensure critical tasks complete first
3. **Enable work stealing** for better load distribution
4. **Monitor queue wait times** to identify capacity issues
5. **Use appropriate execution modes** for your task types
6. **Implement proper error handling** for task failures
7. **Set reasonable timeouts** to prevent hanging tasks
8. **Use auto-scaling** for variable workloads

## Troubleshooting

### High CPU Usage
- Reduce `max_concurrent_tasks`
- Lower `max_cpu_percent` limit
- Use THREAD mode instead of PROCESS for I/O tasks

### High Memory Usage
- Reduce `max_memory_mb` limit
- Limit queue size with `max_queue_size`
- Use streaming/chunking for large data

### Poor Load Balance
- Switch to DYNAMIC or WORK_STEALING scheduling
- Enable work stealing
- Check agent capability distribution

### Task Timeouts
- Increase `task_timeout` for long-running tasks
- Break large tasks into smaller subtasks
- Check for resource contention

## Future Enhancements

1. **Distributed Execution**: Support for multi-node execution
2. **GPU Support**: Resource monitoring and scheduling for GPU tasks
3. **Advanced Scheduling**: Machine learning-based task scheduling
4. **Checkpointing**: Save and resume long-running benchmarks
5. **Real-time Dashboard**: Web-based monitoring interface