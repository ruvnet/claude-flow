"""Comprehensive unit tests for data models."""

import unittest
from datetime import datetime, timedelta
from swarm_benchmark.core.models import (
    Task, Agent, Result, Benchmark, BenchmarkConfig,
    TaskStatus, AgentStatus, ResultStatus, StrategyType, CoordinationMode, AgentType,
    PerformanceMetrics, QualityMetrics, ResourceUsage, BenchmarkMetrics
)


class TestTask(unittest.TestCase):
    """Test Task model."""
    
    def test_task_creation_with_defaults(self):
        """Test task creation with default values."""
        task = Task(objective="Test objective")
        
        self.assertIsNotNone(task.id)
        self.assertEqual(task.objective, "Test objective")
        self.assertEqual(task.strategy, StrategyType.AUTO)
        self.assertEqual(task.mode, CoordinationMode.CENTRALIZED)
        self.assertEqual(task.status, TaskStatus.PENDING)
        self.assertIsInstance(task.created_at, datetime)
        self.assertEqual(task.timeout, 3600)
        self.assertEqual(task.max_retries, 3)
        self.assertEqual(task.priority, 1)
    
    def test_task_duration_calculation(self):
        """Test task duration calculation."""
        task = Task(objective="Test")
        
        # No duration when not started
        self.assertIsNone(task.duration())
        
        # Set start time
        start_time = datetime.now()
        task.started_at = start_time
        
        # Still no duration without completion
        self.assertIsNone(task.duration())
        
        # Set completion time
        end_time = start_time + timedelta(seconds=10)
        task.completed_at = end_time
        
        # Should calculate duration
        self.assertAlmostEqual(task.duration(), 10.0, places=1)
    
    def test_task_with_custom_values(self):
        """Test task creation with custom values."""
        task = Task(
            objective="Custom task",
            description="Test description",
            strategy=StrategyType.RESEARCH,
            mode=CoordinationMode.DISTRIBUTED,
            timeout=1800,
            max_retries=5,
            priority=2
        )
        
        self.assertEqual(task.objective, "Custom task")
        self.assertEqual(task.description, "Test description")
        self.assertEqual(task.strategy, StrategyType.RESEARCH)
        self.assertEqual(task.mode, CoordinationMode.DISTRIBUTED)
        self.assertEqual(task.timeout, 1800)
        self.assertEqual(task.max_retries, 5)
        self.assertEqual(task.priority, 2)


class TestAgent(unittest.TestCase):
    """Test Agent model."""
    
    def test_agent_creation_with_defaults(self):
        """Test agent creation with default values."""
        agent = Agent()
        
        self.assertIsNotNone(agent.id)
        self.assertEqual(agent.type, AgentType.SPECIALIST)
        self.assertEqual(agent.status, AgentStatus.IDLE)
        self.assertEqual(agent.total_tasks_completed, 0)
        self.assertEqual(agent.total_tasks_failed, 0)
        self.assertEqual(agent.success_rate, 1.0)
        self.assertEqual(agent.average_execution_time, 0.0)
        self.assertIsInstance(agent.created_at, datetime)
        self.assertIsInstance(agent.last_active, datetime)
    
    def test_agent_performance_update(self):
        """Test agent performance update."""
        agent = Agent()
        
        # Create performance metrics
        metrics1 = PerformanceMetrics(
            execution_time=10.0,
            success_rate=1.0
        )
        
        agent.update_performance(metrics1)
        
        self.assertEqual(agent.total_tasks_completed, 1)
        self.assertEqual(agent.total_tasks_failed, 0)
        self.assertEqual(agent.success_rate, 1.0)
        self.assertEqual(agent.average_execution_time, 10.0)
        
        # Add a failed task
        metrics2 = PerformanceMetrics(
            execution_time=5.0,
            success_rate=0.0
        )
        
        agent.update_performance(metrics2)
        
        self.assertEqual(agent.total_tasks_completed, 1)
        self.assertEqual(agent.total_tasks_failed, 1)
        self.assertEqual(agent.success_rate, 0.5)
        self.assertEqual(agent.average_execution_time, 7.5)
    
    def test_agent_with_custom_values(self):
        """Test agent creation with custom values."""
        agent = Agent(
            name="Test Agent",
            type=AgentType.RESEARCHER,
            capabilities=["research", "analysis"]
        )
        
        self.assertEqual(agent.name, "Test Agent")
        self.assertEqual(agent.type, AgentType.RESEARCHER)
        self.assertEqual(agent.capabilities, ["research", "analysis"])


