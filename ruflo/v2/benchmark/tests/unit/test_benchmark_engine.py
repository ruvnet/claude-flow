"""Unit tests for benchmark engine."""

import unittest
import asyncio
from unittest.mock import patch, MagicMock
from swarm_benchmark.core.benchmark_engine import BenchmarkEngine
from swarm_benchmark.core.models import (
    BenchmarkConfig, Task, StrategyType, CoordinationMode, TaskStatus
)


class TestBenchmarkEngine(unittest.TestCase):
    """Test BenchmarkEngine class."""
    
    def setUp(self):
        """Set up test fixtures."""
        self.config = BenchmarkConfig(
            name="Test Benchmark",
            strategy=StrategyType.AUTO,
            mode=CoordinationMode.CENTRALIZED,
            max_agents=3,
            output_formats=["json"]
        )
        self.engine = BenchmarkEngine(self.config)
    
    def test_engine_initialization(self):
        """Test engine initialization."""
        self.assertEqual(self.engine.status, "READY")
        self.assertEqual(self.engine.config.name, "Test Benchmark")
        self.assertIsNone(self.engine.current_benchmark)
        self.assertEqual(len(self.engine.task_queue), 0)
    
    def test_submit_task(self):
        """Test task submission."""
        task = Task(objective="Test task")
        self.engine.submit_task(task)
        
        self.assertEqual(len(self.engine.task_queue), 1)
        self.assertEqual(self.engine.task_queue[0], task)
    
    @patch('swarm_benchmark.strategies.create_strategy')
    @patch('swarm_benchmark.core.benchmark_engine.JSONWriter')
    def test_run_benchmark_success(self, mock_json_writer, mock_create_strategy):
        """Test successful benchmark run."""
        # Mock strategy
        mock_strategy = MagicMock()
        mock_result = MagicMock()
        mock_result.status.value = "SUCCESS"
        mock_strategy.execute.return_value = mock_result
        mock_create_strategy.return_value = mock_strategy
        
        # Mock JSON writer
        mock_writer = MagicMock()
        mock_writer.save_benchmark.return_value = None
        mock_json_writer.return_value = mock_writer
        
        # Run test
        async def run_test():
            result = await self.engine.run_benchmark("Test objective")
            return result
        
        result = asyncio.run(run_test())
        
        # Assertions
        self.assertEqual(result["status"], "success")
        self.assertIn("benchmark_id", result)
        self.assertIn("duration", result)
        self.assertIn("results", result)
        
        # Verify strategy was called
        mock_create_strategy.assert_called_once_with("auto")
        mock_strategy.execute.assert_called_once()
    
    @patch('swarm_benchmark.strategies.create_strategy')
    def test_run_benchmark_failure(self, mock_create_strategy):
        """Test benchmark run with failure."""
        # Mock strategy that raises exception
        mock_create_strategy.side_effect = Exception("Strategy failed")
        
        # Run test
        async def run_test():
            result = await self.engine.run_benchmark("Test objective")
            return result
        
        result = asyncio.run(run_test())
        
        # Assertions
        self.assertEqual(result["status"], "failed")
        self.assertIn("error", result)
        self.assertEqual(result["error"], "Strategy failed")
    
    @patch('swarm_benchmark.strategies.create_strategy')
    def test_execute_batch(self, mock_create_strategy):
        """Test batch execution."""
        # Mock strategy
        mock_strategy = MagicMock()
        mock_result = MagicMock()
        mock_strategy.execute.return_value = mock_result
        mock_create_strategy.return_value = mock_strategy
        
        # Create tasks
        tasks = [
            Task(objective="Task 1", strategy=StrategyType.AUTO),
            Task(objective="Task 2", strategy=StrategyType.RESEARCH)
        ]
        
        # Run test
        async def run_test():
            results = await self.engine.execute_batch(tasks)
            return results
        
        results = asyncio.run(run_test())
        
        # Assertions
        self.assertEqual(len(results), 2)
        self.assertEqual(mock_strategy.execute.call_count, 2)
    
    def test_result_to_dict(self):
        """Test result to dictionary conversion."""
        from swarm_benchmark.core.models import Result, ResultStatus, PerformanceMetrics, ResourceUsage
        from datetime import datetime
        
        result = Result(
            task_id="task1",
            agent_id="agent1", 
            status=ResultStatus.SUCCESS,
            output={"test": "data"},
            performance_metrics=PerformanceMetrics(execution_time=10.5),
            resource_usage=ResourceUsage(cpu_percent=25.0, memory_mb=128.0),
            created_at=datetime.now(),
            completed_at=datetime.now()
        )
        
        result_dict = self.engine._result_to_dict(result)
        
        # Assertions
        self.assertEqual(result_dict["task_id"], "task1")
        self.assertEqual(result_dict["agent_id"], "agent1")
        self.assertEqual(result_dict["status"], "success")
        self.assertEqual(result_dict["output"], {"test": "data"})
        self.assertEqual(result_dict["execution_time"], 10.5)
        self.assertEqual(result_dict["resource_usage"]["cpu_percent"], 25.0)
        self.assertEqual(result_dict["resource_usage"]["memory_mb"], 128.0)


if __name__ == '__main__':
    unittest.main()