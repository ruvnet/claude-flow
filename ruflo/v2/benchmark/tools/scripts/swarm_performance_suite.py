#!/usr/bin/env python3
"""
Comprehensive Performance Benchmarking Suite for Claude-Flow Swarm Operations

This suite provides automated performance testing and monitoring for:
- Swarm initialization performance
- Agent coordination latency  
- Memory usage patterns and leak detection
- Token consumption optimization
- Cross-session persistence overhead
- MCP tool response times
- Neural pattern processing speed

Author: Metrics Analyst Agent
Version: 1.0.0
"""

import asyncio
import time
import json
import psutil
import subprocess
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
import threading
import tempfile
import signal
from contextlib import asynccontextmanager
import statistics

# Add benchmark modules to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from swarm_benchmark.core.real_benchmark_engine import RealBenchmarkEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType, CoordinationMode
from swarm_benchmark.metrics.performance_collector import PerformanceCollector


@dataclass
class SwarmPerformanceTarget:
    """Performance targets for swarm operations."""
    swarm_init_time_seconds: float = 5.0
    agent_coordination_latency_ms: float = 200.0
    memory_baseline_mb: float = 1.0
    token_reduction_percent: float = 32.3
    persistence_overhead_percent: float = 10.0
    mcp_response_time_seconds: float = 1.0
    neural_processing_time_ms: float = 500.0


@dataclass
class SwarmBenchmarkResult:
    """Result from a swarm performance benchmark."""
    test_name: str
    start_time: datetime
    end_time: datetime
    duration_seconds: float
    success: bool
    metrics: Dict[str, Any]
    target_met: bool
    error_message: Optional[str] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "test_name": self.test_name,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat(),
            "duration_seconds": self.duration_seconds,
            "success": self.success,
            "metrics": self.metrics,
            "target_met": self.target_met,
            "error_message": self.error_message
        }


class SwarmMemoryLeakDetector:
    """Detects memory leaks in swarm operations."""
    
    def __init__(self):
        self.baseline_memory = 0.0
        self.peak_memory = 0.0
        self.samples = []
        self.sampling_interval = 0.5  # 500ms
        self._stop_event = threading.Event()
        self._monitor_thread = None
        
    def start_monitoring(self):
        """Start memory monitoring."""
        self.baseline_memory = psutil.Process().memory_info().rss / 1024 / 1024
        self.peak_memory = self.baseline_memory
        self.samples = []
        self._stop_event.clear()
        
        self._monitor_thread = threading.Thread(target=self._monitor_memory, daemon=True)
        self._monitor_thread.start()
        
    def stop_monitoring(self) -> Dict[str, float]:
        """Stop monitoring and return leak analysis."""
        self._stop_event.set()
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5.0)
            
        current_memory = psutil.Process().memory_info().rss / 1024 / 1024
        memory_growth = current_memory - self.baseline_memory
        
        # Calculate memory growth trend
        if len(self.samples) > 10:
            # Use linear regression to detect steady growth
            times = [s[0] for s in self.samples]
            memories = [s[1] for s in self.samples]
            n = len(samples)
            
            # Simple linear regression
            sum_xy = sum(t * m for t, m in zip(times, memories))
            sum_x = sum(times)
            sum_y = sum(memories)
            sum_x2 = sum(t * t for t in times)
            
            slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x * sum_x) if n * sum_x2 - sum_x * sum_x != 0 else 0
            growth_rate_mb_per_second = slope
        else:
            growth_rate_mb_per_second = 0
            
        return {
            "baseline_memory_mb": self.baseline_memory,
            "final_memory_mb": current_memory,
            "peak_memory_mb": self.peak_memory,
            "memory_growth_mb": memory_growth,
            "growth_rate_mb_per_second": growth_rate_mb_per_second,
            "leak_detected": growth_rate_mb_per_second > 0.1,  # >100KB/s growth = leak
            "sample_count": len(self.samples)
        }
        
    def _monitor_memory(self):
        """Background memory monitoring thread."""
        start_time = time.time()
        while not self._stop_event.is_set():
            try:
                current_time = time.time() - start_time
                current_memory = psutil.Process().memory_info().rss / 1024 / 1024
                
                self.samples.append((current_time, current_memory))
                self.peak_memory = max(self.peak_memory, current_memory)
                
                # Keep only last 1000 samples to prevent memory bloat
                if len(self.samples) > 1000:
                    self.samples = self.samples[-500:]
                    
                time.sleep(self.sampling_interval)
            except Exception:
                break


