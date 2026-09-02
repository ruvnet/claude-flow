#!/usr/bin/env python3
"""Compare benchmark performance with and without optimizations."""

import asyncio
import json
import time
from datetime import datetime
from pathlib import Path
import sys

# Add parent directory to path for imports
sys.path.append(str(Path(__file__).parent.parent))

from benchmark.src.swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode
from benchmark.src.swarm_benchmark.core.benchmark_engine import BenchmarkEngine
from benchmark.src.swarm_benchmark.core.optimized_benchmark_engine import OptimizedBenchmarkEngine


async def run_comparison(objective: str, strategy: StrategyType, mode: CoordinationMode):
    """Run benchmarks with and without optimizations for comparison."""
    
    print(f"\n{'='*60}")
    print(f"Comparing: {strategy.value} strategy with {mode.value} coordination")
    print(f"Objective: {objective}")
    print(f"{'='*60}\n")
    
    # Configuration for both engines
    config = BenchmarkConfig(
        name=f"comparison-{strategy.value}-{mode.value}",
        description="Performance comparison benchmark",
        strategy=strategy,
        mode=mode,
        max_agents=5,
        task_timeout=30,
        max_retries=2
    )
    
    # Run without optimizations
    print("Running standard benchmark...")
    standard_engine = BenchmarkEngine(config)
    start_time = time.time()
    standard_result = await standard_engine.run_benchmark(objective)
    standard_time = time.time() - start_time
    
    # Run with optimizations
    print("Running optimized benchmark...")
    optimized_engine = OptimizedBenchmarkEngine(config, enable_optimizations=True)
    start_time = time.time()
    optimized_result = await optimized_engine.run_benchmark(objective)
    optimized_time = time.time() - start_time
    
    # Clean shutdown
    await optimized_engine.shutdown()
    
    # Calculate improvement
    improvement = ((standard_time - optimized_time) / standard_time) * 100 if standard_time > 0 else 0
    
    # Display results
    print(f"\n{'='*60}")
    print(f"Results for {strategy.value} / {mode.value}:")
    print(f"{'='*60}")
    print(f"Standard execution time: {standard_time:.2f}s")
    print(f"Optimized execution time: {optimized_time:.2f}s")
    print(f"Improvement: {improvement:.1f}%")
    print(f"Speed multiplier: {standard_time/optimized_time:.2f}x")
    
    # Show performance metrics if available
    if 'performance_metrics' in optimized_result:
        print(f"\nOptimization Metrics:")
        metrics = optimized_result['performance_metrics']
        if 'executor' in metrics:
            print(f"  - Cache hit rate: {metrics['executor'].get('cacheHitRate', 0):.2%}")
            print(f"  - Active executions: {metrics['executor'].get('activeExecutions', 0)}")
        if 'cache' in metrics:
            print(f"  - Cache size: {metrics['cache'].get('size', 0)}")
            print(f"  - Cache hits: {metrics['cache'].get('hits', 0)}")
    
    return {
        'strategy': strategy.value,
        'mode': mode.value,
        'standard_time': standard_time,
        'optimized_time': optimized_time,
        'improvement': improvement,
        'speed_multiplier': standard_time/optimized_time if optimized_time > 0 else 1
    }


async def main():
    """Run comprehensive comparison across different configurations."""
    
    print("Swarm Optimization Performance Comparison")
    print("========================================\n")
    
    # Test configurations
    test_cases = [
        ("Analyze market trends for AI startups", StrategyType.RESEARCH, CoordinationMode.DISTRIBUTED),
        ("Build a REST API for user management", StrategyType.DEVELOPMENT, CoordinationMode.HIERARCHICAL),
        ("Analyze performance bottlenecks in the system", StrategyType.ANALYSIS, CoordinationMode.MESH),
        ("Create test suite for authentication module", StrategyType.TESTING, CoordinationMode.DISTRIBUTED),
        ("Optimize database query performance", StrategyType.OPTIMIZATION, CoordinationMode.HYBRID),
    ]
    
    results = []
    
    for objective, strategy, mode in test_cases:
        try:
            result = await run_comparison(objective, strategy, mode)
            results.append(result)
            
            # Small delay between tests
            await asyncio.sleep(1)
            
        except Exception as e:
            print(f"Error in benchmark: {e}")
            continue
    
    # Summary report
    print(f"\n\n{'='*60}")
    print("SUMMARY REPORT")
    print(f"{'='*60}")
    print(f"{'Strategy':<15} {'Mode':<15} {'Standard':<10} {'Optimized':<10} {'Improvement':<12} {'Speedup':<8}")
    print(f"{'-'*80}")
    
    total_standard = 0
    total_optimized = 0
    
    for result in results:
        print(f"{result['strategy']:<15} {result['mode']:<15} "
              f"{result['standard_time']:<10.2f} {result['optimized_time']:<10.2f} "
              f"{result['improvement']:<12.1f}% {result['speed_multiplier']:<8.2f}x")
        total_standard += result['standard_time']
        total_optimized += result['optimized_time']
    
    print(f"{'-'*80}")
    
    # Overall statistics
    if results:
        avg_improvement = sum(r['improvement'] for r in results) / len(results)
        avg_speedup = sum(r['speed_multiplier'] for r in results) / len(results)
        overall_speedup = total_standard / total_optimized if total_optimized > 0 else 1
        
        print(f"\nOverall Statistics:")
        print(f"  - Average improvement: {avg_improvement:.1f}%")
        print(f"  - Average speedup: {avg_speedup:.2f}x")
        print(f"  - Total time saved: {total_standard - total_optimized:.2f}s")
        print(f"  - Overall speedup: {overall_speedup:.2f}x")
    
    # Save detailed results
    output_dir = Path("benchmark/optimization_results")
    output_dir.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_file = output_dir / f"optimization_comparison_{timestamp}.json"
    
    with open(output_file, 'w') as f:
        json.dump({
            'timestamp': timestamp,
            'results': results,
            'summary': {
                'average_improvement': avg_improvement,
                'average_speedup': avg_speedup,
                'total_standard_time': total_standard,
                'total_optimized_time': total_optimized,
                'overall_speedup': overall_speedup
            }
        }, f, indent=2)
    
    print(f"\nDetailed results saved to: {output_file}")


if __name__ == "__main__":
    asyncio.run(main())