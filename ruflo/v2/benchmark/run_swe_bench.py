#!/usr/bin/env python3
"""
SWE-Bench Runner - Software Engineering Benchmark for Claude Flow

This script runs comprehensive benchmarks to evaluate Claude Flow's 
software engineering capabilities across multiple domains.
"""

import asyncio
import sys
import argparse
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.swe_bench import SWEBenchEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode


async def main():
    parser = argparse.ArgumentParser(description="SWE-Bench Runner for Claude Flow")
    parser.add_argument(
        "--categories", 
        nargs="+",
        choices=["code_generation", "bug_fix", "refactoring", "testing", 
                 "documentation", "code_review", "performance"],
        help="Categories to benchmark"
    )
    parser.add_argument(
        "--difficulty",
        choices=["easy", "medium", "hard"],
        help="Filter by difficulty level"
    )
    parser.add_argument(
        "--optimize",
        action="store_true",
        help="Enable optimization iterations"
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=1,
        help="Number of iterations (default: 1)"
    )
    parser.add_argument(
        "--strategy",
        choices=["development", "optimization", "testing", "analysis"],
        default="development",
        help="Execution strategy"
    )
    parser.add_argument(
        "--mode",
        choices=["hierarchical", "mesh", "distributed", "centralized"],
        default="hierarchical",
        help="Coordination mode"
    )
    parser.add_argument(
        "--agents",
        type=int,
        default=5,
        help="Maximum number of agents"
    )
    parser.add_argument(
        "--output",
        type=str,
        default="benchmark/swe-bench/reports",
        help="Output directory for reports"
    )
    
    args = parser.parse_args()
    
    # Create configuration
    config = BenchmarkConfig(
        name="SWE-Bench",
        description="Software Engineering Benchmark",
        strategy=StrategyType[args.strategy.upper()],
        mode=CoordinationMode[args.mode.upper()],
        max_agents=args.agents,
        output_directory=args.output
    )
    
    # Initialize engine
    engine = SWEBenchEngine(config)
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                    SWE-Bench for Claude Flow                  ║
║                Software Engineering Benchmark Suite           ║
╚══════════════════════════════════════════════════════════════╝

Configuration:
  Strategy: {args.strategy}
  Mode: {args.mode}
  Agents: {args.agents}
  Iterations: {args.iterations}
  Optimize: {args.optimize}
  Categories: {args.categories or 'All'}
  Difficulty: {args.difficulty or 'All'}
""")
    
    # Run benchmark
    results = await engine.run_swe_benchmark(
        categories=args.categories,
        difficulty=args.difficulty,
        optimize=args.optimize,
        iterations=args.iterations
    )
    
    # Display results
    summary = results.get('summary', {})
    final_perf = summary.get('final_performance', {})
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║                        BENCHMARK RESULTS                      ║
╚══════════════════════════════════════════════════════════════╝

📊 Final Performance:
  Success Rate: {final_perf.get('success_rate', 0):.1%}
  Tasks Completed: {final_perf.get('successful_tasks', 0)}/{final_perf.get('total_tasks', 0)}
  Average Duration: {final_perf.get('average_duration', 0):.2f}s
""")
    
    if args.optimize and summary.get('improvement'):
        imp = summary['improvement']
        print(f"""
📈 Optimization Impact:
  Success Rate Change: {imp.get('success_rate_change', 0):+.1%}
  Duration Change: {imp.get('duration_change', 0):+.2f}s
  Optimization Effective: {'✅ Yes' if imp.get('optimization_effective') else '❌ No'}
""")
    
    print(f"\n✅ Full report saved to: {config.output_directory}")
    print("\n" + "="*60)


if __name__ == "__main__":
    asyncio.run(main())