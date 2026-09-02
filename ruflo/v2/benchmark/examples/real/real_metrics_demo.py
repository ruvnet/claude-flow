#!/usr/bin/env python3
"""Demonstration of real metrics collection for claude-flow benchmarks."""

import asyncio
import json
from pathlib import Path
import sys

# Add the src directory to the path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from swarm_benchmark.metrics.performance_collector import PerformanceCollector, AsyncPerformanceCollector
from swarm_benchmark.metrics.resource_monitor import ResourceMonitor, SystemResourceMonitor
from swarm_benchmark.metrics.process_tracker import ProcessTracker
from swarm_benchmark.metrics.metrics_aggregator import MetricsAggregator


async def demo_performance_collection():
    """Demonstrate performance metrics collection."""
    print("\n=== Performance Metrics Collection Demo ===\n")
    
    # Create async collector
    collector = AsyncPerformanceCollector(sample_interval=0.05)
    
    # Simulate a process
    import subprocess
    process = subprocess.Popen(
        ["python", "-c", "import time; time.sleep(2); print('Done')"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    
    # Collect metrics for the duration
    metrics = await collector.collect_for_duration(2.5, process)
    
    print(f"Execution time: {metrics.execution_time:.2f}s")
    print(f"Throughput: {metrics.throughput:.4f} tasks/s")
    
    # Get detailed metrics
    detailed = collector.get_detailed_metrics()
    print(f"\nDetailed Metrics:")
    print(f"  Sample count: {detailed['summary']['sample_count']}")
    print(f"  Process count: {detailed['summary']['process_count']}")
    
    # Save raw metrics
    Path("./examples/output").mkdir(exist_ok=True, parents=True)
    collector.save_raw_metrics(Path("./examples/output/performance_metrics.json"))
    print("  Raw metrics saved to: ./examples/output/performance_metrics.json")


def demo_resource_monitoring():
    """Demonstrate resource monitoring."""
    print("\n=== Resource Monitoring Demo ===\n")
    
    # Create monitor with alert callback
    def alert_handler(alert):
        print(f"⚠️  ALERT: {alert.message}")
    
    monitor = ResourceMonitor(alert_callback=alert_handler)
    
    # Set custom thresholds
    monitor.set_thresholds({
        "cpu_percent": 50.0,
        "memory_mb": 100.0
    })
    
    # Start monitoring current process
    monitor.start_monitoring()
    
    # Simulate some work
    print("Simulating CPU-intensive work...")
    import time
    start = time.time()
    while time.time() - start < 2:
        # CPU-intensive calculation
        sum(i * i for i in range(1000000))
    
    # Stop and get results
    usage = monitor.stop_monitoring()
    stats = monitor.get_statistics()
    
    print(f"\nResource Usage Summary:")
    print(f"  Average CPU: {usage.average_cpu_percent:.1f}%")
    print(f"  Peak memory: {usage.peak_memory_mb:.1f} MB")
    print(f"  Average memory: {usage.memory_mb:.1f} MB")
    
    print(f"\nStatistics:")
    print(f"  CPU mean: {stats['cpu']['mean']:.1f}%")
    print(f"  CPU max: {stats['cpu']['max']:.1f}%")
    print(f"  Memory peak: {stats['memory_mb']['max']:.1f} MB")
    print(f"  Total alerts: {stats['alerts']}")


async def demo_process_tracking():
    """Demonstrate process tracking."""
    print("\n=== Process Tracking Demo ===\n")
    
    tracker = ProcessTracker("claude-flow")
    
    # Execute various commands
    commands = [
        (["--version"], 5),
        (["status"], 10),
        (["sparc", "--help"], 10)
    ]
    
    for cmd, timeout in commands:
        print(f"\nExecuting: claude-flow {' '.join(cmd)}")
        result = await tracker.execute_command_async(cmd, timeout=timeout)
        
        print(f"  Exit code: {result.exit_code}")
        print(f"  Duration: {result.duration:.2f}s")
        print(f"  Memory: {result.resource_usage.peak_memory_mb:.1f} MB")
        print(f"  Output lines: {result.output_size}")
        
        if result.stderr:
            print(f"  Errors: {result.error_count}")
    
    # Show command statistics
    stats = tracker.get_command_statistics()
    summary = tracker.get_execution_summary()
    
    print(f"\nExecution Summary:")
    print(f"  Total executions: {summary['total_executions']}")
    print(f"  Success rate: {summary['overall_success_rate']:.1%}")
    print(f"  Average duration: {summary['average_duration']:.2f}s")
    print(f"  Peak memory: {summary['peak_memory_mb']:.1f} MB")
    
    # Save report
    tracker.save_execution_report(Path("./examples/output/process_report.json"))
    print("\n  Process report saved to: ./examples/output/process_report.json")


async def demo_metrics_aggregation():
    """Demonstrate comprehensive metrics aggregation."""
    print("\n=== Metrics Aggregation Demo ===\n")
    
    aggregator = MetricsAggregator()
    aggregator.start_collection()
    
    # Create multiple collectors
    perf1 = aggregator.create_performance_collector("task1")
    perf2 = aggregator.create_performance_collector("task2")
    res1 = aggregator.create_resource_monitor("agent1")
    res2 = aggregator.create_resource_monitor("agent2")
    
    # Get process tracker
    tracker = aggregator.get_process_tracker()
    
    # Simulate parallel task execution
    print("Simulating parallel task execution...")
    
    # Start monitoring
    perf1.start_collection()
    res1.start_monitoring()
    
    # Execute first command
    result1 = await tracker.execute_command_async(["status"], timeout=5)
    
    # Stop first task monitoring
    perf1.stop_collection()
    res1.stop_monitoring()
    
    # Start second task
    perf2.start_collection()
    res2.start_monitoring()
    
    # Execute second command
    result2 = await tracker.execute_command_async(["sparc", "--list"], timeout=5)
    
    # Stop second task monitoring
    perf2.stop_collection()
    res2.stop_monitoring()
    
    # Get aggregated metrics
    aggregated = aggregator.stop_collection()
    
    print(f"\nAggregated Metrics:")
    print(f"  Wall clock time: {aggregated.wall_clock_time:.2f}s")
    print(f"  Total processes: {aggregated.total_processes}")
    print(f"  Success rate: {aggregated.success_rate:.1%}")
    print(f"  Peak memory: {aggregated.peak_memory_mb:.1f} MB")
    print(f"  Average CPU: {aggregated.average_cpu_percent:.1f}%")
    print(f"  Output complexity: {aggregated.output_complexity_score:.2f} lines/s")
    
    # Save detailed report
    aggregator.save_detailed_report(Path("./examples/output/aggregated_metrics.json"))
    print("\n  Detailed report saved to: ./examples/output/aggregated_metrics.json")


def demo_system_monitoring():
    """Demonstrate system-wide resource monitoring."""
    print("\n=== System Resource Monitoring Demo ===\n")
    
    monitor = SystemResourceMonitor()
    
    # Take baseline
    baseline = monitor.take_baseline()
    print("System baseline:")
    print(f"  CPU: {baseline['cpu_percent']:.1f}%")
    print(f"  Memory available: {baseline['memory_available_mb']:.1f} MB")
    print(f"  Memory usage: {baseline['memory_percent']:.1f}%")
    
    # Simulate some work
    print("\nSimulating workload...")
    import time
    time.sleep(2)
    
    # Measure delta
    delta = monitor.measure_delta()
    print(f"\nResource changes over {delta['duration_seconds']:.1f}s:")
    print(f"  CPU delta: {delta['cpu_percent_delta']:+.1f}%")
    print(f"  Memory delta: {delta['memory_percent_delta']:+.1f}%")
    print(f"  Disk read: {delta['disk_read_mb']:.2f} MB")
    print(f"  Disk write: {delta['disk_write_mb']:.2f} MB")
    print(f"  Network sent: {delta['network_sent_mb']:.2f} MB")
    print(f"  Network received: {delta['network_recv_mb']:.2f} MB")


async def main():
    """Run all demonstrations."""
    print("Claude-Flow Real Metrics Collection Demonstration")
    print("=" * 60)
    
    # Run each demo
    await demo_performance_collection()
    demo_resource_monitoring()
    await demo_process_tracking()
    await demo_metrics_aggregation()
    demo_system_monitoring()
    
    print("\n" + "=" * 60)
    print("Demonstration completed!")
    print("\nCheck the ./examples/output/ directory for saved metrics reports.")


if __name__ == "__main__":
    asyncio.run(main())