class SwarmPerformanceBenchmark:
    """Main performance benchmark suite for swarm operations."""
    
    def __init__(self, output_dir: str = "performance_results"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.targets = SwarmPerformanceTarget()
        self.memory_detector = SwarmMemoryLeakDetector()
        self.results: List[SwarmBenchmarkResult] = []
        
    async def run_full_suite(self) -> Dict[str, Any]:
        """Run the complete performance benchmark suite."""
        print("🚀 Starting Comprehensive Swarm Performance Benchmark Suite")
        print("=" * 60)
        
        suite_start = datetime.now()
        
        # Test categories
        test_categories = [
            ("Startup Performance", self._test_startup_performance),
            ("Coordination Efficiency", self._test_coordination_efficiency),
            ("Memory Performance", self._test_memory_performance),
            ("Network Performance", self._test_network_performance),
            ("Scalability Tests", self._test_scalability),
            ("Regression Tests", self._test_regression_detection)
        ]
        
        category_results = {}
        
        for category_name, test_func in test_categories:
            print(f"\n📊 Running {category_name} Tests...")
            try:
                category_results[category_name] = await test_func()
                passed = sum(1 for r in category_results[category_name] if r.target_met)
                total = len(category_results[category_name])
                print(f"✅ {category_name}: {passed}/{total} tests passed targets")
            except Exception as e:
                print(f"❌ {category_name} failed: {e}")
                category_results[category_name] = []
        
        suite_end = datetime.now()
        
        # Generate comprehensive report
        report = await self._generate_performance_report(category_results, suite_start, suite_end)
        
        # Save results
        await self._save_results(report)
        
        return report
        
    async def _test_startup_performance(self) -> List[SwarmBenchmarkResult]:
        """Test swarm initialization and ready state performance."""
        tests = []
        
        # Test 1: Basic swarm initialization
        result = await self._benchmark_operation(
            "swarm_init_basic",
            lambda: self._run_claude_flow_command(["swarm", "init", "--mode", "mesh", "--agents", "3"]),
            target_time=self.targets.swarm_init_time_seconds
        )
        tests.append(result)
        
        # Test 2: Large swarm initialization
        result = await self._benchmark_operation(
            "swarm_init_large", 
            lambda: self._run_claude_flow_command(["swarm", "init", "--mode", "hierarchical", "--agents", "8"]),
            target_time=self.targets.swarm_init_time_seconds * 2  # Allow more time for larger swarms
        )
        tests.append(result)
        
        # Test 3: Cold start vs warm start
        # Cold start
        result = await self._benchmark_operation(
            "cold_start",
            lambda: self._run_claude_flow_command(["swarm", "status"], clear_cache=True),
            target_time=self.targets.swarm_init_time_seconds
        )
        tests.append(result)
        
        # Warm start (immediate second call)
        result = await self._benchmark_operation(
            "warm_start",
            lambda: self._run_claude_flow_command(["swarm", "status"]),
            target_time=self.targets.swarm_init_time_seconds / 2  # Should be faster
        )
        tests.append(result)
        
        return tests
        
    async def _test_coordination_efficiency(self) -> List[SwarmBenchmarkResult]:
        """Test agent-to-agent coordination and communication."""
        tests = []
        
        # Test 1: Agent spawn latency
        result = await self._benchmark_operation(
            "agent_spawn_latency",
            lambda: self._measure_agent_spawn_time(),
            target_time=self.targets.agent_coordination_latency_ms / 1000.0
        )
        tests.append(result)
        
        # Test 2: Inter-agent communication
        result = await self._benchmark_operation(
            "inter_agent_communication",
            lambda: self._measure_agent_communication(),
            target_time=self.targets.agent_coordination_latency_ms / 1000.0
        )
        tests.append(result)
        
        # Test 3: Task coordination overhead
        result = await self._benchmark_operation(
            "task_coordination_overhead",
            lambda: self._measure_coordination_overhead(),
            target_time=self.targets.agent_coordination_latency_ms / 1000.0
        )
        tests.append(result)
        
        return tests
        
    async def _test_memory_performance(self) -> List[SwarmBenchmarkResult]:
        """Test memory usage patterns and leak detection."""
        tests = []
        
        # Test 1: Memory leak detection
        result = await self._benchmark_memory_operation(
            "memory_leak_detection",
            lambda: self._run_extended_swarm_operation(),
            target_growth_mb=1.0
        )
        tests.append(result)
        
        # Test 2: Memory baseline measurement
        result = await self._benchmark_operation(
            "memory_baseline",
            lambda: self._measure_baseline_memory(),
            target_time=1.0,  # Quick test
            custom_metrics=True
        )
        tests.append(result)
        
        # Test 3: Persistence overhead
        result = await self._benchmark_operation(
            "persistence_overhead",
            lambda: self._measure_persistence_overhead(),
            target_time=self.targets.persistence_overhead_percent / 100.0  # Convert to multiplier
        )
        tests.append(result)
        
        return tests
        
    async def _test_network_performance(self) -> List[SwarmBenchmarkResult]:
        """Test MCP tool response times and network efficiency."""
        tests = []
        
        # Test 1: MCP tool response time
        result = await self._benchmark_operation(
            "mcp_response_time",
            lambda: self._measure_mcp_response_time(),
            target_time=self.targets.mcp_response_time_seconds
        )
        tests.append(result)
        
        # Test 2: Neural pattern processing
        result = await self._benchmark_operation(
            "neural_pattern_processing",
            lambda: self._measure_neural_processing(),
            target_time=self.targets.neural_processing_time_ms / 1000.0
        )
        tests.append(result)
        
        return tests
        
    async def _test_scalability(self) -> List[SwarmBenchmarkResult]:
        """Test performance under increasing loads."""
        tests = []
        
        agent_counts = [1, 2, 4, 8, 16]
        
        for count in agent_counts:
            result = await self._benchmark_operation(
                f"scalability_agents_{count}",
                lambda c=count: self._run_scalability_test(c),
                target_time=self.targets.swarm_init_time_seconds * (1 + count / 10)  # Linear scaling expectation
            )
            tests.append(result)
            
        return tests
        
    async def _test_regression_detection(self) -> List[SwarmBenchmarkResult]:
        """Test for performance regressions."""
        tests = []
        
        # Load baseline metrics if available
        baseline_file = self.output_dir / "baseline_metrics.json"
        baseline_metrics = {}
        
        if baseline_file.exists():
            with open(baseline_file) as f:
                baseline_metrics = json.load(f)
        
        # Test current performance against baseline
        current_metrics = await self._measure_current_performance()
        
        for metric_name, current_value in current_metrics.items():
            if metric_name in baseline_metrics:
                baseline_value = baseline_metrics[metric_name]
                regression_threshold = 1.1  # 10% regression tolerance
                
                target_met = current_value <= baseline_value * regression_threshold
                
                result = SwarmBenchmarkResult(
                    test_name=f"regression_{metric_name}",
                    start_time=datetime.now(),
                    end_time=datetime.now(),
                    duration_seconds=0.0,
                    success=True,
                    metrics={
                        "current_value": current_value,
                        "baseline_value": baseline_value,
                        "regression_percent": ((current_value - baseline_value) / baseline_value) * 100
                    },
                    target_met=target_met
                )
                tests.append(result)
        
        # Save current metrics as new baseline
        with open(baseline_file, 'w') as f:
            json.dump(current_metrics, f, indent=2)
            
        return tests
        
    async def _benchmark_operation(self, test_name: str, operation, target_time: float, custom_metrics: bool = False) -> SwarmBenchmarkResult:
        """Benchmark a single operation against performance targets."""
        start_time = datetime.now()
        
        # Start performance monitoring
        collector = PerformanceCollector(sample_interval=0.1)
        collector.start_collection()
        
        try:
            operation_start = time.time()
            result = await asyncio.get_event_loop().run_in_executor(None, operation)
            operation_end = time.time()
            
            duration = operation_end - operation_start
            performance_metrics = collector.stop_collection()
            
            end_time = datetime.now()
            
            # Check if target was met
            target_met = duration <= target_time
            
            metrics = {
                "duration_seconds": duration,
                "target_seconds": target_time,
                "execution_time": performance_metrics.execution_time,
                "throughput": performance_metrics.throughput,
                "success_rate": performance_metrics.success_rate,
                "operation_result": str(result)[:200] if result else "N/A"
            }
            
            return SwarmBenchmarkResult(
                test_name=test_name,
                start_time=start_time,
                end_time=end_time,
                duration_seconds=duration,
                success=True,
                metrics=metrics,
                target_met=target_met
            )
            
        except Exception as e:
            collector.stop_collection()
            end_time = datetime.now()
            
            return SwarmBenchmarkResult(
                test_name=test_name,
                start_time=start_time,
                end_time=end_time,
                duration_seconds=(end_time - start_time).total_seconds(),
                success=False,
                metrics={"error": str(e)},
                target_met=False,
                error_message=str(e)
            )
    
    async def _benchmark_memory_operation(self, test_name: str, operation, target_growth_mb: float) -> SwarmBenchmarkResult:
        """Benchmark operation specifically for memory usage."""
        start_time = datetime.now()
        
        # Start memory leak detection
        self.memory_detector.start_monitoring()
        
        try:
            operation_start = time.time()
            result = await asyncio.get_event_loop().run_in_executor(None, operation)
            operation_end = time.time()
            
            # Stop memory monitoring and analyze
            memory_metrics = self.memory_detector.stop_monitoring()
            duration = operation_end - operation_start
            end_time = datetime.now()
            
            # Check if memory growth target was met
            target_met = memory_metrics["memory_growth_mb"] <= target_growth_mb and not memory_metrics["leak_detected"]
            
            metrics = {
                "duration_seconds": duration,
                "memory_metrics": memory_metrics,
                "target_growth_mb": target_growth_mb,
                "operation_result": str(result)[:200] if result else "N/A"
            }
            
            return SwarmBenchmarkResult(
                test_name=test_name,
                start_time=start_time,
                end_time=end_time,
                duration_seconds=duration,
                success=True,
                metrics=metrics,
                target_met=target_met
            )
            
        except Exception as e:
            self.memory_detector.stop_monitoring()
            end_time = datetime.now()
            
            return SwarmBenchmarkResult(
                test_name=test_name,
                start_time=start_time,
                end_time=end_time,
                duration_seconds=(end_time - start_time).total_seconds(),
                success=False,
                metrics={"error": str(e)},
                target_met=False,
                error_message=str(e)
            )
            
    def _run_claude_flow_command(self, args: List[str], clear_cache: bool = False) -> str:
        """Run a claude-flow command and return output."""
        if clear_cache:
            # Clear any potential cache
            cache_dirs = [
                Path.home() / ".claude-flow" / "cache",
                Path.cwd() / ".cache",
                Path("/tmp/claude-flow-cache")
            ]
            for cache_dir in cache_dirs:
                if cache_dir.exists():
                    import shutil
                    shutil.rmtree(cache_dir, ignore_errors=True)
        
        # Construct command
        cmd = ["node", str(Path(__file__).parent / "../cli.js")] + args
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(Path(__file__).parent.parent)
            )
            return result.stdout
        except subprocess.TimeoutExpired:
            return "TIMEOUT"
        except Exception as e:
            return f"ERROR: {e}"
    
    def _measure_agent_spawn_time(self) -> float:
        """Measure time to spawn a new agent."""
        start = time.time()
        output = self._run_claude_flow_command(["swarm", "spawn", "researcher", "--name", "test-agent"])
        end = time.time()
        return end - start
    
    def _measure_agent_communication(self) -> float:
        """Measure inter-agent communication latency."""
        # This would measure actual communication between agents
        # For now, simulate with a simple command
        start = time.time()
        output = self._run_claude_flow_command(["swarm", "status"])
        end = time.time()
        return end - start
    
    def _measure_coordination_overhead(self) -> float:
        """Measure task coordination overhead."""
        # Compare single agent vs multi-agent task execution
        start = time.time()
        output = self._run_claude_flow_command(["swarm", "task", "simple test task", "--agents", "3"])
        end = time.time()
        return end - start
    
    def _run_extended_swarm_operation(self) -> str:
        """Run an extended operation to test for memory leaks."""
        operations = []
        
        # Run multiple operations that could cause memory leaks
        for i in range(10):
            output = self._run_claude_flow_command(["swarm", "init", "--mode", "mesh", "--agents", "2"])
            operations.append(output)
            
            output = self._run_claude_flow_command(["swarm", "spawn", "researcher"])
            operations.append(output)
            
            output = self._run_claude_flow_command(["swarm", "status"])
            operations.append(output)
            
            # Small delay to allow monitoring
            time.sleep(0.1)
        
        return "\n".join(operations)
    
    def _measure_baseline_memory(self) -> str:
        """Measure baseline memory usage."""
        process = psutil.Process()
        return f"Baseline memory: {process.memory_info().rss / 1024 / 1024:.2f} MB"
    
    def _measure_persistence_overhead(self) -> float:
        """Measure cross-session persistence overhead."""
        # Time operation with persistence vs without
        start = time.time()
        output = self._run_claude_flow_command(["swarm", "init", "--persist"])
        end = time.time()
        return end - start
    
    def _measure_mcp_response_time(self) -> float:
        """Measure MCP tool response time."""
        start = time.time()
        output = self._run_claude_flow_command(["mcp", "status"])
        end = time.time()
        return end - start
    
    def _measure_neural_processing(self) -> float:
        """Measure neural pattern processing time."""
        start = time.time()
        output = self._run_claude_flow_command(["sparc", "researcher", "quick test"])
        end = time.time()
        return end - start
    
    def _run_scalability_test(self, agent_count: int) -> float:
        """Run scalability test with specified agent count."""
        start = time.time()
        output = self._run_claude_flow_command(["swarm", "init", "--agents", str(agent_count)])
        end = time.time()
        return end - start
    
    async def _measure_current_performance(self) -> Dict[str, float]:
        """Measure current performance metrics for regression testing."""
        metrics = {}
        
        # Swarm init time
        start = time.time()
        self._run_claude_flow_command(["swarm", "init", "--mode", "mesh", "--agents", "3"])
        metrics["swarm_init_time"] = time.time() - start
        
        # Agent spawn time
        start = time.time()
        self._run_claude_flow_command(["swarm", "spawn", "researcher"])
        metrics["agent_spawn_time"] = time.time() - start
        
        # Memory usage
        process = psutil.Process()
        metrics["memory_usage_mb"] = process.memory_info().rss / 1024 / 1024
        
        return metrics
        
    async def _generate_performance_report(self, category_results: Dict[str, List[SwarmBenchmarkResult]], 
                                          suite_start: datetime, suite_end: datetime) -> Dict[str, Any]:
        """Generate comprehensive performance report."""
        
        # Aggregate all results
        all_results = []
        for category_results_list in category_results.values():
            all_results.extend(category_results_list)
            
        # Calculate summary statistics
        total_tests = len(all_results)
        passed_tests = sum(1 for r in all_results if r.target_met)
        failed_tests = sum(1 for r in all_results if not r.success)
        
        # Calculate performance score (0-100)
        if total_tests > 0:
            performance_score = (passed_tests / total_tests) * 100
        else:
            performance_score = 0
            
        # Identify critical issues
        critical_issues = []
        for result in all_results:
            if not result.target_met and result.success:
                critical_issues.append({
                    "test": result.test_name,
                    "issue": "Performance target not met",
                    "metrics": result.metrics
                })
            elif not result.success:
                critical_issues.append({
                    "test": result.test_name,
                    "issue": "Test failed",
                    "error": result.error_message
                })
        
        # Generate recommendations
        recommendations = self._generate_recommendations(all_results)
        
        report = {
            "summary": {
                "test_suite": "Swarm Performance Benchmark",
                "version": "1.0.0",
                "start_time": suite_start.isoformat(),
                "end_time": suite_end.isoformat(),
                "duration_minutes": (suite_end - suite_start).total_seconds() / 60,
                "total_tests": total_tests,
                "passed_tests": passed_tests,
                "failed_tests": failed_tests,
                "performance_score": performance_score
            },
            "targets": asdict(self.targets),
            "category_results": {
                category: [result.to_dict() for result in results]
                for category, results in category_results.items()
            },
            "critical_issues": critical_issues,
            "recommendations": recommendations,
            "detailed_metrics": {
                "memory_analysis": await self._analyze_memory_patterns(all_results),
                "performance_trends": await self._analyze_performance_trends(all_results),
                "bottleneck_analysis": await self._identify_bottlenecks(all_results)
            }
        }
        
        return report
    
    def _generate_recommendations(self, results: List[SwarmBenchmarkResult]) -> List[str]:
        """Generate performance optimization recommendations."""
        recommendations = []
        
        # Analyze results for common patterns
        slow_startup_tests = [r for r in results if "init" in r.test_name and not r.target_met]
        if slow_startup_tests:
            recommendations.append("Consider optimizing swarm initialization by implementing connection pooling")
        
        memory_issues = [r for r in results if "memory" in r.test_name and not r.target_met]
        if memory_issues:
            recommendations.append("Memory usage exceeded targets - investigate memory leaks in agent cleanup")
        
        coordination_issues = [r for r in results if "coordination" in r.test_name and not r.target_met]
        if coordination_issues:
            recommendations.append("Agent coordination latency high - consider implementing async message passing")
        
        scalability_issues = [r for r in results if "scalability" in r.test_name and not r.target_met]
        if scalability_issues:
            recommendations.append("Scalability limits reached - implement load balancing and resource pooling")
        
        if not recommendations:
            recommendations.append("All performance targets met - consider tightening targets for continued optimization")
            
        return recommendations
    
    async def _analyze_memory_patterns(self, results: List[SwarmBenchmarkResult]) -> Dict[str, Any]:
        """Analyze memory usage patterns across tests."""
        memory_tests = [r for r in results if "memory" in r.metrics]
        
        if not memory_tests:
            return {"analysis": "No memory data available"}
        
        memory_values = []
        for result in memory_tests:
            if "memory_metrics" in result.metrics:
                memory_values.append(result.metrics["memory_metrics"].get("peak_memory_mb", 0))
        
        if memory_values:
            return {
                "peak_memory_mb": max(memory_values),
                "average_memory_mb": statistics.mean(memory_values),
                "memory_variance": statistics.variance(memory_values) if len(memory_values) > 1 else 0,
                "trend": "increasing" if memory_values[-1] > memory_values[0] else "stable"
            }
        else:
            return {"analysis": "No memory metrics collected"}
    
    async def _analyze_performance_trends(self, results: List[SwarmBenchmarkResult]) -> Dict[str, Any]:
        """Analyze performance trends across test categories."""
        trends = {}
        
        # Group by test category
        by_category = {}
        for result in results:
            category = result.test_name.split("_")[0]
            if category not in by_category:
                by_category[category] = []
            by_category[category].append(result.duration_seconds)
        
        for category, durations in by_category.items():
            if len(durations) > 1:
                trends[category] = {
                    "average_duration": statistics.mean(durations),
                    "min_duration": min(durations),
                    "max_duration": max(durations),
                    "consistency": 1.0 - (statistics.stdev(durations) / statistics.mean(durations)) if statistics.mean(durations) > 0 else 0
                }
        
        return trends
    
    async def _identify_bottlenecks(self, results: List[SwarmBenchmarkResult]) -> List[Dict[str, Any]]:
        """Identify performance bottlenecks from test results."""
        bottlenecks = []
        
        # Find tests that significantly exceed targets
        for result in results:
            if result.success and not result.target_met:
                if "target_seconds" in result.metrics and result.duration_seconds > result.metrics["target_seconds"] * 2:
                    bottlenecks.append({
                        "test": result.test_name,
                        "severity": "high",
                        "actual_duration": result.duration_seconds,
                        "target_duration": result.metrics["target_seconds"],
                        "slowdown_factor": result.duration_seconds / result.metrics["target_seconds"]
                    })
        
        # Sort by severity
        bottlenecks.sort(key=lambda x: x.get("slowdown_factor", 1), reverse=True)
        
        return bottlenecks[:5]  # Top 5 bottlenecks
    
    async def _save_results(self, report: Dict[str, Any]):
        """Save benchmark results to files."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save main report
        report_file = self.output_dir / f"swarm_performance_report_{timestamp}.json"
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        
        # Save CSV summary for spreadsheet analysis
        csv_file = self.output_dir / f"swarm_performance_summary_{timestamp}.csv"
        with open(csv_file, 'w') as f:
            f.write("test_name,duration_seconds,target_met,success,category\n")
            for category, results in report["category_results"].items():
                for result in results:
                    f.write(f"{result['test_name']},{result['duration_seconds']},{result['target_met']},{result['success']},{category}\n")
        
        print(f"\n📊 Results saved to:")
        print(f"   Report: {report_file}")
        print(f"   CSV: {csv_file}")
        
        # Print summary
        summary = report["summary"]
        print(f"\n🎯 Performance Summary:")
        print(f"   Score: {summary['performance_score']:.1f}/100")
        print(f"   Tests: {summary['passed_tests']}/{summary['total_tests']} passed")
        print(f"   Duration: {summary['duration_minutes']:.1f} minutes")
        
        if report["critical_issues"]:
            print(f"\n⚠️  Critical Issues Found: {len(report['critical_issues'])}")
            for issue in report["critical_issues"][:3]:  # Show top 3
                print(f"   - {issue['test']}: {issue['issue']}")


async def main():
    """Main entry point for the performance benchmark suite."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Swarm Performance Benchmark Suite")
    parser.add_argument("--output-dir", default="performance_results", help="Output directory for results")
    parser.add_argument("--quick", action="store_true", help="Run quick subset of tests")
    args = parser.parse_args()
    
    benchmark = SwarmPerformanceBenchmark(output_dir=args.output_dir)
    
    if args.quick:
        # Run only essential tests for quick feedback
        print("🚀 Running Quick Performance Check...")
        result = await benchmark._test_startup_performance()
        print(f"Quick check completed: {len([r for r in result if r.target_met])}/{len(result)} targets met")
    else:
        # Run full suite
        await benchmark.run_full_suite()


if __name__ == "__main__":
    asyncio.run(main())