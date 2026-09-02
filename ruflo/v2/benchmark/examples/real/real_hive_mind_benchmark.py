#!/usr/bin/env python3
"""
Real Hive-Mind Benchmark Example - Execute and measure real hive-mind performance.

This example demonstrates how to:
1. Execute real Claude Flow hive-mind commands
2. Measure collective intelligence performance
3. Parse real distributed agent responses
4. Track swarm coordination metrics

Usage:
    python real_hive_mind_benchmark.py [task_description]
"""

import sys
import json
import argparse
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from swarm_benchmark.scenarios.real_benchmarks import RealHiveMindBenchmark, RealBenchmarkResult


def run_hive_mind_benchmark(task: str, mode: str = "consensus", agents: int = 8) -> RealBenchmarkResult:
    """
    Run a real hive-mind benchmark.
    
    Args:
        task: Task description
        mode: Collective intelligence mode
        agents: Number of agents
        
    Returns:
        RealBenchmarkResult with actual metrics
    """
    print(f"🧠 Starting Real Hive-Mind Benchmark")
    print(f"   Task: {task}")
    print(f"   Mode: {mode}")
    print(f"   Agents: {agents}")
    print("-" * 60)
    
    # Initialize benchmark
    benchmark = RealHiveMindBenchmark()
    
    # Execute real hive-mind
    result = benchmark.executor.execute_hive_mind(
        task=task,
        collective_mode=mode,
        agent_count=agents,
        timeout=15
    )
    
    # Display results
    print(f"✅ Hive-Mind Benchmark Complete!")
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
        print(f"\n📋 Collective Output Excerpt:")
        print(result.stdout_excerpt)
        
    if result.stderr_excerpt and result.error_count > 0:
        print(f"\n❌ Error Excerpt:")
        print(result.stderr_excerpt)
        
    # Display raw metrics if available
    if result.metrics_raw:
        print(f"\n📊 Raw Metrics:")
        for key, value in result.metrics_raw.items():
            print(f"   {key}: {value}")
        
    return result


def run_collective_intelligence_suite():
    """Run comprehensive collective intelligence benchmark suite."""
    print("🔥 Running Collective Intelligence Benchmark Suite")
    print("=" * 60)
    
    benchmark_configs = [
        ("Design a distributed system architecture", "consensus", 6),
        ("Solve complex optimization problem: traveling salesman with 20 cities", "collective-intelligence", 10),
        ("Collaborate on comprehensive code review", "memory-shared", 8),
        ("Brainstorm innovative AI applications", "divergent-thinking", 12),
        ("Analyze market trends for cryptocurrency", "research-swarm", 8),
        ("Optimize neural network hyperparameters", "optimization-collective", 6)
    ]
    
    results = []
    
    for i, (task, mode, agents) in enumerate(benchmark_configs, 1):
        print(f"\n🎯 Collective Intelligence Test {i}/{len(benchmark_configs)}")
        result = run_hive_mind_benchmark(task, mode, agents)
        results.append(result)
        print("=" * 60)
    
    # Save comprehensive results
    output_file = Path("real_hive_mind_benchmark_results.json")
    with open(output_file, 'w') as f:
        json.dump([r.to_dict() for r in results], f, indent=2)
    
    print(f"\n💾 Results saved to: {output_file}")
    
    # Collective intelligence metrics
    total_time = sum(r.execution_time for r in results)
    total_tokens = sum(r.tokens_used for r in results)
    total_agents = sum(r.agents_spawned for r in results)
    success_rate = sum(1 for r in results if r.success) / len(results) * 100
    avg_agents_per_task = total_agents / len(results)
    
    print(f"\n📊 Collective Intelligence Summary:")
    print(f"   Total Execution Time: {total_time:.2f}s")
    print(f"   Total Tokens Used: {total_tokens}")
    print(f"   Total Agents Spawned: {total_agents}")
    print(f"   Success Rate: {success_rate:.1f}%")
    print(f"   Average Agents per Task: {avg_agents_per_task:.1f}")
    print(f"   Average Time per Task: {total_time/len(results):.2f}s")
    print(f"   Collective Efficiency: {total_tokens/total_time:.1f} tokens/sec")


def run_swarm_memory_benchmark():
    """Benchmark swarm with shared memory capabilities."""
    print("🧬 Running Swarm Memory Benchmark")
    print("=" * 60)
    
    memory_tasks = [
        "Maintain shared knowledge base while solving multi-step math problems",
        "Coordinate distributed file processing with shared state",
        "Collaborate on building comprehensive documentation with memory persistence",
        "Execute parallel research tasks with knowledge sharing"
    ]
    
    results = []
    
    for i, task in enumerate(memory_tasks, 1):
        print(f"\n🎯 Memory Test {i}/{len(memory_tasks)}")
        result = run_hive_mind_benchmark(task, "memory-shared", 6)
        results.append(result)
        print("=" * 60)
    
    # Analyze memory performance
    avg_time = sum(r.execution_time for r in results) / len(results)
    avg_memory = sum(r.memory_usage_mb for r in results) / len(results)
    success_rate = sum(1 for r in results if r.success) / len(results) * 100
    
    print(f"\n🧬 Memory Performance Analysis:")
    print(f"   Average Execution Time: {avg_time:.2f}s")
    print(f"   Average Memory Usage: {avg_memory:.2f} MB")
    print(f"   Memory Success Rate: {success_rate:.1f}%")
    
    return results


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Real Hive-Mind Benchmark Example")
    parser.add_argument("task", nargs="?",
                       default="Design a scalable microservices architecture for e-commerce platform",
                       help="Task description for the hive-mind")
    parser.add_argument("--mode", default="consensus",
                       choices=["consensus", "collective-intelligence", "memory-shared", 
                               "divergent-thinking", "research-swarm", "optimization-collective"],
                       help="Collective intelligence mode")
    parser.add_argument("--agents", type=int, default=8,
                       help="Number of agents in the hive-mind")
    parser.add_argument("--suite", action="store_true",
                       help="Run comprehensive collective intelligence suite")
    parser.add_argument("--memory", action="store_true",
                       help="Run swarm memory benchmark")
    
    args = parser.parse_args()
    
    if args.suite:
        run_collective_intelligence_suite()
    elif args.memory:
        run_swarm_memory_benchmark()
    else:
        run_hive_mind_benchmark(args.task, args.mode, args.agents)


if __name__ == "__main__":
    main()