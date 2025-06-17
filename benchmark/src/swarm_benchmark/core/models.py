"""Core data models for the swarm benchmarking tool."""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Any, Union
import uuid


class TaskStatus(Enum):
    """Task execution status."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


class AgentStatus(Enum):
    """Agent status."""
    IDLE = "idle"
    BUSY = "busy"
    FAILED = "failed"
    OFFLINE = "offline"


class ResultStatus(Enum):
    """Result status."""
    SUCCESS = "success"
    FAILURE = "failure"
    PARTIAL = "partial"
    ERROR = "error"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


class StrategyType(Enum):
    """Swarm strategy types."""
    AUTO = "auto"
    RESEARCH = "research"
    DEVELOPMENT = "development"
    ANALYSIS = "analysis"
    TESTING = "testing"
    OPTIMIZATION = "optimization"
    MAINTENANCE = "maintenance"


class CoordinationMode(Enum):
    """Coordination modes."""
    CENTRALIZED = "centralized"
    DISTRIBUTED = "distributed"
    HIERARCHICAL = "hierarchical"
    MESH = "mesh"
    HYBRID = "hybrid"


class AgentType(Enum):
    """Agent types."""
    COORDINATOR = "coordinator"
    RESEARCHER = "researcher"
    DEVELOPER = "developer"
    ANALYZER = "analyzer"
    REVIEWER = "reviewer"
    TESTER = "tester"
    DOCUMENTER = "documenter"
    MONITOR = "monitor"
    SPECIALIST = "specialist"


@dataclass
class ResourceUsage:
    """Resource usage metrics."""
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    network_bytes_sent: int = 0
    network_bytes_recv: int = 0
    disk_bytes_read: int = 0
    disk_bytes_write: int = 0
    peak_memory_mb: float = 0.0
    average_cpu_percent: float = 0.0


@dataclass
class PerformanceMetrics:
    """Performance metrics for tasks and agents."""
    execution_time: float = 0.0
    queue_time: float = 0.0
    throughput: float = 0.0
    success_rate: float = 0.0
    error_rate: float = 0.0
    retry_count: int = 0
    coordination_overhead: float = 0.0
    communication_latency: float = 0.0


@dataclass
class QualityMetrics:
    """Quality assessment metrics."""
    accuracy_score: float = 0.0
    completeness_score: float = 0.0
    consistency_score: float = 0.0
    relevance_score: float = 0.0
    overall_quality: float = 0.0
    review_score: Optional[float] = None
    automated_score: Optional[float] = None


@dataclass
class Task:
    """Task model for benchmarking."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    objective: str = ""
    description: str = ""
    strategy: StrategyType = StrategyType.AUTO
    mode: CoordinationMode = CoordinationMode.CENTRALIZED
    parameters: Dict[str, Any] = field(default_factory=dict)
    timeout: int = 3600  # seconds
    max_retries: int = 3
    priority: int = 1
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    assigned_agents: List[str] = field(default_factory=list)
    parent_task_id: Optional[str] = None
    subtasks: List[str] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)
    
    def duration(self) -> Optional[float]:
        """Calculate task duration in seconds."""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None


@dataclass
class Agent:
    """Agent model for benchmarking."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    type: AgentType = AgentType.SPECIALIST
    name: str = ""
    capabilities: List[str] = field(default_factory=list)
    status: AgentStatus = AgentStatus.IDLE
    current_task: Optional[str] = None
    performance_history: List[PerformanceMetrics] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)
    last_active: datetime = field(default_factory=datetime.now)
    total_tasks_completed: int = 0
    total_tasks_failed: int = 0
    average_execution_time: float = 0.0
    success_rate: float = 1.0
    
    def update_performance(self, metrics: PerformanceMetrics) -> None:
        """Update agent performance metrics."""
        self.performance_history.append(metrics)
        self.last_active = datetime.now()
        
        if metrics.success_rate > 0:
            self.total_tasks_completed += 1
        else:
            self.total_tasks_failed += 1
            
        total_tasks = self.total_tasks_completed + self.total_tasks_failed
        if total_tasks > 0:
            self.success_rate = self.total_tasks_completed / total_tasks
            
        # Calculate average execution time
        execution_times = [m.execution_time for m in self.performance_history if m.execution_time > 0]
        if execution_times:
            self.average_execution_time = sum(execution_times) / len(execution_times)


@dataclass
class Result:
    """Result model for task execution."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    task_id: str = ""
    agent_id: str = ""
    status: ResultStatus = ResultStatus.SUCCESS
    output: Dict[str, Any] = field(default_factory=dict)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    performance_metrics: PerformanceMetrics = field(default_factory=PerformanceMetrics)
    quality_metrics: QualityMetrics = field(default_factory=QualityMetrics)
    resource_usage: ResourceUsage = field(default_factory=ResourceUsage)
    execution_details: Dict[str, Any] = field(default_factory=dict)
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    
    def duration(self) -> Optional[float]:
        """Calculate result duration in seconds."""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None


