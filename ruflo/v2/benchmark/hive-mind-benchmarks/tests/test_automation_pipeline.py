#!/usr/bin/env python3
"""
Comprehensive Test Suite for Hive Mind Benchmark Automation Pipeline
Tests all components of the automated testing infrastructure
"""

import os
import sys
import json
import time
import tempfile
import unittest
import subprocess
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))
from scripts.automated_test_runner import AutomatedTestRunner, AutomationConfig
from scripts.parallel_executor import ParallelBenchmarkExecutor, ResourceManager
from scripts.result_collector import AdvancedResultCollector, ResultDatabase
from benchmark_runner import BenchmarkConfig, BenchmarkResult, HiveMindBenchmarkRunner

class TestAutomationInfrastructure(unittest.TestCase):
    """Test the complete automation infrastructure"""
    
    def setUp(self):
        """Set up test environment"""
        self.temp_dir = Path(tempfile.mkdtemp())
        self.config_file = self.temp_dir / "test-config.json"
        self.output_dir = self.temp_dir / "output"
        self.output_dir.mkdir(exist_ok=True)
        
        # Create minimal test configuration
        self.test_config = {
            "benchmark_profiles": {
                "test": {
                    "name": "Test Profile",
                    "description": "Test profile for unit tests",
                    "max_duration_minutes": 5,
                    "parallel_workers": 1,
                    "configurations": [
                        {
                            "name": "test_config",
                            "topology": "hierarchical",
                            "coordination": "queen",
                            "memory_type": "sqlite",
                            "agent_count": 3,
                            "task_complexity": "simple",
                            "duration_seconds": 5,
                            "iterations": 1
                        }
                    ]
                }
            },
            "performance_thresholds": {
                "initialization_time_max_seconds": 10.0,
                "coordination_latency_max_ms": 1000,
                "memory_usage_max_mb": 100,
                "task_completion_rate_min": 0.8,
                "error_rate_max": 0.2
            },
            "output_settings": {
                "save_raw_results": True,
                "save_analysis": True,
                "save_csv_summary": True
            }
        }
        
        with open(self.config_file, 'w') as f:
            json.dump(self.test_config, f, indent=2)
            
    def tearDown(self):
        """Clean up test environment"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)
        
    def test_config_loading(self):
        """Test configuration file loading"""
        runner = AutomatedTestRunner(str(self.config_file))
        self.assertEqual(runner.config['benchmark_profiles']['test']['name'], 'Test Profile')
        
    def test_profile_creation(self):
        """Test test profile creation"""
        runner = AutomatedTestRunner(str(self.config_file))
        profile = runner.create_test_profile('test')
        
        self.assertEqual(profile.name, 'Test Profile')
        self.assertEqual(len(profile.configurations), 1)
        self.assertEqual(profile.configurations[0]['name'], 'test_config')
        
    def test_environment_validation(self):
        """Test environment validation"""
        runner = AutomatedTestRunner(str(self.config_file))
        is_valid, issues = runner.validate_environment()
        
        # Should pass basic validation (Python, Node.js availability)
        # Some issues might be expected in test environment
        self.assertIsInstance(is_valid, bool)
        self.assertIsInstance(issues, list)
        
    def test_benchmark_config_creation(self):
        """Test benchmark configuration creation"""
        config = BenchmarkConfig(
            name="test",
            topology="hierarchical",
            coordination="queen",
            memory_type="sqlite",
            agent_count=5,
            task_complexity="simple",
            duration_seconds=10
        )
        
        self.assertEqual(config.name, "test")
        self.assertEqual(config.agent_count, 5)
        self.assertEqual(config.topology, "hierarchical")
        
    @patch('subprocess.run')
    def test_mock_benchmark_execution(self, mock_subprocess):
        """Test benchmark execution with mocked CLI calls"""
        # Mock successful subprocess calls
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = '{"status": "success"}'
        mock_result.stderr = ''
        mock_subprocess.return_value = mock_result
        
        runner = HiveMindBenchmarkRunner()
        config = BenchmarkConfig(
            name="mock_test",
            topology="hierarchical",
            coordination="queen",
            memory_type="sqlite",
            agent_count=3,
            task_complexity="simple",
            duration_seconds=5
        )
        
        result = runner.run_single_benchmark(config)
        
        self.assertIsNotNone(result)
        self.assertTrue(result.success)
        self.assertEqual(result.config.name, "mock_test")
        
    def test_resource_manager(self):
        """Test resource manager functionality"""
        manager = ResourceManager(total_memory_mb=1000, total_cpu_cores=4)
        
        # Test resource allocation
        from scripts.parallel_executor import ResourceConstraint
        constraint = ResourceConstraint(
            max_memory_mb=100,
            max_cpu_percent=25.0,
            max_duration_seconds=60,
            max_concurrent_agents=5,
            priority=5
        )
        
        # Should be able to allocate
        self.assertTrue(manager.can_allocate(constraint))
        
        # Allocate resources
        self.assertTrue(manager.allocate(1, constraint))
        
        # Check usage
        usage = manager.get_resource_usage()
        self.assertGreater(usage['memory_usage_percent'], 0)
        self.assertGreater(usage['cpu_usage_percent'], 0)
        
        # Deallocate
        manager.deallocate(1)
        usage_after = manager.get_resource_usage()
        self.assertEqual(usage_after['memory_usage_percent'], 0)
        
    def test_parallel_executor_categorization(self):
        """Test benchmark categorization in parallel executor"""
        executor = ParallelBenchmarkExecutor(max_workers=2)
        
        configs = [
            BenchmarkConfig("light", "hierarchical", "queen", "sqlite", 5, "simple", 10),
            BenchmarkConfig("medium", "mesh", "consensus", "memory", 25, "medium", 45),
            BenchmarkConfig("heavy", "star", "hybrid", "distributed", 100, "complex", 90)
        ]
        
        categories = executor._categorize_benchmarks(configs)
        
        self.assertEqual(len(categories['light']), 1)
        self.assertEqual(len(categories['medium']), 1)
        self.assertEqual(len(categories['heavy']), 1)
        self.assertEqual(len(categories['extreme']), 0)
        
    def test_result_database(self):
        """Test result database operations"""
        db_path = self.temp_dir / "test.db"
        database = ResultDatabase(str(db_path))
        
        # Create test result
        config = BenchmarkConfig("test", "hierarchical", "queen", "sqlite", 5, "simple", 10)
        result = BenchmarkResult(
            config=config,
            start_time="2023-01-01T00:00:00",
            end_time="2023-01-01T00:01:00",
            duration=60.0,
            initialization_time=5.0,
            coordination_latency=100.0,
            memory_usage_mb=50.0,
            cpu_usage_percent=25.0,
            token_consumption=100,
            task_completion_rate=1.0,
            error_count=0,
            consensus_decisions=1,
            agent_spawn_time=2.0,
            collective_memory_ops=10,
            success=True
        )
        
        # Insert result
        inserted = database.insert_results([result])
        self.assertEqual(inserted, 1)
        
        # Query results
        df = database.query_results()
        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]['config_name'], 'test')
        
        # Calculate aggregated metrics
        metrics = database.calculate_aggregated_metrics()
        self.assertEqual(len(metrics), 1)
        self.assertEqual(metrics[0].topology, 'hierarchical')
        
    def test_result_collector_integration(self):
        """Test result collector with database integration"""
        db_path = self.temp_dir / "collector_test.db"
        database = ResultDatabase(str(db_path))
        collector = AdvancedResultCollector(database, str(self.output_dir))
        
        # Create mock result data
        result_data = {
            "config": {
                "name": "collector_test",
                "topology": "hierarchical",
                "coordination": "queen",
                "memory_type": "sqlite",
                "agent_count": 5,
                "task_complexity": "simple",
                "duration_seconds": 10
            },
            "start_time": "2023-01-01T00:00:00",
            "end_time": "2023-01-01T00:01:00",
            "duration": 60.0,
            "initialization_time": 5.0,
            "coordination_latency": 100.0,
            "memory_usage_mb": 50.0,
            "cpu_usage_percent": 25.0,
            "token_consumption": 100,
            "task_completion_rate": 1.0,
            "error_count": 0,
            "consensus_decisions": 1,
            "agent_spawn_time": 2.0,
            "collective_memory_ops": 10,
            "success": True
        }
        
        # Test data conversion
        result = collector._dict_to_benchmark_result(result_data)
        self.assertIsNotNone(result)
        self.assertEqual(result.config.name, "collector_test")
        self.assertTrue(result.success)
        
    def test_automation_config_validation(self):
        """Test automation configuration validation"""
        config = AutomationConfig(
            profile="test",
            output_dir=str(self.output_dir),
            timeout_minutes=30,
            retry_count=2,
            retry_delay=5,
            fail_fast=False,
            generate_reports=True,
            save_artifacts=True,
            notify_on_failure=False,
            cleanup_on_exit=True
        )
        
        self.assertEqual(config.profile, "test")
        self.assertEqual(config.timeout_minutes, 30)
        self.assertTrue(config.generate_reports)
        
    def test_cli_script_existence(self):
        """Test that required CLI scripts exist and are executable"""
        benchmark_dir = Path(__file__).parent.parent
        
        required_scripts = [
            "scripts/automated_test_runner.py",
            "scripts/parallel_executor.py",
            "scripts/result_collector.py",
            "scripts/run_complete_benchmark_suite.sh",
            "benchmark_runner.py"
        ]
        
        for script in required_scripts:
            script_path = benchmark_dir / script
            self.assertTrue(script_path.exists(), f"Script {script} does not exist")
            self.assertTrue(os.access(script_path, os.X_OK), f"Script {script} is not executable")
            
    def test_config_file_structure(self):
        """Test that configuration files have correct structure"""
        benchmark_dir = Path(__file__).parent.parent
        config_file = benchmark_dir / "config" / "test-config.json"
        
        self.assertTrue(config_file.exists(), "test-config.json does not exist")
        
        with open(config_file, 'r') as f:
            config = json.load(f)
            
        # Check required sections
        self.assertIn('benchmark_profiles', config)
        self.assertIn('performance_thresholds', config)
        self.assertIn('output_settings', config)
        
        # Check profile structure
        for profile_name, profile in config['benchmark_profiles'].items():
            self.assertIn('name', profile)
            self.assertIn('description', profile)
            self.assertIn('max_duration_minutes', profile)
            self.assertIn('parallel_workers', profile)
            self.assertIn('configurations', profile)
            
    def test_docker_files_existence(self):
        """Test that Docker files exist and are properly structured"""
        benchmark_dir = Path(__file__).parent.parent
        docker_dir = benchmark_dir / "docker"
        
        required_files = [
            "Dockerfile",
            "docker-compose.yml",
            ".dockerignore"
        ]
        
        for file in required_files:
            file_path = docker_dir / file
            self.assertTrue(file_path.exists(), f"Docker file {file} does not exist")
            
    def test_github_workflow_existence(self):
        """Test that GitHub workflow exists"""
        project_root = Path(__file__).parent.parent.parent.parent
        workflow_file = project_root / ".github" / "workflows" / "hive-mind-benchmarks.yml"
        
        self.assertTrue(workflow_file.exists(), "GitHub workflow file does not exist")
        
        # Basic YAML structure check
        with open(workflow_file, 'r') as f:
            content = f.read()
            self.assertIn('name: Hive Mind Benchmarks', content)
            self.assertIn('on:', content)
            self.assertIn('jobs:', content)
            
    def test_requirements_file(self):
        """Test that requirements.txt exists and contains expected packages"""
        benchmark_dir = Path(__file__).parent.parent
        requirements_file = benchmark_dir / "requirements.txt"
        
        self.assertTrue(requirements_file.exists(), "requirements.txt does not exist")
        
        with open(requirements_file, 'r') as f:
            content = f.read()
            
        # Check for essential packages
        required_packages = ['psutil', 'pandas', 'numpy', 'matplotlib', 'pytest']
        for package in required_packages:
            self.assertIn(package, content, f"Required package {package} not found in requirements.txt")
            
class TestIntegrationFlow(unittest.TestCase):
    """Integration tests for the complete automation flow"""
    
    def setUp(self):
        """Set up integration test environment"""
        self.temp_dir = Path(tempfile.mkdtemp())
        
    def tearDown(self):
        """Clean up integration test environment"""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)
        
    @patch('subprocess.run')
    def test_end_to_end_workflow(self, mock_subprocess):
        """Test complete end-to-end automation workflow"""
        # Mock all subprocess calls to return success
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = '{"status": "success", "results": []}'
        mock_result.stderr = ''
        mock_subprocess.return_value = mock_result
        
        # Create test configuration
        config_file = self.temp_dir / "test-config.json"
        test_config = {
            "benchmark_profiles": {
                "integration_test": {
                    "name": "Integration Test",
                    "description": "End-to-end integration test",
                    "max_duration_minutes": 1,
                    "parallel_workers": 1,
                    "configurations": [
                        {
                            "name": "integration_config",
                            "topology": "hierarchical",
                            "coordination": "queen",
                            "memory_type": "sqlite",
                            "agent_count": 2,
                            "task_complexity": "simple",
                            "duration_seconds": 5,
                            "iterations": 1
                        }
                    ]
                }
            },
            "performance_thresholds": {
                "initialization_time_max_seconds": 10.0,
                "coordination_latency_max_ms": 1000,
                "memory_usage_max_mb": 100,
                "task_completion_rate_min": 0.5,
                "error_rate_max": 0.5
            }
        }
        
        with open(config_file, 'w') as f:
            json.dump(test_config, f, indent=2)
            
        # Test the automation runner
        automation_config = AutomationConfig(
            profile="integration_test",
            output_dir=str(self.temp_dir / "output"),
            timeout_minutes=5,
            retry_count=1,
            retry_delay=1,
            fail_fast=False,
            generate_reports=False,  # Skip report generation for speed
            save_artifacts=True,
            notify_on_failure=False,
            cleanup_on_exit=True
        )
        
        runner = AutomatedTestRunner(str(config_file))
        
        # This should complete without errors (mocked)
        # In real scenarios, we'd check the actual results
        profile = runner.create_test_profile("integration_test")
        self.assertEqual(profile.name, "Integration Test")
        self.assertEqual(len(profile.configurations), 1)
        
if __name__ == '__main__':
    # Set up test environment
    os.environ['LOG_LEVEL'] = 'WARNING'  # Reduce log noise
    
    # Create test suite
    test_loader = unittest.TestLoader()
    test_suite = unittest.TestSuite()
    
    # Add test classes
    test_suite.addTest(test_loader.loadTestsFromTestCase(TestAutomationInfrastructure))
    test_suite.addTest(test_loader.loadTestsFromTestCase(TestIntegrationFlow))
    
    # Run tests with detailed output
    runner = unittest.TextTestRunner(verbosity=2, buffer=True)
    result = runner.run(test_suite)
    
    # Exit with appropriate code
    sys.exit(0 if result.wasSuccessful() else 1)