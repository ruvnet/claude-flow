"""Centralized coordination mode implementation."""

import asyncio
from typing import Dict, List, Any
from ..core.models import Task, Agent, Result, AgentStatus, ResultStatus
from .base_mode import BaseCoordinationMode


class CentralizedMode(BaseCoordinationMode):
    """Centralized coordination with single coordinator."""
    
    def __init__(self):
        """Initialize centralized coordination mode."""
        super().__init__()
        self.coordinator_agent = None
    
    @property
    def name(self) -> str:
        """Coordination mode name."""
        return "centralized"
    
    @property
    def description(self) -> str:
        """Coordination mode description."""
        return "Single coordinator manages all tasks and agents"
    
    async def coordinate(self, agents: List[Agent], tasks: List[Task]) -> List[Result]:
        """Coordinate tasks through a central coordinator.
        
        Args:
            agents: Available agents
            tasks: Tasks to execute
            
        Returns:
            List of execution results
        """
        if not agents or not tasks:
            return []
        
        # Select or designate coordinator
        self.coordinator_agent = self._select_coordinator(agents)
        
        # Centralized task distribution
        results = await self._centralized_execution(agents, tasks)
        
        # Record coordination session
        self._record_coordination(agents, tasks, results)
        
        return results
    
    def _select_coordinator(self, agents: List[Agent]) -> Agent:
        """Select the coordinator agent.
        
        Args:
            agents: Available agents
            
        Returns:
            Selected coordinator agent
        """
        # Simple selection: use first available agent or one with highest success rate
        available_agents = [a for a in agents if a.status == AgentStatus.IDLE]
        
        if not available_agents:
            return agents[0]  # Fallback to any agent
        
        # Select agent with highest success rate
        coordinator = max(available_agents, key=lambda a: a.success_rate)
        return coordinator
    
    async def _centralized_execution(self, agents: List[Agent], tasks: List[Task]) -> List[Result]:
        """Execute tasks through centralized coordination.
        
        Args:
            agents: Available agents
            tasks: Tasks to execute
            
        Returns:
            List of results
        """
        results = []
        available_agents = [a for a in agents if a.status == AgentStatus.IDLE]
        
        # Process tasks sequentially through coordinator
        for task in tasks:
            if not available_agents:
                # Create error result for unassigned task
                error_result = Result(
                    task_id=task.id,
                    agent_id="coordinator",
                    status=ResultStatus.ERROR,
                    errors=["No available agents"]
                )
                results.append(error_result)
                continue
            
            # Coordinator assigns task to best agent
            assigned_agent = self._assign_task_to_agent(task, available_agents)
            
            if assigned_agent:
                # Simulate task execution
                result = await self._execute_coordinated_task(task, assigned_agent)
                results.append(result)
                
                # Release agent back to available pool
                if assigned_agent.status == AgentStatus.BUSY:
                    assigned_agent.status = AgentStatus.IDLE
                    assigned_agent.current_task = None
            else:
                # No suitable agent found
                error_result = Result(
                    task_id=task.id,
                    agent_id="coordinator",
                    status=ResultStatus.ERROR,
                    errors=["No suitable agent found"]
                )
                results.append(error_result)
        
        return results
    
    def _assign_task_to_agent(self, task: Task, available_agents: List[Agent]) -> Agent:
        """Assign a task to the most suitable agent.
        
        Args:
            task: Task to assign
            available_agents: Available agents
            
        Returns:
            Selected agent or None
        """
        if not available_agents:
            return None
        
        # Simple assignment: select agent with matching capabilities or highest success rate
        suitable_agents = []
        
        for agent in available_agents:
            # Check if agent has relevant capabilities
            task_keywords = task.objective.lower().split()
            agent_capabilities = [cap.lower() for cap in agent.capabilities]
            
            has_relevant_capability = any(
                keyword in ' '.join(agent_capabilities) 
                for keyword in task_keywords
            )
            
            if has_relevant_capability or 'general' in agent_capabilities:
                suitable_agents.append(agent)
        
        # If no suitable agents found, use any available agent
        if not suitable_agents:
            suitable_agents = available_agents
        
        # Select agent with highest success rate
        selected_agent = max(suitable_agents, key=lambda a: a.success_rate)
        
        # Mark agent as busy
        selected_agent.status = AgentStatus.BUSY
        selected_agent.current_task = task.id
        
        return selected_agent
    
    async def _execute_coordinated_task(self, task: Task, agent: Agent) -> Result:
        """Execute a task through the agent with coordination overhead.
        
        Args:
            task: Task to execute
            agent: Agent to execute the task
            
        Returns:
            Task execution result
        """
        # Simulate coordination overhead
        coordination_delay = 0.05  # 50ms coordination overhead
        await asyncio.sleep(coordination_delay)
        
        # Import here to avoid circular imports
        from ..strategies import create_strategy
        
        try:
            # Get strategy for task execution
            strategy = create_strategy(task.strategy.value.lower())
            result = await strategy.execute(task)
            
            # Add coordination metrics
            result.performance_metrics.coordination_overhead = coordination_delay
            result.performance_metrics.communication_latency = coordination_delay / 2
            
            return result
            
        except Exception as e:
            # Create error result
            error_result = Result(
                task_id=task.id,
                agent_id=agent.id,
                status=ResultStatus.ERROR,
                errors=[str(e)]
            )
            return error_result
    
    def get_coordination_metrics(self) -> Dict[str, Any]:
        """Get centralized coordination metrics.
        
        Returns:
            Dictionary of coordination metrics
        """
        if not self.coordination_history:
            return {
                "coordination_mode": "centralized",
                "total_sessions": 0,
                "average_overhead": 0.0,
                "coordinator_efficiency": 1.0
            }
        
        # Calculate metrics from history
        total_overhead = sum(session.get("coordination_overhead", 0) for session in self.coordination_history)
        average_overhead = total_overhead / len(self.coordination_history)
        
        total_success = sum(session.get("success_count", 0) for session in self.coordination_history)
        total_tasks = sum(session.get("task_count", 0) for session in self.coordination_history)
        coordinator_efficiency = total_success / total_tasks if total_tasks > 0 else 1.0
        
        return {
            "coordination_mode": "centralized",
            "total_sessions": len(self.coordination_history),
            "total_coordinated_tasks": total_tasks,
            "total_successful_tasks": total_success,
            "average_overhead": average_overhead,
            "coordinator_efficiency": coordinator_efficiency,
            "coordinator_agent": self.coordinator_agent.id if self.coordinator_agent else None
        }