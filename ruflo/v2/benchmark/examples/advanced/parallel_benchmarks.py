#!/usr/bin/env python3
"""
Advanced parallel benchmarks with concurrent execution strategies.

This example demonstrates:
- Parallel benchmark execution
- Multi-strategy comparison
- Resource utilization optimization
- Performance scaling analysis
"""

import asyncio
import concurrent.futures
import subprocess
import sys
import json
import time
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

@dataclass
class BenchmarkConfig:
    """Configuration for a benchmark run."""
    name: str
    strategy: str
    agents: int
    coordination_mode: str
    task: str
    expected_duration: float = 60.0

@dataclass
class BenchmarkResult:
    """Result from a benchmark execution."""
    config: BenchmarkConfig
    execution_time: float
    success: bool
    metrics: Dict[str, Any]
    error: Optional[str] = None

class ParallelBenchmarkRunner:
    """Execute multiple benchmarks in parallel."""
    
    def __init__(self, max_workers: int = 4):
        self.max_workers = max_workers
        self.results: List[BenchmarkResult] = []
    
    def create_benchmark_configs(self) -> List[BenchmarkConfig]:
        """Create various benchmark configurations for parallel execution."""
        configs = [
            BenchmarkConfig(
                name="swarm-development",
                strategy="development",
                agents=5,
                coordination_mode="hierarchical",
                task="Create a REST API with authentication"
            ),
            BenchmarkConfig(
                name="swarm-optimization", 
                strategy="optimization",
                agents=6,
                coordination_mode="mesh",
                task="Optimize database query performance"
            ),
            BenchmarkConfig(
                name="swarm-research",
                strategy="research",
                agents=4,
                coordination_mode="distributed",
                task="Research machine learning best practices"
            ),
            BenchmarkConfig(
                name="hive-mind-analysis",
                strategy="analysis",
                agents=7,
                coordination_mode="collective",
                task="Analyze code patterns and suggest improvements"
            ),
            BenchmarkConfig(
                name="sparc-tdd",
                strategy="tdd",
                agents=3,
                coordination_mode="hierarchical", 
                task="Implement user management system with TDD"
            )
        ]
        return configs
    
    def execute_single_benchmark(self, config: BenchmarkConfig) -> BenchmarkResult:
        """Execute a single benchmark configuration."""
        print(f"🚀 Starting benchmark: {config.name}")
        start_time = time.time()
        
        try:
            # Build command based on strategy
            if "hive-mind" in config.name:
                cmd = [
                    "swarm-benchmark", "real", "hive-mind",
                    config.task,
                    "--agents", str(config.agents),
                    "--coordination", config.coordination_mode
                ]
            elif "sparc" in config.name:
                cmd = [
                    "swarm-benchmark", "real", "sparc",
                    config.task,
                    "--mode", config.strategy,
                    "--agents", str(config.agents)
                ]
            else:
                cmd = [
                    "swarm-benchmark", "real", "swarm",
                    config.task,
                    "--strategy", config.strategy,
                    "--max-agents", str(config.agents),
                    "--coordination", config.coordination_mode
                ]
            
            # Execute benchmark
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120,  # 2 minute timeout
                cwd="/workspaces/claude-code-flow/benchmark"
            )
            
            execution_time = time.time() - start_time
            
            if result.returncode == 0:
                # Parse metrics from output
                metrics = self._parse_benchmark_output(result.stdout)
                return BenchmarkResult(
                    config=config,
                    execution_time=execution_time,
                    success=True,
                    metrics=metrics
                )
            else:
                return BenchmarkResult(
                    config=config,
                    execution_time=execution_time,
                    success=False,
                    metrics={},
                    error=result.stderr
                )
                
        except subprocess.TimeoutExpired:
            execution_time = time.time() - start_time
            return BenchmarkResult(
                config=config,
                execution_time=execution_time,
                success=False,
                metrics={},
                error="Benchmark timeout"
            )
        except Exception as e:
            execution_time = time.time() - start_time
            return BenchmarkResult(
                config=config,
                execution_time=execution_time,
                success=False,
                metrics={},
                error=str(e)
            )
    
    def _parse_benchmark_output(self, output: str) -> Dict[str, Any]:
        """Parse benchmark output to extract metrics."""
        # Try to find JSON in output
        try:
            lines = output.strip().split('\n')
            for line in lines:
                if line.strip().startswith('{'):
                    return json.loads(line.strip())
        except:
            pass
        
        # Return basic metrics if JSON parsing fails
        return {
            "tokens_estimated": len(output.split()) * 1.3,  # Rough estimate
            "output_length": len(output),
            "success_indicators": output.count("✅"),
            "error_indicators": output.count("❌")
        }
    
    def run_parallel_benchmarks(self) -> List[BenchmarkResult]:
        """Execute all benchmarks in parallel."""
        configs = self.create_benchmark_configs()
        
        print(f"🔀 Starting {len(configs)} parallel benchmarks")
        print(f"👥 Max workers: {self.max_workers}")
        print("=" * 60)
        
        with concurrent.futures.ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            # Submit all benchmarks
            future_to_config = {
                executor.submit(self.execute_single_benchmark, config): config
                for config in configs
            }
            
            # Collect results as they complete
            results = []
            for future in concurrent.futures.as_completed(future_to_config):
                config = future_to_config[future]
                try:
                    result = future.result()
                    results.append(result)
                    
                    status = "✅" if result.success else "❌"
                    print(f"{status} {config.name}: {result.execution_time:.1f}s")
                    
                except Exception as e:
                    error_result = BenchmarkResult(
                        config=config,
                        execution_time=0,
                        success=False,
                        metrics={},
                        error=str(e)
                    )
                    results.append(error_result)
                    print(f"❌ {config.name}: Exception - {e}")
        
        self.results = results
        return results
    
    def analyze_parallel_performance(self) -> Dict[str, Any]:
        """Analyze performance across parallel benchmarks."""
        if not self.results:
            return {}
        
        successful_results = [r for r in self.results if r.success]
        failed_results = [r for r in self.results if not r.success]
        
        analysis = {
            "total_benchmarks": len(self.results),
            "successful_benchmarks": len(successful_results),
            "failed_benchmarks": len(failed_results),
            "success_rate": len(successful_results) / len(self.results) if self.results else 0,
            "average_execution_time": sum(r.execution_time for r in successful_results) / len(successful_results) if successful_results else 0,
            "fastest_benchmark": min(successful_results, key=lambda x: x.execution_time).config.name if successful_results else None,
            "slowest_benchmark": max(successful_results, key=lambda x: x.execution_time).config.name if successful_results else None,
            "strategy_performance": {},
            "coordination_performance": {}
        }
        
        # Analyze by strategy
        strategy_groups = {}
        for result in successful_results:
            strategy = result.config.strategy
            if strategy not in strategy_groups:
                strategy_groups[strategy] = []
            strategy_groups[strategy].append(result.execution_time)
        
        for strategy, times in strategy_groups.items():
            analysis["strategy_performance"][strategy] = {
                "average_time": sum(times) / len(times),
                "benchmark_count": len(times)
            }
        
        # Analyze by coordination mode
        coordination_groups = {}
        for result in successful_results:
            mode = result.config.coordination_mode
            if mode not in coordination_groups:
                coordination_groups[mode] = []
            coordination_groups[mode].append(result.execution_time)
        
        for mode, times in coordination_groups.items():
            analysis["coordination_performance"][mode] = {
                "average_time": sum(times) / len(times),
                "benchmark_count": len(times)
            }
        
        return analysis

