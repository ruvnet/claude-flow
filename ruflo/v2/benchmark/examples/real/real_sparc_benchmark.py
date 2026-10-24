#!/usr/bin/env python3
"""
Real SPARC Benchmark Example - Execute and measure real SPARC mode performance.

This example demonstrates how to:
1. Execute real Claude Flow SPARC modes
2. Measure specialized agent performance
3. Parse real SPARC execution responses  
4. Track mode-specific metrics

Usage:
    python real_sparc_benchmark.py [mode] [task_description]
"""

import sys
import json
import argparse
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from swarm_benchmark.scenarios.real_benchmarks import RealSparcBenchmark, RealBenchmarkResult


def run_sparc_benchmark(mode: str, task: str, timeout: int = 10) -> RealBenchmarkResult:
    """
    Run a real SPARC benchmark.
    
    Args:
        mode: SPARC mode to execute
        task: Task description
        timeout: Timeout in minutes
        
    Returns:
        RealBenchmarkResult with actual metrics
    """
    print(f"⚡ Starting Real SPARC Benchmark")
    print(f"   Mode: {mode}")
    print(f"   Task: {task}")
    print(f"   Timeout: {timeout}m")
    print("-" * 60)
    
    # Initialize benchmark
    benchmark = RealSparcBenchmark()
    
    # Execute real SPARC mode
    result = benchmark.executor.execute_sparc_mode(
        mode=mode,
        task=task,
        timeout=timeout
    )
    
    # Display results
    print(f"✅ SPARC Benchmark Complete!")
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
        print(f"\n📋 SPARC Output Excerpt:")
        print(result.stdout_excerpt)
        
    if result.stderr_excerpt and result.error_count > 0:
        print(f"\n❌ Error Excerpt:")
        print(result.stderr_excerpt)
        
    # Display command executed
    if result.command_executed:
        print(f"\n🔧 Command Executed:")
        print(f"   {' '.join(result.command_executed)}")
        
    return result


def run_sparc_mode_suite():
    """Run comprehensive SPARC mode benchmark suite."""
    print("🔥 Running SPARC Mode Benchmark Suite")
    print("=" * 60)
    
    sparc_scenarios = [
        ("coder", "Implement user authentication system with JWT tokens", 12),
        ("tdd", "Create payment processing module with comprehensive tests", 15),
        ("architect", "Design microservices architecture for social media platform", 10),
        ("optimizer", "Optimize database queries and API response times", 8),
        ("researcher", "Research latest trends in AI and machine learning", 10),
        ("reviewer", "Conduct comprehensive code review of REST API", 8),
        ("analyzer", "Analyze system performance and identify bottlenecks", 10),
        ("designer", "Design user interface for mobile application", 12),
        ("documenter", "Create comprehensive API documentation", 8),
        ("debugger", "Debug and fix complex application issues", 10),
        ("tester", "Create automated test suite for web application", 10),
        ("innovator", "Brainstorm innovative features for productivity app", 8)
    ]
    
    results = []
    
    for i, (mode, task, timeout) in enumerate(sparc_scenarios, 1):
        print(f"\n🎯 SPARC Mode Test {i}/{len(sparc_scenarios)}")
        result = run_sparc_benchmark(mode, task, timeout)
        results.append(result)
        print("=" * 60)
    
    # Save comprehensive results
    output_file = Path("real_sparc_benchmark_results.json")
    with open(output_file, 'w') as f:
        json.dump([r.to_dict() for r in results], f, indent=2)
    
    print(f"\n💾 Results saved to: {output_file}")
    
    # SPARC performance analysis  
    total_time = sum(r.execution_time for r in results)
    total_tokens = sum(r.tokens_used for r in results)
    success_rate = sum(1 for r in results if r.success) / len(results) * 100
    
    # Mode-specific analysis
    mode_performance = {}
    for result in results:
        mode = result.benchmark_name.replace("sparc_", "")
        if mode not in mode_performance:
            mode_performance[mode] = {
                "count": 0,
                "total_time": 0,
                "total_tokens": 0,
                "successes": 0
            }
        mode_performance[mode]["count"] += 1
        mode_performance[mode]["total_time"] += result.execution_time
        mode_performance[mode]["total_tokens"] += result.tokens_used
        if result.success:
            mode_performance[mode]["successes"] += 1
    
    print(f"\n📊 SPARC Mode Performance Summary:")
    print(f"   Total Execution Time: {total_time:.2f}s")
    print(f"   Total Tokens Used: {total_tokens}")
    print(f"   Overall Success Rate: {success_rate:.1f}%")
    print(f"   Average Time per Mode: {total_time/len(results):.2f}s")
    print(f"   Token Efficiency: {total_tokens/total_time:.1f} tokens/sec")
    
    print(f"\n🎯 Per-Mode Performance:")
    for mode, perf in mode_performance.items():
        avg_time = perf["total_time"] / perf["count"]
        avg_tokens = perf["total_tokens"] / perf["count"] 
        success_rate = perf["successes"] / perf["count"] * 100
        print(f"   {mode:12} | Time: {avg_time:6.2f}s | Tokens: {avg_tokens:6.0f} | Success: {success_rate:5.1f}%")


