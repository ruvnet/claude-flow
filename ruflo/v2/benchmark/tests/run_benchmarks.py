#!/usr/bin/env python3
"""
Comprehensive benchmark runner for claude-flow.
Executes all test suites and generates consolidated reports.
"""

import subprocess
import time
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any
import argparse


class BenchmarkRunner:
    """Main benchmark runner for claude-flow tests"""
    
    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self.test_dir = Path(__file__).parent
        self.results = {
            "timestamp": datetime.now().isoformat(),
            "test_suites": {},
            "summary": {}
        }
        
    def run_unit_tests(self) -> Dict[str, Any]:
        """Run unit tests"""
        print("\n" + "="*60)
        print("🧪 Running Unit Tests")
        print("="*60)
        
        start_time = time.time()
        
        result = subprocess.run(
            [sys.executable, "-m", "pytest", 
             str(self.test_dir / "unit"),
             "-v" if self.verbose else "-q",
             "--tb=short",
             "--json-report",
             "--json-report-file=unit_test_report.json"],
            capture_output=True,
            text=True,
            cwd=self.test_dir
        )
        
        duration = time.time() - start_time
        
        # Load test report if available
        report_path = self.test_dir / "unit_test_report.json"
        test_details = {}
        if report_path.exists():
            with open(report_path) as f:
                test_details = json.load(f)
        
        return {
            "success": result.returncode == 0,
            "duration": duration,
            "tests_run": test_details.get("summary", {}).get("total", 0),
            "tests_passed": test_details.get("summary", {}).get("passed", 0),
            "stdout": result.stdout if self.verbose else "",
            "stderr": result.stderr
        }
    
    def run_integration_tests(self, test_type: str = "all") -> Dict[str, Any]:
        """Run integration tests"""
        print("\n" + "="*60)
        print(f"🔧 Running Integration Tests: {test_type}")
        print("="*60)
        
        test_files = []
        if test_type == "all":
            test_files = [
                "test_sparc_modes.py",
                "test_swarm_strategies.py"
            ]
        elif test_type == "sparc":
            test_files = ["test_sparc_modes.py"]
        elif test_type == "swarm":
            test_files = ["test_swarm_strategies.py"]
        
        results = {}
        
        for test_file in test_files:
            print(f"\n📋 Running {test_file}...")
            start_time = time.time()
            
            result = subprocess.run(
                [sys.executable, "-m", "pytest",
                 str(self.test_dir / "integration" / test_file),
                 "-v" if self.verbose else "-q",
                 "--tb=short",
                 "-k", "not stress and not advanced",  # Skip stress tests by default
                 "--json-report",
                 f"--json-report-file={test_file}.json"],
                capture_output=True,
                text=True,
                cwd=self.test_dir,
                timeout=600  # 10 minute timeout
            )
            
            duration = time.time() - start_time
            
            # Load test report
            report_path = self.test_dir / f"{test_file}.json"
            test_details = {}
            if report_path.exists():
                with open(report_path) as f:
                    test_details = json.load(f)
            
            results[test_file] = {
                "success": result.returncode == 0,
                "duration": duration,
                "tests_run": test_details.get("summary", {}).get("total", 0),
                "tests_passed": test_details.get("summary", {}).get("passed", 0),
                "stdout": result.stdout if self.verbose else "",
                "stderr": result.stderr
            }
            
            # Print summary
            status = "✅ PASSED" if result.returncode == 0 else "❌ FAILED"
            print(f"{status} - Duration: {duration:.2f}s")
            
        return results
    
    def run_performance_benchmarks(self) -> Dict[str, Any]:
        """Run performance-specific benchmarks"""
        print("\n" + "="*60)
        print("⚡ Running Performance Benchmarks")
        print("="*60)
        
        start_time = time.time()
        
        # Run performance-marked tests
        result = subprocess.run(
            [sys.executable, "-m", "pytest",
             str(self.test_dir / "integration"),
             "-v" if self.verbose else "-q",
             "--tb=short",
             "-m", "performance",
             "--json-report",
             "--json-report-file=performance_report.json"],
            capture_output=True,
            text=True,
            cwd=self.test_dir,
            timeout=300  # 5 minute timeout
        )
        
        duration = time.time() - start_time
        
        # Load performance results
        report_path = self.test_dir / "performance_report.json"
        if report_path.exists():
            with open(report_path) as f:
                perf_data = json.load(f)
        else:
            perf_data = {}
        
        return {
            "success": result.returncode == 0,
            "duration": duration,
            "performance_data": perf_data,
            "stdout": result.stdout if self.verbose else "",
            "stderr": result.stderr
        }
    
    def generate_consolidated_report(self):
        """Generate a consolidated benchmark report"""
        print("\n" + "="*60)
        print("📊 Generating Consolidated Report")
        print("="*60)
        
        # Calculate summary statistics
        total_duration = sum(
            suite.get("duration", 0) 
            for suite in self.results["test_suites"].values()
            if isinstance(suite, dict)
        )
        
        total_tests = 0
        passed_tests = 0
        
        for suite_name, suite_data in self.results["test_suites"].items():
            if isinstance(suite_data, dict):
                if "tests_run" in suite_data:
                    total_tests += suite_data["tests_run"]
                    passed_tests += suite_data.get("tests_passed", 0)
                elif isinstance(suite_data.get("tests_run"), dict):
                    # Handle nested results
                    for test_data in suite_data.values():
                        if isinstance(test_data, dict):
                            total_tests += test_data.get("tests_run", 0)
                            passed_tests += test_data.get("tests_passed", 0)
        
        self.results["summary"] = {
            "total_duration": total_duration,
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "failed_tests": total_tests - passed_tests,
            "success_rate": (passed_tests / total_tests * 100) if total_tests > 0 else 0
        }
        
        # Save consolidated report
        report_path = self.test_dir.parent / "consolidated_benchmark_report.json"
        with open(report_path, "w") as f:
            json.dump(self.results, f, indent=2)
        
        # Print summary
        print(f"\n📋 Benchmark Summary:")
        print(f"  Total Duration: {total_duration:.2f}s")
        print(f"  Total Tests: {total_tests}")
        print(f"  Passed: {passed_tests}")
        print(f"  Failed: {total_tests - passed_tests}")
        print(f"  Success Rate: {self.results['summary']['success_rate']:.1f}%")
        print(f"\n💾 Report saved to: {report_path}")
        
        # Generate markdown report
        self._generate_markdown_report()
    
    def _generate_markdown_report(self):
        """Generate a human-readable markdown report"""
        report_lines = [
            "# Claude-Flow Benchmark Report",
            f"\nGenerated: {self.results['timestamp']}",
            "\n## Summary",
            f"- **Total Duration**: {self.results['summary']['total_duration']:.2f}s",
            f"- **Total Tests**: {self.results['summary']['total_tests']}",
            f"- **Passed**: {self.results['summary']['passed_tests']}",
            f"- **Failed**: {self.results['summary']['failed_tests']}",
            f"- **Success Rate**: {self.results['summary']['success_rate']:.1f}%",
            "\n## Test Suite Results\n"
        ]
        
        for suite_name, suite_data in self.results["test_suites"].items():
            report_lines.append(f"### {suite_name}")
            
            if isinstance(suite_data, dict):
                if "duration" in suite_data:
                    report_lines.append(f"- Duration: {suite_data['duration']:.2f}s")
                if "tests_run" in suite_data:
                    report_lines.append(f"- Tests: {suite_data['tests_run']}")
                    report_lines.append(f"- Passed: {suite_data.get('tests_passed', 0)}")
                report_lines.append("")
        
        # Save markdown report
        md_path = self.test_dir.parent / "benchmark_report.md"
        with open(md_path, "w") as f:
            f.write("\n".join(report_lines))
        
        print(f"📄 Markdown report saved to: {md_path}")
    
    def run_all_benchmarks(self):
        """Run all benchmark suites"""
        print("🚀 Starting Comprehensive Claude-Flow Benchmarks")
        print(f"Test Directory: {self.test_dir}")
        
        # Run unit tests
        self.results["test_suites"]["unit_tests"] = self.run_unit_tests()
        
        # Run integration tests
        self.results["test_suites"]["integration_tests"] = self.run_integration_tests("all")
        
        # Run performance benchmarks
        self.results["test_suites"]["performance_benchmarks"] = self.run_performance_benchmarks()
        
        # Generate consolidated report
        self.generate_consolidated_report()


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="Run claude-flow benchmarks")
    parser.add_argument("-v", "--verbose", action="store_true", 
                      help="Verbose output")
    parser.add_argument("--suite", choices=["all", "unit", "integration", "performance"],
                      default="all", help="Test suite to run")
    parser.add_argument("--integration-type", choices=["all", "sparc", "swarm"],
                      default="all", help="Type of integration tests")
    
    args = parser.parse_args()
    
    runner = BenchmarkRunner(verbose=args.verbose)
    
    if args.suite == "all":
        runner.run_all_benchmarks()
    elif args.suite == "unit":
        results = runner.run_unit_tests()
        print(f"\nUnit Tests: {'✅ PASSED' if results['success'] else '❌ FAILED'}")
    elif args.suite == "integration":
        results = runner.run_integration_tests(args.integration_type)
        success = all(r.get("success", False) for r in results.values())
        print(f"\nIntegration Tests: {'✅ PASSED' if success else '❌ FAILED'}")
    elif args.suite == "performance":
        results = runner.run_performance_benchmarks()
        print(f"\nPerformance Tests: {'✅ PASSED' if results['success'] else '❌ FAILED'}")


if __name__ == "__main__":
    main()