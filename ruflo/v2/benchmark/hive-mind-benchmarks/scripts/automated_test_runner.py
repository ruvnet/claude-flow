#!/usr/bin/env python3
"""
Automated Hive Mind Benchmark Test Runner
Integrates with CI/CD pipelines for continuous performance testing
"""

import os
import sys
import json
import time
import signal
import logging
import argparse
import subprocess
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError

# Add parent directory to path for benchmark_runner import
sys.path.append(str(Path(__file__).parent.parent))
from benchmark_runner import HiveMindBenchmarkRunner, BenchmarkConfig, BenchmarkResult

@dataclass
class TestProfile:
    """Test profile configuration"""
    name: str
    description: str
    max_duration_minutes: int
    parallel_workers: int
    configurations: List[Dict[str, Any]]
    performance_thresholds: Dict[str, float]

@dataclass
class AutomationConfig:
    """Configuration for automated test execution"""
    profile: str
    output_dir: str
    timeout_minutes: int
    retry_count: int
    retry_delay: int
    fail_fast: bool
    generate_reports: bool
    save_artifacts: bool
    notify_on_failure: bool
    cleanup_on_exit: bool

class AutomatedTestRunner:
    """Automated test runner with CI/CD integration"""
    
    def __init__(self, config_file: str = None):
        self.config_file = config_file or self._find_config_file()
        self.config = self._load_config()
        self.runner = HiveMindBenchmarkRunner()
        self.start_time = None
        self.test_results = []
        self.interrupted = False
        
        # Setup logging
        self._setup_logging()
        
        # Setup signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
    def _find_config_file(self) -> str:
        """Find test configuration file"""
        possible_paths = [
            "config/test-config.json",
            "../config/test-config.json",
            "test-config.json",
            "/workspaces/claude-code-flow/benchmark/hive-mind-benchmarks/config/test-config.json"
        ]
        
        for path in possible_paths:
            if Path(path).exists():
                return path
                
        raise FileNotFoundError("Could not find test-config.json file")
        
    def _load_config(self) -> Dict[str, Any]:
        """Load test configuration from JSON file"""
        try:
            with open(self.config_file, 'r') as f:
                return json.load(f)
        except Exception as e:
            raise RuntimeError(f"Failed to load config from {self.config_file}: {e}")
            
    def _setup_logging(self):
        """Setup logging for automated test execution"""
        log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
        log_format = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        
        logging.basicConfig(
            level=getattr(logging, log_level),
            format=log_format,
            handlers=[
                logging.StreamHandler(sys.stdout),
                logging.FileHandler('automated_test_runner.log')
            ]
        )
        
        self.logger = logging.getLogger(__name__)
        self.logger.info(f"Automated test runner initialized with config: {self.config_file}")
        
    def _signal_handler(self, signum, frame):
        """Handle graceful shutdown on signals"""
        self.logger.warning(f"Received signal {signum}, initiating graceful shutdown...")
        self.interrupted = True
        
    def create_test_profile(self, profile_name: str) -> TestProfile:
        """Create test profile from configuration"""
        if profile_name not in self.config['benchmark_profiles']:
            raise ValueError(f"Profile '{profile_name}' not found in configuration")
            
        profile_config = self.config['benchmark_profiles'][profile_name]
        thresholds = self.config.get('performance_thresholds', {})
        
        configurations = profile_config['configurations']
        if configurations == "auto_generate":
            # Generate comprehensive configurations
            configurations = self._generate_comprehensive_configs()
            
        return TestProfile(
            name=profile_config['name'],
            description=profile_config['description'],
            max_duration_minutes=profile_config['max_duration_minutes'],
            parallel_workers=profile_config['parallel_workers'],
            configurations=configurations,
            performance_thresholds=thresholds
        )
        
    def _generate_comprehensive_configs(self) -> List[Dict[str, Any]]:
        """Generate comprehensive test configurations"""
        configs = []
        
        # Core topology tests
        topologies = ["hierarchical", "mesh", "ring", "star"]
        coordinations = ["queen", "consensus", "hybrid"]
        memory_types = ["sqlite", "memory", "distributed"]
        
        # Scale tests
        scales = [(5, "simple"), (15, "medium"), (50, "complex")]
        
        for topology in topologies:
            for coordination in coordinations:
                for memory_type in memory_types:
                    for agent_count, complexity in scales:
                        # Skip expensive combinations
                        if agent_count > 15 and topology != "hierarchical":
                            continue
                            
                        configs.append({
                            "name": f"auto_{topology}_{coordination}_{memory_type}_{agent_count}",
                            "topology": topology,
                            "coordination": coordination,
                            "memory_type": memory_type,
                            "agent_count": agent_count,
                            "task_complexity": complexity,
                            "duration_seconds": 30 if agent_count <= 15 else 60,
                            "iterations": 2
                        })
                        
        return configs
        
    def validate_environment(self) -> Tuple[bool, List[str]]:
        """Validate test environment and dependencies"""
        issues = []
        
        # Check Python dependencies
        required_modules = ['psutil', 'numpy', 'pandas']
        for module in required_modules:
            try:
                __import__(module)
            except ImportError:
                issues.append(f"Missing Python module: {module}")
                
        # Check Node.js and CLI availability
        try:
            result = subprocess.run(['node', '--version'], capture_output=True, text=True)
            if result.returncode != 0:
                issues.append("Node.js not available")
        except FileNotFoundError:
            issues.append("Node.js not found in PATH")
            
        # Check CLI script
        cli_path = Path("../src/cli/simple-cli.js")
        if not cli_path.exists():
            issues.append(f"CLI script not found: {cli_path}")
            
        # Check available disk space (require at least 1GB)
        try:
            import shutil
            free_space = shutil.disk_usage('.').free
            if free_space < 1024**3:  # 1GB
                issues.append(f"Insufficient disk space: {free_space / 1024**3:.1f}GB available")
        except Exception:
            issues.append("Could not check disk space")
            
        return len(issues) == 0, issues
        
    def run_benchmark_with_timeout(self, config: BenchmarkConfig, timeout_minutes: int) -> Optional[BenchmarkResult]:
        """Run single benchmark with timeout and retry logic"""
        retry_count = self.config.get('retry_settings', {}).get('max_retries', 2)
        retry_delay = self.config.get('retry_settings', {}).get('retry_delay_seconds', 5)
        
        for attempt in range(retry_count + 1):
            if self.interrupted:
                self.logger.warning("Test interrupted, stopping benchmark execution")
                return None
                
            try:
                self.logger.info(f"Running benchmark {config.name} (attempt {attempt + 1}/{retry_count + 1})")
                
                with ThreadPoolExecutor(max_workers=1) as executor:
                    future = executor.submit(self.runner.run_single_benchmark, config)
                    
                    try:
                        result = future.result(timeout=timeout_minutes * 60)
                        if result.success:
                            return result
                        else:
                            self.logger.warning(f"Benchmark {config.name} failed: {result.error_message}")
                            
                    except TimeoutError:
                        self.logger.error(f"Benchmark {config.name} timed out after {timeout_minutes} minutes")
                        future.cancel()
                        
            except Exception as e:
                self.logger.error(f"Benchmark {config.name} failed with exception: {e}")
                
            # Wait before retry
            if attempt < retry_count:
                self.logger.info(f"Retrying in {retry_delay} seconds...")
                time.sleep(retry_delay)
                
        return None
        
    def run_profile_tests(self, profile: TestProfile, automation_config: AutomationConfig) -> List[BenchmarkResult]:
        """Run all tests in a profile with parallel execution"""
        self.logger.info(f"Starting test profile: {profile.name}")
        self.logger.info(f"Description: {profile.description}")
        self.logger.info(f"Configurations: {len(profile.configurations)}")
        
        # Convert configurations to BenchmarkConfig objects
        benchmark_configs = []
        for config_dict in profile.configurations:
            try:
                benchmark_config = BenchmarkConfig(**config_dict)
                benchmark_configs.append(benchmark_config)
            except Exception as e:
                self.logger.error(f"Invalid configuration {config_dict.get('name', 'unknown')}: {e}")
                continue
                
        if not benchmark_configs:
            self.logger.error("No valid benchmark configurations found")
            return []
            
        # Run benchmarks with parallel execution
        results = []
        timeout_per_benchmark = min(automation_config.timeout_minutes // len(benchmark_configs), 10)
        
        # Group by resource intensity for optimal parallel execution
        light_configs = [c for c in benchmark_configs if c.agent_count <= 20]
        heavy_configs = [c for c in benchmark_configs if c.agent_count > 20]
        
        # Run light configs in parallel
        if light_configs:
            self.logger.info(f"Running {len(light_configs)} light benchmarks in parallel")
            with ThreadPoolExecutor(max_workers=min(profile.parallel_workers, len(light_configs))) as executor:
                future_to_config = {
                    executor.submit(self.run_benchmark_with_timeout, config, timeout_per_benchmark): config
                    for config in light_configs
                }
                
                for future in as_completed(future_to_config):
                    if self.interrupted:
                        break
                        
                    config = future_to_config[future]
                    try:
                        result = future.result()
                        if result:
                            results.append(result)
                            status = "✅" if result.success else "❌"
                            self.logger.info(f"{status} Completed: {config.name}")
                    except Exception as e:
                        self.logger.error(f"Failed to get result for {config.name}: {e}")
                        
        # Run heavy configs sequentially
        if heavy_configs and not self.interrupted:
            self.logger.info(f"Running {len(heavy_configs)} heavy benchmarks sequentially")
            for config in heavy_configs:
                if self.interrupted:
                    break
                    
                result = self.run_benchmark_with_timeout(config, timeout_per_benchmark * 2)
                if result:
                    results.append(result)
                    status = "✅" if result.success else "❌"
                    self.logger.info(f"{status} Completed: {config.name}")
                    
        self.logger.info(f"Profile {profile.name} completed with {len(results)} results")
        return results
        
    def validate_performance_thresholds(self, results: List[BenchmarkResult], thresholds: Dict[str, float]) -> Tuple[bool, List[str]]:
        """Validate results against performance thresholds"""
        violations = []
        successful_results = [r for r in results if r.success]
        
        if not successful_results:
            return False, ["No successful benchmark results to validate"]
            
        # Check individual thresholds
        for result in successful_results:
            config_name = result.config.name
            
            if 'initialization_time_max_seconds' in thresholds:
                if result.initialization_time > thresholds['initialization_time_max_seconds']:
                    violations.append(f"{config_name}: Initialization time {result.initialization_time:.2f}s exceeds threshold {thresholds['initialization_time_max_seconds']}s")
                    
            if 'coordination_latency_max_ms' in thresholds:
                if result.coordination_latency > thresholds['coordination_latency_max_ms']:
                    violations.append(f"{config_name}: Coordination latency {result.coordination_latency:.1f}ms exceeds threshold {thresholds['coordination_latency_max_ms']}ms")
                    
            if 'memory_usage_max_mb' in thresholds:
                if result.memory_usage_mb > thresholds['memory_usage_max_mb']:
                    violations.append(f"{config_name}: Memory usage {result.memory_usage_mb:.1f}MB exceeds threshold {thresholds['memory_usage_max_mb']}MB")
                    
            if 'task_completion_rate_min' in thresholds:
                if result.task_completion_rate < thresholds['task_completion_rate_min']:
                    violations.append(f"{config_name}: Task completion rate {result.task_completion_rate:.2f} below threshold {thresholds['task_completion_rate_min']}")
                    
        # Check overall success rate
        success_rate = len(successful_results) / len(results)
        error_rate_threshold = thresholds.get('error_rate_max', 0.05)
        
        if success_rate < (1.0 - error_rate_threshold):
            violations.append(f"Overall success rate {success_rate:.2f} below threshold {1.0 - error_rate_threshold:.2f}")
            
        return len(violations) == 0, violations
        
    def generate_automation_report(self, profile: TestProfile, results: List[BenchmarkResult], 
                                 violations: List[str], automation_config: AutomationConfig) -> Dict[str, Any]:
        """Generate comprehensive automation report"""
        analysis = self.runner.analyze_results(results)
        
        report = {
            "automation_metadata": {
                "profile_name": profile.name,
                "profile_description": profile.description,
                "execution_time": datetime.now().isoformat(),
                "total_duration_minutes": (time.time() - self.start_time) / 60 if self.start_time else 0,
                "automation_config": asdict(automation_config),
                "environment": {
                    "python_version": sys.version,
                    "platform": sys.platform,
                    "working_directory": str(Path.cwd())
                }
            },
            "test_summary": {
                "total_configurations": len(profile.configurations),
                "completed_tests": len(results),
                "successful_tests": len([r for r in results if r.success]),
                "failed_tests": len([r for r in results if not r.success]),
                "interrupted": self.interrupted
            },
            "performance_validation": {
                "thresholds_met": len(violations) == 0,
                "violations_count": len(violations),
                "violations": violations,
                "thresholds_checked": profile.performance_thresholds
            },
            "benchmark_analysis": analysis,
            "recommendations": self._generate_recommendations(results, violations)
        }
        
        return report
        
    def _generate_recommendations(self, results: List[BenchmarkResult], violations: List[str]) -> List[str]:
        """Generate actionable recommendations based on test results"""
        recommendations = []
        
        successful_results = [r for r in results if r.success]
        failed_results = [r for r in results if not r.success]
        
        # Performance recommendations
        if successful_results:
            avg_init_time = sum(r.initialization_time for r in successful_results) / len(successful_results)
            if avg_init_time > 5.0:
                recommendations.append("Consider optimizing initialization process - average time exceeds 5 seconds")
                
            avg_coord_latency = sum(r.coordination_latency for r in successful_results) / len(successful_results)
            if avg_coord_latency > 200:
                recommendations.append("Consider optimizing coordination mechanisms - average latency exceeds 200ms")
                
        # Failure analysis recommendations
        if failed_results:
            failure_rate = len(failed_results) / len(results)
            if failure_rate > 0.1:
                recommendations.append(f"High failure rate ({failure_rate:.1%}) - investigate system stability")
                
        # Configuration recommendations
        topology_performance = {}
        for result in successful_results:
            topology = result.config.topology
            if topology not in topology_performance:
                topology_performance[topology] = []
            topology_performance[topology].append(result.coordination_latency)
            
        if topology_performance:
            best_topology = min(topology_performance.keys(), 
                              key=lambda t: sum(topology_performance[t]) / len(topology_performance[t]))
            recommendations.append(f"Best performing topology: {best_topology}")
            
        # Threshold violations recommendations
        if violations:
            recommendations.append("Review and possibly adjust performance thresholds based on current violations")
            
        return recommendations
        
    def save_automation_artifacts(self, report: Dict[str, Any], results: List[BenchmarkResult]) -> Dict[str, str]:
        """Save all automation artifacts"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_dir = Path("automation-results")
        output_dir.mkdir(exist_ok=True)
        
        artifacts = {}
        
        # Save comprehensive report
        report_file = output_dir / f"automation_report_{timestamp}.json"
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2)
        artifacts["report"] = str(report_file)
        
        # Save raw results if requested
        if self.config.get('output_settings', {}).get('save_raw_results', True):
            results_file = output_dir / f"raw_results_{timestamp}.json"
            with open(results_file, 'w') as f:
                json.dump([asdict(r) for r in results], f, indent=2)
            artifacts["raw_results"] = str(results_file)
            
        # Save CSV summary if requested
        if self.config.get('output_settings', {}).get('save_csv_summary', True):
            csv_file = output_dir / f"summary_{timestamp}.csv"
            with open(csv_file, 'w') as f:
                f.write("name,topology,coordination,memory_type,agent_count,success,init_time,coord_latency,memory_mb,completion_rate\n")
                for result in results:
                    config = result.config
                    f.write(f"{config.name},{config.topology},{config.coordination},{config.memory_type},"
                           f"{config.agent_count},{result.success},{result.initialization_time:.3f},"
                           f"{result.coordination_latency:.2f},{result.memory_usage_mb:.1f},"
                           f"{result.task_completion_rate:.2f}\n")
            artifacts["csv_summary"] = str(csv_file)
            
        self.logger.info(f"Automation artifacts saved to {output_dir}")
        for artifact_type, path in artifacts.items():
            self.logger.info(f"  {artifact_type}: {path}")
            
        return artifacts
        
    def run_automated_tests(self, profile_name: str, automation_config: AutomationConfig) -> Dict[str, Any]:
        """Run complete automated test suite"""
        self.start_time = time.time()
        
        try:
            # Validate environment
            self.logger.info("Validating test environment...")
            env_valid, env_issues = self.validate_environment()
            if not env_valid:
                raise RuntimeError(f"Environment validation failed: {env_issues}")
                
            # Create test profile
            self.logger.info(f"Loading test profile: {profile_name}")
            profile = self.create_test_profile(profile_name)
            
            # Run tests
            self.logger.info("Starting automated test execution...")
            results = self.run_profile_tests(profile, automation_config)
            
            if not results:
                raise RuntimeError("No test results generated")
                
            # Validate performance thresholds
            self.logger.info("Validating performance thresholds...")
            thresholds_met, violations = self.validate_performance_thresholds(results, profile.performance_thresholds)
            
            # Generate report
            self.logger.info("Generating automation report...")
            report = self.generate_automation_report(profile, results, violations, automation_config)
            
            # Save artifacts
            if automation_config.save_artifacts:
                artifacts = self.save_automation_artifacts(report, results)
                report["artifacts"] = artifacts
                
            # Log summary
            self.logger.info("=" * 60)
            self.logger.info("AUTOMATION SUMMARY")
            self.logger.info(f"Profile: {profile.name}")
            self.logger.info(f"Tests completed: {len(results)}/{len(profile.configurations)}")
            self.logger.info(f"Success rate: {len([r for r in results if r.success])/len(results):.1%}")
            self.logger.info(f"Thresholds met: {'✅' if thresholds_met else '❌'}")
            if violations:
                self.logger.warning(f"Performance violations: {len(violations)}")
                for violation in violations[:3]:  # Show first 3
                    self.logger.warning(f"  - {violation}")
                    
            return report
            
        except Exception as e:
            self.logger.error(f"Automated test execution failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "execution_time": datetime.now().isoformat(),
                "interrupted": self.interrupted
            }
            
def main():
    """Main automation entry point"""
    parser = argparse.ArgumentParser(description="Automated Hive Mind Benchmark Test Runner")
    parser.add_argument('--profile', default='quick', choices=['quick', 'standard', 'comprehensive', 'stress'],
                       help='Test profile to run')
    parser.add_argument('--config', help='Path to test configuration file')
    parser.add_argument('--output-dir', default='automation-results', help='Output directory for results')
    parser.add_argument('--timeout', type=int, default=60, help='Timeout in minutes for entire test suite')
    parser.add_argument('--retries', type=int, default=2, help='Number of retries for failed tests')
    parser.add_argument('--fail-fast', action='store_true', help='Stop on first test failure')
    parser.add_argument('--no-reports', action='store_true', help='Skip report generation')
    parser.add_argument('--no-artifacts', action='store_true', help='Skip saving artifacts')
    parser.add_argument('--quiet', action='store_true', help='Reduce logging output')
    
    args = parser.parse_args()
    
    # Setup logging level
    if args.quiet:
        logging.getLogger().setLevel(logging.WARNING)
        
    try:
        # Create automation configuration
        automation_config = AutomationConfig(
            profile=args.profile,
            output_dir=args.output_dir,
            timeout_minutes=args.timeout,
            retry_count=args.retries,
            retry_delay=5,
            fail_fast=args.fail_fast,
            generate_reports=not args.no_reports,
            save_artifacts=not args.no_artifacts,
            notify_on_failure=False,
            cleanup_on_exit=True
        )
        
        # Run automated tests
        runner = AutomatedTestRunner(args.config)
        report = runner.run_automated_tests(args.profile, automation_config)
        
        # Exit with appropriate code
        if report.get('success', True) and report.get('performance_validation', {}).get('thresholds_met', True):
            print("\n✅ All automated tests passed!")
            sys.exit(0)
        else:
            print("\n❌ Automated tests failed or thresholds not met!")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\n⚠️  Automated tests interrupted by user")
        sys.exit(130)
    except Exception as e:
        print(f"\n💥 Automated test execution failed: {e}")
        sys.exit(1)
        
if __name__ == "__main__":
    main()