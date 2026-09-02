#!/usr/bin/env python3
"""
Real Swarm Benchmark Example - Execute and measure real swarm performance.

This example demonstrates how to:
1. Execute real Claude Flow swarm commands
2. Measure actual performance metrics
3. Parse real JSON streaming responses
4. Track token usage from actual Claude responses

Usage:
    python real_swarm_benchmark.py [task_description]
"""

import sys
import json
import argparse
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from swarm_benchmark.scenarios.real_benchmarks import RealSwarmBenchmark, RealBenchmarkResult


def run_swarm_benchmark(task: str, strategy: str = "auto", mode: str = "hierarchical") -> RealBenchmarkResult:
    """
    Run a real swarm benchmark.
    
    Args:
        task: Task description
        strategy: Execution strategy
        mode: Coordination mode
        
    Returns:
        RealBenchmarkResult with actual metrics
    """
    print(f"🚀 Starting Real Swarm Benchmark")
    print(f"   Task: {task}")
    print(f"   Strategy: {strategy}")  
    print(f"   Mode: {mode}")
    print("-" * 60)
    
    # Initialize benchmark
    benchmark = RealSwarmBenchmark()
    
    # Execute real swarm
    result = benchmark.executor.execute_swarm(
        objective=task,
        strategy=strategy,
        mode=mode,
        max_agents=5,
        timeout=10,
        non_interactive=True
    )
    
    # Display results
    print(f"✅ Benchmark Complete!")
    print(f"   Success: {result.success}")
    print(f"   Execution Time: {result.execution_time:.2f}s")
    print(f"   Tokens Used: {result.tokens_used}")
    print(f"   Agents Spawned: {result.agents_spawned}")
    print(f"   Memory Usage: {result.memory_usage_mb:.2f} MB")
    print(f"   CPU Usage: {result.cpu_usage_percent:.1f}%")
    print(f"   Output Size: {result.output_size_bytes} bytes")
    print(f"   Errors: {result.error_count}")
    print(f"   Warnings: {result.warning_count}")
    
    if result.stdout_excerpt:
        print(f"\n📋 Output Excerpt:")
        print(result.stdout_excerpt)
        
    if result.stderr_excerpt and result.error_count > 0:
        print(f"\n❌ Error Excerpt:")
        print(result.stderr_excerpt)
        
    return result


def run_multiple_benchmarks():
    """Run multiple swarm benchmarks with different configurations."""
    print("🔥 Running Multiple Real Swarm Benchmarks")
    print("=" * 60)
    
    benchmark_configs = [
        ("Create a REST API for user management", "development", "centralized"),
        ("Analyze system performance bottlenecks", "analysis", "distributed"),
        ("Research modern web development frameworks", "research", "mesh"),
        ("Optimize database query performance", "optimization", "hierarchical"),
        ("Test API endpoint functionality", "testing", "hybrid")
    ]
    
    results = []
    
    for i, (task, strategy, mode) in enumerate(benchmark_configs, 1):
        print(f"\n🎯 Benchmark {i}/{len(benchmark_configs)}")
        result = run_swarm_benchmark(task, strategy, mode)
        results.append(result)
        print("=" * 60)
    
    # Save comprehensive results
    output_file = Path("real_swarm_benchmark_results.json")
    with open(output_file, 'w') as f:
        json.dump([r.to_dict() for r in results], f, indent=2)
    
    print(f"\n💾 Results saved to: {output_file}")
    
    # Summary statistics
    total_time = sum(r.execution_time for r in results)
    total_tokens = sum(r.tokens_used for r in results)
    total_agents = sum(r.agents_spawned for r in results)
    success_rate = sum(1 for r in results if r.success) / len(results) * 100
    
    print(f"\n📊 Summary Statistics:")
    print(f"   Total Execution Time: {total_time:.2f}s")
    print(f"   Total Tokens Used: {total_tokens}")
    print(f"   Total Agents Spawned: {total_agents}")
    print(f"   Success Rate: {success_rate:.1f}%")
    print(f"   Average Time per Benchmark: {total_time/len(results):.2f}s")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Real Swarm Benchmark Example")
    parser.add_argument("task", nargs="?", 
                       default="Create a simple web application with authentication",
                       help="Task description for the swarm")
    parser.add_argument("--strategy", default="auto",
                       choices=["auto", "development", "research", "analysis", "testing", "optimization"],
                       help="Execution strategy")
    parser.add_argument("--mode", default="hierarchical", 
                       choices=["centralized", "distributed", "hierarchical", "mesh", "hybrid"],
                       help="Coordination mode")
    parser.add_argument("--multiple", action="store_true",
                       help="Run multiple benchmark scenarios")
    
    args = parser.parse_args()
    
    if args.multiple:
        run_multiple_benchmarks()
    else:
        run_swarm_benchmark(args.task, args.strategy, args.mode)


if __name__ == "__main__":
    main()