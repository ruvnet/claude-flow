#!/usr/bin/env python3
"""
Run Real Benchmarks - Comprehensive real benchmark execution.

This script orchestrates real benchmark executions across:
1. Swarm benchmarks with actual ./claude-flow commands
2. Hive-mind benchmarks with collective intelligence  
3. SPARC mode benchmarks with specialized agents
4. Performance analysis and reporting

Usage:
    python run_real_benchmarks.py [--mode MODE] [--output-dir DIR] [--timeout MINUTES]
"""

import sys
import json
import argparse
import time
from pathlib import Path
from datetime import datetime

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.scenarios.real_benchmarks import (
    RealBenchmarkSuite,
    RealSwarmBenchmark,
    RealHiveMindBenchmark, 
    RealSparcBenchmark
)


def run_comprehensive_benchmark(output_dir: str = "./comprehensive_benchmark_results"):
    """Run comprehensive real benchmark suite."""
    print("🚀 Starting Comprehensive Real Benchmark Suite")
    print("=" * 60)
    
    start_time = time.time()
    
    # Initialize suite
    suite = RealBenchmarkSuite(output_dir=output_dir)
    
    try:
        # Run comprehensive benchmarks
        results = suite.run_comprehensive_benchmark()
        
        total_time = time.time() - start_time
        
        # Analysis
        total_benchmarks = sum(len(category_results) for category_results in results.values())
        successful_benchmarks = sum(
            sum(1 for r in category_results if r.success) 
            for category_results in results.values()
        )
        
        print(f"\n🎉 Comprehensive Benchmark Complete!")
        print(f"   Total Time: {total_time:.2f}s")
        print(f"   Total Benchmarks: {total_benchmarks}")
        print(f"   Successful: {successful_benchmarks}")
        print(f"   Success Rate: {successful_benchmarks/total_benchmarks*100:.1f}%")
        print(f"   Results Directory: {output_dir}")
        
        # Category breakdown
        print(f"\n📊 Category Breakdown:")
        for category, category_results in results.items():
            success_count = sum(1 for r in category_results if r.success)
            print(f"   {category:20} | {success_count:2}/{len(category_results)} | {success_count/len(category_results)*100:5.1f}%")
        
        return results
        
    except Exception as e:
        print(f"❌ Comprehensive benchmark failed: {e}")
        return None


def run_swarm_benchmarks(output_dir: str = "./swarm_benchmark_results"):
    """Run focused swarm benchmarks."""
    print("🔬 Starting Swarm Benchmark Focus")
    print("=" * 50)
    
    benchmark = RealSwarmBenchmark()
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    scenarios = [
        ("Create REST API for blog management", "development"),
        ("Analyze microservices performance", "analysis"),
        ("Research GraphQL best practices", "research"),
        ("Optimize database connection pooling", "optimization"),
        ("Test API rate limiting functionality", "testing"),
        ("Maintain legacy system compatibility", "maintenance")
    ]
    
    results = []
    
    for i, (task, strategy) in enumerate(scenarios, 1):
        print(f"\n🎯 Swarm Test {i}/{len(scenarios)}: {strategy}")
        
        if strategy == "development":
            result = benchmark.benchmark_development_swarm(task)
        elif strategy == "research":
            result = benchmark.benchmark_research_swarm(task.replace("Research ", ""))
        elif strategy == "optimization":
            result = benchmark.benchmark_optimization_swarm(task.replace("Optimize ", ""))
        else:
            result = benchmark.benchmark_swarm_task(task)
            
        results.append(result)
        
        print(f"   Success: {result.success} | Time: {result.execution_time:.2f}s | Tokens: {result.tokens_used}")
    
    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = output_path / f"swarm_benchmarks_{timestamp}.json"
    
    with open(results_file, 'w') as f:
        json.dump([r.to_dict() for r in results], f, indent=2)
    
    success_rate = sum(1 for r in results if r.success) / len(results) * 100
    total_time = sum(r.execution_time for r in results)
    
    print(f"\n📊 Swarm Benchmark Summary:")
    print(f"   Total Tests: {len(results)}")
    print(f"   Success Rate: {success_rate:.1f}%")
    print(f"   Total Time: {total_time:.2f}s")
    print(f"   Results: {results_file}")
    
    return results


def run_hive_mind_benchmarks(output_dir: str = "./hive_mind_benchmark_results"):
    """Run focused hive-mind benchmarks."""
    print("🧠 Starting Hive-Mind Benchmark Focus")
    print("=" * 50)
    
    benchmark = RealHiveMindBenchmark()
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    scenarios = [
        ("Design distributed cache architecture", "consensus", 6),
        ("Solve traveling salesman optimization", "collective-intelligence", 10),
        ("Collaborative code architecture review", "memory-shared", 8),
        ("Brainstorm AI application ideas", "consensus", 12),
        ("Research blockchain scalability solutions", "collective-intelligence", 8)
    ]
    
    results = []
    
    for i, (task, mode, agents) in enumerate(scenarios, 1):
        print(f"\n🎯 Hive-Mind Test {i}/{len(scenarios)}: {mode}")
        
        if mode == "collective-intelligence":
            result = benchmark.benchmark_collective_intelligence(task)
        elif mode == "memory-shared":
            result = benchmark.benchmark_swarm_memory(task)
        else:
            result = benchmark.benchmark_hive_mind(task)
            
        results.append(result)
        
        print(f"   Success: {result.success} | Time: {result.execution_time:.2f}s | Agents: {result.agents_spawned}")
    
    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = output_path / f"hive_mind_benchmarks_{timestamp}.json"
    
    with open(results_file, 'w') as f:
        json.dump([r.to_dict() for r in results], f, indent=2)
    
    success_rate = sum(1 for r in results if r.success) / len(results) * 100
    total_time = sum(r.execution_time for r in results)
    avg_agents = sum(r.agents_spawned for r in results) / len(results)
    
    print(f"\n📊 Hive-Mind Benchmark Summary:")
    print(f"   Total Tests: {len(results)}")
    print(f"   Success Rate: {success_rate:.1f}%")
    print(f"   Total Time: {total_time:.2f}s") 
    print(f"   Average Agents: {avg_agents:.1f}")
    print(f"   Results: {results_file}")
    
    return results


