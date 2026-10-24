#!/usr/bin/env python3
"""Test script for real metrics collection."""

import asyncio
import sys
from pathlib import Path

# Add the src directory to the path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode
from swarm_benchmark.core.real_benchmark_engine import RealBenchmarkEngine
from swarm_benchmark.metrics.process_tracker import ProcessTracker


async def test_basic_metrics():
    """Test basic metrics collection."""
    print("Testing basic metrics collection...")
    
    # Create configuration
    config = BenchmarkConfig(
        name="test-metrics",
        description="Test real metrics collection",
        strategy=StrategyType.AUTO,
        mode=CoordinationMode.CENTRALIZED,
        task_timeout=30,
        output_directory="./test_reports"
    )
    
    # Create engine
    engine = RealBenchmarkEngine(config)
    
    # Run a simple benchmark
    result = await engine.run_benchmark("Show claude-flow status")
    
    print("\nBenchmark Results:")
    print(f"Status: {result['status']}")
    print(f"Duration: {result.get('duration', 0):.2f}s")
    
    if 'metrics' in result:
        print("\nPerformance Metrics:")
        metrics = result['metrics']
        print(f"  Wall clock time: {metrics.get('wall_clock_time', 0):.2f}s")
        print(f"  Tasks per second: {metrics.get('tasks_per_second', 0):.2f}")
        print(f"  Success rate: {metrics.get('success_rate', 0):.1%}")
        print(f"  Peak memory: {metrics.get('peak_memory_mb', 0):.1f} MB")
        print(f"  Average CPU: {metrics.get('average_cpu_percent', 0):.1f}%")
        print(f"  Total output: {metrics.get('total_output_lines', 0)} lines")


async def test_process_tracker():
    """Test process tracker directly."""
    print("\nTesting process tracker...")
    
    tracker = ProcessTracker()
    
    # Test a simple command
    result = await tracker.execute_command_async(
        ["status"],
        timeout=10
    )
    
    print(f"\nCommand: {' '.join(result.command)}")
    print(f"Exit code: {result.exit_code}")
    print(f"Success: {result.success}")
    print(f"Duration: {result.duration:.2f}s")
    print(f"Peak memory: {result.resource_usage.peak_memory_mb:.1f} MB")
    print(f"Average CPU: {result.resource_usage.average_cpu_percent:.1f}%")
    print(f"Output lines: {result.output_size}")
    
    # Get command statistics
    stats = tracker.get_command_statistics()
    print("\nCommand Statistics:")
    for key, stat in stats.items():
        print(f"  {stat['command_type']}: {stat['execution_count']} executions, "
              f"{stat['success_rate']:.1%} success rate, "
              f"{stat['average_duration']:.2f}s avg duration")


async def test_multiple_commands():
    """Test multiple command execution."""
    print("\nTesting multiple commands...")
    
    config = BenchmarkConfig(
        name="test-multiple",
        description="Test multiple commands",
        strategy=StrategyType.AUTO,
        mode=CoordinationMode.CENTRALIZED,
        parallel=True,
        max_agents=3,
        output_directory="./test_reports"
    )
    
    engine = RealBenchmarkEngine(config)
    
    # Test different objectives
    objectives = [
        "Show current configuration",
        "List available SPARC modes",
        "Check system status"
    ]
    
    for obj in objectives:
        print(f"\nRunning: {obj}")
        result = await engine.run_benchmark(obj)
        
        if result['status'] == 'success' and 'metrics' in result:
            metrics = result['metrics']
            print(f"  ✓ Completed in {metrics.get('wall_clock_time', 0):.2f}s")
            print(f"  ✓ Memory usage: {metrics.get('peak_memory_mb', 0):.1f} MB")


def main():
    """Main test function."""
    print("Claude-Flow Real Metrics Collection Test")
    print("=" * 50)
    
    # Run tests
    asyncio.run(test_basic_metrics())
    asyncio.run(test_process_tracker())
    asyncio.run(test_multiple_commands())
    
    print("\n" + "=" * 50)
    print("All tests completed!")


if __name__ == "__main__":
    main()