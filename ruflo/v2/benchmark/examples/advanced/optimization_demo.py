#!/usr/bin/env python3
"""
Optimization Engine Demo

This script demonstrates the real optimization capabilities that have been
implemented to fix the "Optimizations not available" warning.

Features demonstrated:
- Connection pooling
- TTL-based caching
- Circular buffer logging
- Async I/O operations
- Parallel task execution
"""

import asyncio
import sys
import os
from pathlib import Path

# Add the src directory to Python path
sys.path.insert(0, str(Path(__file__).parent.parent / 'src'))

from swarm_benchmark.optimization import OptimizedBenchmarkEngine
from swarm_benchmark.core.benchmark_engine import BenchmarkEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode


async def demo_optimization_features():
    """Demonstrate the optimization features."""
    print("🚀 Optimization Engine Demo")
    print("=" * 50)
    
    # Create configuration
    config = BenchmarkConfig(
        name="optimization_demo",
        description="Demonstration of optimization features",
        strategy=StrategyType.DEVELOPMENT,
        mode=CoordinationMode.MESH,
        max_agents=5,
        task_timeout=30
    )
    
    # Create base engine for comparison
    base_engine = BenchmarkEngine(config)
    
    # Create optimized engine
    optimized_engine = OptimizedBenchmarkEngine(base_engine, {
        'min_connections': 3,
        'max_connections': 8,
        'max_concurrency': 6,
        'cache_ttl': 3600000,  # 1 hour
        'cache_size': 1000,
        'history_size': 500
    })
    
    print("✅ Optimization engine initialized")
    print("Features enabled:")
    print("  - Connection pooling (3-8 connections)")
    print("  - TTL-based result caching (1 hour)")
    print("  - Circular buffer logging (500 items)")
    print("  - Async I/O operations")
    print("  - Parallel execution (6 concurrent tasks)")
    
    # Enable optimizations
    optimized_engine.enable_optimizations()
    
    print("\n🏃 Running benchmark tests...")
    
    # Test 1: Single objective
    print("1. Single objective benchmark:")
    result1 = await optimized_engine.run_optimized_benchmark(
        "Develop a REST API with authentication"
    )
    print(f"   Duration: {result1['execution_time']:.3f}s")
    print(f"   Optimized: {result1['optimized']}")
    
    # Test 2: Same objective (should hit cache)
    print("\n2. Same objective (cache test):")
    result2 = await optimized_engine.run_optimized_benchmark(
        "Develop a REST API with authentication"
    )
    print(f"   Duration: {result2['execution_time']:.3f}s")
    print(f"   Cache hit: {result2.get('cache_hit', False)}")
    
    # Test 3: Batch processing
    print("\n3. Batch processing test:")
    objectives = [
        "Implement user authentication system",
        "Create database schema and migrations", 
        "Build API endpoints for CRUD operations",
        "Add input validation and error handling",
        "Implement logging and monitoring"
    ]
    
    batch_results = await optimized_engine.batch_process(objectives, batch_size=3)
    print(f"   Processed {len(batch_results)} objectives")
    
    successful = sum(1 for r in batch_results if r.get('optimized', False))
    print(f"   Successful optimized executions: {successful}")
    
    # Test 4: Performance metrics
    print("\n4. Performance metrics:")
    metrics = optimized_engine.get_optimization_metrics()
    
    print(f"   Optimized executions: {metrics['optimized_executions']}")
    print(f"   Cache hits: {metrics['cache_hits']}")
    print(f"   Parallel tasks: {metrics['parallel_tasks']}")
    
    if 'executor_metrics' in metrics:
        exec_metrics = metrics['executor_metrics']
        print(f"   Total tasks executed: {exec_metrics['tasks_executed']}")
        print(f"   Average execution time: {exec_metrics['average_execution_time']:.3f}s")
    
    if 'cache_stats' in metrics:
        cache_stats = metrics['cache_stats']
        print(f"   Cache hit rate: {cache_stats['hit_rate']:.2%}")
        print(f"   Cache size: {cache_stats['size']}/{cache_stats['max_size']}")
    
    # Cleanup
    await optimized_engine.shutdown()
    
    print("\n✅ Demo completed successfully!")
    print("The optimization engine provides real performance improvements:")
    print("  • Parallel execution reduces overall processing time")
    print("  • Caching eliminates redundant work")
    print("  • Connection pooling manages resources efficiently")
    print("  • Async I/O prevents blocking operations")
    print("  • Circular buffers provide memory-efficient logging")


if __name__ == "__main__":
    asyncio.run(demo_optimization_features())