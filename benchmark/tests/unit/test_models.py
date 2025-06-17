"""Unit tests for data models."""

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


class TestAgent:
    """Test cases for Agent model."""
    
    def test_agent_creation(self):
        """Test basic agent creation."""
        agent = Agent(
            id="agent-1",
            type="worker",
            capabilities=["research", "analysis"]
        )
        
        assert agent.id == "agent-1"
        assert agent.type == "worker"
        assert agent.capabilities == ["research", "analysis"]
        assert agent.status == AgentStatus.IDLE
        assert agent.current_task is None
        assert isinstance(agent.created_at, datetime)
    
    def test_agent_task_assignment(self):
        """Test agent task assignment."""
        agent = Agent(id="agent-1", type="worker", capabilities=["research"])
        task = Task(id="task-1", objective="test", strategy="research", mode="centralized")
        
        agent.assign_task(task)
        assert agent.current_task == task
        assert agent.status == AgentStatus.BUSY
    
    def test_agent_task_completion(self):
        """Test agent task completion."""
        agent = Agent(id="agent-1", type="worker", capabilities=["research"])
        task = Task(id="task-1", objective="test", strategy="research", mode="centralized")
        
        agent.assign_task(task)
        agent.complete_task()
        
        assert agent.current_task is None
        assert agent.status == AgentStatus.IDLE


class TestResult:
    """Test cases for Result model."""
    
    def test_result_creation(self):
        """Test basic result creation."""
        resource_usage = ResourceUsage(
            cpu_usage=25.5,
            memory_usage=512,
            network_io=1024,
            disk_io=256
        )
        
        result = Result(
            task_id="task-1",
            agent_id="agent-1",
            status=ResultStatus.SUCCESS,
            output={"key": "value"},
            execution_time=120.5,
            resource_usage=resource_usage
        )
        
        assert result.task_id == "task-1"
        assert result.agent_id == "agent-1"
        assert result.status == ResultStatus.SUCCESS
        assert result.output == {"key": "value"}
        assert result.execution_time == 120.5
        assert result.resource_usage == resource_usage
        assert isinstance(result.completed_at, datetime)
    
    def test_result_with_errors(self):
        """Test result creation with errors."""
        result = Result(
            task_id="task-1",
            agent_id="agent-1",
            status=ResultStatus.FAILURE,
            output={},
            execution_time=10.0,
            errors=["Error 1", "Error 2"]
        )
        
        assert result.status == ResultStatus.FAILURE
        assert result.errors == ["Error 1", "Error 2"]


class TestBenchmark:
    """Test cases for Benchmark model."""
    
    def test_benchmark_creation(self):
        """Test basic benchmark creation."""
        benchmark = Benchmark(
            id="bench-1",
            name="Test Benchmark",
            description="A test benchmark",
            strategy="auto",
            mode="centralized"
        )
        
        assert benchmark.id == "bench-1"
        assert benchmark.name == "Test Benchmark"
        assert benchmark.description == "A test benchmark"
        assert benchmark.strategy == "auto"
        assert benchmark.mode == "centralized"
        assert benchmark.tasks == []
        assert benchmark.results == []
        assert isinstance(benchmark.started_at, datetime)
        assert benchmark.completed_at is None
    
    def test_benchmark_with_tasks(self):
        """Test benchmark with tasks."""
        tasks = [
            Task(id="task-1", objective="test 1", strategy="auto", mode="centralized"),
            Task(id="task-2", objective="test 2", strategy="auto", mode="centralized")
        ]
        
        benchmark = Benchmark(
            id="bench-1",
            name="Test Benchmark",
            description="A test benchmark",
            strategy="auto",
            mode="centralized",
            tasks=tasks
        )
        
        assert len(benchmark.tasks) == 2
        assert benchmark.tasks[0].id == "task-1"
        assert benchmark.tasks[1].id == "task-2"
    
    def test_benchmark_completion(self):
        """Test benchmark completion."""
        benchmark = Benchmark(
            id="bench-1",
            name="Test Benchmark",
            description="A test benchmark",
            strategy="auto",
            mode="centralized"
        )
        
        benchmark.complete()
        assert benchmark.completed_at is not None
        assert isinstance(benchmark.completed_at, datetime)


class TestResourceUsage:
    """Test cases for ResourceUsage model."""
    
    def test_resource_usage_creation(self):
        """Test resource usage creation."""
        usage = ResourceUsage(
            cpu_usage=50.0,
            memory_usage=1024,
            network_io=2048,
            disk_io=512
        )
        
        assert usage.cpu_usage == 50.0
        assert usage.memory_usage == 1024
        assert usage.network_io == 2048
        assert usage.disk_io == 512
    
    def test_resource_usage_validation(self):
        """Test resource usage validation."""
        # Test CPU usage bounds
        with pytest.raises(ValueError):
            ResourceUsage(cpu_usage=-1.0)
        
        with pytest.raises(ValueError):
            ResourceUsage(cpu_usage=101.0)
        
        # Test memory usage bounds
        with pytest.raises(ValueError):
            ResourceUsage(memory_usage=-1)


class TestBenchmarkMetrics:
    """Test cases for BenchmarkMetrics model."""
    
    def test_benchmark_metrics_creation(self):
        """Test benchmark metrics creation."""
        metrics = BenchmarkMetrics(
            total_tasks=10,
            completed_tasks=8,
            failed_tasks=2,
            average_execution_time=150.5,
            total_execution_time=1505.0
        )
        
        assert metrics.total_tasks == 10
        assert metrics.completed_tasks == 8
        assert metrics.failed_tasks == 2
        assert metrics.average_execution_time == 150.5
        assert metrics.total_execution_time == 1505.0
        assert metrics.success_rate == 0.8
    
    def test_benchmark_metrics_calculations(self):
        """Test benchmark metrics calculations."""
        metrics = BenchmarkMetrics(
            total_tasks=10,
            completed_tasks=8,
            failed_tasks=2
        )
        
        # Test calculated success rate
        assert metrics.success_rate == 0.8