def demonstrate_async_benchmarks():
    """Demonstrate async benchmark execution."""
    print("\n🔄 Async Benchmark Demonstration")
    print("=" * 35)
    
    async def async_benchmark_task(name: str, duration: float):
        """Simulate an async benchmark task."""
        print(f"  🔄 Starting async task: {name}")
        await asyncio.sleep(duration)  # Simulate work
        print(f"  ✅ Completed async task: {name}")
        return {
            "name": name,
            "duration": duration,
            "timestamp": time.time()
        }
    
    async def run_async_benchmarks():
        """Run multiple async benchmarks concurrently."""
        tasks = [
            async_benchmark_task("Fast API Creation", 2.0),
            async_benchmark_task("Database Optimization", 3.5),
            async_benchmark_task("Code Analysis", 1.8),
            async_benchmark_task("Test Generation", 2.7)
        ]
        
        start_time = time.time()
        results = await asyncio.gather(*tasks)
        total_time = time.time() - start_time
        
        print(f"\n📊 Async Results:")
        print(f"  ⏱️  Total execution time: {total_time:.1f}s")
        print(f"  🎯 Sequential time would be: {sum(r['duration'] for r in results):.1f}s")
        print(f"  ⚡ Speedup: {sum(r['duration'] for r in results) / total_time:.1f}x")
        
        return results
    
    # Run async demonstration
    try:
        results = asyncio.run(run_async_benchmarks())
    except Exception as e:
        print(f"❌ Async demonstration error: {e}")

