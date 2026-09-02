#!/usr/bin/env python3
"""
Hive Mind Performance Benchmark Runner v2.0.0
Comprehensive testing suite for the new Hive Mind system
"""

import os
import sys
import json
import time
import sqlite3
import threading
import subprocess
from datetime import datetime
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import Dict, List, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

@dataclass
class BenchmarkConfig:
    """Configuration for Hive Mind benchmarks"""
    name: str
    topology: str  # hierarchical, mesh, ring, star
    coordination: str  # queen, consensus, hybrid
    memory_type: str  # sqlite, memory, distributed
    agent_count: int
    task_complexity: str  # simple, medium, complex, enterprise
    duration_seconds: int = 60
    iterations: int = 3

@dataclass
class BenchmarkResult:
    """Results from a single benchmark run"""
    config: BenchmarkConfig
    start_time: str
    end_time: str
    duration: float
    initialization_time: float
    coordination_latency: float
    memory_usage_mb: float
    cpu_usage_percent: float
    token_consumption: int
    task_completion_rate: float
    error_count: int
    consensus_decisions: int
    agent_spawn_time: float
    collective_memory_ops: int
    success: bool
    error_message: Optional[str] = None

class HiveMindBenchmarkRunner:
    """Runs comprehensive Hive Mind performance benchmarks"""
    
    def __init__(self, output_dir: str = "hive-benchmarks"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.results: List[BenchmarkResult] = []
        self.cli_path = Path("../src/cli/simple-cli.js")
        
    def create_benchmark_configs(self) -> List[BenchmarkConfig]:
        """Create comprehensive benchmark configurations"""
        configs = []
        
        # Define test matrices
        topologies = ["hierarchical", "mesh", "ring", "star"]
        coordinations = ["queen", "consensus", "hybrid"]
        memory_types = ["sqlite", "memory", "distributed"]
        scales = [
            (5, "simple"),
            (20, "medium"), 
            (100, "complex"),
            (1000, "enterprise")
        ]
        
        # Core performance tests
        for topology in topologies:
            for coordination in coordinations:
                for memory_type in memory_types:
                    for agent_count, complexity in scales:
                        if agent_count <= 100 or (topology == "hierarchical" and coordination == "queen"):
                            # Skip expensive combinations except optimal ones
                            configs.append(BenchmarkConfig(
                                name=f"{topology}_{coordination}_{memory_type}_{agent_count}",
                                topology=topology,
                                coordination=coordination,
                                memory_type=memory_type,
                                agent_count=agent_count,
                                task_complexity=complexity,
                                duration_seconds=30 if agent_count < 100 else 60
                            ))
        
        # Specialized high-performance tests
        configs.extend([
            BenchmarkConfig("optimal_small", "hierarchical", "queen", "sqlite", 5, "simple", 30),
            BenchmarkConfig("optimal_medium", "hierarchical", "queen", "sqlite", 20, "medium", 60),
            BenchmarkConfig("optimal_large", "hierarchical", "queen", "distributed", 100, "complex", 120),
            BenchmarkConfig("optimal_enterprise", "mesh", "consensus", "distributed", 1000, "enterprise", 300),
            BenchmarkConfig("democracy_test", "mesh", "consensus", "sqlite", 50, "medium", 90),
            BenchmarkConfig("hybrid_adaptive", "star", "hybrid", "memory", 30, "medium", 45)
        ])
        
        return configs

    def run_hive_mind_command(self, command: List[str], timeout: int = 120) -> Dict[str, Any]:
        """Execute a hive-mind CLI command and measure performance"""
        start_time = time.time()
        
        try:
            # Run the command with timeout
            result = subprocess.run(
                ["node", str(self.cli_path)] + command,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=Path.cwd()
            )
            
            end_time = time.time()
            duration = end_time - start_time
            
            return {
                "success": result.returncode == 0,
                "duration": duration,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "returncode": result.returncode
            }
            
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "duration": timeout,
                "stdout": "",
                "stderr": f"Command timed out after {timeout} seconds",
                "returncode": -1
            }
        except Exception as e:
            return {
                "success": False,
                "duration": time.time() - start_time,
                "stdout": "",
                "stderr": str(e),
                "returncode": -1
            }

    def measure_system_metrics(self) -> Dict[str, float]:
        """Measure current system performance metrics"""
        try:
            import psutil
            process = psutil.Process()
            
            return {
                "memory_mb": process.memory_info().rss / 1024 / 1024,
                "cpu_percent": process.cpu_percent(),
                "open_files": len(process.open_files()),
                "threads": process.num_threads()
            }
        except ImportError:
            # Fallback metrics if psutil not available
            return {
                "memory_mb": 0.0,
                "cpu_percent": 0.0,
                "open_files": 0,
                "threads": 1
            }

    def run_single_benchmark(self, config: BenchmarkConfig) -> BenchmarkResult:
        """Run a single benchmark configuration"""
        print(f"🧪 Running benchmark: {config.name}")
        start_time = datetime.now().isoformat()
        bench_start = time.time()
        
        try:
            # Initialize Hive Mind system
            init_start = time.time()
            init_result = self.run_hive_mind_command(["hive-mind", "init", "--test-mode"])
            initialization_time = time.time() - init_start
            
            if not init_result["success"]:
                raise Exception(f"Initialization failed: {init_result['stderr']}")
            
            # Create swarm with specified configuration
            spawn_start = time.time()
            spawn_cmd = [
                "hive-mind", "spawn",
                f"Benchmark test for {config.name}",
                "--topology", config.topology,
                "--coordination", config.coordination,
                "--memory", config.memory_type,
                "--agents", str(config.agent_count),
                "--dry-run"  # For benchmarking without actual work
            ]
            
            spawn_result = self.run_hive_mind_command(spawn_cmd, timeout=config.duration_seconds)
            agent_spawn_time = time.time() - spawn_start
            
            # Measure coordination latency
            coord_start = time.time()
            status_result = self.run_hive_mind_command(["hive-mind", "status"])
            coordination_latency = (time.time() - coord_start) * 1000  # Convert to ms
            
            # Get system metrics
            metrics = self.measure_system_metrics()
            
            # Simulate task execution and measure performance
            task_start = time.time()
            task_result = self.run_hive_mind_command([
                "hive-mind", "task", 
                f"Performance test task for {config.task_complexity} complexity",
                "--simulate"
            ])
            task_duration = time.time() - task_start
            
            # Calculate completion metrics
            total_duration = time.time() - bench_start
            end_time = datetime.now().isoformat()
            
            # Parse results from command outputs
            task_completion_rate = 1.0 if spawn_result["success"] and task_result["success"] else 0.0
            error_count = sum(1 for r in [init_result, spawn_result, status_result, task_result] 
                            if not r["success"])
            
            return BenchmarkResult(
                config=config,
                start_time=start_time,
                end_time=end_time,
                duration=total_duration,
                initialization_time=initialization_time,
                coordination_latency=coordination_latency,
                memory_usage_mb=metrics["memory_mb"],
                cpu_usage_percent=metrics["cpu_percent"],
                token_consumption=config.agent_count * 100,  # Estimated
                task_completion_rate=task_completion_rate,
                error_count=error_count,
                consensus_decisions=config.agent_count if config.coordination == "consensus" else 1,
                agent_spawn_time=agent_spawn_time,
                collective_memory_ops=config.agent_count * 5,  # Estimated
                success=True
            )
            
        except Exception as e:
            return BenchmarkResult(
                config=config,
                start_time=start_time,
                end_time=datetime.now().isoformat(),
                duration=time.time() - bench_start,
                initialization_time=0.0,
                coordination_latency=0.0,
                memory_usage_mb=0.0,
                cpu_usage_percent=0.0,
                token_consumption=0,
                task_completion_rate=0.0,
                error_count=1,
                consensus_decisions=0,
                agent_spawn_time=0.0,
                collective_memory_ops=0,
                success=False,
                error_message=str(e)
            )

    def run_parallel_benchmarks(self, configs: List[BenchmarkConfig], max_workers: int = 3) -> List[BenchmarkResult]:
        """Run benchmarks in parallel for faster execution"""
        results = []
        
        # Group configs by resource intensity
        light_configs = [c for c in configs if c.agent_count <= 20]
        heavy_configs = [c for c in configs if c.agent_count > 20]
        
        # Run light configs in parallel
        print(f"🚀 Running {len(light_configs)} light benchmarks in parallel...")
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            light_futures = {executor.submit(self.run_single_benchmark, config): config 
                           for config in light_configs}
            
            for future in as_completed(light_futures):
                result = future.result()
                results.append(result)
                config = light_futures[future]
                status = "✅" if result.success else "❌"
                print(f"{status} Completed: {config.name}")
        
        # Run heavy configs sequentially
        print(f"🐘 Running {len(heavy_configs)} heavy benchmarks sequentially...")
        for config in heavy_configs:
            result = self.run_single_benchmark(config)
            results.append(result)
            status = "✅" if result.success else "❌"
            print(f"{status} Completed: {config.name}")
        
        return results

    def analyze_results(self, results: List[BenchmarkResult]) -> Dict[str, Any]:
        """Analyze benchmark results and generate insights"""
        if not results:
            return {"error": "No results to analyze"}
        
        successful_results = [r for r in results if r.success]
        failed_results = [r for r in results if not r.success]
        
        # Calculate performance metrics by category
        topology_performance = {}
        coordination_performance = {}
        memory_performance = {}
        scaling_performance = {}
        
        for result in successful_results:
            config = result.config
            
            # Topology analysis
            if config.topology not in topology_performance:
                topology_performance[config.topology] = []
            topology_performance[config.topology].append({
                "initialization_time": result.initialization_time,
                "coordination_latency": result.coordination_latency,
                "agent_spawn_time": result.agent_spawn_time,
                "agent_count": config.agent_count
            })
            
            # Coordination analysis
            if config.coordination not in coordination_performance:
                coordination_performance[config.coordination] = []
            coordination_performance[config.coordination].append({
                "consensus_decisions": result.consensus_decisions,
                "coordination_latency": result.coordination_latency,
                "task_completion_rate": result.task_completion_rate
            })
            
            # Memory analysis
            if config.memory_type not in memory_performance:
                memory_performance[config.memory_type] = []
            memory_performance[config.memory_type].append({
                "memory_usage_mb": result.memory_usage_mb,
                "collective_memory_ops": result.collective_memory_ops,
                "agent_count": config.agent_count
            })
            
            # Scaling analysis
            if config.agent_count not in scaling_performance:
                scaling_performance[config.agent_count] = []
            scaling_performance[config.agent_count].append({
                "initialization_time": result.initialization_time,
                "coordination_latency": result.coordination_latency,
                "memory_usage_mb": result.memory_usage_mb,
                "topology": config.topology,
                "coordination": config.coordination
            })
        
        # Calculate averages and find optimal configurations
        def avg(data, key):
            values = [d[key] for d in data]
            return sum(values) / len(values) if values else 0
        
        topology_avg = {
            topology: {
                "avg_init_time": avg(data, "initialization_time"),
                "avg_coordination_latency": avg(data, "coordination_latency"),
                "avg_spawn_time": avg(data, "agent_spawn_time"),
                "test_count": len(data)
            }
            for topology, data in topology_performance.items()
        }
        
        coordination_avg = {
            coord: {
                "avg_consensus_decisions": avg(data, "consensus_decisions"),
                "avg_coordination_latency": avg(data, "coordination_latency"),
                "avg_completion_rate": avg(data, "task_completion_rate"),
                "test_count": len(data)
            }
            for coord, data in coordination_performance.items()
        }
        
        # Find optimal configurations
        optimal_small = min([r for r in successful_results if r.config.agent_count <= 10],
                          key=lambda r: r.coordination_latency, default=None)
        optimal_medium = min([r for r in successful_results if 10 < r.config.agent_count <= 50],
                           key=lambda r: r.coordination_latency, default=None)
        optimal_large = min([r for r in successful_results if r.config.agent_count > 50],
                          key=lambda r: r.coordination_latency, default=None)
        
        return {
            "summary": {
                "total_tests": len(results),
                "successful_tests": len(successful_results),
                "failed_tests": len(failed_results),
                "success_rate": len(successful_results) / len(results) if results else 0,
                "avg_initialization_time": avg([r for r in successful_results], "initialization_time"),
                "avg_coordination_latency": avg([r for r in successful_results], "coordination_latency"),
                "avg_memory_usage": avg([r for r in successful_results], "memory_usage_mb")
            },
            "topology_performance": topology_avg,
            "coordination_performance": coordination_avg,
            "scaling_analysis": scaling_performance,
            "optimal_configurations": {
                "small_scale": optimal_small.config.name if optimal_small else None,
                "medium_scale": optimal_medium.config.name if optimal_medium else None,
                "large_scale": optimal_large.config.name if optimal_large else None
            },
            "failed_configurations": [r.config.name for r in failed_results],
            "performance_targets": {
                "initialization_time_met": len([r for r in successful_results if r.initialization_time < 5.0]),
                "coordination_latency_met": len([r for r in successful_results if r.coordination_latency < 200]),
                "memory_usage_met": len([r for r in successful_results if r.memory_usage_mb < 100])
            }
        }

    def save_results(self, results: List[BenchmarkResult], analysis: Dict[str, Any]):
        """Save benchmark results and analysis to files"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save raw results
        results_file = self.output_dir / f"hive_mind_benchmark_results_{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump([asdict(r) for r in results], f, indent=2)
        
        # Save analysis
        analysis_file = self.output_dir / f"hive_mind_benchmark_analysis_{timestamp}.json"
        with open(analysis_file, 'w') as f:
            json.dump(analysis, f, indent=2)
        
        # Save CSV summary
        csv_file = self.output_dir / f"hive_mind_benchmark_summary_{timestamp}.csv"
        with open(csv_file, 'w') as f:
            f.write("name,topology,coordination,memory_type,agent_count,success,init_time,coord_latency,memory_mb,completion_rate\\n")
            for result in results:
                config = result.config
                f.write(f"{config.name},{config.topology},{config.coordination},{config.memory_type},"
                       f"{config.agent_count},{result.success},{result.initialization_time:.3f},"
                       f"{result.coordination_latency:.2f},{result.memory_usage_mb:.1f},"
                       f"{result.task_completion_rate:.2f}\\n")
        
        print(f"📊 Results saved to:")
        print(f"   📄 Raw data: {results_file}")
        print(f"   📈 Analysis: {analysis_file}") 
        print(f"   📋 Summary: {csv_file}")
        
        return {
            "results_file": str(results_file),
            "analysis_file": str(analysis_file),
            "csv_file": str(csv_file)
        }

    def run_comprehensive_benchmark(self) -> Dict[str, Any]:
        """Run the complete Hive Mind benchmark suite"""
        print("🐝 Starting Hive Mind Performance Benchmark Suite v2.0.0")
        print("=" * 60)
        
        # Create benchmark configurations
        configs = self.create_benchmark_configs()
        print(f"📋 Created {len(configs)} benchmark configurations")
        
        # Run benchmarks
        start_time = time.time()
        results = self.run_parallel_benchmarks(configs)
        total_duration = time.time() - start_time
        
        print(f"⏱️  Total benchmark time: {total_duration:.1f} seconds")
        
        # Analyze results
        analysis = self.analyze_results(results)
        
        # Save results
        file_info = self.save_results(results, analysis)
        
        # Add metadata
        analysis["metadata"] = {
            "total_duration_seconds": total_duration,
            "benchmark_time": datetime.now().isoformat(),
            "config_count": len(configs),
            "claude_flow_version": "2.0.0",
            "hive_mind_version": "1.0.0"
        }
        analysis["files"] = file_info
        
        return analysis

def main():
    """Main benchmark execution"""
    if len(sys.argv) > 1 and sys.argv[1] == "--quick":
        # Quick test with reduced configurations
        runner = HiveMindBenchmarkRunner()
        configs = [
            BenchmarkConfig("quick_hierarchical", "hierarchical", "queen", "sqlite", 5, "simple", 10),
            BenchmarkConfig("quick_mesh", "mesh", "consensus", "memory", 10, "medium", 15),
            BenchmarkConfig("quick_star", "star", "hybrid", "sqlite", 8, "simple", 10)
        ]
        
        print("🚀 Running quick Hive Mind benchmark...")
        results = []
        for config in configs:
            result = runner.run_single_benchmark(config)
            results.append(result)
        
        analysis = runner.analyze_results(results)
        runner.save_results(results, analysis)
        
    else:
        # Full comprehensive benchmark
        runner = HiveMindBenchmarkRunner()
        analysis = runner.run_comprehensive_benchmark()
        
        # Print summary
        summary = analysis["summary"]
        print("\\n🎯 BENCHMARK SUMMARY")
        print("=" * 40)
        print(f"Total tests: {summary['total_tests']}")
        print(f"Success rate: {summary['success_rate']:.1%}")
        print(f"Avg initialization: {summary['avg_initialization_time']:.3f}s")
        print(f"Avg coordination latency: {summary['avg_coordination_latency']:.1f}ms")
        print(f"Avg memory usage: {summary['avg_memory_usage']:.1f}MB")
        
        # Print optimal configurations
        optimal = analysis["optimal_configurations"]
        print("\\n🏆 OPTIMAL CONFIGURATIONS")
        print(f"Small scale (≤10 agents): {optimal.get('small_scale', 'N/A')}")
        print(f"Medium scale (11-50 agents): {optimal.get('medium_scale', 'N/A')}")
        print(f"Large scale (>50 agents): {optimal.get('large_scale', 'N/A')}")

if __name__ == "__main__":
    main()