def run_sparc_benchmarks(output_dir: str = "./sparc_benchmark_results"):
    """Run focused SPARC benchmarks."""
    print("⚡ Starting SPARC Benchmark Focus")
    print("=" * 50)
    
    benchmark = RealSparcBenchmark()
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    scenarios = [
        ("coder", "Implement OAuth2 authentication flow"),
        ("tdd", "Create e-commerce shopping cart with tests"),
        ("architect", "Design event-driven microservices"),
        ("optimizer", "Improve React application performance"),
        ("researcher", "Analyze modern frontend frameworks"),
        ("reviewer", "Review Python FastAPI implementation"),
        ("analyzer", "Identify API security vulnerabilities"),
        ("documenter", "Create comprehensive API docs")
    ]
    
    results = []
    
    for i, (mode, task) in enumerate(scenarios, 1):
        print(f"\n🎯 SPARC Test {i}/{len(scenarios)}: {mode}")
        
        if mode == "coder":
            result = benchmark.benchmark_coder_mode(task)
        elif mode == "tdd":
            result = benchmark.benchmark_tdd_mode(task)
        elif mode == "architect":
            result = benchmark.benchmark_architect_mode(task)
        elif mode == "optimizer":
            result = benchmark.benchmark_optimizer_mode(task)
        else:
            result = benchmark.benchmark_sparc_modes(mode, task)
            
        results.append(result)
        
        print(f"   Success: {result.success} | Time: {result.execution_time:.2f}s | Output: {result.output_size_bytes}B")
    
    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = output_path / f"sparc_benchmarks_{timestamp}.json"
    
    with open(results_file, 'w') as f:
        json.dump([r.to_dict() for r in results], f, indent=2)
    
    success_rate = sum(1 for r in results if r.success) / len(results) * 100
    total_time = sum(r.execution_time for r in results)
    
    # Mode performance analysis
    mode_stats = {}
    for result in results:
        mode = result.benchmark_name.replace("sparc_", "")
        if mode not in mode_stats:
            mode_stats[mode] = {"time": 0, "tokens": 0, "success": 0, "count": 0}
        mode_stats[mode]["time"] += result.execution_time
        mode_stats[mode]["tokens"] += result.tokens_used
        mode_stats[mode]["count"] += 1
        if result.success:
            mode_stats[mode]["success"] += 1
    
    print(f"\n📊 SPARC Benchmark Summary:")
    print(f"   Total Tests: {len(results)}")
    print(f"   Success Rate: {success_rate:.1f}%")
    print(f"   Total Time: {total_time:.2f}s")
    print(f"   Results: {results_file}")
    
    print(f"\n🎯 Mode Performance:")
    for mode, stats in mode_stats.items():
        avg_time = stats["time"] / stats["count"]
        avg_tokens = stats["tokens"] / stats["count"]
        success_rate = stats["success"] / stats["count"] * 100
        print(f"   {mode:12} | {avg_time:6.2f}s | {avg_tokens:6.0f} tokens | {success_rate:5.1f}%")
    
    return results


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="Run Real Benchmarks")
    parser.add_argument("--mode", default="comprehensive",
                       choices=["comprehensive", "swarm", "hive-mind", "sparc"],
                       help="Benchmark mode to run")
    parser.add_argument("--output-dir", default="./real_benchmark_results",
                       help="Output directory for results")
    parser.add_argument("--timeout", type=int, default=30,
                       help="Timeout per benchmark in minutes")
    
    args = parser.parse_args()
    
    print(f"🚀 Real Benchmark Execution Started")
    print(f"   Mode: {args.mode}")
    print(f"   Output: {args.output_dir}")
    print(f"   Timeout: {args.timeout}m")
    print("=" * 60)
    
    start_time = time.time()
    
    try:
        if args.mode == "comprehensive":
            results = run_comprehensive_benchmark(args.output_dir)
        elif args.mode == "swarm":
            results = run_swarm_benchmarks(args.output_dir)
        elif args.mode == "hive-mind":
            results = run_hive_mind_benchmarks(args.output_dir)
        elif args.mode == "sparc":
            results = run_sparc_benchmarks(args.output_dir)
        
        total_time = time.time() - start_time
        
        if results:
            print(f"\n🎉 Real Benchmark Execution Complete!")
            print(f"   Total Time: {total_time:.2f}s")
            print(f"   Results Directory: {args.output_dir}")
            sys.exit(0)
        else:
            print(f"\n💥 Benchmark execution failed!")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print(f"\n⚠️  Benchmark execution interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Benchmark execution failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()