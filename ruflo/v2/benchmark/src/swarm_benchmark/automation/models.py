"""
Models for automation module.

Defines data structures used throughout the automation components.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Dict, Any, Optional
from enum import Enum


class TaskStatus(Enum):
    """Status of benchmark tasks."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    TIMEOUT = "timeout"


@dataclass
class BenchmarkTask:
    """A benchmark task to be executed."""
    id: str
    name: str
    description: str
    type: str = "generic"
    parameters: Dict[str, Any] = field(default_factory=dict)
    priority: int = 5  # 1-10, higher is more priority
    timeout: Optional[int] = None  # seconds
    dependencies: list = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)


@dataclass
class BenchmarkResult:
    """Result of a benchmark task execution."""
    task_id: str
    status: str
    execution_time: float
    metrics: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)
    error_message: Optional[str] = None
    output: Optional[str] = None