"""Hierarchical coordination mode implementation."""

import asyncio
from typing import Dict, List, Any, Optional
from ..core.models import Task, Agent, Result, AgentStatus, ResultStatus
from .base_mode import BaseCoordinationMode


class HierarchicalMode(BaseCoordinationMode):
    """Hierarchical coordination with tree structure."""
    
    def __init__(self):
        """Initialize hierarchical coordination mode."""
        super().__init__()
        self.root_coordinator = None
        self.hierarchy_levels = {}
    
    @property
    def name(self) -> str:
        """Coordination mode name."""
        return "hierarchical"
    
    @property
    def description(self) -> str:
        """Coordination mode description."""
        return "Tree structure coordination with multiple levels"
    
    async def coordinate(self, agents: List[Agent], tasks: List[Task]) -> List[Result]:
        """Coordinate tasks through hierarchical structure.
        
        Args:
            agents: Available agents
            tasks: Tasks to execute
            
        Returns:
            List of execution results
        """
        if not agents or not tasks:
            return []
        
        # Build hierarchy
        self._build_hierarchy(agents)
        
        # Execute through hierarchy
        results = await self._hierarchical_execution(tasks)
        
        # Record coordination session
        self._record_coordination(agents, tasks, results)
        
        return results
    
    def _build_hierarchy(self, agents: List[Agent]) -> None:
        """Build agent hierarchy.
        
        Args:
            agents: Available agents
        """
        # Simple hierarchy: root + managers + workers
        if len(agents) <= 1:
            self.root_coordinator = agents[0] if agents else None
            self.hierarchy_levels = {0: agents}
            return
        
        # Sort agents by success rate for hierarchy assignment
        sorted_agents = sorted(agents, key=lambda a: a.success_rate, reverse=True)
        
        # Assign hierarchy levels
        self.root_coordinator = sorted_agents[0]
        
        # Simple 3-level hierarchy
        if len(sorted_agents) <= 3:
            self.hierarchy_levels = {
                0: [self.root_coordinator],  # Root
                1: sorted_agents[1:2],       # Managers
                2: sorted_agents[2:]         # Workers
            }
        else:
            num_managers = max(1, len(sorted_agents) // 3)
            self.hierarchy_levels = {
                0: [self.root_coordinator],                    # Root
                1: sorted_agents[1:1+num_managers],           # Managers
                2: sorted_agents[1+num_managers:]             # Workers
            }
    
    async def _hierarchical_execution(self, tasks: List[Task]) -> List[Result]:
        """Execute tasks through hierarchy.
        
        Args:
            tasks: Tasks to execute
            
        Returns:
            List of results
        """
        if not self.root_coordinator or not tasks:
            return []
        
        # Root coordinator distributes tasks to managers
        manager_tasks = self._distribute_tasks_to_managers(tasks)
        
        # Execute through hierarchy levels
        results = []
        
        for manager, assigned_tasks in manager_tasks.items():
            if assigned_tasks:
                manager_results = await self._manager_execution(manager, assigned_tasks)
                results.extend(manager_results)
        
        return results
    
    def _distribute_tasks_to_managers(self, tasks: List[Task]) -> Dict[Agent, List[Task]]:
        """Distribute tasks from root to managers.
        
        Args:
            tasks: Tasks to distribute
            
        Returns:
            Dictionary mapping managers to their tasks
        """
        managers = self.hierarchy_levels.get(1, [])
        
        if not managers:
            # No managers, root does everything
            return {self.root_coordinator: tasks}
        
        # Distribute tasks among managers
        manager_tasks = {manager: [] for manager in managers}
        
        for i, task in enumerate(tasks):
            manager = managers[i % len(managers)]
            manager_tasks[manager].append(task)
        
        return manager_tasks
    
    async def _manager_execution(self, manager: Agent, tasks: List[Task]) -> List[Result]:
        """Execute tasks through a manager.
        
        Args:
            manager: Manager agent
            tasks: Tasks for this manager
            
        Returns:
            Results from manager's team
        """
        # Add hierarchical coordination overhead
        coordination_delay = 0.08  # 80ms for hierarchy coordination
        await asyncio.sleep(coordination_delay)
        
        # Get workers for this manager
        workers = self.hierarchy_levels.get(2, [])
        available_workers = [w for w in workers if w.status == AgentStatus.IDLE]
        
        results = []
        
        for task in tasks:
            # Manager assigns task to worker or executes itself
            if available_workers:
                worker = available_workers[0]  # Simple assignment
                worker.status = AgentStatus.BUSY
                worker.current_task = task.id
                
                result = await self._execute_hierarchical_task(task, worker, manager)
                
                # Release worker
                worker.status = AgentStatus.IDLE
                worker.current_task = None
            else:
                # Manager executes task itself
                result = await self._execute_hierarchical_task(task, manager, self.root_coordinator)
            
            results.append(result)
        
        return results
    
    async def _execute_hierarchical_task(self, task: Task, executor: Agent, supervisor: Agent) -> Result:
        """Execute task in hierarchical mode.
        
        Args:
            task: Task to execute
            executor: Agent executing the task
            supervisor: Supervising agent
            
        Returns:
            Task execution result
        """
        from ..strategies import create_strategy
        
        try:
            # Get strategy for task execution
            strategy = create_strategy(task.strategy.value.lower())
            result = await strategy.execute(task)
            
            # Add hierarchical coordination metrics
            result.performance_metrics.coordination_overhead = 0.08
            result.performance_metrics.communication_latency = 0.04  # Half of coordination overhead
            
            return result
            
        except Exception as e:
            # Create error result
            error_result = Result(
                task_id=task.id,
                agent_id=executor.id,
                status=ResultStatus.ERROR,
                errors=[str(e)]
            )
            return error_result
    
    def get_coordination_metrics(self) -> Dict[str, Any]:
        """Get hierarchical coordination metrics.
        
        Returns:
            Dictionary of coordination metrics
        """
        if not self.coordination_history:
            return {
                "coordination_mode": "hierarchical",
                "total_sessions": 0,
                "average_overhead": 0.0,
                "hierarchy_efficiency": 1.0,
                "hierarchy_levels": 0
            }
        
        # Calculate metrics from history
        total_overhead = sum(session.get("coordination_overhead", 0) for session in self.coordination_history)
        average_overhead = total_overhead / len(self.coordination_history)
        
        total_success = sum(session.get("success_count", 0) for session in self.coordination_history)
        total_tasks = sum(session.get("task_count", 0) for session in self.coordination_history)
        hierarchy_efficiency = total_success / total_tasks if total_tasks > 0 else 1.0
        
        return {
            "coordination_mode": "hierarchical",
            "total_sessions": len(self.coordination_history),
            "total_coordinated_tasks": total_tasks,
            "total_successful_tasks": total_success,
            "average_overhead": average_overhead,
            "hierarchy_efficiency": hierarchy_efficiency,
            "hierarchy_levels": len(self.hierarchy_levels),
            "root_coordinator": self.root_coordinator.id if self.root_coordinator else None,
            "level_distribution": {
                level: len(agents) for level, agents in self.hierarchy_levels.items()
            }
        }