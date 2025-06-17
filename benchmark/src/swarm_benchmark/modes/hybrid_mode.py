"""Hybrid coordination mode implementation."""

import asyncio
import random
from typing import Dict, List, Any
from ..core.models import Task, Agent, Result, AgentStatus
from .base_mode import BaseCoordinationMode
from .centralized_mode import CentralizedMode
from .distributed_mode import DistributedMode
from .hierarchical_mode import HierarchicalMode
from .mesh_mode import MeshMode


class HybridMode(BaseCoordinationMode):
    """Hybrid coordination mixing multiple coordination patterns."""
    
    def __init__(self):
        """Initialize hybrid coordination mode."""
        super().__init__()
        self.coordination_strategies = {
            "centralized": CentralizedMode(),
            "distributed": DistributedMode(),
            "hierarchical": HierarchicalMode(),
            "mesh": MeshMode()
        }
        self.strategy_usage = {}
        self.task_strategy_mapping = {}
    
    @property
    def name(self) -> str:
        """Coordination mode name."""
        return "hybrid"
    
    @property
    def description(self) -> str:
        """Coordination mode description."""
        return "Adaptive coordination using multiple coordination patterns"
    
    async def coordinate(self, agents: List[Agent], tasks: List[Task]) -> List[Result]:
        """Coordinate tasks using hybrid approach.
        
        Args:
            agents: Available agents
            tasks: Tasks to execute
            
        Returns:
            List of execution results
        """
        if not agents or not tasks:
            return []
        
        # Analyze and partition tasks for different coordination strategies
        strategy_partitions = self._partition_tasks_by_strategy(agents, tasks)
        
        # Execute each partition with its optimal coordination strategy
        all_results = []
        
        for strategy_name, (strategy_agents, strategy_tasks) in strategy_partitions.items():
            if strategy_tasks:
                strategy_mode = self.coordination_strategies[strategy_name]
                strategy_results = await strategy_mode.coordinate(strategy_agents, strategy_tasks)
                all_results.extend(strategy_results)
                
                # Track strategy usage
                self.strategy_usage[strategy_name] = self.strategy_usage.get(strategy_name, 0) + len(strategy_tasks)
        
        # Record coordination session
        self._record_coordination(agents, tasks, all_results)
        
        return all_results
    
    def _partition_tasks_by_strategy(self, agents: List[Agent], tasks: List[Task]) -> Dict[str, tuple]:
        """Partition tasks and agents by optimal coordination strategy.
        
        Args:
            agents: Available agents
            tasks: Tasks to partition
            
        Returns:
            Dictionary mapping strategy names to (agents, tasks) tuples
        """
        # Initialize partitions
        partitions = {
            "centralized": ([], []),
            "distributed": ([], []),
            "hierarchical": ([], []),
            "mesh": ([], [])
        }
        
        # Analyze task and agent characteristics
        for task in tasks:
            strategy = self._select_optimal_strategy(task, agents)
            
            # Assign task to strategy
            current_agents, current_tasks = partitions[strategy]
            current_tasks.append(task)
            self.task_strategy_mapping[task.id] = strategy
        
        # Distribute agents among strategies based on task allocation
        self._distribute_agents_to_strategies(agents, partitions)
        
        return partitions
    
    def _select_optimal_strategy(self, task: Task, agents: List[Agent]) -> str:
        """Select optimal coordination strategy for a task.
        
        Args:
            task: Task to analyze
            agents: Available agents
            
        Returns:
            Selected coordination strategy name
        """
        # Decision factors
        task_complexity = self._estimate_task_complexity(task)
        agent_count = len(agents)
        task_type = task.strategy.value.lower()
        
        # Strategy selection heuristics
        if agent_count <= 2:
            return "centralized"  # Few agents, centralized is optimal
        
        if task_complexity > 0.8 and agent_count >= 5:
            return "hierarchical"  # Complex tasks benefit from hierarchy
        
        if task_type in ["research", "analysis"] and agent_count >= 4:
            return "distributed"  # Research tasks work well distributed
        
        if task_type in ["development", "testing"] and agent_count >= 6:
            return "mesh"  # Development benefits from peer coordination
        
        # Default strategies based on agent count
        if agent_count >= 8:
            return random.choice(["distributed", "mesh"])  # Large groups
        elif agent_count >= 4:
            return random.choice(["hierarchical", "distributed"])  # Medium groups
        else:
            return "centralized"  # Small groups
    
    def _estimate_task_complexity(self, task: Task) -> float:
        """Estimate task complexity on a scale of 0-1.
        
        Args:
            task: Task to analyze
            
        Returns:
            Complexity score (0.0 to 1.0)
        """
        # Simple heuristics for complexity estimation
        complexity_factors = []
        
        # Objective length factor
        obj_length = len(task.objective.split())
        complexity_factors.append(min(obj_length / 20.0, 1.0))
        
        # Description length factor
        desc_length = len(task.description.split()) if task.description else 0
        complexity_factors.append(min(desc_length / 50.0, 1.0))
        
        # Strategy complexity factor
        strategy_complexity = {
            "auto": 0.5,
            "research": 0.4,
            "development": 0.8,
            "analysis": 0.6,
            "testing": 0.5,
            "optimization": 0.9,
            "maintenance": 0.3
        }
        complexity_factors.append(strategy_complexity.get(task.strategy.value.lower(), 0.5))
        
        # Parameters complexity
        param_factor = min(len(task.parameters) / 10.0, 1.0)
        complexity_factors.append(param_factor)
        
        # Return average complexity
        return sum(complexity_factors) / len(complexity_factors)
    
    def _distribute_agents_to_strategies(self, agents: List[Agent], partitions: Dict[str, tuple]) -> None:
        """Distribute agents among coordination strategies.
        
        Args:
            agents: All available agents
            partitions: Strategy partitions to update
        """
        # Count tasks per strategy
        strategy_task_counts = {
            strategy: len(tasks) for strategy, (_, tasks) in partitions.items()
        }
        
        total_tasks = sum(strategy_task_counts.values())
        if total_tasks == 0:
            return
        
        # Distribute agents proportionally
        remaining_agents = agents.copy()
        
        for strategy, task_count in strategy_task_counts.items():
            if task_count == 0:
                continue
            
            # Calculate agent allocation
            proportion = task_count / total_tasks
            agent_allocation = max(1, int(len(agents) * proportion))
            
            # Assign agents
            strategy_agents = remaining_agents[:agent_allocation]
            remaining_agents = remaining_agents[agent_allocation:]
            
            # Update partition
            _, strategy_tasks = partitions[strategy]
            partitions[strategy] = (strategy_agents, strategy_tasks)
        
        # Assign any remaining agents to the strategy with most tasks
        if remaining_agents:
            max_strategy = max(strategy_task_counts.items(), key=lambda x: x[1])[0]
            current_agents, current_tasks = partitions[max_strategy]
            current_agents.extend(remaining_agents)
            partitions[max_strategy] = (current_agents, current_tasks)
    
    def get_coordination_metrics(self) -> Dict[str, Any]:
        """Get hybrid coordination metrics.
        
        Returns:
            Dictionary of coordination metrics
        """
        if not self.coordination_history:
            return {
                "coordination_mode": "hybrid",
                "total_sessions": 0,
                "average_overhead": 0.0,
                "hybrid_efficiency": 1.0,
                "strategy_usage": {}
            }
        
        # Calculate metrics from history
        total_overhead = sum(session.get("coordination_overhead", 0) for session in self.coordination_history)
        average_overhead = total_overhead / len(self.coordination_history)
        
        total_success = sum(session.get("success_count", 0) for session in self.coordination_history)
        total_tasks = sum(session.get("task_count", 0) for session in self.coordination_history)
        hybrid_efficiency = total_success / total_tasks if total_tasks > 0 else 1.0
        
        # Get strategy-specific metrics
        strategy_metrics = {}
        for strategy_name, strategy_mode in self.coordination_strategies.items():
            strategy_metrics[strategy_name] = strategy_mode.get_coordination_metrics()
        
        return {
            "coordination_mode": "hybrid",
            "total_sessions": len(self.coordination_history),
            "total_coordinated_tasks": total_tasks,
            "total_successful_tasks": total_success,
            "average_overhead": average_overhead,
            "hybrid_efficiency": hybrid_efficiency,
            "strategy_usage": self.strategy_usage.copy(),
            "task_strategy_mapping": len(self.task_strategy_mapping),
            "strategy_metrics": strategy_metrics,
            "adaptation_score": self._calculate_adaptation_score()
        }
    
    def _calculate_adaptation_score(self) -> float:
        """Calculate how well the hybrid mode adapted to different scenarios.
        
        Returns:
            Adaptation score (0.0 to 1.0)
        """
        if not self.strategy_usage:
            return 1.0
        
        # Good adaptation means using multiple strategies
        used_strategies = len([count for count in self.strategy_usage.values() if count > 0])
        total_strategies = len(self.coordination_strategies)
        
        diversity_score = used_strategies / total_strategies
        
        # Balance score - good adaptation avoids over-reliance on one strategy
        total_usage = sum(self.strategy_usage.values())
        if total_usage == 0:
            balance_score = 1.0
        else:
            # Calculate variance in usage
            avg_usage = total_usage / len(self.coordination_strategies)
            variance = sum((count - avg_usage) ** 2 for count in self.strategy_usage.values())
            normalized_variance = variance / (avg_usage ** 2) if avg_usage > 0 else 0
            balance_score = max(0.0, 1.0 - normalized_variance / 4.0)  # Normalize to 0-1
        
        # Combine diversity and balance
        adaptation_score = (diversity_score + balance_score) / 2
        return min(1.0, max(0.0, adaptation_score))