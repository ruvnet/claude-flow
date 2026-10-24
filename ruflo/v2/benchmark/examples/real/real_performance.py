#!/usr/bin/env python3
"""
Real performance analysis and monitoring for claude-flow benchmarks.

This example demonstrates:
- Comprehensive performance monitoring
- System resource tracking
- Bottleneck identification
- Performance optimization recommendations
"""

import subprocess
import sys
import json
import time
import psutil
import threading
import queue
from pathlib import Path
from dataclasses import dataclass, asdict
from typing import List, Dict, Any, Optional, Tuple
from contextlib import contextmanager
import statistics

@dataclass
class PerformanceSnapshot:
    """Single performance measurement snapshot."""
    timestamp: float
    cpu_percent: float
    memory_mb: float
    memory_percent: float
    disk_read_mb: float
    disk_write_mb: float
    network_sent_mb: float
    network_recv_mb: float
    process_count: int
    thread_count: int

@dataclass
class PerformanceMetrics:
    """Comprehensive performance metrics for a benchmark."""
    benchmark_id: str
    methodology: str
    coordination_mode: str
    agent_count: int
    task_complexity: str
    execution_time: float
    success: bool
    
    # CPU metrics
    cpu_avg: float
    cpu_max: float
    cpu_min: float
    cpu_std: float
    
    # Memory metrics
    memory_avg_mb: float
    memory_max_mb: float
    memory_min_mb: float
    memory_std_mb: float
    memory_peak_percent: float
    
    # I/O metrics
    disk_read_total_mb: float
    disk_write_total_mb: float
    network_sent_total_mb: float
    network_recv_total_mb: float
    
    # Performance scores
    cpu_efficiency_score: float
    memory_efficiency_score: float
    io_efficiency_score: float
    overall_performance_score: float
    
    # Bottleneck analysis
    primary_bottleneck: str
    bottleneck_severity: float
    optimization_recommendations: List[str]

