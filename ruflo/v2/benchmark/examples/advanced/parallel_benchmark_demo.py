#!/usr/bin/env python3
"""Example demonstrating parallel benchmark execution with orchestration."""

import asyncio
import logging
import sys
from pathlib import Path
from datetime import datetime

# Add the src directory to Python path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from swarm_benchmark.core import (
    OrchestrationManager,
    OrchestrationConfig,
    BenchmarkConfig,
    ExecutionMode,
    SchedulingAlgorithm,
    ResourceLimits,
    StrategyType,
    CoordinationMode
)


# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)


async def run_basic_parallel_benchmark():
    """Run a basic parallel benchmark demonstration."""
    print("\n=== Basic Parallel Benchmark Demo ===\n")
    
    # Configure orchestration
    orch_config = OrchestrationConfig(
        execution_mode=ExecutionMode.HYBRID,
        scheduling_algorithm=SchedulingAlgorithm.DYNAMIC,
        enable_work_stealing=True,
        max_parallel_benchmarks=5,
        resource_limits=ResourceLimits(
            max_cpu_percent=80,
            max_memory_mb=1024,
            max_concurrent_tasks=10
        )
    )
    
    # Create orchestration manager
    orchestrator = OrchestrationManager(orch_config)
    
    # Define benchmark objectives
    objectives = [
        "Research best practices for microservices architecture",
        "Analyze performance bottlenecks in distributed systems",
        "Test security vulnerabilities in web applications",
        "Optimize database query performance",
        "Develop monitoring solution for cloud infrastructure"
    ]
    
    # Configure benchmark
    bench_config = BenchmarkConfig(
        name="parallel-demo",
        strategy=StrategyType.AUTO,
        mode=CoordinationMode.DISTRIBUTED,
        max_agents=10,
        parallel=True,
        timeout=300
    )
    
    try:
        # Initialize orchestrator
        await orchestrator.initialize()
        
        print(f"Starting parallel execution of {len(objectives)} benchmarks...")
        start_time = datetime.now()
        
        # Run benchmark suite
        results = await orchestrator.run_benchmark_suite(objectives, bench_config)
        
        # Display results
        print(f"\nCompleted in {results['duration']:.2f} seconds")
        print(f"Throughput: {results['throughput']:.2f} benchmarks/second")
        print(f"\nResults Summary:")
        print(f"  - Total objectives: {results['total_objectives']}")
        print(f"  - Completed: {results['completed_objectives']}")
        print(f"  - Failed: {results['failed_objectives']}")
        
        # Show execution metrics
        exec_metrics = results['execution_metrics']
        print(f"\nExecution Metrics:")
        print(f"  - Tasks completed: {exec_metrics['tasks_completed']}")
        print(f"  - Average execution time: {exec_metrics['average_execution_time']:.2f}s")
        print(f"  - Peak CPU usage: {exec_metrics['peak_cpu_usage']:.1f}%")
        print(f"  - Peak memory usage: {exec_metrics['peak_memory_usage']:.1f}MB")
        print(f"  - Queue wait time: {exec_metrics['queue_wait_time']:.2f}s")
        
        # Show scheduling metrics
        sched_metrics = results['scheduling_metrics']
        print(f"\nScheduling Metrics:")
        print(f"  - Total scheduled: {sched_metrics['total_scheduled']}")
        print(f"  - Load balance score: {sched_metrics['load_balance_score']:.2f}")
        print(f"  - Max agent load: {sched_metrics['max_agent_load']}")
        print(f"  - Min agent load: {sched_metrics['min_agent_load']}")
        
    finally:
        # Shutdown orchestrator
        await orchestrator.shutdown()


