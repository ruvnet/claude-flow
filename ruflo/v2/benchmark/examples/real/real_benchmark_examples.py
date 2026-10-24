#!/usr/bin/env python3
"""
Examples of using the Real Claude-Flow Benchmark Engine
Demonstrates various usage patterns and configurations
"""

import asyncio
import json
from pathlib import Path
import sys

# Add benchmark source to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from swarm_benchmark.core.real_benchmark_engine import RealBenchmarkEngine
from swarm_benchmark.core.models import (
    BenchmarkConfig, Task, StrategyType, CoordinationMode
)


async def example_simple_benchmark():
    """Example 1: Simple benchmark execution"""
    print("\n" + "="*60)
    print("Example 1: Simple Benchmark")
    print("="*60)
    
    # Create configuration
    config = BenchmarkConfig(
        name="simple-benchmark",
        description="A simple benchmark example",
        strategy=StrategyType.AUTO,
        mode=CoordinationMode.CENTRALIZED,
        task_timeout=60,
        output_formats=["json"],
        output_directory="./reports/examples"
    )
    
    # Create engine
    engine = RealBenchmarkEngine(config)
    
    # Run benchmark
    result = await engine.run_benchmark("Create a function to calculate fibonacci numbers")
    
    print(f"\nBenchmark ID: {result['benchmark_id']}")
    print(f"Status: {result['status']}")
    print(f"Duration: {result.get('duration', 0):.2f}s")
    
    return result


async def example_sparc_mode_comparison():
    """Example 2: Compare different SPARC modes"""
    print("\n" + "="*60)
    print("Example 2: SPARC Mode Comparison")
    print("="*60)
    
    objective = "Create a REST API endpoint for user management"
    modes_to_test = ["coder", "architect", "tdd", "reviewer"]
    
    results = {}
    
    for mode in modes_to_test:
        print(f"\nTesting SPARC mode: {mode}")
        
        config = BenchmarkConfig(
            name=f"sparc-{mode}-test",
            task_timeout=45
        )
        
        engine = RealBenchmarkEngine(config)
        
        # Execute SPARC mode
        result = await engine._execute_sparc_mode(mode, objective)
        results[mode] = result
        
        print(f"  Success: {result['success']}")
        print(f"  Duration: {result['duration']:.2f}s")
        if 'resource_usage' in result:
            print(f"  CPU: {result['resource_usage'].get('avg_cpu_percent', 0):.1f}%")
            print(f"  Memory: {result['resource_usage'].get('peak_memory_mb', 0):.1f} MB")
    
    return results


async def example_swarm_strategies():
    """Example 3: Test different swarm strategies"""
    print("\n" + "="*60)
    print("Example 3: Swarm Strategy Testing")
    print("="*60)
    
    objective = "Build a data processing pipeline"
    
    # Define test configurations
    test_configs = [
        {
            "strategy": StrategyType.DEVELOPMENT,
            "mode": CoordinationMode.HIERARCHICAL,
            "description": "Development with hierarchical coordination"
        },
        {
            "strategy": StrategyType.RESEARCH,
            "mode": CoordinationMode.DISTRIBUTED,
            "description": "Research with distributed coordination"
        },
        {
            "strategy": StrategyType.OPTIMIZATION,
            "mode": CoordinationMode.HYBRID,
            "description": "Optimization with hybrid coordination"
        }
    ]
    
    results = []
    
    for config_def in test_configs:
        print(f"\n📋 {config_def['description']}")
        
        config = BenchmarkConfig(
            name=f"swarm-{config_def['strategy'].value}",
            strategy=config_def['strategy'],
            mode=config_def['mode'],
            max_agents=5,
            parallel=True,
            monitoring=True,
            task_timeout=90
        )
        
        engine = RealBenchmarkEngine(config)
        
        result = await engine.run_benchmark(objective)
        results.append({
            "config": config_def['description'],
            "result": result
        })
        
        print(f"  Status: {result['status']}")
        print(f"  Duration: {result.get('duration', 0):.2f}s")
    
    return results


async def example_parallel_benchmarking():
    """Example 4: Parallel task execution"""
    print("\n" + "="*60)
    print("Example 4: Parallel Task Benchmarking")
    print("="*60)
    
    config = BenchmarkConfig(
        name="parallel-benchmark",
        parallel=True,
        max_agents=4,
        task_timeout=60,
        monitoring=True
    )
    
    engine = RealBenchmarkEngine(config)
    
    # Create multiple tasks
    tasks = [
        Task(
            objective="Create a user authentication module",
            strategy=StrategyType.DEVELOPMENT,
            mode=CoordinationMode.CENTRALIZED
        ),
        Task(
            objective="Research best practices for API security",
            strategy=StrategyType.RESEARCH,
            mode=CoordinationMode.DISTRIBUTED
        ),
        Task(
            objective="Analyze code for performance bottlenecks",
            strategy=StrategyType.ANALYSIS,
            mode=CoordinationMode.MESH
        ),
        Task(
            objective="Generate comprehensive test suite",
            strategy=StrategyType.TESTING,
            mode=CoordinationMode.HIERARCHICAL
        )
    ]
    
    print(f"Executing {len(tasks)} tasks in parallel...")
    
    # Execute batch
    results = await engine.execute_batch(tasks)
    
    # Analyze results
    successful = sum(1 for r in results if r.status.value == "success")
    total_time = sum(r.performance_metrics.execution_time for r in results)
    
    print(f"\n📊 Results:")
    print(f"  Successful: {successful}/{len(tasks)}")
    print(f"  Total execution time: {total_time:.2f}s")
    print(f"  Average time per task: {total_time/len(tasks):.2f}s")
    
    for i, result in enumerate(results):
        print(f"\n  Task {i+1}: {tasks[i].objective[:50]}...")
        print(f"    Status: {result.status.value}")
        print(f"    Duration: {result.performance_metrics.execution_time:.2f}s")
        print(f"    Quality: {result.quality_metrics.overall_quality:.2f}")
    
    return results