@dataclass
class BenchmarkMetrics:
    """Aggregate metrics for a benchmark run."""
    total_tasks: int = 0
    completed_tasks: int = 0
    failed_tasks: int = 0
    total_agents: int = 0
    active_agents: int = 0
    average_execution_time: float = 0.0
    total_execution_time: float = 0.0
    success_rate: float = 0.0
    throughput: float = 0.0
    resource_efficiency: float = 0.0
    coordination_efficiency: float = 0.0
    quality_score: float = 0.0
    peak_memory_usage: float = 0.0
    total_cpu_time: float = 0.0
    network_overhead: float = 0.0
    
    def update_from_results(self, results: List[Result]) -> None:
        """Update metrics from result list."""
        if not results:
            return
            
        self.total_tasks = len(results)
        self.completed_tasks = len([r for r in results if r.status == ResultStatus.SUCCESS])
        self.failed_tasks = len([r for r in results if r.status in [ResultStatus.FAILURE, ResultStatus.ERROR]])
        
        if self.total_tasks > 0:
            self.success_rate = self.completed_tasks / self.total_tasks
            
        execution_times = [r.performance_metrics.execution_time for r in results if r.performance_metrics.execution_time > 0]
        if execution_times:
            self.average_execution_time = sum(execution_times) / len(execution_times)
            self.total_execution_time = sum(execution_times)
            
        quality_scores = [r.quality_metrics.overall_quality for r in results if r.quality_metrics.overall_quality > 0]
        if quality_scores:
            self.quality_score = sum(quality_scores) / len(quality_scores)
            
        # Resource utilization
        memory_usage = [r.resource_usage.peak_memory_mb for r in results if r.resource_usage.peak_memory_mb > 0]
        if memory_usage:
            self.peak_memory_usage = max(memory_usage)


@dataclass
class BenchmarkConfig:
    """Configuration for benchmark execution."""
    name: str = "benchmark"
    description: str = ""
    strategy: StrategyType = StrategyType.AUTO
    mode: CoordinationMode = CoordinationMode.CENTRALIZED
    max_agents: int = 5
    max_tasks: int = 100
    timeout: int = 3600  # seconds
    task_timeout: int = 300  # seconds
    max_retries: int = 3
    parallel: bool = False
    background: bool = False
    monitoring: bool = True
    quality_threshold: float = 0.8
    resource_limits: Dict[str, Any] = field(default_factory=lambda: {
        "max_memory_mb": 1024,
        "max_cpu_percent": 80,
        "max_network_mbps": 100
    })
    output_formats: List[str] = field(default_factory=lambda: ["json"])
    output_directory: str = "./reports"
    verbose: bool = False


@dataclass
class Benchmark:
    """Benchmark model for complete benchmark runs."""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = ""
    description: str = ""
    config: BenchmarkConfig = field(default_factory=BenchmarkConfig)
    tasks: List[Task] = field(default_factory=list)
    agents: List[Agent] = field(default_factory=list)
    results: List[Result] = field(default_factory=list)
    metrics: BenchmarkMetrics = field(default_factory=BenchmarkMetrics)
    status: TaskStatus = TaskStatus.PENDING
    created_at: datetime = field(default_factory=datetime.now)
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_log: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    
    def duration(self) -> Optional[float]:
        """Calculate benchmark duration in seconds."""
        if self.started_at and self.completed_at:
            return (self.completed_at - self.started_at).total_seconds()
        return None
    
    def add_task(self, task: Task) -> None:
        """Add a task to the benchmark."""
        self.tasks.append(task)
    
    def add_agent(self, agent: Agent) -> None:
        """Add an agent to the benchmark."""
        self.agents.append(agent)
    
    def add_result(self, result: Result) -> None:
        """Add a result to the benchmark."""
        self.results.append(result)
        self.metrics.update_from_results(self.results)
    
    def get_task_by_id(self, task_id: str) -> Optional[Task]:
        """Get task by ID."""
        return next((t for t in self.tasks if t.id == task_id), None)
    
    def get_agent_by_id(self, agent_id: str) -> Optional[Agent]:
        """Get agent by ID."""
        return next((a for a in self.agents if a.id == agent_id), None)
    
    def get_results_by_task_id(self, task_id: str) -> List[Result]:
        """Get all results for a specific task."""
        return [r for r in self.results if r.task_id == task_id]
    
    def get_results_by_agent_id(self, agent_id: str) -> List[Result]:
        """Get all results for a specific agent."""
        return [r for r in self.results if r.agent_id == agent_id]