async def run_adaptive_benchmark():
    """Run an adaptive benchmark with auto-scaling."""
    print("\n=== Adaptive Benchmark Demo ===\n")
    
    # Configure with auto-scaling
    orch_config = OrchestrationConfig(
        execution_mode=ExecutionMode.HYBRID,
        scheduling_algorithm=SchedulingAlgorithm.WORK_STEALING,
        enable_optimizations=True,
        auto_scaling=True,
        load_balancing=True,
        progress_reporting=True
    )
    
    orchestrator = OrchestrationManager(orch_config)
    
    # Complex objective requiring adaptation
    objective = "Build and optimize a complete e-commerce platform with microservices"
    
    bench_config = BenchmarkConfig(
        name="adaptive-demo",
        strategy=StrategyType.DEVELOPMENT,
        mode=CoordinationMode.HIERARCHICAL,
        max_agents=15,
        parallel=True,
        timeout=600
    )
    
    try:
        print("Starting adaptive benchmark with auto-scaling...")
        
        # Run adaptive benchmark
        result = await orchestrator.run_adaptive_benchmark(objective, bench_config)
        
        print(f"\nBenchmark completed!")
        print(f"Status: {result['status']}")
        print(f"Duration: {result.get('duration', 0):.2f}s")
        
        # Show optimization benefits
        if result.get('optimized'):
            print("\nOptimization Benefits:")
            perf_metrics = result.get('performance_metrics', {})
            if 'executor' in perf_metrics:
                print(f"  - Connection pooling enabled")
                print(f"  - Caching enabled")
                print(f"  - Parallel file operations")
        
        # Get final metrics
        final_metrics = orchestrator.get_orchestration_metrics()
        
        print(f"\nAgent Status:")
        for agent in final_metrics['agents'][:5]:  # Show first 5 agents
            print(f"  - {agent['name']}: {agent['status']} "
                  f"(completed: {agent['tasks_completed']}, "
                  f"success rate: {agent['success_rate']:.1%})")
        
    finally:
        await orchestrator.shutdown()


async def run_stress_test():
    """Run a stress test with many concurrent tasks."""
    print("\n=== Stress Test Demo ===\n")
    
    # Configure for stress testing
    orch_config = OrchestrationConfig(
        execution_mode=ExecutionMode.HYBRID,
        scheduling_algorithm=SchedulingAlgorithm.LEAST_LOADED,
        max_parallel_benchmarks=20,
        resource_limits=ResourceLimits(
            max_cpu_percent=90,
            max_memory_mb=2048,
            max_concurrent_tasks=20,
            task_timeout=60
        )
    )
    
    orchestrator = OrchestrationManager(orch_config)
    
    # Generate many objectives
    objectives = [
        f"Task {i}: Analyze and optimize component {i}"
        for i in range(50)
    ]
    
    bench_config = BenchmarkConfig(
        name="stress-test",
        strategy=StrategyType.ANALYSIS,
        mode=CoordinationMode.DISTRIBUTED,
        max_agents=20,
        parallel=True,
        timeout=300,
        task_timeout=30
    )
    
    try:
        await orchestrator.initialize()
        
        print(f"Starting stress test with {len(objectives)} tasks...")
        
        # Run stress test
        results = await orchestrator.run_benchmark_suite(objectives, bench_config)
        
        print(f"\nStress Test Results:")
        print(f"  - Total tasks: {len(objectives)}")
        print(f"  - Completed: {results['completed_objectives']}")
        print(f"  - Failed: {results['failed_objectives']}")
        print(f"  - Duration: {results['duration']:.2f}s")
        print(f"  - Throughput: {results['throughput']:.2f} tasks/second")
        
        # Resource utilization
        exec_metrics = results['execution_metrics']
        print(f"\nResource Utilization:")
        print(f"  - Peak CPU: {exec_metrics['peak_cpu_usage']:.1f}%")
        print(f"  - Peak Memory: {exec_metrics['peak_memory_usage']:.1f}MB")
        print(f"  - Current CPU: {exec_metrics['current_cpu_usage']:.1f}%")
        print(f"  - Current Memory: {exec_metrics['current_memory_usage']:.1f}MB")
        
    finally:
        await orchestrator.shutdown()


async def main():
    """Run all demonstration scenarios."""
    # Run basic parallel benchmark
    await run_basic_parallel_benchmark()
    
    # Small delay between demos
    await asyncio.sleep(2)
    
    # Run adaptive benchmark
    await run_adaptive_benchmark()
    
    # Small delay
    await asyncio.sleep(2)
    
    # Run stress test
    await run_stress_test()
    
    print("\n=== All demos completed! ===")


if __name__ == "__main__":
    asyncio.run(main())