class TestResult(unittest.TestCase):
    """Test Result model."""
    
    def test_result_creation_with_defaults(self):
        """Test result creation with default values."""
        result = Result(task_id="task1", agent_id="agent1")
        
        self.assertIsNotNone(result.id)
        self.assertEqual(result.task_id, "task1")
        self.assertEqual(result.agent_id, "agent1")
        self.assertEqual(result.status, ResultStatus.SUCCESS)
        self.assertIsInstance(result.performance_metrics, PerformanceMetrics)
        self.assertIsInstance(result.quality_metrics, QualityMetrics)
        self.assertIsInstance(result.resource_usage, ResourceUsage)
        self.assertIsInstance(result.created_at, datetime)
    
    def test_result_duration_calculation(self):
        """Test result duration calculation."""
        result = Result()
        
        # No duration when not started
        self.assertIsNone(result.duration())
        
        # Set start and end times
        start_time = datetime.now()
        result.started_at = start_time
        result.completed_at = start_time + timedelta(seconds=5)
        
        # Should calculate duration
        self.assertAlmostEqual(result.duration(), 5.0, places=1)


class TestBenchmarkMetrics(unittest.TestCase):
    """Test BenchmarkMetrics model."""
    
    def test_metrics_update_from_results(self):
        """Test metrics update from results."""
        metrics = BenchmarkMetrics()
        
        # Create sample results
        results = [
            Result(
                status=ResultStatus.SUCCESS,
                performance_metrics=PerformanceMetrics(execution_time=10.0),
                quality_metrics=QualityMetrics(overall_quality=0.9),
                resource_usage=ResourceUsage(peak_memory_mb=100.0)
            ),
            Result(
                status=ResultStatus.SUCCESS,
                performance_metrics=PerformanceMetrics(execution_time=15.0),
                quality_metrics=QualityMetrics(overall_quality=0.8),
                resource_usage=ResourceUsage(peak_memory_mb=150.0)
            ),
            Result(
                status=ResultStatus.FAILURE,
                performance_metrics=PerformanceMetrics(execution_time=5.0),
                quality_metrics=QualityMetrics(overall_quality=0.0),
                resource_usage=ResourceUsage(peak_memory_mb=50.0)
            )
        ]
        
        metrics.update_from_results(results)
        
        self.assertEqual(metrics.total_tasks, 3)
        self.assertEqual(metrics.completed_tasks, 2)
        self.assertEqual(metrics.failed_tasks, 1)
        self.assertAlmostEqual(metrics.success_rate, 2/3, places=2)
        self.assertAlmostEqual(metrics.average_execution_time, 10.0, places=1)
        self.assertEqual(metrics.total_execution_time, 30.0)
        self.assertAlmostEqual(metrics.quality_score, 0.85, places=2)
        self.assertEqual(metrics.peak_memory_usage, 150.0)


class TestBenchmark(unittest.TestCase):
    """Test Benchmark model."""
    
    def test_benchmark_creation_with_defaults(self):
        """Test benchmark creation with default values."""
        benchmark = Benchmark()
        
        self.assertIsNotNone(benchmark.id)
        self.assertEqual(benchmark.status, TaskStatus.PENDING)
        self.assertIsInstance(benchmark.config, BenchmarkConfig)
        self.assertIsInstance(benchmark.metrics, BenchmarkMetrics)
        self.assertIsInstance(benchmark.created_at, datetime)
        self.assertEqual(len(benchmark.tasks), 0)
        self.assertEqual(len(benchmark.agents), 0)
        self.assertEqual(len(benchmark.results), 0)
    
    def test_benchmark_add_components(self):
        """Test adding components to benchmark."""
        benchmark = Benchmark()
        
        # Add task
        task = Task(objective="Test task")
        benchmark.add_task(task)
        self.assertEqual(len(benchmark.tasks), 1)
        self.assertEqual(benchmark.tasks[0], task)
        
        # Add agent
        agent = Agent(name="Test agent")
        benchmark.add_agent(agent)
        self.assertEqual(len(benchmark.agents), 1)
        self.assertEqual(benchmark.agents[0], agent)
        
        # Add result
        result = Result(task_id=task.id, agent_id=agent.id)
        benchmark.add_result(result)
        self.assertEqual(len(benchmark.results), 1)
        self.assertEqual(benchmark.results[0], result)
    
    def test_benchmark_get_by_id(self):
        """Test getting components by ID."""
        benchmark = Benchmark()
        
        # Add components
        task = Task(objective="Test task")
        agent = Agent(name="Test agent")
        result = Result(task_id=task.id, agent_id=agent.id)
        
        benchmark.add_task(task)
        benchmark.add_agent(agent)
        benchmark.add_result(result)
        
        # Test retrieval
        self.assertEqual(benchmark.get_task_by_id(task.id), task)
        self.assertEqual(benchmark.get_agent_by_id(agent.id), agent)
        self.assertIsNone(benchmark.get_task_by_id("nonexistent"))
        
        # Test getting results by IDs
        task_results = benchmark.get_results_by_task_id(task.id)
        agent_results = benchmark.get_results_by_agent_id(agent.id)
        
        self.assertEqual(len(task_results), 1)
        self.assertEqual(len(agent_results), 1)
        self.assertEqual(task_results[0], result)
        self.assertEqual(agent_results[0], result)
    
    def test_benchmark_duration_calculation(self):
        """Test benchmark duration calculation."""
        benchmark = Benchmark()
        
        # No duration when not started
        self.assertIsNone(benchmark.duration())
        
        # Set start and end times
        start_time = datetime.now()
        benchmark.started_at = start_time
        benchmark.completed_at = start_time + timedelta(minutes=5)
        
        # Should calculate duration
        self.assertAlmostEqual(benchmark.duration(), 300.0, places=1)


