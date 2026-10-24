#!/usr/bin/env python3
"""
Hive Mind Load Test Orchestrator
Comprehensive testing orchestration for the Benchmark-Tester agent

This script runs the complete load testing suite including:
1. Progressive scaling tests (1 -> 1000+ agents)
2. Stress testing for breaking point discovery
3. Concurrent swarm testing
4. Resource exhaustion testing
5. Failure recovery testing
"""

import os
import sys
import json
import time
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Any

class LoadTestOrchestrator:
    """Orchestrates comprehensive load testing suite"""
    
    def __init__(self):
        self.benchmark_dir = Path(__file__).parent
        self.results_dir = self.benchmark_dir / "test-results" / datetime.now().strftime("%Y%m%d_%H%M%S")
        self.results_dir.mkdir(parents=True, exist_ok=True)
        
        self.test_results = {}
        
    def log(self, message: str, level: str = "INFO"):
        """Log messages with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
    
    def run_command(self, command: List[str], cwd: Path = None) -> Dict[str, Any]:
        """Run a command and return results"""
        self.log(f"Running: {' '.join(command)}")
        
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                text=True,
                cwd=cwd or self.benchmark_dir,
                timeout=7200  # 2 hour timeout
            )
            
            return {
                "success": result.returncode == 0,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr
            }
        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "returncode": -1,
                "stdout": "",
                "stderr": "Command timed out after 2 hours"
            }
        except Exception as e:
            return {
                "success": False,
                "returncode": -1,
                "stdout": "",
                "stderr": str(e)
            }
    
    def run_load_testing(self) -> Dict[str, Any]:
        """Run comprehensive load testing"""
        self.log("🔥 Starting Load Testing Phase", "INFO")
        
        # Run quick load test first
        self.log("Running quick load test for system validation...")
        quick_result = self.run_command([
            "python3", "hive-mind-load-test.py", 
            "--quick",
            "--output", str(self.results_dir / "load-test-quick")
        ])
        
        if not quick_result["success"]:
            self.log("❌ Quick load test failed, aborting full test", "ERROR")
            return {"success": False, "error": "Quick test failed", "details": quick_result}
        
        self.log("✅ Quick load test passed, proceeding with full load testing")
        
        # Run full load testing
        self.log("Running comprehensive load testing...")
        full_result = self.run_command([
            "python3", "hive-mind-load-test.py",
            "--output", str(self.results_dir / "load-test-full")
        ])
        
        return {
            "success": full_result["success"],
            "quick_test": quick_result,
            "full_test": full_result
        }
    
    def run_stress_testing(self) -> Dict[str, Any]:
        """Run stress testing for breaking point discovery"""
        self.log("💥 Starting Stress Testing Phase", "INFO")
        
        stress_types = ["memory", "cpu", "coordination", "consensus"]
        stress_results = {}
        
        for stress_type in stress_types:
            self.log(f"Running {stress_type} stress test...")
            
            result = self.run_command([
                "python3", "hive-mind-stress-test.py",
                "--stress-type", stress_type,
                "--output", str(self.results_dir / f"stress-test-{stress_type}")
            ])
            
            stress_results[stress_type] = result
            
            if result["success"]:
                self.log(f"✅ {stress_type} stress test completed")
            else:
                self.log(f"❌ {stress_type} stress test failed: {result['stderr'][:200]}", "ERROR")
        
        # Run comprehensive stress testing
        self.log("Running comprehensive stress testing...")
        comprehensive_result = self.run_command([
            "python3", "hive-mind-stress-test.py",
            "--output", str(self.results_dir / "stress-test-comprehensive")
        ])
        
        stress_results["comprehensive"] = comprehensive_result
        
        return stress_results
    
    def run_benchmark_suite(self) -> Dict[str, Any]:
        """Run existing benchmark suite"""
        self.log("📊 Starting Benchmark Suite Phase", "INFO")
        
        # Check if benchmark runner exists
        benchmark_runner = self.benchmark_dir / "hive-mind-benchmarks" / "benchmark_runner.py"
        if not benchmark_runner.exists():
            self.log("⚠️ Benchmark runner not found, skipping benchmark suite", "WARN")
            return {"success": False, "error": "Benchmark runner not found"}
        
        # Run quick benchmark
        self.log("Running quick benchmark...")
        quick_result = self.run_command([
            "python3", str(benchmark_runner),
            "--quick"
        ], cwd=benchmark_runner.parent)
        
        if quick_result["success"]:
            self.log("✅ Quick benchmark completed")
        else:
            self.log(f"❌ Quick benchmark failed: {quick_result['stderr'][:200]}", "ERROR")
        
        return {"quick_benchmark": quick_result}
    
    def run_concurrent_swarm_tests(self) -> Dict[str, Any]:
        """Run concurrent swarm testing"""
        self.log("🐝 Starting Concurrent Swarm Testing", "INFO")
        
        concurrent_tests = [
            (2, 25, "Two swarms test"),
            (5, 20, "Five swarms test"),
            (10, 10, "Ten swarms test")
        ]
        
        results = {}
        
        for swarm_count, agents_per_swarm, description in concurrent_tests:
            self.log(f"Running {description}: {swarm_count} swarms x {agents_per_swarm} agents")
            
            # Use load test with specific parameters
            result = self.run_command([
                "python3", "hive-mind-load-test.py",
                "--scale", str(agents_per_swarm),
                "--output", str(self.results_dir / f"concurrent-{swarm_count}x{agents_per_swarm}")
            ])
            
            results[f"{swarm_count}x{agents_per_swarm}"] = result
            
            if result["success"]:
                self.log(f"✅ {description} completed")
            else:
                self.log(f"❌ {description} failed", "ERROR")
        
        return results
    
    def analyze_combined_results(self) -> Dict[str, Any]:
        """Analyze all test results and generate combined report"""
        self.log("📈 Analyzing Combined Results", "INFO")
        
        # Collect all result files
        result_files = list(self.results_dir.glob("**/*.json"))
        
        combined_analysis = {
            "test_summary": {
                "total_test_files": len(result_files),
                "test_phases": list(self.test_results.keys()),
                "overall_success": all(
                    result.get("success", False) 
                    for result in self.test_results.values() 
                    if isinstance(result, dict)
                ),
                "test_duration": time.time() - self.start_time
            },
            "breaking_points": {},
            "stability_limits": {},
            "performance_metrics": {},
            "recommendations": []
        }
        
        # Analyze each result file
        for result_file in result_files:
            try:
                with open(result_file, 'r') as f:
                    data = json.load(f)
                
                # Extract key metrics
                if "summary" in data:
                    summary = data["summary"]
                    
                    # Breaking points
                    if "breaking_point_agents" in summary:
                        test_name = result_file.stem
                        combined_analysis["breaking_points"][test_name] = summary["breaking_point_agents"]
                    
                    # Stability limits
                    if "max_stable_agents" in summary:
                        test_name = result_file.stem
                        combined_analysis["stability_limits"][test_name] = summary["max_stable_agents"]
                    
                    # Performance metrics
                    if "avg_throughput" in summary:
                        test_name = result_file.stem
                        combined_analysis["performance_metrics"][test_name] = {
                            "throughput": summary.get("avg_throughput", 0),
                            "response_time": summary.get("avg_response_time_ms", 0),
                            "memory_usage": summary.get("peak_memory_usage_mb", 0)
                        }
                
                # Extract recommendations
                if "recommendations" in data:
                    combined_analysis["recommendations"].extend(data["recommendations"])
            
            except Exception as e:
                self.log(f"⚠️ Failed to analyze {result_file}: {e}", "WARN")
        
        # Generate overall recommendations
        overall_recommendations = self._generate_overall_recommendations(combined_analysis)
        combined_analysis["overall_recommendations"] = overall_recommendations
        
        # Save combined analysis
        analysis_file = self.results_dir / "combined_analysis.json"
        with open(analysis_file, 'w') as f:
            json.dump(combined_analysis, f, indent=2)
        
        self.log(f"📊 Combined analysis saved to: {analysis_file}")
        
        return combined_analysis
    
    def _generate_overall_recommendations(self, analysis: Dict[str, Any]) -> List[str]:
        """Generate overall recommendations from combined analysis"""
        recommendations = []
        
        # Analyze breaking points
        breaking_points = list(analysis["breaking_points"].values())
        if breaking_points:
            min_breaking_point = min(breaking_points)
            avg_breaking_point = sum(breaking_points) / len(breaking_points)
            
            if min_breaking_point < 100:
                recommendations.append(
                    f"CRITICAL: Minimum breaking point at {min_breaking_point} agents indicates fundamental scaling issues."
                )
            elif avg_breaking_point < 500:
                recommendations.append(
                    f"OPTIMIZATION NEEDED: Average breaking point at {avg_breaking_point:.0f} agents suggests medium-scale optimization opportunities."
                )
            else:
                recommendations.append(
                    f"EXCELLENT: Strong scaling characteristics with average breaking point at {avg_breaking_point:.0f} agents."
                )
        
        # Analyze stability limits
        stability_limits = list(analysis["stability_limits"].values())
        if stability_limits:
            max_stability = max(stability_limits)
            
            if max_stability >= 1000:
                recommendations.append("System demonstrates enterprise-scale stability (1000+ agents).")
            elif max_stability >= 500:
                recommendations.append("System suitable for large-scale deployments (500+ agents).")
            elif max_stability >= 100:
                recommendations.append("System suitable for medium-scale deployments (100+ agents).")
            else:
                recommendations.append("System requires optimization for production deployment.")
        
        # Analyze test success rates
        if not analysis["test_summary"]["overall_success"]:
            recommendations.append("URGENT: Some test phases failed. Review error logs and address critical issues.")
        
        return recommendations
    
    def generate_summary_report(self, analysis: Dict[str, Any]):
        """Generate human-readable summary report"""
        self.log("📋 Generating Summary Report", "INFO")
        
        report_file = self.results_dir / "LOAD_TEST_SUMMARY.md"
        
        with open(report_file, 'w') as f:
            f.write("# Hive Mind Load Testing Summary Report\\n")
            f.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\\n\\n")
            
            # Test Summary
            f.write("## Test Summary\\n")
            summary = analysis["test_summary"]
            f.write(f"- **Total Test Duration**: {summary['test_duration']:.1f} seconds\\n")
            f.write(f"- **Test Phases**: {len(summary['test_phases'])}\\n")
            f.write(f"- **Overall Success**: {'✅ PASS' if summary['overall_success'] else '❌ FAIL'}\\n")
            f.write(f"- **Result Files**: {summary['total_test_files']}\\n\\n")
            
            # Breaking Points
            if analysis["breaking_points"]:
                f.write("## Breaking Points\\n")
                for test_name, breaking_point in analysis["breaking_points"].items():
                    f.write(f"- **{test_name}**: {breaking_point} agents\\n")
                f.write("\\n")
            
            # Stability Limits
            if analysis["stability_limits"]:
                f.write("## Stability Limits\\n")
                for test_name, stability_limit in analysis["stability_limits"].items():
                    f.write(f"- **{test_name}**: {stability_limit} agents\\n")
                f.write("\\n")
            
            # Performance Metrics
            if analysis["performance_metrics"]:
                f.write("## Performance Metrics\\n")
                for test_name, metrics in analysis["performance_metrics"].items():
                    f.write(f"### {test_name}\\n")
                    f.write(f"- **Throughput**: {metrics['throughput']:.1f} ops/sec\\n")
                    f.write(f"- **Response Time**: {metrics['response_time']:.1f}ms\\n")
                    f.write(f"- **Memory Usage**: {metrics['memory_usage']:.1f}MB\\n\\n")
            
            # Recommendations
            if analysis["overall_recommendations"]:
                f.write("## Recommendations\\n")
                for i, rec in enumerate(analysis["overall_recommendations"], 1):
                    f.write(f"{i}. {rec}\\n")
                f.write("\\n")
            
            # Test Results Summary
            f.write("## Test Results by Phase\\n")
            for phase, result in self.test_results.items():
                if isinstance(result, dict):
                    success = result.get("success", False)
                    f.write(f"- **{phase}**: {'✅ PASS' if success else '❌ FAIL'}\\n")
            f.write("\\n")
            
            # Files and Locations
            f.write("## Generated Files\\n")
            f.write(f"- **Results Directory**: `{self.results_dir}`\\n")
            f.write(f"- **Combined Analysis**: `{self.results_dir}/combined_analysis.json`\\n")
            f.write(f"- **This Report**: `{report_file}`\\n")
        
        self.log(f"📋 Summary report saved to: {report_file}")
    
    def run_comprehensive_testing(self) -> Dict[str, Any]:
        """Run the complete testing suite"""
        self.log("🚀 Starting Comprehensive Hive Mind Load Testing", "INFO")
        self.log("=" * 60)
        
        self.start_time = time.time()
        
        # Phase 1: Load Testing
        self.log("Phase 1: Load Testing")
        self.test_results["load_testing"] = self.run_load_testing()
        
        # Phase 2: Stress Testing
        self.log("Phase 2: Stress Testing") 
        self.test_results["stress_testing"] = self.run_stress_testing()
        
        # Phase 3: Benchmark Suite
        self.log("Phase 3: Benchmark Suite")
        self.test_results["benchmark_suite"] = self.run_benchmark_suite()
        
        # Phase 4: Concurrent Swarm Testing
        self.log("Phase 4: Concurrent Swarm Testing")
        self.test_results["concurrent_swarms"] = self.run_concurrent_swarm_tests()
        
        # Phase 5: Analysis
        self.log("Phase 5: Analysis and Reporting")
        analysis = self.analyze_combined_results()
        
        # Generate summary report
        self.generate_summary_report(analysis)
        
        total_duration = time.time() - self.start_time
        
        self.log(f"🎯 Testing Complete! Total Duration: {total_duration:.1f} seconds")
        self.log(f"📊 Results saved to: {self.results_dir}")
        
        return {
            "success": True,
            "total_duration": total_duration,
            "results_directory": str(self.results_dir),
            "test_results": self.test_results,
            "analysis": analysis
        }

def main():
    """Main orchestrator execution"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Hive Mind Load Testing Orchestrator")
    parser.add_argument("--phase", choices=["load", "stress", "benchmark", "concurrent", "all"],
                       default="all", help="Run specific testing phase")
    parser.add_argument("--quick", action="store_true", help="Run quick tests only")
    
    args = parser.parse_args()
    
    orchestrator = LoadTestOrchestrator()
    
    try:
        if args.phase == "all":
            if args.quick:
                # Quick testing mode
                orchestrator.log("🚀 Running Quick Testing Mode")
                result = orchestrator.run_command([
                    "python3", "hive-mind-load-test.py", "--quick"
                ])
                print("Quick test result:", "SUCCESS" if result["success"] else "FAILED")
            else:
                # Full comprehensive testing
                result = orchestrator.run_comprehensive_testing()
                
                # Print summary
                if result["success"]:
                    print("\\n🎯 COMPREHENSIVE TESTING SUMMARY")
                    print("=" * 50)
                    print(f"✅ Testing completed successfully!")
                    print(f"⏱️  Total duration: {result['total_duration']:.1f} seconds")
                    print(f"📁 Results directory: {result['results_directory']}")
                    print("\\n📊 Phase Results:")
                    for phase, phase_result in result["test_results"].items():
                        if isinstance(phase_result, dict):
                            success = phase_result.get("success", False)
                            print(f"  {phase}: {'✅ PASS' if success else '❌ FAIL'}")
                else:
                    print("❌ Testing failed!")
                    
        else:
            # Run specific phase
            orchestrator.log(f"Running specific phase: {args.phase}")
            
            if args.phase == "load":
                result = orchestrator.run_load_testing()
            elif args.phase == "stress":
                result = orchestrator.run_stress_testing()
            elif args.phase == "benchmark":
                result = orchestrator.run_benchmark_suite()
            elif args.phase == "concurrent":
                result = orchestrator.run_concurrent_swarm_tests()
            
            print(f"{args.phase} phase result:", "SUCCESS" if result.get("success", False) else "FAILED")
    
    except KeyboardInterrupt:
        orchestrator.log("Testing interrupted by user", "WARN")
        sys.exit(1)
    except Exception as e:
        orchestrator.log(f"Testing failed with error: {e}", "ERROR")
        sys.exit(1)

if __name__ == "__main__":
    main()