class RealPerformanceMonitor:
    """Real-time performance monitoring and analysis."""
    
    def __init__(self, monitoring_interval: float = 1.0):
        self.monitoring_interval = monitoring_interval
        self.snapshots: List[PerformanceSnapshot] = []
        self.monitoring_active = False
        self.monitor_thread: Optional[threading.Thread] = None
        self.performance_history: List[PerformanceMetrics] = []
        self.claude_flow_path = "/workspaces/claude-code-flow"
        
        # Performance thresholds
        self.thresholds = {
            "cpu_high": 80.0,
            "cpu_critical": 95.0,
            "memory_high": 85.0,
            "memory_critical": 95.0,
            "disk_io_high": 100.0,  # MB/s
            "network_high": 50.0    # MB/s
        }
    
    @contextmanager
    def performance_monitoring(self):
        """Context manager for comprehensive performance monitoring."""
        self.snapshots.clear()
        self.monitoring_active = True
        
        # Get initial system state
        initial_disk = psutil.disk_io_counters()
        initial_network = psutil.net_io_counters()
        
        def monitor_performance():
            """Background monitoring function."""
            prev_disk = initial_disk
            prev_network = initial_network
            
            while self.monitoring_active:
                try:
                    # Get current system metrics
                    cpu_percent = psutil.cpu_percent(interval=0.1)
                    memory = psutil.virtual_memory()
                    disk_io = psutil.disk_io_counters()
                    network_io = psutil.net_io_counters()
                    
                    # Calculate rates
                    disk_read_mb = (disk_io.read_bytes - prev_disk.read_bytes) / 1024 / 1024 if prev_disk else 0
                    disk_write_mb = (disk_io.write_bytes - prev_disk.write_bytes) / 1024 / 1024 if prev_disk else 0
                    network_sent_mb = (network_io.bytes_sent - prev_network.bytes_sent) / 1024 / 1024 if prev_network else 0
                    network_recv_mb = (network_io.bytes_recv - prev_network.bytes_recv) / 1024 / 1024 if prev_network else 0
                    
                    # Count processes and threads
                    process_count = len(psutil.pids())
                    thread_count = sum(proc.num_threads() for proc in psutil.process_iter(['num_threads']) if proc.info['num_threads'])
                    
                    snapshot = PerformanceSnapshot(
                        timestamp=time.time(),
                        cpu_percent=cpu_percent,
                        memory_mb=memory.used / 1024 / 1024,
                        memory_percent=memory.percent,
                        disk_read_mb=disk_read_mb,
                        disk_write_mb=disk_write_mb,
                        network_sent_mb=network_sent_mb,
                        network_recv_mb=network_recv_mb,
                        process_count=process_count,
                        thread_count=thread_count
                    )
                    
                    self.snapshots.append(snapshot)
                    
                    prev_disk = disk_io
                    prev_network = network_io
                    
                    time.sleep(self.monitoring_interval)
                    
                except Exception as e:
                    print(f"⚠️  Performance monitoring error: {e}")
                    break
        
        self.monitor_thread = threading.Thread(target=monitor_performance, daemon=True)
        self.monitor_thread.start()
        
        try:
            yield
        finally:
            self.monitoring_active = False
            if self.monitor_thread:
                self.monitor_thread.join(timeout=5.0)
    
    def create_performance_benchmarks(self) -> List[Dict[str, Any]]:
        """Create benchmarks designed for performance analysis."""
        benchmarks = [
            {
                "id": "lightweight_swarm",
                "methodology": "swarm",
                "task": "Create a simple utility function",
                "strategy": "development",
                "coordination": "hierarchical",
                "agents": 3,
                "complexity": "simple",
                "expected_duration": 60
            },
            {
                "id": "standard_api_swarm", 
                "methodology": "swarm",
                "task": "Build a REST API with database integration",
                "strategy": "development",
                "coordination": "hierarchical",
                "agents": 5,
                "complexity": "medium",
                "expected_duration": 180
            },
            {
                "id": "intensive_mesh_swarm",
                "methodology": "swarm",
                "task": "Design complex distributed system with multiple services",
                "strategy": "development",
                "coordination": "mesh",
                "agents": 7,
                "complexity": "complex",
                "expected_duration": 300
            },
            {
                "id": "collective_hive_analysis",
                "methodology": "hive-mind",
                "task": "Perform comprehensive code analysis and optimization",
                "strategy": "collective",
                "coordination": "mesh",
                "agents": 6,
                "complexity": "medium",
                "expected_duration": 240
            },
            {
                "id": "consensus_architecture_hive",
                "methodology": "hive-mind",
                "task": "Reach consensus on complex system architecture",
                "strategy": "consensus",
                "coordination": "distributed",
                "agents": 8,
                "complexity": "complex",
                "expected_duration": 360
            },
            {
                "id": "tdd_sparc_intensive",
                "methodology": "sparc",
                "task": "Implement comprehensive system using TDD with multiple refinement cycles",
                "strategy": "tdd",
                "coordination": "hierarchical",
                "agents": 5,
                "complexity": "complex",
                "expected_duration": 300
            }
        ]
        return benchmarks
    
    def execute_performance_benchmark(self, benchmark_config: Dict[str, Any]) -> PerformanceMetrics:
        """Execute benchmark with comprehensive performance monitoring."""
        print(f"📊 Performance benchmark: {benchmark_config['id']}")
        print(f"   📋 Task: {benchmark_config['task'][:50]}...")
        print(f"   🎯 Expected duration: {benchmark_config['expected_duration']}s")
        print(f"   👥 Agents: {benchmark_config['agents']} ({benchmark_config['coordination']})")
        
        start_time = time.time()
        
        with self.performance_monitoring():
            try:
                # Build command
                cmd = self._build_performance_command(benchmark_config)
                
                # Execute benchmark
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=benchmark_config['expected_duration'] + 60,  # Add buffer
                    cwd=self.claude_flow_path
                )
                
                end_time = time.time()
                execution_time = end_time - start_time
                success = result.returncode == 0
                
                # Create performance metrics
                metrics = self._create_performance_metrics(
                    benchmark_config, execution_time, success
                )
                
                # Display results
                status = "✅" if success else "❌"
                print(f"   {status} Completed in {execution_time:.1f}s")
                print(f"   🖥️  CPU avg/max: {metrics.cpu_avg:.1f}%/{metrics.cpu_max:.1f}%")
                print(f"   💾 Memory peak: {metrics.memory_max_mb:.1f}MB ({metrics.memory_peak_percent:.1f}%)")
                print(f"   ⚡ Performance score: {metrics.overall_performance_score:.1f}/100")
                print(f"   🚨 Primary bottleneck: {metrics.primary_bottleneck}")
                
                return metrics
                
            except subprocess.TimeoutExpired:
                end_time = time.time()
                execution_time = end_time - start_time
                print(f"   ⏰ Timeout after {execution_time:.1f}s")
                
                return self._create_timeout_performance_metrics(benchmark_config, execution_time)
                
            except Exception as e:
                end_time = time.time()
                execution_time = end_time - start_time
                print(f"   ❌ Error: {e}")
                
                return self._create_error_performance_metrics(benchmark_config, execution_time)
    
    def _build_performance_command(self, config: Dict[str, Any]) -> List[str]:
        """Build command for performance benchmark."""
        base_cmd = ["npx", "claude-flow@alpha"]
        
        if config["methodology"] == "swarm":
            cmd = base_cmd + [
                "swarm", config["task"],
                "--strategy", config["strategy"],
                "--coordination", config["coordination"],
                "--max-agents", str(config["agents"]),
                "--enable-metrics", "true"
            ]
        elif config["methodology"] == "hive-mind":
            cmd = base_cmd + [
                "hive-mind", config["task"],
                "--thinking-pattern", config["strategy"],
                "--coordination", config["coordination"],
                "--agents", str(config["agents"]),
                "--enable-metrics", "true"
            ]
        elif config["methodology"] == "sparc":
            cmd = base_cmd + [
                "sparc", config["task"],
                "--mode", config["strategy"],
                "--coordination", config["coordination"],
                "--agents", str(config["agents"]),
                "--enable-metrics", "true",
                "--refinement-cycles", "3"
            ]
        
        return cmd
    
    def _create_performance_metrics(
        self,
        config: Dict[str, Any],
        execution_time: float,
        success: bool
    ) -> PerformanceMetrics:
        """Create comprehensive performance metrics from monitoring data."""
        
        if not self.snapshots:
            return self._create_empty_performance_metrics(config, execution_time, success)
        
        # Extract values
        cpu_values = [s.cpu_percent for s in self.snapshots]
        memory_mb_values = [s.memory_mb for s in self.snapshots]
        memory_percent_values = [s.memory_percent for s in self.snapshots]
        
        # Calculate CPU metrics
        cpu_avg = statistics.mean(cpu_values)
        cpu_max = max(cpu_values)
        cpu_min = min(cpu_values)
        cpu_std = statistics.stdev(cpu_values) if len(cpu_values) > 1 else 0
        
        # Calculate memory metrics
        memory_avg_mb = statistics.mean(memory_mb_values)
        memory_max_mb = max(memory_mb_values)
        memory_min_mb = min(memory_mb_values)
        memory_std_mb = statistics.stdev(memory_mb_values) if len(memory_mb_values) > 1 else 0
        memory_peak_percent = max(memory_percent_values)
        
        # Calculate I/O totals
        disk_read_total = sum(s.disk_read_mb for s in self.snapshots)
        disk_write_total = sum(s.disk_write_mb for s in self.snapshots)
        network_sent_total = sum(s.network_sent_mb for s in self.snapshots)
        network_recv_total = sum(s.network_recv_mb for s in self.snapshots)
        
        # Calculate efficiency scores
        cpu_efficiency_score = self._calculate_cpu_efficiency(cpu_avg, cpu_max)
        memory_efficiency_score = self._calculate_memory_efficiency(memory_peak_percent)
        io_efficiency_score = self._calculate_io_efficiency(disk_read_total + disk_write_total, execution_time)
        
        # Overall performance score
        time_efficiency = min(100, (config.get("expected_duration", execution_time) / execution_time) * 100) if execution_time > 0 else 0
        resource_efficiency = (cpu_efficiency_score + memory_efficiency_score + io_efficiency_score) / 3
        overall_score = (time_efficiency * 0.4 + resource_efficiency * 0.6) if success else 0
        
        # Bottleneck analysis
        bottleneck, bottleneck_severity = self._identify_bottleneck(cpu_avg, cpu_max, memory_peak_percent, disk_read_total + disk_write_total)
        
        # Generate optimization recommendations
        recommendations = self._generate_optimization_recommendations(
            cpu_avg, cpu_max, memory_peak_percent, disk_read_total + disk_write_total, config
        )
        
        return PerformanceMetrics(
            benchmark_id=config["id"],
            methodology=config["methodology"],
            coordination_mode=config["coordination"],
            agent_count=config["agents"],
            task_complexity=config["complexity"],
            execution_time=execution_time,
            success=success,
            cpu_avg=cpu_avg,
            cpu_max=cpu_max,
            cpu_min=cpu_min,
            cpu_std=cpu_std,
            memory_avg_mb=memory_avg_mb,
            memory_max_mb=memory_max_mb,
            memory_min_mb=memory_min_mb,
            memory_std_mb=memory_std_mb,
            memory_peak_percent=memory_peak_percent,
            disk_read_total_mb=disk_read_total,
            disk_write_total_mb=disk_write_total,
            network_sent_total_mb=network_sent_total,
            network_recv_total_mb=network_recv_total,
            cpu_efficiency_score=cpu_efficiency_score,
            memory_efficiency_score=memory_efficiency_score,
            io_efficiency_score=io_efficiency_score,
            overall_performance_score=overall_score,
            primary_bottleneck=bottleneck,
            bottleneck_severity=bottleneck_severity,
            optimization_recommendations=recommendations
        )
    
    def _calculate_cpu_efficiency(self, cpu_avg: float, cpu_max: float) -> float:
        """Calculate CPU efficiency score."""
        # Penalty for high CPU usage
        avg_penalty = max(0, (cpu_avg - 50) / 50 * 50)  # Penalty starts at 50%
        max_penalty = max(0, (cpu_max - 80) / 20 * 30)  # Heavy penalty above 80%
        
        efficiency = 100 - avg_penalty - max_penalty
        return max(0, min(100, efficiency))
    
    def _calculate_memory_efficiency(self, memory_peak_percent: float) -> float:
        """Calculate memory efficiency score."""
        # Penalty for high memory usage
        if memory_peak_percent < 50:
            return 100
        elif memory_peak_percent < 80:
            return 100 - (memory_peak_percent - 50) / 30 * 30
        else:
            return 70 - (memory_peak_percent - 80) / 20 * 70
    
    def _calculate_io_efficiency(self, total_io_mb: float, execution_time: float) -> float:
        """Calculate I/O efficiency score."""
        io_rate = total_io_mb / execution_time if execution_time > 0 else 0
        
        # Good I/O rates are typically under 10 MB/s for our workloads
        if io_rate < 10:
            return 100
        elif io_rate < 50:
            return 100 - (io_rate - 10) / 40 * 50
        else:
            return 50 - min(50, (io_rate - 50) / 100 * 50)
    
    def _identify_bottleneck(self, cpu_avg: float, cpu_max: float, memory_peak: float, total_io: float) -> Tuple[str, float]:
        """Identify primary performance bottleneck."""
        bottlenecks = []
        
        # CPU bottleneck
        if cpu_avg > 70:
            severity = (cpu_avg - 70) / 30 * 100
            bottlenecks.append(("CPU", severity))
        
        # Memory bottleneck
        if memory_peak > 80:
            severity = (memory_peak - 80) / 20 * 100
            bottlenecks.append(("Memory", severity))
        
        # I/O bottleneck (rough heuristic)
        if total_io > 100:  # More than 100MB total I/O
            severity = min(100, (total_io - 100) / 500 * 100)
            bottlenecks.append(("I/O", severity))
        
        if not bottlenecks:
            return ("None", 0.0)
        
        # Return most severe bottleneck
        primary_bottleneck = max(bottlenecks, key=lambda x: x[1])
        return primary_bottleneck[0], primary_bottleneck[1]
    
    def _generate_optimization_recommendations(
        self,
        cpu_avg: float,
        cpu_max: float,
        memory_peak: float,
        total_io: float,
        config: Dict[str, Any]
    ) -> List[str]:
        """Generate optimization recommendations based on performance analysis."""
        recommendations = []
        
        # CPU recommendations
        if cpu_avg > 80:
            recommendations.append("Consider reducing agent count to decrease CPU load")
            if config["coordination"] == "mesh":
                recommendations.append("Switch to hierarchical coordination to reduce CPU overhead")
        elif cpu_avg < 30:
            recommendations.append("CPU is underutilized - consider increasing agent count")
        
        # Memory recommendations
        if memory_peak > 85:
            recommendations.append("Memory usage is high - enable memory optimization flags")
            recommendations.append("Consider using streaming processing for large tasks")
        
        # I/O recommendations
        if total_io > 200:
            recommendations.append("High I/O detected - enable caching mechanisms")
            recommendations.append("Consider SSD storage for better I/O performance")
        
        # Coordination recommendations
        if config["coordination"] == "mesh" and config["agents"] > 5:
            recommendations.append("Large mesh coordination is inefficient - consider hierarchical mode")
        
        # Agent scaling recommendations
        if config["agents"] > 6 and cpu_avg > 75:
            recommendations.append("Too many agents for available CPU - reduce to 4-5 agents")
        elif config["agents"] < 4 and cpu_avg < 40:
            recommendations.append("CPU capacity available - consider increasing to 5-6 agents")
        
        # Methodology-specific recommendations
        if config["methodology"] == "hive-mind" and memory_peak > 80:
            recommendations.append("Hive-mind is memory intensive - enable memory pooling")
        
        if config["methodology"] == "sparc" and config.get("refinement_cycles", 1) > 2:
            recommendations.append("Multiple refinement cycles increase resource usage")
        
        # General recommendations
        if not recommendations:
            recommendations.append("Performance is well-balanced - no major optimizations needed")
        
        return recommendations
    
    def _create_empty_performance_metrics(self, config: Dict[str, Any], execution_time: float, success: bool) -> PerformanceMetrics:
        """Create empty performance metrics when monitoring failed."""
        return PerformanceMetrics(
            benchmark_id=config["id"],
            methodology=config["methodology"],
            coordination_mode=config["coordination"],
            agent_count=config["agents"],
            task_complexity=config["complexity"],
            execution_time=execution_time,
            success=success,
            cpu_avg=0, cpu_max=0, cpu_min=0, cpu_std=0,
            memory_avg_mb=0, memory_max_mb=0, memory_min_mb=0, memory_std_mb=0, memory_peak_percent=0,
            disk_read_total_mb=0, disk_write_total_mb=0, network_sent_total_mb=0, network_recv_total_mb=0,
            cpu_efficiency_score=0, memory_efficiency_score=0, io_efficiency_score=0, overall_performance_score=0,
            primary_bottleneck="Unknown", bottleneck_severity=0, optimization_recommendations=["No monitoring data available"]
        )
    
    def _create_timeout_performance_metrics(self, config: Dict[str, Any], execution_time: float) -> PerformanceMetrics:
        """Create performance metrics for timed out benchmark."""
        metrics = self._create_performance_metrics(config, execution_time, False)
        metrics.optimization_recommendations.insert(0, "Benchmark timed out - consider reducing task complexity")
        return metrics
    
    def _create_error_performance_metrics(self, config: Dict[str, Any], execution_time: float) -> PerformanceMetrics:
        """Create performance metrics for failed benchmark."""
        metrics = self._create_performance_metrics(config, execution_time, False)
        metrics.optimization_recommendations.insert(0, "Benchmark failed - check system resources and configuration")
        return metrics
    
    def run_performance_analysis_suite(self) -> Dict[str, Any]:
        """Run complete performance analysis benchmark suite."""
        print("📊 Real Performance Analysis Suite")
        print("=" * 50)
        
        benchmarks = self.create_performance_benchmarks()
        all_metrics = []
        
        for i, benchmark in enumerate(benchmarks, 1):
            print(f"\n[{i}/{len(benchmarks)}] Running {benchmark['id']}")
            print("-" * 50)
            
            metrics = self.execute_performance_benchmark(benchmark)
            all_metrics.append(metrics)
            self.performance_history.append(metrics)
            
            # Brief pause between benchmarks to let system settle
            time.sleep(5)
        
        # Generate suite analysis
        suite_analysis = self._analyze_performance_suite(all_metrics)
        
        # Save results
        self._save_performance_results(all_metrics, suite_analysis)
        
        return {
            "metrics": [asdict(m) for m in all_metrics],
            "analysis": suite_analysis,
            "timestamp": time.time()
        }
    
    def _analyze_performance_suite(self, metrics_list: List[PerformanceMetrics]) -> Dict[str, Any]:
        """Analyze performance across the entire suite."""
        if not metrics_list:
            return {}
        
        successful_metrics = [m for m in metrics_list if m.success]
        
        analysis = {
            "total_benchmarks": len(metrics_list),
            "successful_benchmarks": len(successful_metrics),
            "success_rate": len(successful_metrics) / len(metrics_list),
            "performance_summary": {},
            "bottleneck_analysis": {},
            "resource_utilization": {},
            "optimization_priorities": [],
            "best_performers": {},
            "worst_performers": {}
        }
        
        if not successful_metrics:
            return analysis
        
        # Performance summary
        analysis["performance_summary"] = {
            "average_execution_time": statistics.mean([m.execution_time for m in successful_metrics]),
            "average_performance_score": statistics.mean([m.overall_performance_score for m in successful_metrics]),
            "average_cpu_usage": statistics.mean([m.cpu_avg for m in successful_metrics]),
            "average_memory_peak": statistics.mean([m.memory_peak_percent for m in successful_metrics])
        }
        
        # Bottleneck analysis
        bottleneck_counts = {}
        for m in successful_metrics:
            bottleneck = m.primary_bottleneck
            if bottleneck not in bottleneck_counts:
                bottleneck_counts[bottleneck] = 0
            bottleneck_counts[bottleneck] += 1
        
        analysis["bottleneck_analysis"] = {
            "most_common_bottleneck": max(bottleneck_counts.items(), key=lambda x: x[1])[0] if bottleneck_counts else "None",
            "bottleneck_distribution": bottleneck_counts
        }
        
        # Resource utilization patterns
        analysis["resource_utilization"] = {
            "cpu_efficiency_avg": statistics.mean([m.cpu_efficiency_score for m in successful_metrics]),
            "memory_efficiency_avg": statistics.mean([m.memory_efficiency_score for m in successful_metrics]),
            "io_efficiency_avg": statistics.mean([m.io_efficiency_score for m in successful_metrics])
        }
        
        # Best and worst performers
        if successful_metrics:
            best_overall = max(successful_metrics, key=lambda m: m.overall_performance_score)
            worst_overall = min(successful_metrics, key=lambda m: m.overall_performance_score)
            
            analysis["best_performers"] = {
                "overall": {
                    "benchmark_id": best_overall.benchmark_id,
                    "score": best_overall.overall_performance_score,
                    "methodology": best_overall.methodology,
                    "coordination": best_overall.coordination_mode
                }
            }
            
            analysis["worst_performers"] = {
                "overall": {
                    "benchmark_id": worst_overall.benchmark_id,
                    "score": worst_overall.overall_performance_score,
                    "methodology": worst_overall.methodology,
                    "coordination": worst_overall.coordination_mode
                }
            }
        
        # Generate optimization priorities
        cpu_issues = sum(1 for m in successful_metrics if m.cpu_avg > 70)
        memory_issues = sum(1 for m in successful_metrics if m.memory_peak_percent > 80)
        io_issues = sum(1 for m in successful_metrics if m.disk_read_total_mb + m.disk_write_total_mb > 100)
        
        if cpu_issues > len(successful_metrics) / 2:
            analysis["optimization_priorities"].append("CPU optimization is critical")
        if memory_issues > len(successful_metrics) / 2:
            analysis["optimization_priorities"].append("Memory optimization is needed")
        if io_issues > len(successful_metrics) / 2:
            analysis["optimization_priorities"].append("I/O optimization should be considered")
        
        return analysis
    
    def _save_performance_results(self, metrics_list: List[PerformanceMetrics], analysis: Dict[str, Any]):
        """Save performance analysis results."""
        output_dir = Path("/workspaces/claude-code-flow/benchmark/examples/output")
        output_dir.mkdir(exist_ok=True)
        
        timestamp = int(time.time())
        
        # Save individual metrics
        metrics_data = [asdict(m) for m in metrics_list]
        with open(output_dir / f"performance_metrics_{timestamp}.json", "w") as f:
            json.dump(metrics_data, f, indent=2)
        
        # Save analysis
        with open(output_dir / f"performance_analysis_{timestamp}.json", "w") as f:
            json.dump(analysis, f, indent=2)
        
        # Save CSV for analysis
        with open(output_dir / f"performance_summary_{timestamp}.csv", "w") as f:
            f.write("benchmark_id,methodology,coordination,agents,execution_time,cpu_avg,cpu_max,memory_peak_mb,memory_peak_percent,performance_score,primary_bottleneck\n")
            for m in metrics_list:
                f.write(f"{m.benchmark_id},{m.methodology},{m.coordination_mode},{m.agent_count},"
                       f"{m.execution_time:.2f},{m.cpu_avg:.2f},{m.cpu_max:.2f},{m.memory_max_mb:.2f},"
                       f"{m.memory_peak_percent:.2f},{m.overall_performance_score:.2f},{m.primary_bottleneck}\n")
        
        print(f"\n📁 Performance results saved to: {output_dir}")
        print(f"   📊 Metrics: performance_metrics_{timestamp}.json")
        print(f"   📈 Analysis: performance_analysis_{timestamp}.json")
        print(f"   📋 CSV: performance_summary_{timestamp}.csv")

