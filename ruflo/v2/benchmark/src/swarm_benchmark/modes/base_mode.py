"""Base coordination mode interface."""

from abc import ABC, abstractmethod
from typing import Dict, List, Any
from ..core.models import Task, Agent, Result


class BaseCoordinationMode(ABC):
    """Abstract base class for all coordination modes."""
    
    def __init__(self):
        """Initialize the coordination mode."""
        self.coordination_count = 0
        self.coordination_history = []
    
    @property
    @abstractmethod
    def name(self) -> str:
        """Coordination mode name."""
        pass
    
    @property
    @abstractmethod 
    def description(self) -> str:
        """Coordination mode description."""
        pass
    
    @abstractmethod
    async def coordinate(self, agents: List[Agent], tasks: List[Task]) -> List[Result]:
        """Coordinate task execution across agents.
        
        Args:
            agents: Available agents
            tasks: Tasks to execute
            
        Returns:
            List of execution results
        """
        pass
    
    @abstractmethod
    def get_coordination_metrics(self) -> Dict[str, Any]:
        """Get coordination-specific metrics.
        
        Returns:
            Dictionary of coordination metrics
        """
        pass
    
    def _record_coordination(self, agents: List[Agent], tasks: List[Task], results: List[Result]) -> None:
        """Record a coordination session for metrics.
        
        Args:
            agents: Agents involved
            tasks: Tasks coordinated
            results: Results produced
        """
        self.coordination_count += 1
        
        coordination_record = {
            "session_id": self.coordination_count,
            "agent_count": len(agents),
            "task_count": len(tasks),
            "result_count": len(results),
            "success_count": len([r for r in results if r.status.value == "success"]),
            "coordination_overhead": self._calculate_coordination_overhead(agents, tasks, results),
            "timestamp": results[0].created_at if results else None
        }
        
        self.coordination_history.append(coordination_record)
        
        # Keep only last 50 coordination sessions for memory efficiency
        if len(self.coordination_history) > 50:
            self.coordination_history = self.coordination_history[-50:]
    
    def _calculate_coordination_overhead(self, agents: List[Agent], tasks: List[Task], results: List[Result]) -> float:
        """Calculate coordination overhead as a percentage.
        
        Args:
            agents: Agents involved
            tasks: Tasks coordinated
            results: Results produced
            
        Returns:
            Coordination overhead percentage
        """
        if not results:
            return 0.0
        
        total_execution_time = sum(r.performance_metrics.execution_time for r in results)
        if total_execution_time == 0:
            return 0.0
        
        # Estimate coordination overhead based on number of agents and communication
        agent_factor = len(agents) * 0.1  # 10% per agent
        task_factor = len(tasks) * 0.05   # 5% per task
        
        estimated_overhead = min(agent_factor + task_factor, 50.0)  # Cap at 50%
        return estimated_overhead