#!/usr/bin/env python3
"""
Test runner script for the benchmark test suite.

Provides convenient commands to run different types of tests
with appropriate configurations and reporting.
"""

import sys
import os
import subprocess
import argparse
from pathlib import Path
from datetime import datetime


class TestRunner:
    """Test runner with various execution modes."""
    
    def __init__(self):
        self.benchmark_root = Path(__file__).parent.parent
        self.test_root = Path(__file__).parent
        
    def run_unit_tests(self, coverage=False, verbose=True):
        """Run unit tests."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root / "unit"),
            "-v" if verbose else "",
            "--tb=short",
            "--color=yes"
        ]
        
        if coverage:
            cmd.extend([
                "--cov=swarm_benchmark",
                "--cov-report=html",
                "--cov-report=term-missing",
                "--cov-fail-under=85"
            ])
        
        # Filter out empty strings
        cmd = [arg for arg in cmd if arg]
        
        print(f"Running unit tests with command: {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)
    
    def run_integration_tests(self, verbose=True):
        """Run integration tests."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root / "integration"),
            "-v" if verbose else "",
            "--tb=short",
            "--color=yes",
            "-m", "integration"
        ]
        
        # Filter out empty strings
        cmd = [arg for arg in cmd if arg]
        
        print(f"Running integration tests with command: {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)
    
    def run_performance_tests(self, verbose=True):
        """Run performance tests."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root / "performance"),
            "-v" if verbose else "",
            "--tb=short",
            "--color=yes",
            "-m", "performance"
        ]
        
        # Filter out empty strings
        cmd = [arg for arg in cmd if arg]
        
        print(f"Running performance tests with command: {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)
    
    def run_all_tests(self, coverage=False, verbose=True, include_slow=False):
        """Run all tests."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root),
            "-v" if verbose else "",
            "--tb=short",
            "--color=yes",
            "--durations=10"
        ]
        
        if not include_slow:
            cmd.extend(["-m", "not slow"])
        
        if coverage:
            cmd.extend([
                "--cov=swarm_benchmark",
                "--cov-report=html",
                "--cov-report=term-missing",
                "--cov-fail-under=80"
            ])
        
        # Filter out empty strings
        cmd = [arg for arg in cmd if arg]
        
        print(f"Running all tests with command: {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)
    
    def run_fast_tests(self, coverage=False, verbose=True):
        """Run fast tests only (exclude slow and stress tests)."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root),
            "-v" if verbose else "",
            "--tb=short",
            "--color=yes",
            "-m", "not slow and not stress"
        ]
        
        if coverage:
            cmd.extend([
                "--cov=swarm_benchmark",
                "--cov-report=term-missing"
            ])
        
        # Filter out empty strings
        cmd = [arg for arg in cmd if arg]
        
        print(f"Running fast tests with command: {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)
    
    def run_regression_tests(self, verbose=True):
        """Run regression tests."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root),
            "-v" if verbose else "",
            "--tb=short",
            "--color=yes",
            "-m", "regression"
        ]
        
        # Filter out empty strings
        cmd = [arg for arg in cmd if arg]
        
        print(f"Running regression tests with command: {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)
    
    def run_stress_tests(self, verbose=True):
        """Run stress tests."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root),
            "-v" if verbose else "",
            "--tb=short",
            "--color=yes",
            "-m", "stress",
            "--timeout=600"  # 10 minute timeout for stress tests
        ]
        
        # Filter out empty strings  
        cmd = [arg for arg in cmd if arg]
        
        print(f"Running stress tests with command: {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)
    
    def run_by_module(self, module_name, coverage=False, verbose=True):
        """Run tests for a specific module."""
        valid_modules = [
            "mle_star", "automation", "metrics", 
            "collective", "claude_optimizer"
        ]
        
        if module_name not in valid_modules:
            print(f"Invalid module. Valid modules: {', '.join(valid_modules)}")
            return subprocess.run(["false"])  # Return failure
        
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root),
            "-v" if verbose else "",
            "--tb=short", 
            "--color=yes",
            "-k", module_name
        ]
        
        if coverage:
            cmd.extend([
                "--cov=swarm_benchmark",
                "--cov-report=term-missing"
            ])
        
        # Filter out empty strings
        cmd = [arg for arg in cmd if arg]
        
        print(f"Running {module_name} tests with command: {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)
    
    def generate_coverage_report(self):
        """Generate comprehensive coverage report."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root),
            "--cov=swarm_benchmark",
            "--cov-report=html",
            "--cov-report=xml",
            "--cov-report=term",
            "--cov-fail-under=80",
            "-m", "not slow and not stress"
        ]
        
        print(f"Generating coverage report with command: {' '.join(cmd)}")
        result = subprocess.run(cmd, cwd=self.benchmark_root)
        
        if result.returncode == 0:
            print("\nCoverage report generated:")
            print(f"  HTML: {self.benchmark_root}/htmlcov/index.html")
            print(f"  XML:  {self.benchmark_root}/coverage.xml")
        
        return result
    
    def run_parallel_tests(self, num_workers=4, coverage=False, verbose=True):
        """Run tests in parallel using pytest-xdist."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root),
            "-v" if verbose else "",
            "--tb=short",
            "--color=yes",
            "-n", str(num_workers),
            "-m", "not slow"
        ]
        
        if coverage:
            cmd.extend([
                "--cov=swarm_benchmark",
                "--cov-report=term-missing"
            ])
        
        # Filter out empty strings
        cmd = [arg for arg in cmd if arg]
        
        print(f"Running tests in parallel ({num_workers} workers): {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)
    
    def run_ci_tests(self):
        """Run tests optimized for CI environment."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root),
            "--tb=short",
            "--color=yes",
            "--durations=10",
            "--cov=swarm_benchmark",
            "--cov-report=xml",
            "--cov-report=term",
            "--junit-xml=test-results.xml",
            "-m", "not slow and not stress",
            "--maxfail=5"  # Stop after 5 failures
        ]
        
        print(f"Running CI tests with command: {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)
    
    def run_smoke_tests(self):
        """Run quick smoke tests."""
        cmd = [
            sys.executable, "-m", "pytest",
            str(self.test_root),
            "--tb=line",
            "--color=yes",
            "--maxfail=3",
            "-x",  # Stop on first failure
            "-k", "test_initialization or test_basic"
        ]
        
        print(f"Running smoke tests with command: {' '.join(cmd)}")
        return subprocess.run(cmd, cwd=self.benchmark_root)


def main():
    """Main entry point for test runner."""
    parser = argparse.ArgumentParser(description="Benchmark test suite runner")
    parser.add_argument(
        "test_type",
        choices=[
            "unit", "integration", "performance", "all", "fast", 
            "regression", "stress", "coverage", "parallel", 
            "ci", "smoke", "module"
        ],
        help="Type of tests to run"
    )
    parser.add_argument(
        "--module",
        choices=["mle_star", "automation", "metrics", "collective", "claude_optimizer"],
        help="Specific module to test (for module test type)"
    )
    parser.add_argument("--coverage", action="store_true", help="Generate coverage report")
    parser.add_argument("--quiet", "-q", action="store_true", help="Reduce verbosity")
    parser.add_argument("--slow", action="store_true", help="Include slow tests")
    parser.add_argument(
        "--workers", "-n", type=int, default=4,
        help="Number of parallel workers (for parallel tests)"
    )
    
    args = parser.parse_args()
    
    runner = TestRunner()
    verbose = not args.quiet
    
    print(f"\n{'='*60}")
    print(f"Benchmark Test Suite Runner")
    print(f"Started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Test type: {args.test_type}")
    print(f"{'='*60}\n")
    
    # Run appropriate test type
    if args.test_type == "unit":
        result = runner.run_unit_tests(coverage=args.coverage, verbose=verbose)
    elif args.test_type == "integration":
        result = runner.run_integration_tests(verbose=verbose)
    elif args.test_type == "performance":
        result = runner.run_performance_tests(verbose=verbose)
    elif args.test_type == "all":
        result = runner.run_all_tests(
            coverage=args.coverage, verbose=verbose, include_slow=args.slow
        )
    elif args.test_type == "fast":
        result = runner.run_fast_tests(coverage=args.coverage, verbose=verbose)
    elif args.test_type == "regression":
        result = runner.run_regression_tests(verbose=verbose)
    elif args.test_type == "stress":
        result = runner.run_stress_tests(verbose=verbose)
    elif args.test_type == "coverage":
        result = runner.generate_coverage_report()
    elif args.test_type == "parallel":
        result = runner.run_parallel_tests(
            num_workers=args.workers, coverage=args.coverage, verbose=verbose
        )
    elif args.test_type == "ci":
        result = runner.run_ci_tests()
    elif args.test_type == "smoke":
        result = runner.run_smoke_tests()
    elif args.test_type == "module":
        if not args.module:
            print("Error: --module is required for module tests")
            return 1
        result = runner.run_by_module(
            args.module, coverage=args.coverage, verbose=verbose
        )
    else:
        print(f"Unknown test type: {args.test_type}")
        return 1
    
    print(f"\n{'='*60}")
    print(f"Test run completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Exit code: {result.returncode}")
    print(f"{'='*60}")
    
    return result.returncode


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)