async def example_comprehensive_mode_testing():
    """Example 5: Test all modes comprehensively"""
    print("\n" + "="*60)
    print("Example 5: Comprehensive Mode Testing")
    print("="*60)
    
    config = BenchmarkConfig(
        name="comprehensive-test",
        task_timeout=30,  # Shorter timeout for comprehensive testing
        output_formats=["json", "sqlite"],
        monitoring=True
    )
    
    engine = RealBenchmarkEngine(config)
    
    # Note: This is resource-intensive!
    print("⚠️  This will test all SPARC modes and swarm strategies")
    print("   This may take several minutes to complete...")
    
    # For demo, we'll test a subset
    objective = "Create a simple calculator application"
    
    # Test subset of SPARC modes
    sparc_modes = ["coder", "reviewer", "tester"]
    sparc_results = {}
    
    for mode in sparc_modes:
        print(f"\n  Testing SPARC {mode}...")
        result = await engine._execute_sparc_mode(mode, objective)
        sparc_results[mode] = result
    
    # Test subset of swarm combinations
    swarm_configs = [
        (StrategyType.AUTO, CoordinationMode.CENTRALIZED),
        (StrategyType.DEVELOPMENT, CoordinationMode.HIERARCHICAL),
        (StrategyType.TESTING, CoordinationMode.DISTRIBUTED)
    ]
    
    swarm_results = {}
    
    for strategy, mode in swarm_configs:
        print(f"\n  Testing Swarm {strategy.value}/{mode.value}...")
        
        task = Task(
            objective=objective,
            strategy=strategy,
            mode=mode
        )
        
        result = await engine._execute_real_task(task)
        swarm_results[f"{strategy.value}_{mode.value}"] = {
            "success": result.status.value == "success",
            "duration": result.performance_metrics.execution_time,
            "quality": result.quality_metrics.overall_quality
        }
    
    return {
        "sparc_modes": sparc_results,
        "swarm_strategies": swarm_results
    }


async def example_resource_monitoring():
    """Example 6: Detailed resource monitoring"""
    print("\n" + "="*60)
    print("Example 6: Resource Monitoring")
    print("="*60)
    
    # Create system monitor
    system_monitor = SystemMonitor()
    
    # Take baseline
    baseline = system_monitor.take_measurement()
    print(f"Baseline CPU: {baseline['cpu_percent']:.1f}%")
    print(f"Baseline Memory: {baseline['memory_percent']:.1f}%")
    
    # Configure with monitoring
    config = BenchmarkConfig(
        name="resource-monitor-test",
        monitoring=True,
        task_timeout=60,
        resource_limits={
            "max_memory_mb": 512,
            "max_cpu_percent": 75
        }
    )
    
    engine = RealBenchmarkEngine(config)
    
    # Run intensive task
    print("\nExecuting resource-intensive task...")
    result = await engine.run_benchmark("Analyze a large codebase for complexity metrics")
    
    # Take final measurement
    final = system_monitor.take_measurement()
    
    # Get summary
    summary = system_monitor.get_summary()
    
    print(f"\n📊 Resource Usage Summary:")
    print(f"  Average CPU: {summary['avg_cpu']:.1f}%")
    print(f"  Peak CPU: {summary['max_cpu']:.1f}%")
    print(f"  Average Memory: {summary['avg_memory']:.1f}%")
    print(f"  Peak Memory: {summary['max_memory']:.1f}%")
    
    # Process-specific metrics from result
    if result.get('results'):
        process_metrics = result['results'][0].get('resource_usage', {})
        print(f"\n📈 Process Metrics:")
        print(f"  Process CPU: {process_metrics.get('average_cpu_percent', 0):.1f}%")
        print(f"  Process Memory: {process_metrics.get('peak_memory_mb', 0):.1f} MB")
    
    return {
        "system_summary": summary,
        "benchmark_result": result
    }


async def main():
    """Run all examples"""
    print("🚀 Real Claude-Flow Benchmark Examples")
    
    examples = [
        ("Simple Benchmark", example_simple_benchmark),
        ("SPARC Mode Comparison", example_sparc_mode_comparison),
        ("Swarm Strategies", example_swarm_strategies),
        ("Parallel Benchmarking", example_parallel_benchmarking),
        ("Comprehensive Testing", example_comprehensive_mode_testing),
        ("Resource Monitoring", example_resource_monitoring)
    ]
    
    all_results = {}
    
    for name, example_func in examples:
        try:
            print(f"\n{'='*60}")
            print(f"Running: {name}")
            print('='*60)
            
            result = await example_func()
            all_results[name] = {
                "status": "success",
                "result": result
            }
            
        except Exception as e:
            print(f"\n❌ Example '{name}' failed: {e}")
            all_results[name] = {
                "status": "failed",
                "error": str(e)
            }
    
    # Save all results
    output_file = Path("reports/examples/all_examples_results.json")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    
    print(f"\n\n💾 All results saved to: {output_file}")
    
    # Summary
    successful = sum(1 for r in all_results.values() if r["status"] == "success")
    print(f"\n📊 Summary: {successful}/{len(examples)} examples completed successfully")


if __name__ == "__main__":
    # Create output directories
    Path("reports/examples").mkdir(parents=True, exist_ok=True)
    Path("test_output/real_benchmarks").mkdir(parents=True, exist_ok=True)
    
    # Run examples
    asyncio.run(main())