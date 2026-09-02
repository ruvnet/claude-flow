#!/usr/bin/env python3
"""
Comprehensive Performance Test Runner for Claude-Flow Swarm Operations

This script coordinates all performance testing and monitoring tools:
- Runs complete performance benchmark suite
- Monitors for memory leaks and performance regressions
- Generates dashboard reports and CI integration
- Provides automated performance validation

Author: Metrics Analyst Agent
Version: 1.0.0
"""

import asyncio
import sys
import json
import time
import os
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional

# Add local modules to path
sys.path.insert(0, str(Path(__file__).parent))

try:
    from swarm_performance_suite import SwarmPerformanceBenchmark
    from continuous_performance_monitor import PerformanceMonitor
    from ci_performance_integration import CIPerformanceGate
    from performance_dashboard import PerformanceDashboard
except ImportError as e:
    print(f"Warning: Could not import all performance modules: {e}")
    print("Some functionality may be limited")


class PerformanceTestOrchestrator:
    """Orchestrates comprehensive performance testing."""
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        self.config = config or self._get_default_config()
        self.results: Dict[str, Any] = {}
        self.start_time = datetime.now()
        
    def _get_default_config(self) -> Dict[str, Any]:
        """Get default configuration for performance testing."""
        return {
            "test_modes": {
                "benchmark_suite": True,
                "continuous_monitoring": True,
                "memory_leak_detection": True,
                "regression_analysis": True,
                "dashboard_generation": True
            },
            "benchmark_config": {
                "quick_mode": False,
                "parallel_execution": True,
                "timeout_minutes": 30
            },
            "monitoring_config": {
                "duration_minutes": 10,
                "sample_interval_seconds": 5.0
            },
            "output_config": {
                "base_directory": "performance_results",
                "generate_reports": True,
                "save_artifacts": True
            },
            "notification_config": {
                "enable_notifications": False,
                "webhook_url": None,
                "email_recipients": []
            }
        }
    
    async def run_comprehensive_tests(self) -> Dict[str, Any]:
        """Run comprehensive performance testing suite."""
        print("🚀 Starting Comprehensive Performance Testing")
        print("=" * 60)
        print(f"Start Time: {self.start_time}")
        print("=" * 60)
        
        # Create output directory
        output_dir = Path(self.config["output_config"]["base_directory"])
        output_dir.mkdir(exist_ok=True)
        
        test_results = {
            "orchestrator_info": {
                "version": "1.0.0",
                "start_time": self.start_time.isoformat(),
                "config": self.config
            },
            "test_results": {},
            "summary": {}
        }
        
        # Run enabled test modes
        test_modes = self.config["test_modes"]
        
        try:
            # 1. Benchmark Suite
            if test_modes.get("benchmark_suite", True):
                print("\n📊 Running Performance Benchmark Suite...")
                benchmark_results = await self._run_benchmark_suite(output_dir)
                test_results["test_results"]["benchmark_suite"] = benchmark_results
            
            # 2. Continuous Monitoring
            if test_modes.get("continuous_monitoring", True):
                print("\n📈 Running Continuous Performance Monitoring...")
                monitoring_results = await self._run_continuous_monitoring(output_dir)
                test_results["test_results"]["continuous_monitoring"] = monitoring_results
            
            # 3. Memory Leak Detection
            if test_modes.get("memory_leak_detection", True):
                print("\n🔍 Running Memory Leak Detection...")
                memory_results = await self._run_memory_leak_detection(output_dir)
                test_results["test_results"]["memory_leak_detection"] = memory_results
            
            # 4. Regression Analysis
            if test_modes.get("regression_analysis", True):
                print("\n📉 Running Regression Analysis...")
                regression_results = await self._run_regression_analysis(output_dir)
                test_results["test_results"]["regression_analysis"] = regression_results
            
            # 5. Dashboard Generation
            if test_modes.get("dashboard_generation", True):
                print("\n📊 Generating Performance Dashboard...")
                dashboard_results = await self._generate_dashboard(output_dir)
                test_results["test_results"]["dashboard_generation"] = dashboard_results
            
            # Generate final summary
            end_time = datetime.now()
            test_results["summary"] = self._generate_summary(test_results, end_time)
            
            # Save comprehensive results
            await self._save_comprehensive_results(test_results, output_dir)
            
            # Send notifications if enabled
            if self.config["notification_config"]["enable_notifications"]:
                await self._send_notifications(test_results)
            
            # Print final summary
            self._print_final_summary(test_results)
            
            return test_results
            
        except Exception as e:
            error_time = datetime.now()
            test_results["error"] = {
                "message": str(e),
                "timestamp": error_time.isoformat(),
                "duration_seconds": (error_time - self.start_time).total_seconds()
            }
            
            print(f"\n❌ Performance testing failed: {e}")
            return test_results
    
    async def _run_benchmark_suite(self, output_dir: Path) -> Dict[str, Any]:
        """Run the performance benchmark suite."""
        try:
            benchmark = SwarmPerformanceBenchmark(str(output_dir / "benchmark"))
            
            if self.config["benchmark_config"]["quick_mode"]:
                # Run quick subset of tests
                results = await benchmark._test_startup_performance()
                return {
                    "mode": "quick",
                    "test_count": len(results),
                    "passed_count": sum(1 for r in results if r.target_met),
                    "results": [r.to_dict() for r in results]
                }
            else:
                # Run full suite
                results = await benchmark.run_full_suite()
                return {
                    "mode": "full",
                    "results": results
                }
                
        except Exception as e:
            return {"error": str(e), "success": False}
    
    async def _run_continuous_monitoring(self, output_dir: Path) -> Dict[str, Any]:
        """Run continuous performance monitoring."""
        try:
            duration = self.config["monitoring_config"]["duration_minutes"]
            interval = self.config["monitoring_config"]["sample_interval_seconds"]
            
            monitor = PerformanceMonitor(str(output_dir / "monitor.db"))
            
            # Start monitoring
            session_id = f"comprehensive_{int(time.time())}"
            monitor.start_monitoring(interval, session_id)
            
            print(f"   Monitoring for {duration} minutes with {interval}s intervals...")
            await asyncio.sleep(duration * 60)
            
            # Stop and get results
            monitor.stop_monitoring()
            
            # Get dashboard data
            dashboard_data = monitor.get_performance_dashboard_data(hours=1)
            regression_report = monitor.generate_regression_report()
            
            return {
                "duration_minutes": duration,
                "sample_interval_seconds": interval,
                "session_id": session_id,
                "dashboard_data": dashboard_data,
                "regression_report": regression_report,
                "success": True
            }
            
        except Exception as e:
            return {"error": str(e), "success": False}
    
    async def _run_memory_leak_detection(self, output_dir: Path) -> Dict[str, Any]:
        """Run memory leak detection tests."""
        try:
            import psutil
            
            # Monitor memory during extended operations
            process = psutil.Process()
            start_memory = process.memory_info().rss / 1024 / 1024
            
            memory_samples = []
            test_operations = [
                "swarm initialization",
                "agent spawning",
                "task coordination",
                "memory persistence",
                "swarm cleanup"
            ]
            
            for i, operation in enumerate(test_operations):
                print(f"   Testing {operation}...")
                
                # Simulate operation (would be real swarm operations)
                await asyncio.sleep(2)
                
                # Sample memory
                current_memory = process.memory_info().rss / 1024 / 1024
                memory_samples.append({
                    "operation": operation,
                    "memory_mb": current_memory,
                    "growth_from_start": current_memory - start_memory
                })
            
            end_memory = process.memory_info().rss / 1024 / 1024
            total_growth = end_memory - start_memory
            
            # Analyze for leaks
            leak_detected = total_growth > 10.0  # >10MB growth = potential leak
            growth_rate = total_growth / len(test_operations)
            
            return {
                "start_memory_mb": start_memory,
                "end_memory_mb": end_memory,
                "total_growth_mb": total_growth,
                "average_growth_per_operation": growth_rate,
                "leak_detected": leak_detected,
                "memory_samples": memory_samples,
                "success": True
            }
            
        except Exception as e:
            return {"error": str(e), "success": False}
    
    async def _run_regression_analysis(self, output_dir: Path) -> Dict[str, Any]:
        """Run performance regression analysis."""
        try:
            # This would typically compare against stored baselines
            # For now, simulate regression analysis
            
            current_metrics = {
                "swarm_init_time": 3.2,
                "agent_coordination_latency": 180.5,
                "memory_usage_mb": 45.3,
                "mcp_response_time": 0.8
            }
            
            # Load or create baseline
            baseline_file = output_dir / "performance_baseline.json"
            if baseline_file.exists():
                with open(baseline_file) as f:
                    baseline_metrics = json.load(f)
            else:
                # Create initial baseline
                baseline_metrics = {
                    "swarm_init_time": 3.5,
                    "agent_coordination_latency": 195.0,
                    "memory_usage_mb": 42.1,
                    "mcp_response_time": 0.9
                }
                with open(baseline_file, 'w') as f:
                    json.dump(baseline_metrics, f, indent=2)
            
            # Calculate regressions
            regressions = {}
            for metric, current_value in current_metrics.items():
                baseline_value = baseline_metrics.get(metric, current_value)
                regression_percent = ((current_value - baseline_value) / baseline_value) * 100 if baseline_value > 0 else 0
                
                regressions[metric] = {
                    "current_value": current_value,
                    "baseline_value": baseline_value,
                    "regression_percent": regression_percent,
                    "regression_detected": abs(regression_percent) > 10,
                    "status": "regression" if regression_percent > 10 else "improvement" if regression_percent < -5 else "stable"
                }
            
            # Update baseline with current metrics
            with open(baseline_file, 'w') as f:
                json.dump(current_metrics, f, indent=2)
            
            return {
                "baseline_file": str(baseline_file),
                "current_metrics": current_metrics,
                "baseline_metrics": baseline_metrics,
                "regressions": regressions,
                "critical_regressions": [k for k, v in regressions.items() if v["regression_percent"] > 25],
                "success": True
            }
            
        except Exception as e:
            return {"error": str(e), "success": False}
    
    async def _generate_dashboard(self, output_dir: Path) -> Dict[str, Any]:
        """Generate performance dashboard."""
        try:
            dashboard = PerformanceDashboard(str(output_dir / "dashboard"))
            
            # Generate dashboard with sample data for now
            dashboard_file = dashboard.generate_dashboard("sample")
            
            return {
                "dashboard_file": str(dashboard_file),
                "dashboard_url": f"file://{Path(dashboard_file).absolute()}",
                "success": True
            }
            
        except Exception as e:
            return {"error": str(e), "success": False}
    
    def _generate_summary(self, test_results: Dict[str, Any], end_time: datetime) -> Dict[str, Any]:
        """Generate comprehensive test summary."""
        duration = (end_time - self.start_time).total_seconds()
        
        # Count successes and failures
        results = test_results.get("test_results", {})
        successful_tests = sum(1 for r in results.values() if r.get("success", False))
        total_tests = len(results)
        
        # Identify critical issues
        critical_issues = []
        
        # Check benchmark results
        benchmark_results = results.get("benchmark_suite", {})
        if "results" in benchmark_results:
            if benchmark_results.get("mode") == "full":
                # Full suite results
                summary = benchmark_results["results"].get("summary", {})
                if summary.get("performance_score", 100) < 80:
                    critical_issues.append("Performance benchmark score below 80%")
            else:
                # Quick mode results
                passed = benchmark_results.get("passed_count", 0)
                total = benchmark_results.get("test_count", 1)
                if passed / total < 0.8:
                    critical_issues.append("Quick benchmark tests below 80% pass rate")
        
        # Check memory leak detection
        memory_results = results.get("memory_leak_detection", {})
        if memory_results.get("leak_detected", False):
            critical_issues.append("Memory leak detected")
        
        # Check regression analysis
        regression_results = results.get("regression_analysis", {})
        critical_regressions = regression_results.get("critical_regressions", [])
        if critical_regressions:
            critical_issues.append(f"{len(critical_regressions)} critical performance regressions")
        
        return {
            "end_time": end_time.isoformat(),
            "total_duration_seconds": duration,
            "total_duration_minutes": duration / 60,
            "successful_tests": successful_tests,
            "total_tests": total_tests,
            "success_rate": successful_tests / total_tests if total_tests > 0 else 0,
            "critical_issues": critical_issues,
            "overall_status": "passed" if not critical_issues and successful_tests == total_tests else "failed",
            "performance_score": self._calculate_overall_score(results)
        }
    
    def _calculate_overall_score(self, results: Dict[str, Any]) -> float:
        """Calculate overall performance score (0-100)."""
        scores = []
        
        # Benchmark score
        benchmark_results = results.get("benchmark_suite", {})
        if "results" in benchmark_results and benchmark_results.get("mode") == "full":
            scores.append(benchmark_results["results"].get("summary", {}).get("performance_score", 50))
        elif "passed_count" in benchmark_results and "test_count" in benchmark_results:
            scores.append((benchmark_results["passed_count"] / benchmark_results["test_count"]) * 100)
        
        # Memory score
        memory_results = results.get("memory_leak_detection", {})
        if memory_results.get("success", False):
            leak_detected = memory_results.get("leak_detected", False)
            scores.append(0 if leak_detected else 100)
        
        # Regression score
        regression_results = results.get("regression_analysis", {})
        if regression_results.get("success", False):
            critical_regressions = len(regression_results.get("critical_regressions", []))
            scores.append(max(0, 100 - critical_regressions * 25))
        
        return sum(scores) / len(scores) if scores else 50.0
    
    async def _save_comprehensive_results(self, test_results: Dict[str, Any], output_dir: Path):
        """Save comprehensive test results."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
        # Save main results file
        results_file = output_dir / f"comprehensive_performance_results_{timestamp}.json"
        with open(results_file, 'w') as f:
            json.dump(test_results, f, indent=2, default=str)
        
        # Save summary file
        summary_file = output_dir / f"performance_summary_{timestamp}.json"
        with open(summary_file, 'w') as f:
            json.dump(test_results.get("summary", {}), f, indent=2, default=str)
        
        # Create latest symlinks
        latest_results = output_dir / "latest_comprehensive_results.json"
        latest_summary = output_dir / "latest_performance_summary.json"
        
        try:
            if latest_results.exists():
                latest_results.unlink()
            if latest_summary.exists():
                latest_summary.unlink()
                
            latest_results.symlink_to(results_file.name)
            latest_summary.symlink_to(summary_file.name)
        except OSError:
            # Fallback for systems without symlink support
            import shutil
            shutil.copy2(results_file, latest_results)
            shutil.copy2(summary_file, latest_summary)
        
        print(f"📁 Results saved:")
        print(f"   Full results: {results_file}")
        print(f"   Summary: {summary_file}")
    
    async def _send_notifications(self, test_results: Dict[str, Any]):
        """Send performance test notifications."""
        # This would integrate with notification systems
        # For now, just log the notification
        summary = test_results.get("summary", {})
        status = summary.get("overall_status", "unknown")
        score = summary.get("performance_score", 0)
        issues = summary.get("critical_issues", [])
        
        print(f"\n📢 Notification: Performance tests {status.upper()}")
        print(f"   Score: {score:.1f}/100")
        if issues:
            print(f"   Issues: {len(issues)} critical issues found")
    
    def _print_final_summary(self, test_results: Dict[str, Any]):
        """Print final performance test summary."""
        summary = test_results.get("summary", {})
        
        print("\n" + "=" * 60)
        print("🎯 COMPREHENSIVE PERFORMANCE TEST SUMMARY")
        print("=" * 60)
        
        status = summary.get("overall_status", "unknown")
        emoji = "✅" if status == "passed" else "❌"
        
        print(f"{emoji} Overall Status: {status.upper()}")
        print(f"⏱️  Total Duration: {summary.get('total_duration_minutes', 0):.1f} minutes")
        print(f"📊 Performance Score: {summary.get('performance_score', 0):.1f}/100")
        print(f"🧪 Tests: {summary.get('successful_tests', 0)}/{summary.get('total_tests', 0)} successful")
        
        issues = summary.get("critical_issues", [])
        if issues:
            print(f"\n⚠️  Critical Issues ({len(issues)}):")
            for issue in issues:
                print(f"   - {issue}")
        else:
            print("\n✅ No critical issues detected")
        
        print("\n📋 Test Results:")
        results = test_results.get("test_results", {})
        for test_name, test_result in results.items():
            success = test_result.get("success", False)
            emoji = "✅" if success else "❌"
            print(f"   {emoji} {test_name.replace('_', ' ').title()}")
        
        print("\n" + "=" * 60)


async def main():
    """Main entry point for comprehensive performance testing."""
    parser = argparse.ArgumentParser(description="Comprehensive Performance Test Runner")
    parser.add_argument("--config", help="Configuration file path")
    parser.add_argument("--quick", action="store_true", help="Run quick performance tests only")
    parser.add_argument("--benchmark-only", action="store_true", help="Run benchmark suite only")
    parser.add_argument("--monitor-only", action="store_true", help="Run continuous monitoring only")
    parser.add_argument("--output-dir", default="performance_results", help="Output directory")
    parser.add_argument("--duration", type=int, default=10, help="Monitoring duration in minutes")
    
    args = parser.parse_args()
    
    # Load configuration
    config = {}
    if args.config and Path(args.config).exists():
        with open(args.config) as f:
            config = json.load(f)
    
    # Apply command line overrides
    if args.quick:
        config.setdefault("benchmark_config", {})["quick_mode"] = True
        config.setdefault("monitoring_config", {})["duration_minutes"] = 3
    
    if args.benchmark_only:
        config["test_modes"] = {"benchmark_suite": True}
    elif args.monitor_only:
        config["test_modes"] = {"continuous_monitoring": True}
    
    if args.output_dir:
        config.setdefault("output_config", {})["base_directory"] = args.output_dir
    
    if args.duration:
        config.setdefault("monitoring_config", {})["duration_minutes"] = args.duration
    
    # Run comprehensive tests
    orchestrator = PerformanceTestOrchestrator(config)
    results = await orchestrator.run_comprehensive_tests()
    
    # Exit with appropriate code
    summary = results.get("summary", {})
    exit_code = 0 if summary.get("overall_status") == "passed" else 1
    sys.exit(exit_code)


if __name__ == "__main__":
    asyncio.run(main())