def run_development_workflow_benchmark():
    """Benchmark complete development workflow using SPARC modes."""
    print("🚀 Running Development Workflow Benchmark")
    print("=" * 60)
    
    workflow_steps = [
        ("architect", "Design RESTful API for task management system", 8),
        ("coder", "Implement user authentication endpoints", 10),
        ("tdd", "Create comprehensive tests for authentication", 8),
        ("reviewer", "Review authentication implementation", 6),
        ("optimizer", "Optimize authentication performance", 6),
        ("documenter", "Document authentication API endpoints", 6),
        ("tester", "Run integration tests for complete workflow", 8)
    ]
    
    results = []
    workflow_start = None
    
    for i, (mode, task, timeout) in enumerate(workflow_steps, 1):
        if i == 1:
            import time
            workflow_start = time.time()
            
        print(f"\n🎯 Workflow Step {i}/{len(workflow_steps)}")
        result = run_sparc_benchmark(mode, task, timeout)
        results.append(result)
        print("=" * 60)
    
    total_workflow_time = sum(r.execution_time for r in results)
    
    # Save workflow results
    output_file = Path("development_workflow_benchmark_results.json")
    with open(output_file, 'w') as f:
        json.dump([r.to_dict() for r in results], f, indent=2)
    
    print(f"\n🚀 Development Workflow Complete!")
    print(f"   Total Workflow Time: {total_workflow_time:.2f}s")
    print(f"   Steps Completed: {len(results)}")
    print(f"   Success Rate: {sum(1 for r in results if r.success)/len(results)*100:.1f}%")
    print(f"   Average Step Time: {total_workflow_time/len(results):.2f}s")
    print(f"   Results saved to: {output_file}")
    
    return results


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Real SPARC Benchmark Example")
    parser.add_argument("mode", nargs="?", default="coder",
                       choices=["coder", "tdd", "architect", "optimizer", "researcher", 
                               "reviewer", "analyzer", "designer", "documenter", 
                               "debugger", "tester", "innovator"],
                       help="SPARC mode to execute")
    parser.add_argument("task", nargs="?",
                       default="Create a simple web API with authentication",
                       help="Task description")
    parser.add_argument("--timeout", type=int, default=10,
                       help="Timeout in minutes")
    parser.add_argument("--suite", action="store_true",
                       help="Run comprehensive SPARC mode suite")
    parser.add_argument("--workflow", action="store_true",
                       help="Run development workflow benchmark")
    
    args = parser.parse_args()
    
    if args.suite:
        run_sparc_mode_suite()
    elif args.workflow:
        run_development_workflow_benchmark()
    else:
        run_sparc_benchmark(args.mode, args.task, args.timeout)


if __name__ == "__main__":
    main()