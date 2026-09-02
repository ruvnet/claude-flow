"""Base strategy interface for swarm execution."""

from abc import ABC, abstractmethod
from typing import Dict, Any
from swarm_benchmark.core.models import Task, Result


class BaseStrategy(ABC):
    """Abstract base class for all swarm strategies."""
    
    def __init__(self):
        """Initialize the base strategy."""
        self.execution_count = 0
        self.execution_history = []
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Strategy name."""
        pass
    
    @property
    @abstractmethod 
    def description(self) -> str:
        """Strategy description."""
        pass
    
    @abstractmethod
    async def execute(self, task: Task) -> Result:
        """Execute a task using this strategy.
        
        Args:
            task: Task to execute
            
        Returns:
            Execution result
        """
        pass
    
    @abstractmethod
    def get_metrics(self) -> Dict[str, Any]:
        """Get strategy-specific metrics.
        
        Returns:
            Dictionary of metrics
        """
        pass
    
    def _record_execution(self, task: Task, result: Result) -> None:
        """Record an execution for metrics.
        
        Args:
            task: Executed task
            result: Execution result
        """
        self.execution_count += 1
        self.execution_history.append({
            "task_id": task.id,
            "result_status": result.status.value,
            "execution_time": result.performance_metrics.execution_time,
            "timestamp": result.completed_at or result.created_at
        })
        
        # Keep only last 100 executions for memory efficiency
        if len(self.execution_history) > 100:
            self.execution_history = self.execution_history[-100:]