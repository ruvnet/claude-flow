# Real Metrics Collection for Claude-Flow Benchmarks

## Overview

The real metrics collection system provides accurate, real-time performance monitoring for claude-flow benchmarks. Unlike simulated metrics, this system captures actual execution data including:

- **Execution time** (wall clock and CPU time)
- **Memory usage** (peak and average)
- **Process metrics** (subprocess resource usage)
- **Output size and complexity**
- **Success/failure rates**

## Architecture

### Core Components

1. **PerformanceCollector** - Collects timing and CPU metrics
2. **ResourceMonitor** - Monitors memory and system resources
3. **ProcessTracker** - Tracks claude-flow subprocess execution
4. **MetricsAggregator** - Aggregates metrics from all sources

### Metrics Flow

```
claude-flow command
    ↓
ProcessTracker (subprocess monitoring)
    ↓
PerformanceCollector + ResourceMonitor (real-time sampling)
    ↓
MetricsAggregator (aggregation & analysis)
    ↓
BenchmarkMetrics (final results)
```

## Usage

### Basic Usage

Run benchmarks with real metrics collection:

```bash
swarm-benchmark run "Your objective" --real-metrics
```

### Programmatic Usage

```python
from swarm_benchmark.core.real_benchmark_engine import RealBenchmarkEngine
from swarm_benchmark.core.models import BenchmarkConfig

config = BenchmarkConfig(
    name="my-benchmark",
    strategy=StrategyType.AUTO,
    mode=CoordinationMode.CENTRALIZED
)

engine = RealBenchmarkEngine(config)
result = await engine.run_benchmark("Build a REST API")

# Access metrics
metrics = result['metrics']
print(f"Peak memory: {metrics['peak_memory_mb']} MB")
print(f"Success rate: {metrics['success_rate']}")
```

## Collected Metrics

### Performance Metrics

- **execution_time**: Total wall clock time
- **cpu_time**: Total CPU time consumed
- **throughput**: Tasks completed per second
- **queue_time**: Time spent waiting in queue
- **coordination_overhead**: Time spent on coordination
- **communication_latency**: Inter-agent communication delay

### Resource Metrics

- **cpu_percent**: CPU utilization percentage
- **memory_mb**: Current memory usage in MB
- **peak_memory_mb**: Maximum memory usage
- **average_cpu_percent**: Average CPU usage over time
- **network_bytes_sent/recv**: Network I/O
- **disk_bytes_read/write**: Disk I/O

### Process Metrics

- **pid**: Process ID
- **num_threads**: Thread count
- **num_fds**: Open file descriptors
- **create_time**: Process creation timestamp
- **exit_code**: Process exit status

### Output Metrics

- **total_output_size**: Total lines of output
- **average_output_size**: Average output per task
- **output_complexity_score**: Output generation rate
- **error_count**: Number of errors in output

## Features

### Real-Time Monitoring

The system samples metrics at configurable intervals (default 100ms):

```python
collector = PerformanceCollector(sample_interval=0.05)  # 50ms sampling
```

### Resource Alerts

Set thresholds and receive alerts when exceeded:

```python
monitor = ResourceMonitor(alert_callback=handle_alert)
monitor.set_thresholds({
    "cpu_percent": 80.0,
    "memory_mb": 1024.0
})
```

### Process Tracking

Track all claude-flow subprocess executions:

```python
tracker = ProcessTracker()
result = await tracker.execute_command_async(
    ["swarm", "Build API", "--parallel"],
    timeout=300
)
```

### Metrics Aggregation

Aggregate metrics from multiple sources:

```python
aggregator = MetricsAggregator()
aggregator.start_collection()

# Create named collectors
perf1 = aggregator.create_performance_collector("agent1")
res1 = aggregator.create_resource_monitor("agent1")

# ... execute tasks ...

# Get aggregated results
metrics = aggregator.stop_collection()
```

## Output Formats

### Detailed Metrics Report

Saved as `metrics_{benchmark_id}.json`:

```json
{
  "summary": {
    "wall_clock_time": 45.23,
    "tasks_per_second": 2.21,
    "success_rate": 0.95,
    "peak_memory_mb": 256.4,
    "average_cpu_percent": 65.3
  },
  "performance": {
    "average_duration": 0.45,
    "median_duration": 0.42,
    "p95_duration": 0.68,
    "p99_duration": 0.89
  },
  "resources": {
    "memory": {
      "peak_mb": 256.4,
      "average_mb": 185.2
    },
    "cpu": {
      "average_percent": 65.3,
      "total_seconds": 29.5
    }
  }
}
```

### Process Execution Report

Saved as `process_report_{benchmark_id}.json`:

```json
{
  "summary": {
    "total_executions": 10,
    "successful_executions": 9,
    "failed_executions": 1,
    "overall_success_rate": 0.9,
    "average_duration": 4.52
  },
  "command_statistics": {
    "swarm:research": {
      "execution_count": 5,
      "success_rate": 1.0,
      "average_duration": 3.2,
      "peak_memory_mb": 128.5
    }
  }
}
```

## Advanced Features

### Custom Metrics Collection

Extend the base collectors for custom metrics:

```python
class CustomCollector(PerformanceCollector):
    def _collect_custom_metrics(self):
        # Add custom metric collection
        pass
```

### Batch Processing

Process multiple tasks with shared metrics:

```python
results = await engine.execute_batch(tasks)
```

### Historical Analysis

Compare metrics across benchmark runs:

```python
# Load historical metrics
history = load_metrics_history("./reports")
trends = analyze_performance_trends(history)
```

## Performance Considerations

### Overhead

The metrics collection system is designed for minimal overhead:
- ~2-5% CPU overhead for monitoring
- ~10-20 MB memory overhead
- Configurable sampling rates

### Optimization

For production benchmarks:
- Use larger sampling intervals (0.1-0.5s)
- Disable detailed collection for long runs
- Use batch operations for efficiency

## Troubleshooting

### Common Issues

1. **High memory usage**: Reduce history size or sampling rate
2. **Missing metrics**: Ensure claude-flow is in PATH
3. **Permission errors**: Check file permissions for output directory

### Debug Mode

Enable detailed logging:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## Examples

See `/benchmark/examples/real_metrics_demo.py` for comprehensive examples.

## Future Enhancements

- GPU metrics collection
- Distributed metrics aggregation
- Real-time visualization dashboard
- Machine learning performance prediction