if __name__ == "__main__":
    print("📊 Real Performance Analysis and Monitoring")
    print("=" * 50)
    
    # Initialize monitor
    monitor = RealPerformanceMonitor(monitoring_interval=1.0)
    
    # Run performance analysis suite
    results = monitor.run_performance_analysis_suite()
    
    # Display key findings
    analysis = results.get("analysis", {})
    print(f"\n📈 Performance Analysis Summary")
    print("=" * 40)
    print(f"Success rate: {analysis.get('success_rate', 0):.1%}")
    
    perf_summary = analysis.get("performance_summary", {})
    if perf_summary:
        print(f"Average performance score: {perf_summary.get('average_performance_score', 0):.1f}/100")
        print(f"Average execution time: {perf_summary.get('average_execution_time', 0):.1f}s")
        print(f"Average CPU usage: {perf_summary.get('average_cpu_usage', 0):.1f}%")
        print(f"Average memory peak: {perf_summary.get('average_memory_peak', 0):.1f}%")
    
    bottleneck_analysis = analysis.get("bottleneck_analysis", {})
    if bottleneck_analysis:
        print(f"Most common bottleneck: {bottleneck_analysis.get('most_common_bottleneck', 'None')}")
    
    # Optimization priorities
    priorities = analysis.get("optimization_priorities", [])
    if priorities:
        print(f"\n💡 Optimization Priorities:")
        for priority in priorities:
            print(f"   • {priority}")
    
    # Best performer
    best_performers = analysis.get("best_performers", {})
    if "overall" in best_performers:
        best = best_performers["overall"]
        print(f"\n🏆 Best Performer: {best['benchmark_id']}")
        print(f"   Score: {best['score']:.1f}/100")
        print(f"   Method: {best['methodology']} ({best['coordination']})")
    
    print(f"\n🎉 Performance Analysis Complete!")
    print("This analysis provides:")
    print("- Real-time system resource monitoring")
    print("- Bottleneck identification and analysis")
    print("- Performance optimization recommendations")
    print("- Resource utilization patterns")
    print("- Comparative performance insights")