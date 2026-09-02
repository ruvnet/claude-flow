"""Distributed coordination mode implementation."""

import asyncio
import random
from typing import Dict, List, Any
from ..core.models import Task, Agent, Result, AgentStatus, ResultStatus
from .base_mode import BaseCoordinationMode


class DistributedMode(BaseCoordinationMode):
    """Distributed coordination with multiple coordinators."""
    
    def __init__(self):
        """Initialize distributed coordination mode."""
        super().__init__()
        self.coordinator_agents = []
        self.task_assignments = {}
    
    @property
    def name(self) -> str:
        """Coordination mode name."""
        return "distributed"
    
    @property
    def description(self) -> str:
        """Coordination mode description."""
        return "Multiple coordinators manage tasks independently"
    
    async def coordinate(self, agents: List[Agent], tasks: List[Task]) -> List[Result]:
        """Coordinate tasks through distributed coordinators.
        
        Args:
            agents: Available agents
            tasks: Tasks to execute
            
        Returns:
            List of execution results
        """
        if not agents or not tasks:
            return []
        
        # Select multiple coordinators
        self.coordinator_agents = self._select_coordinators(agents)
        
        # Distribute tasks among coordinators
        coordinator_tasks = self._distribute_tasks(tasks)
        
        # Execute tasks in parallel across coordinators
        results = await self._distributed_execution(agents, coordinator_tasks)
        
        # Record coordination session
        self._record_coordination(agents, tasks, results)
        
        return results
    
    def _select_coordinators(self, agents: List[Agent]) -> List[Agent]:
        """Select multiple coordinator agents.
        
        Args:
            agents: Available agents
            
        Returns:
            List of coordinator agents
        """
        available_agents = [a for a in agents if a.status == AgentStatus.IDLE]
        
        if not available_agents:
            return agents[:1]  # Fallback to any agent
        
        # Select 2-3 coordinators based on agent pool size
        num_coordinators = min(max(2, len(available_agents) // 3), 3)
        
        # Select agents with highest success rates
        coordinators = sorted(available_agents, key=lambda a: a.success_rate, reverse=True)[:num_coordinators]
        
        return coordinators
    
    def _distribute_tasks(self, tasks: List[Task]) -> Dict[Agent, List[Task]]:
        """Distribute tasks among coordinators.
        
        Args:
            tasks: Tasks to distribute
            
        Returns:
            Dictionary mapping coordinators to their assigned tasks
        """
        if not self.coordinator_agents:
            return {}
        
        coordinator_tasks = {coord: [] for coord in self.coordinator_agents}
        
        # Round-robin distribution
        for i, task in enumerate(tasks):
            coordinator = self.coordinator_agents[i % len(self.coordinator_agents)]
            coordinator_tasks[coordinator].append(task)
            self.task_assignments[task.id] = coordinator.id
        
        return coordinator_tasks
    
    async def _distributed_execution(self, agents: List[Agent], coordinator_tasks: Dict[Agent, List[Task]]) -> List[Result]:
        """Execute tasks through distributed coordination.
        
        Args:
            agents: All available agents
            coordinator_tasks: Tasks assigned to each coordinator
            
        Returns:
            List of results
        """
        # Create coordination tasks for parallel execution
        coordination_tasks = []
        
        for coordinator, tasks in coordinator_tasks.items():
            if tasks:
                # Each coordinator manages a subset of agents
                coordinator_agents = self._assign_agents_to_coordinator(coordinator, agents)
                
                # Create async task for this coordinator
                coord_task = self._coordinator_execution(coordinator, coordinator_agents, tasks)
                coordination_tasks.append(coord_task)
        
        # Execute all coordinators in parallel
        if coordination_tasks:
            coordinator_results = await asyncio.gather(*coordination_tasks, return_exceptions=True)
            
            # Flatten results from all coordinators
            all_results = []
            for result_group in coordinator_results:
                if isinstance(result_group, list):
                    all_results.extend(result_group)
                elif isinstance(result_group, Exception):
                    # Handle coordinator failure
                    error_result = Result(
                        task_id="unknown",
                        agent_id="failed-coordinator",
                        status=ResultStatus.ERROR,
                        errors=[str(result_group)]
                    )
                    all_results.append(error_result)
            
            return all_results
        
        return []
    
    def _assign_agents_to_coordinator(self, coordinator: Agent, all_agents: List[Agent]) -> List[Agent]:
        """Assign a subset of agents to a coordinator.
        
        Args:
            coordinator: The coordinator agent
            all_agents: All available agents
            
        Returns:
            List of agents assigned to this coordinator
        """
        # Exclude the coordinator from the agent pool
        available_agents = [a for a in all_agents if a.id != coordinator.id]
        
        if not available_agents:
            return [coordinator]  # Coordinator works alone
        
        # Assign subset of agents to this coordinator
        agents_per_coordinator = max(1, len(available_agents) // len(self.coordinator_agents))
        
        # Use deterministic assignment based on coordinator ID for consistency
        start_idx = hash(coordinator.id) % len(available_agents)
        assigned_agents = []
        
        for i in range(agents_per_coordinator):
            idx = (start_idx + i) % len(available_agents)
            assigned_agents.append(available_agents[idx])
        
        # Always include the coordinator
        assigned_agents.append(coordinator)
        
        return assigned_agents
    
    async def _coordinator_execution(self, coordinator: Agent, agents: List[Agent], tasks: List[Task]) -> List[Result]:
        """Execute tasks for a single coordinator.
        
        Args:
            coordinator: The coordinator agent
            agents: Agents assigned to this coordinator
            tasks: Tasks to execute
            
        Returns:
            List of results from this coordinator
        """
        results = []
        available_agents = [a for a in agents if a.status == AgentStatus.IDLE]
        
        # Add distributed coordination overhead
        coordination_delay = 0.1 + random.uniform(0.02, 0.08)  # 100ms + jitter
        await asyncio.sleep(coordination_delay)
        
        for task in tasks:
            if not available_agents:
                # No available agents
                error_result = Result(
                    task_id=task.id,
                    agent_id=coordinator.id,
                    status=ResultStatus.ERROR,
                    errors=["No available agents for coordinator"]
                )
                results.append(error_result)
                continue
            
            # Assign task to best available agent
            assigned_agent = self._select_best_agent(task, available_agents)
            
            if assigned_agent:
                # Execute task
                result = await self._execute_distributed_task(task, assigned_agent, coordinator)
                results.append(result)
                
                # Release agent
                if assigned_agent.status == AgentStatus.BUSY:
                    assigned_agent.status = AgentStatus.IDLE
                    assigned_agent.current_task = None
        
        return results
    
    def _select_best_agent(self, task: Task, available_agents: List[Agent]) -> Agent:
        """Select the best agent for a task.
        
        Args:
            task: Task to assign
            available_agents: Available agents
            
        Returns:
            Selected agent or None
        """
        if not available_agents:
            return None
        
        # Simple selection based on success rate and random factor
        weighted_agents = []
        for agent in available_agents:
            weight = agent.success_rate + random.uniform(0, 0.2)  # Add randomness
            weighted_agents.append((weight, agent))
        
        # Select agent with highest weight
        selected_agent = max(weighted_agents, key=lambda x: x[0])[1]
        
        # Mark as busy
        selected_agent.status = AgentStatus.BUSY
        selected_agent.current_task = task.id
        
        return selected_agent
    
    async def _execute_distributed_task(self, task: Task, agent: Agent, coordinator: Agent) -> Result:
        """Execute a task in distributed mode.
        
        Args:
            task: Task to execute
            agent: Agent executing the task
            coordinator: Coordinator managing the task
            
        Returns:
            Task execution result
        """
        from ..strategies import create_strategy
        
        try:
            # Get strategy for task execution
            strategy = create_strategy(task.strategy.value.lower())
            result = await strategy.execute(task)
            
            # Add distributed coordination metrics
            result.performance_metrics.coordination_overhead = 0.1 + random.uniform(0.02, 0.08)
            result.performance_metrics.communication_latency = random.uniform(0.02, 0.06)
            
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
        """Get distributed coordination metrics.
        
        Returns:
            Dictionary of coordination metrics
        """
        if not self.coordination_history:
            return {
                "coordination_mode": "distributed",
                "total_sessions": 0,
                "average_overhead": 0.0,
                "coordination_efficiency": 1.0,
                "coordinator_count": 0
            }
        
        # Calculate metrics from history
        total_overhead = sum(session.get("coordination_overhead", 0) for session in self.coordination_history)
        average_overhead = total_overhead / len(self.coordination_history)
        
        total_success = sum(session.get("success_count", 0) for session in self.coordination_history)
        total_tasks = sum(session.get("task_count", 0) for session in self.coordination_history)
        coordination_efficiency = total_success / total_tasks if total_tasks > 0 else 1.0
        
        return {
            "coordination_mode": "distributed",
            "total_sessions": len(self.coordination_history),
            "total_coordinated_tasks": total_tasks,
            "total_successful_tasks": total_success,
            "average_overhead": average_overhead,
            "coordination_efficiency": coordination_efficiency,
            "coordinator_count": len(self.coordinator_agents),
            "coordinator_agents": [coord.id for coord in self.coordinator_agents],
            "task_distribution": len(self.task_assignments)
        }