def save_parallel_results(results: List[BenchmarkResult], analysis: Dict[str, Any]):
    """Save parallel benchmark results and analysis."""
    output_dir = Path("/workspaces/claude-code-flow/benchmark/examples/output")
    output_dir.mkdir(exist_ok=True)
    
    # Convert results to serializable format
    serializable_results = []
    for result in results:
        serializable_results.append({
            "config": {
                "name": result.config.name,
                "strategy": result.config.strategy,
                "agents": result.config.agents,
                "coordination_mode": result.config.coordination_mode,
                "task": result.config.task
            },
            "execution_time": result.execution_time,
            "success": result.success,
            "metrics": result.metrics,
            "error": result.error
        })
    
    # Save detailed results
    with open(output_dir / "parallel_benchmark_results.json", "w") as f:
        json.dump(serializable_results, f, indent=2)
    
    # Save analysis
    with open(output_dir / "parallel_benchmark_analysis.json", "w") as f:
        json.dump(analysis, f, indent=2)
    
    print(f"📁 Results saved to: {output_dir}")

if __name__ == "__main__":
    print("🔀 Advanced Parallel Benchmarks")
    print("=" * 50)
    
    # Run parallel benchmarks
    runner = ParallelBenchmarkRunner(max_workers=3)  # Conservative for demo
    results = runner.run_parallel_benchmarks()
    
    # Analyze results
    analysis = runner.analyze_parallel_performance()
    
    print(f"\n📊 Parallel Execution Analysis")
    print("=" * 35)
    print(f"Total benchmarks: {analysis['total_benchmarks']}")
    print(f"Success rate: {analysis['success_rate']:.1%}")
    print(f"Average execution time: {analysis['average_execution_time']:.1f}s")
    
    if analysis['fastest_benchmark']:
        print(f"Fastest: {analysis['fastest_benchmark']}")
    if analysis['slowest_benchmark']:
        print(f"Slowest: {analysis['slowest_benchmark']}")
    
    # Strategy performance
    if analysis['strategy_performance']:
        print(f"\n📈 Strategy Performance:")
        for strategy, perf in analysis['strategy_performance'].items():
            print(f"  {strategy}: {perf['average_time']:.1f}s avg")
    
    # Demonstrate async patterns
    demonstrate_async_benchmarks()
    
    # Save results
    save_parallel_results(results, analysis)
    
    print(f"\n🎉 Parallel Benchmarks Complete!")
    print("Results demonstrate:")
    print("- Concurrent execution capabilities")
    print("- Performance scaling characteristics")
    print("- Strategy comparison effectiveness")
    print("- Resource utilization patterns")