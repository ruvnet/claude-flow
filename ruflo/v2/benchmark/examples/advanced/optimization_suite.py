#!/usr/bin/env python3
"""
Advanced optimization suite for performance tuning and efficiency analysis.

This example demonstrates:
- Performance optimization strategies
- Resource utilization analysis
- Token consumption optimization
- Coordination efficiency tuning
"""

import subprocess
import sys
import json
import time
import psutil
import threading
from pathlib import Path
from dataclasses import dataclass
from typing import List, Dict, Any, Optional, Tuple
from contextlib import contextmanager

@dataclass
class OptimizationConfig:
    """Configuration for optimization testing."""
    name: str
    agent_count: int
    coordination_mode: str
    optimization_target: str  # 'speed', 'quality', 'tokens', 'memory'
    parameters: Dict[str, Any]

@dataclass
class ResourceSnapshot:
    """System resource snapshot."""
    timestamp: float
    cpu_percent: float
    memory_mb: float
    memory_percent: float
    disk_io_read: int
    disk_io_write: int

class OptimizationSuite:
    """Advanced optimization testing and analysis."""
    
    def __init__(self):
        self.resource_snapshots: List[ResourceSnapshot] = []
        self.monitoring_active = False
        self.monitor_thread: Optional[threading.Thread] = None
    
    def create_optimization_configs(self) -> List[OptimizationConfig]:
        """Create various optimization configurations."""
        configs = [
            # Speed optimization
            OptimizationConfig(
                name="speed_optimized_swarm",
                agent_count=3,
                coordination_mode="hierarchical",
                optimization_target="speed",
                parameters={
                    "parallel_execution": True,
                    "cache_enabled": True,
                    "batch_size": 5,
                    "timeout": 30
                }
            ),
            # Quality optimization
            OptimizationConfig(
                name="quality_focused_swarm",
                agent_count=6,
                coordination_mode="mesh",
                optimization_target="quality",
                parameters={
                    "refinement_cycles": 3,
                    "validation_enabled": True,
                    "consensus_threshold": 0.9,
                    "review_depth": "deep"
                }
            ),
            # Token efficiency
            OptimizationConfig(
                name="token_efficient_swarm",
                agent_count=4,
                coordination_mode="ring",
                optimization_target="tokens",
                parameters={
                    "compression_enabled": True,
                    "context_optimization": True,
                    "prompt_optimization": True,
                    "response_filtering": True
                }
            ),
            # Memory optimization
            OptimizationConfig(
                name="memory_optimized_swarm",
                agent_count=5,
                coordination_mode="star",
                optimization_target="memory",
                parameters={
                    "memory_pooling": True,
                    "garbage_collection": "aggressive",
                    "cache_limit": "64MB",
                    "streaming_enabled": True
                }
            ),
            # Balanced optimization
            OptimizationConfig(
                name="balanced_swarm",
                agent_count=4,
                coordination_mode="adaptive",
                optimization_target="balanced",
                parameters={
                    "auto_scaling": True,
                    "dynamic_coordination": True,
                    "adaptive_timeout": True,
                    "smart_batching": True
                }
            )
        ]
        return configs
    
    @contextmanager
    def resource_monitoring(self, interval: float = 1.0):
        """Context manager for resource monitoring during benchmarks."""
        self.resource_snapshots.clear()
        self.monitoring_active = True
        
        def monitor_resources():
            while self.monitoring_active:
                try:
                    # Get system metrics
                    cpu_percent = psutil.cpu_percent(interval=0.1)
                    memory = psutil.virtual_memory()
                    disk_io = psutil.disk_io_counters()
                    
                    snapshot = ResourceSnapshot(
                        timestamp=time.time(),
                        cpu_percent=cpu_percent,
                        memory_mb=memory.used / 1024 / 1024,
                        memory_percent=memory.percent,
                        disk_io_read=disk_io.read_bytes if disk_io else 0,
                        disk_io_write=disk_io.write_bytes if disk_io else 0
                    )
                    
                    self.resource_snapshots.append(snapshot)
                    time.sleep(interval)
                    
                except Exception as e:
                    print(f"⚠️  Resource monitoring error: {e}")
                    break
        
        self.monitor_thread = threading.Thread(target=monitor_resources, daemon=True)
        self.monitor_thread.start()
        
        try:
            yield
        finally:
            self.monitoring_active = False
            if self.monitor_thread:
                self.monitor_thread.join(timeout=2.0)
    
    def run_optimization_benchmark(self, config: OptimizationConfig) -> Dict[str, Any]:
        """Run a single optimization benchmark with monitoring."""
        print(f"🔧 Testing optimization: {config.name}")
        print(f"   🎯 Target: {config.optimization_target}")
        print(f"   👥 Agents: {config.agent_count}")
        print(f"   🔗 Mode: {config.coordination_mode}")
        
        start_time = time.time()
        
        # Prepare task based on optimization target
        task = self._get_task_for_optimization(config.optimization_target)
        
        with self.resource_monitoring():
            try:
                # Build optimized command
                cmd = self._build_optimized_command(config, task)
                
                # Execute benchmark
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=120,
                    cwd="/workspaces/claude-code-flow/benchmark"
                )
                
                execution_time = time.time() - start_time
                
                # Analyze resource usage
                resource_analysis = self._analyze_resource_usage()
                
                # Parse benchmark output
                benchmark_metrics = self._parse_optimization_output(result.stdout)
                
                # Calculate optimization scores
                optimization_scores = self._calculate_optimization_scores(
                    config, execution_time, resource_analysis, benchmark_metrics
                )
                
                return {
                    "config": config.name,
                    "success": result.returncode == 0,
                    "execution_time": execution_time,
                    "resource_analysis": resource_analysis,
                    "benchmark_metrics": benchmark_metrics,
                    "optimization_scores": optimization_scores,
                    "error": result.stderr if result.returncode != 0 else None
                }
                
            except subprocess.TimeoutExpired:
                return {
                    "config": config.name,
                    "success": False,
                    "execution_time": time.time() - start_time,
                    "error": "Timeout"
                }
            except Exception as e:
                return {
                    "config": config.name,
                    "success": False,
                    "execution_time": time.time() - start_time,
                    "error": str(e)
                }
    
    def _get_task_for_optimization(self, optimization_target: str) -> str:
        """Get appropriate task based on optimization target."""
        tasks = {
            "speed": "Create a simple function with basic validation",
            "quality": "Design and implement a robust user authentication system",
            "tokens": "Generate API documentation for a REST service",
            "memory": "Process and analyze a large dataset efficiently", 
            "balanced": "Build a scalable microservice with tests and documentation"
        }
        return tasks.get(optimization_target, tasks["balanced"])
    
    def _build_optimized_command(self, config: OptimizationConfig, task: str) -> List[str]:
        """Build command with optimization parameters."""
        cmd = [
            "swarm-benchmark", "real", "swarm",
            task,
            "--max-agents", str(config.agent_count),
            "--coordination", config.coordination_mode
        ]
        
        # Add optimization-specific parameters
        if config.parameters.get("parallel_execution"):
            cmd.extend(["--parallel", "true"])
        
        if config.parameters.get("cache_enabled"):
            cmd.extend(["--cache", "enabled"])
        
        if "timeout" in config.parameters:
            cmd.extend(["--timeout", str(config.parameters["timeout"])])
        
        return cmd
    
    def _analyze_resource_usage(self) -> Dict[str, Any]:
        """Analyze resource usage from snapshots."""
        if not self.resource_snapshots:
            return {}
        
        cpu_values = [s.cpu_percent for s in self.resource_snapshots]
        memory_values = [s.memory_mb for s in self.resource_snapshots]
        
        return {
            "cpu_avg": sum(cpu_values) / len(cpu_values),
            "cpu_max": max(cpu_values),
            "cpu_min": min(cpu_values),
            "memory_avg_mb": sum(memory_values) / len(memory_values),
            "memory_max_mb": max(memory_values),
            "memory_peak_percent": max(s.memory_percent for s in self.resource_snapshots),
            "samples_count": len(self.resource_snapshots),
            "monitoring_duration": self.resource_snapshots[-1].timestamp - self.resource_snapshots[0].timestamp if len(self.resource_snapshots) > 1 else 0
        }
    
    def _parse_optimization_output(self, output: str) -> Dict[str, Any]:
        """Parse optimization-specific metrics from output."""
        # Try to extract JSON metrics
        try:
            lines = output.strip().split('\n')
            for line in lines:
                if line.strip().startswith('{'):
                    return json.loads(line.strip())
        except:
            pass
        
        # Fallback to heuristic analysis
        return {
            "output_length": len(output),
            "lines_count": len(output.split('\n')),
            "estimated_tokens": len(output.split()) * 1.3,
            "success_indicators": output.count("✅"),
            "warning_indicators": output.count("⚠️"),
            "error_indicators": output.count("❌")
        }
    
    def _calculate_optimization_scores(
        self, 
        config: OptimizationConfig,
        execution_time: float,
        resource_analysis: Dict[str, Any],
        benchmark_metrics: Dict[str, Any]
    ) -> Dict[str, float]:
        """Calculate optimization effectiveness scores."""
        scores = {}
        
        # Speed score (inverse of execution time, normalized)
        baseline_time = 60.0  # Assume 60s baseline
        scores["speed_score"] = max(0, min(100, (baseline_time / execution_time) * 100 if execution_time > 0 else 0))
        
        # Resource efficiency score
        if resource_analysis:
            cpu_efficiency = max(0, 100 - resource_analysis.get("cpu_avg", 50))
            memory_efficiency = max(0, 100 - resource_analysis.get("memory_peak_percent", 50))
            scores["resource_efficiency"] = (cpu_efficiency + memory_efficiency) / 2
        
        # Quality score (based on success indicators)
        success_count = benchmark_metrics.get("success_indicators", 0)
        error_count = benchmark_metrics.get("error_indicators", 0)
        warning_count = benchmark_metrics.get("warning_indicators", 0)
        
        quality_base = success_count * 20
        quality_penalty = error_count * 15 + warning_count * 5
        scores["quality_score"] = max(0, min(100, quality_base - quality_penalty))
        
        # Token efficiency score
        estimated_tokens = benchmark_metrics.get("estimated_tokens", 1000)
        baseline_tokens = 1500
        scores["token_efficiency"] = max(0, min(100, (baseline_tokens / estimated_tokens) * 100 if estimated_tokens > 0 else 100))
        
        # Overall optimization score
        target = config.optimization_target
        if target == "speed":
            scores["overall_score"] = scores["speed_score"] * 0.6 + scores.get("resource_efficiency", 50) * 0.4
        elif target == "quality":
            scores["overall_score"] = scores["quality_score"] * 0.7 + scores["speed_score"] * 0.3
        elif target == "tokens":
            scores["overall_score"] = scores["token_efficiency"] * 0.8 + scores["quality_score"] * 0.2
        elif target == "memory":
            scores["overall_score"] = scores.get("resource_efficiency", 50) * 0.7 + scores["speed_score"] * 0.3
        else:  # balanced
            scores["overall_score"] = (
                scores["speed_score"] * 0.25 +
                scores.get("resource_efficiency", 50) * 0.25 +
                scores["quality_score"] * 0.25 +
                scores["token_efficiency"] * 0.25
            )
        
        return scores
    
    def run_optimization_suite(self) -> Dict[str, Any]:
        """Run complete optimization suite."""
        print("🔧 Starting Optimization Suite")
        print("=" * 40)
        
        configs = self.create_optimization_configs()
        results = []
        
        for config in configs:
            result = self.run_optimization_benchmark(config)
            results.append(result)
            
            status = "✅" if result["success"] else "❌"
            score = result.get("optimization_scores", {}).get("overall_score", 0)
            print(f"{status} {config.name}: {score:.1f}/100 ({result['execution_time']:.1f}s)")
        
        # Analyze suite results
        suite_analysis = self._analyze_suite_results(results)
        
        return {
            "results": results,
            "analysis": suite_analysis,
            "timestamp": time.time()
        }
    
    def _analyze_suite_results(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Analyze optimization suite results."""
        successful_results = [r for r in results if r["success"]]
        
        if not successful_results:
            return {"error": "No successful optimization runs"}
        
        # Find best optimization by target
        best_by_target = {}
        for result in successful_results:
            config_name = result["config"]
            overall_score = result.get("optimization_scores", {}).get("overall_score", 0)
            
            # Extract target from config name
            if "speed" in config_name:
                target = "speed"
            elif "quality" in config_name:
                target = "quality"
            elif "token" in config_name:
                target = "tokens"
            elif "memory" in config_name:
                target = "memory"
            else:
                target = "balanced"
            
            if target not in best_by_target or overall_score > best_by_target[target]["score"]:
                best_by_target[target] = {
                    "config": config_name,
                    "score": overall_score,
                    "execution_time": result["execution_time"]
                }
        
        # Calculate averages
        avg_execution_time = sum(r["execution_time"] for r in successful_results) / len(successful_results)
        avg_overall_score = sum(r.get("optimization_scores", {}).get("overall_score", 0) for r in successful_results) / len(successful_results)
        
        return {
            "total_optimizations": len(results),
            "successful_optimizations": len(successful_results),
            "success_rate": len(successful_results) / len(results),
            "average_execution_time": avg_execution_time,
            "average_overall_score": avg_overall_score,
            "best_by_target": best_by_target,
            "recommendations": self._generate_optimization_recommendations(best_by_target)
        }
    
    def _generate_optimization_recommendations(self, best_by_target: Dict[str, Any]) -> List[str]:
        """Generate optimization recommendations based on results."""
        recommendations = []
        
        if "speed" in best_by_target:
            speed_config = best_by_target["speed"]["config"]
            recommendations.append(f"For speed optimization, use: {speed_config}")
        
        if "quality" in best_by_target:
            quality_config = best_by_target["quality"]["config"]
            recommendations.append(f"For quality optimization, use: {quality_config}")
        
        if "tokens" in best_by_target:
            token_config = best_by_target["tokens"]["config"]
            recommendations.append(f"For token efficiency, use: {token_config}")
        
        if "memory" in best_by_target:
            memory_config = best_by_target["memory"]["config"]
            recommendations.append(f"For memory optimization, use: {memory_config}")
        
        # General recommendations
        recommendations.extend([
            "Monitor resource usage during optimization",
            "Balance speed vs quality based on use case",
            "Consider token costs for production workloads",
            "Use hierarchical coordination for speed",
            "Use mesh coordination for quality",
            "Enable caching for repeated operations"
        ])
        
        return recommendations

def save_optimization_results(suite_results: Dict[str, Any]):
    """Save optimization suite results."""
    output_dir = Path("/workspaces/claude-code-flow/benchmark/examples/output")
    output_dir.mkdir(exist_ok=True)
    
    # Save complete results
    with open(output_dir / "optimization_suite_results.json", "w") as f:
        json.dump(suite_results, f, indent=2, default=str)
    
    # Save analysis summary
    analysis = suite_results.get("analysis", {})
    with open(output_dir / "optimization_analysis.json", "w") as f:
        json.dump(analysis, f, indent=2)
    
    print(f"📁 Optimization results saved to: {output_dir}")

if __name__ == "__main__":
    print("🔧 Advanced Optimization Suite")
    print("=" * 50)
    
    # Run optimization suite
    suite = OptimizationSuite()
    results = suite.run_optimization_suite()
    
    # Display analysis
    analysis = results.get("analysis", {})
    print(f"\n📊 Optimization Suite Analysis")
    print("=" * 35)
    print(f"Success rate: {analysis.get('success_rate', 0):.1%}")
    print(f"Average score: {analysis.get('average_overall_score', 0):.1f}/100")
    print(f"Average time: {analysis.get('average_execution_time', 0):.1f}s")
    
    # Best by target
    best_by_target = analysis.get("best_by_target", {})
    if best_by_target:
        print(f"\n🏆 Best Optimizations by Target:")
        for target, best in best_by_target.items():
            print(f"  {target}: {best['config']} ({best['score']:.1f}/100)")
    
    # Recommendations
    recommendations = analysis.get("recommendations", [])
    if recommendations:
        print(f"\n💡 Optimization Recommendations:")
        for i, rec in enumerate(recommendations[:5], 1):  # Show top 5
            print(f"  {i}. {rec}")
    
    # Save results
    save_optimization_results(results)
    
    print(f"\n🎉 Optimization Suite Complete!")
    print("Results provide insights for:")
    print("- Performance tuning strategies")
    print("- Resource utilization patterns")
    print("- Target-specific optimizations")
    print("- Production deployment guidelines")