class TestBenchmarkConfig(unittest.TestCase):
    """Test BenchmarkConfig model."""
    
    def test_config_creation_with_defaults(self):
        """Test config creation with default values."""
        config = BenchmarkConfig()
        
        self.assertEqual(config.name, "benchmark")
        self.assertEqual(config.strategy, StrategyType.AUTO)
        self.assertEqual(config.mode, CoordinationMode.CENTRALIZED)
        self.assertEqual(config.max_agents, 5)
        self.assertEqual(config.max_tasks, 100)
        self.assertEqual(config.timeout, 3600)
        self.assertEqual(config.task_timeout, 300)
        self.assertEqual(config.max_retries, 3)
        self.assertFalse(config.parallel)
        self.assertFalse(config.background)
        self.assertTrue(config.monitoring)
        self.assertEqual(config.quality_threshold, 0.8)
        self.assertEqual(config.output_formats, ["json"])
        self.assertEqual(config.output_directory, "./reports")
        self.assertFalse(config.verbose)
    
    def test_config_with_custom_values(self):
        """Test config creation with custom values."""
        config = BenchmarkConfig(
            name="Custom Benchmark",
            strategy=StrategyType.DEVELOPMENT,
            mode=CoordinationMode.HIERARCHICAL,
            max_agents=10,
            parallel=True,
            verbose=True
        )
        
        self.assertEqual(config.name, "Custom Benchmark")
        self.assertEqual(config.strategy, StrategyType.DEVELOPMENT)
        self.assertEqual(config.mode, CoordinationMode.HIERARCHICAL)
        self.assertEqual(config.max_agents, 10)
        self.assertTrue(config.parallel)
        self.assertTrue(config.verbose)


class TestPerformanceMetrics(unittest.TestCase):
    """Test PerformanceMetrics model."""
    
    def test_performance_metrics_creation(self):
        """Test performance metrics creation."""
        metrics = PerformanceMetrics(
            execution_time=10.5,
            queue_time=2.0,
            throughput=5.0,
            success_rate=0.95,
            error_rate=0.05,
            retry_count=1
        )
        
        self.assertEqual(metrics.execution_time, 10.5)
        self.assertEqual(metrics.queue_time, 2.0)
        self.assertEqual(metrics.throughput, 5.0)
        self.assertEqual(metrics.success_rate, 0.95)
        self.assertEqual(metrics.error_rate, 0.05)
        self.assertEqual(metrics.retry_count, 1)


class TestQualityMetrics(unittest.TestCase):
    """Test QualityMetrics model."""
    
    def test_quality_metrics_creation(self):
        """Test quality metrics creation."""
        metrics = QualityMetrics(
            accuracy_score=0.9,
            completeness_score=0.8,
            consistency_score=0.95,
            relevance_score=0.85,
            overall_quality=0.87,
            review_score=0.9
        )
        
        self.assertEqual(metrics.accuracy_score, 0.9)
        self.assertEqual(metrics.completeness_score, 0.8)
        self.assertEqual(metrics.consistency_score, 0.95)
        self.assertEqual(metrics.relevance_score, 0.85)
        self.assertEqual(metrics.overall_quality, 0.87)
        self.assertEqual(metrics.review_score, 0.9)


class TestResourceUsage(unittest.TestCase):
    """Test ResourceUsage model."""
    
    def test_resource_usage_creation(self):
        """Test resource usage creation."""
        usage = ResourceUsage(
            cpu_percent=25.5,
            memory_mb=512.0,
            network_bytes_sent=1024,
            network_bytes_recv=2048,
            disk_bytes_read=4096,
            disk_bytes_write=2048,
            peak_memory_mb=600.0,
            average_cpu_percent=20.0
        )
        
        self.assertEqual(usage.cpu_percent, 25.5)
        self.assertEqual(usage.memory_mb, 512.0)
        self.assertEqual(usage.network_bytes_sent, 1024)
        self.assertEqual(usage.network_bytes_recv, 2048)
        self.assertEqual(usage.disk_bytes_read, 4096)
        self.assertEqual(usage.disk_bytes_write, 2048)
        self.assertEqual(usage.peak_memory_mb, 600.0)
        self.assertEqual(usage.average_cpu_percent, 20.0)


if __name__ == '__main__':
    unittest.main()