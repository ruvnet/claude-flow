#!/usr/bin/env python3
"""
Demo script for the new real claude-flow benchmark system
Shows how to benchmark actual claude-flow commands with real metrics
"""

import asyncio
import json
from pathlib import Path
import sys

# Add the benchmark source to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.core.claude_flow_executor import (
    ClaudeFlowExecutor, SwarmConfig, SparcConfig, 
    ExecutionStrategy, CoordinationMode
)
from swarm_benchmark.metrics.performance_collector import PerformanceCollector
from swarm_benchmark.core.parallel_executor import ParallelExecutor, ExecutionMode
from swarm_benchmark.core.orchestration_manager import OrchestrationManager


async def demo_basic_benchmark():
    """Demonstrate basic benchmarking with real claude-flow execution"""
    print("\n🚀 Demo 1: Basic Real Benchmark")
    print("=" * 60)
    
    executor = ClaudeFlowExecutor()
    
    # Test 1: Simple SPARC mode
    print("\n📊 Testing SPARC Coder Mode:")
    sparc_config = SparcConfig(
        mode="coder",
        prompt="Create a fibonacci function in Python"
    )
    
    result = executor.execute_sparc(sparc_config)
    print(f"✅ Success: {result.success}")
    print(f"⏱️  Execution Time: {result.execution_time:.2f}s")
    print(f"💾 Memory Used: {result.metrics.get('peak_memory_mb', 0):.1f}MB")
    
    # Test 2: Swarm execution
    print("\n📊 Testing Swarm Research Strategy:")
    swarm_config = SwarmConfig(
        objective="Research best practices for Python async programming",
        strategy=ExecutionStrategy.RESEARCH,
        mode=CoordinationMode.DISTRIBUTED,
        max_agents=3
    )
    
    result = executor.execute_swarm(swarm_config)
    print(f"✅ Success: {result.success}")
    print(f"⏱️  Execution Time: {result.execution_time:.2f}s")
    print(f"📋 Output Lines: {result.metrics.get('output_lines', 0)}")


async def demo_parallel_benchmark():
    """Demonstrate parallel benchmark execution"""
    print("\n\n🚀 Demo 2: Parallel Benchmark Execution")
    print("=" * 60)
    
    parallel_executor = ParallelExecutor(
        max_workers=4,
        mode=ExecutionMode.THREAD,
        resource_limits={'cpu_percent': 80, 'memory_mb': 2048}
    )
    
    # Create multiple benchmark tasks
    tasks = [
        {
            'name': 'sparc_coder',
            'func': lambda: ClaudeFlowExecutor().execute_sparc(
                SparcConfig(mode="coder", prompt="Write a sorting algorithm")
            ),
            'priority': 1
        },
        {
            'name': 'sparc_tester',
            'func': lambda: ClaudeFlowExecutor().execute_sparc(
                SparcConfig(mode="tester", prompt="Test a login function")
            ),
            'priority': 2
        },
        {
            'name': 'swarm_development',
            'func': lambda: ClaudeFlowExecutor().execute_swarm(
                SwarmConfig(
                    objective="Build a simple TODO API",
                    strategy=ExecutionStrategy.DEVELOPMENT,
                    max_agents=3
                )
            ),
            'priority': 1
        }
    ]
    
    print("📋 Submitting 3 benchmark tasks...")
    futures = []
    for task in tasks:
        future = await parallel_executor.submit_task(
            task['func'], 
            priority=task['priority'],
            task_name=task['name']
        )
        futures.append((task['name'], future))
    
    print("⏳ Waiting for completion...")
    for name, future in futures:
        try:
            result = await future
            print(f"✅ {name}: Success={result.success}, Time={result.execution_time:.2f}s")
        except Exception as e:
            print(f"❌ {name}: Failed - {str(e)}")
    
    # Show metrics
    metrics = parallel_executor.get_metrics()
    print(f"\n📊 Parallel Execution Metrics:")
    print(f"  - Total Tasks: {metrics['total_tasks']}")
    print(f"  - Success Rate: {metrics['success_rate']:.1%}")
    print(f"  - Avg Execution Time: {metrics['avg_execution_time']:.2f}s")
    print(f"  - Peak Workers: {metrics['peak_workers']}")


async def demo_comprehensive_benchmark():
    """Demonstrate comprehensive benchmarking with orchestration"""
    print("\n\n🚀 Demo 3: Comprehensive Benchmark Suite")
    print("=" * 60)
    
    orchestrator = OrchestrationManager()
    
    # Define benchmark suite
    benchmarks = [
        {
            'name': 'SPARC Modes Test',
            'mode': 'sparc',
            'configs': [
                SparcConfig(mode="coder", prompt="Implement binary search"),
                SparcConfig(mode="reviewer", prompt="Review this code for security"),
                SparcConfig(mode="optimizer", prompt="Optimize database queries")
            ]
        },
        {
            'name': 'Swarm Strategies Test',
            'mode': 'swarm',
            'configs': [
                SwarmConfig(
                    objective="Create user authentication system",
                    strategy=ExecutionStrategy.DEVELOPMENT,
                    mode=CoordinationMode.HIERARCHICAL
                ),
                SwarmConfig(
                    objective="Research microservices patterns",
                    strategy=ExecutionStrategy.RESEARCH,
                    mode=CoordinationMode.DISTRIBUTED
                )
            ]
        }
    ]
    
    print("📋 Running comprehensive benchmark suite...")
    results = await orchestrator.run_parallel_benchmarks(
        benchmarks,
        max_parallel=3,
        monitor_resources=True
    )
    
    # Generate report
    print("\n📊 Benchmark Results Summary:")
    for suite_name, suite_results in results.items():
        print(f"\n  {suite_name}:")
        success_count = sum(1 for r in suite_results if r.get('success', False))
        total_count = len(suite_results)
        avg_time = sum(r.get('execution_time', 0) for r in suite_results) / total_count
        
        print(f"    - Success Rate: {success_count}/{total_count} ({success_count/total_count:.1%})")
        print(f"    - Avg Execution Time: {avg_time:.2f}s")
        
        for result in suite_results:
            status = "✅" if result.get('success', False) else "❌"
            print(f"    {status} {result.get('task_name', 'Unknown')}: {result.get('execution_time', 0):.2f}s")
    
    # Save detailed report
    report_path = Path(__file__).parent / "real_benchmark_report.json"
    with open(report_path, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\n💾 Detailed report saved to: {report_path}")


async def main():
    """Run all demos"""
    print("🧠 Claude-Flow Real Benchmark System Demo")
    print("=" * 60)
    print("This demo showcases the new benchmark system that executes")
    print("real claude-flow commands and measures actual performance.")
    
    try:
        # Run demos
        await demo_basic_benchmark()
        await demo_parallel_benchmark()
        await demo_comprehensive_benchmark()
        
        print("\n\n✅ All demos completed successfully!")
        print("\nKey Features Demonstrated:")
        print("  • Real claude-flow command execution")
        print("  • Accurate performance metrics collection")
        print("  • Parallel benchmark execution")
        print("  • Resource monitoring and limits")
        print("  • Comprehensive test orchestration")
        print("  • Support for all SPARC modes and swarm strategies")
        
    except Exception as e:
        print(f"\n❌ Demo failed: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())