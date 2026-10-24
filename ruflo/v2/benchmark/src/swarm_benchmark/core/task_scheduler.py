"""Task scheduling and management with advanced algorithms."""

import heapq
import logging
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import List, Dict, Set, Optional, Tuple, Callable

from .models import (
    Task, Agent, TaskStatus, AgentStatus, AgentType,
    StrategyType, CoordinationMode
)


logger = logging.getLogger(__name__)


class SchedulingAlgorithm(Enum):
    """Task scheduling algorithms."""
    ROUND_ROBIN = "round_robin"
    LEAST_LOADED = "least_loaded"
    CAPABILITY_BASED = "capability_based"
    PRIORITY_BASED = "priority_based"
    DYNAMIC = "dynamic"
    WORK_STEALING = "work_stealing"


@dataclass
class SchedulingMetrics:
    """Metrics for scheduling performance."""
    total_scheduled: int = 0
    scheduling_time: float = 0.0
    load_balance_score: float = 0.0
    capability_match_score: float = 0.0
    average_wait_time: float = 0.0
    max_agent_load: int = 0
    min_agent_load: int = 0


class TaskScheduler:
    """Advanced task scheduler with multiple scheduling algorithms."""
    
    def __init__(self, 
                 algorithm: SchedulingAlgorithm = SchedulingAlgorithm.DYNAMIC,
                 enable_work_stealing: bool = True):
        """Initialize the task scheduler."""
        self.algorithm = algorithm
        self.enable_work_stealing = enable_work_stealing
        
        # Task queues per agent
        self.agent_queues: Dict[str, deque] = defaultdict(deque)
        
        # Agent workload tracking
        self.agent_workload: Dict[str, int] = defaultdict(int)
        self.agent_capabilities: Dict[str, Set[str]] = {}
        
        # Task dependencies
        self.task_dependencies: Dict[str, Set[str]] = defaultdict(set)
        self.completed_tasks: Set[str] = set()
        
        # Scheduling metrics
        self.metrics = SchedulingMetrics()
        
        # Work stealing queue for idle agents
        self.work_steal_queue: deque = deque()
        
        # Strategy to capability mapping
        self.strategy_capabilities = {
            StrategyType.RESEARCH: {'research', 'analysis', 'web_search'},
            StrategyType.DEVELOPMENT: {'development', 'coding', 'architecture'},
            StrategyType.ANALYSIS: {'analysis', 'data_processing', 'statistics'},
            StrategyType.TESTING: {'testing', 'validation', 'quality_assurance'},
            StrategyType.OPTIMIZATION: {'optimization', 'performance', 'profiling'},
            StrategyType.MAINTENANCE: {'maintenance', 'monitoring', 'debugging'}
        }
        
        # Agent type to capability mapping
        self.agent_type_capabilities = {
            AgentType.RESEARCHER: {'research', 'analysis', 'web_search'},
            AgentType.DEVELOPER: {'development', 'coding', 'architecture'},
            AgentType.ANALYZER: {'analysis', 'data_processing', 'statistics'},
            AgentType.TESTER: {'testing', 'validation', 'quality_assurance'},
            AgentType.REVIEWER: {'review', 'validation', 'quality_assurance'},
            AgentType.DOCUMENTER: {'documentation', 'writing', 'communication'},
            AgentType.COORDINATOR: {'coordination', 'planning', 'orchestration'},
            AgentType.MONITOR: {'monitoring', 'alerting', 'metrics'},
            AgentType.SPECIALIST: set()  # Can do anything
        }
    
    def schedule_tasks(self, 
                      tasks: List[Task], 
                      agents: List[Agent]) -> Dict[Agent, List[Task]]:
        """Schedule tasks across available agents using selected algorithm."""
        start_time = datetime.now()
        
        # Initialize agent capabilities
        self._initialize_agent_capabilities(agents)
        
        # Filter available agents
        available_agents = [a for a in agents if a.status in [AgentStatus.IDLE, AgentStatus.BUSY]]
        
        if not available_agents:
            logger.warning("No available agents for scheduling")
            return {}
        
        # Sort tasks by priority and dependencies
        sorted_tasks = self._sort_tasks(tasks)
        
        # Apply scheduling algorithm
        if self.algorithm == SchedulingAlgorithm.ROUND_ROBIN:
            assignments = self._schedule_round_robin(sorted_tasks, available_agents)
        elif self.algorithm == SchedulingAlgorithm.LEAST_LOADED:
            assignments = self._schedule_least_loaded(sorted_tasks, available_agents)
        elif self.algorithm == SchedulingAlgorithm.CAPABILITY_BASED:
            assignments = self._schedule_capability_based(sorted_tasks, available_agents)
        elif self.algorithm == SchedulingAlgorithm.PRIORITY_BASED:
            assignments = self._schedule_priority_based(sorted_tasks, available_agents)
        elif self.algorithm == SchedulingAlgorithm.DYNAMIC:
            assignments = self._schedule_dynamic(sorted_tasks, available_agents)
        elif self.algorithm == SchedulingAlgorithm.WORK_STEALING:
            assignments = self._schedule_work_stealing(sorted_tasks, available_agents)
        else:
            assignments = self._schedule_round_robin(sorted_tasks, available_agents)
        
        # Update metrics
        self._update_metrics(assignments, start_time)
        
        # Enable work stealing if configured
        if self.enable_work_stealing:
            self._enable_work_stealing(assignments)
        
        return assignments
    
    def _initialize_agent_capabilities(self, agents: List[Agent]):
        """Initialize agent capabilities based on type."""
        for agent in agents:
            if agent.capabilities:
                self.agent_capabilities[agent.id] = set(agent.capabilities)
            else:
                # Use default capabilities based on agent type
                self.agent_capabilities[agent.id] = self.agent_type_capabilities.get(
                    agent.type, set()
                )
    
    def _sort_tasks(self, tasks: List[Task]) -> List[Task]:
        """Sort tasks by priority and dependencies."""
        # Build dependency graph
        dependency_levels = self._calculate_dependency_levels(tasks)
        
        # Sort by dependency level first, then priority
        return sorted(tasks, key=lambda t: (
            -dependency_levels.get(t.id, 0),  # Higher dependency level first
            -t.priority,  # Higher priority first
            t.created_at  # Earlier created first
        ))
    
    def _calculate_dependency_levels(self, tasks: List[Task]) -> Dict[str, int]:
        """Calculate dependency levels for topological sorting."""
        levels = {}
        task_map = {t.id: t for t in tasks}
        
        def calculate_level(task_id: str) -> int:
            if task_id in levels:
                return levels[task_id]
            
            task = task_map.get(task_id)
            if not task or not task.dependencies:
                levels[task_id] = 0
                return 0
            
            max_dep_level = 0
            for dep_id in task.dependencies:
                if dep_id in task_map:
                    dep_level = calculate_level(dep_id)
                    max_dep_level = max(max_dep_level, dep_level)
            
            levels[task_id] = max_dep_level + 1
            return levels[task_id]
        
        for task in tasks:
            calculate_level(task.id)
        
        return levels
    
    def _schedule_round_robin(self, 
                            tasks: List[Task], 
                            agents: List[Agent]) -> Dict[Agent, List[Task]]:
        """Simple round-robin scheduling."""
        assignments = {agent: [] for agent in agents}
        
        for i, task in enumerate(tasks):
            agent = agents[i % len(agents)]
            assignments[agent].append(task)
            self.agent_workload[agent.id] += 1
        
        return assignments
    
    def _schedule_least_loaded(self, 
                             tasks: List[Task], 
                             agents: List[Agent]) -> Dict[Agent, List[Task]]:
        """Schedule to least loaded agents."""
        assignments = {agent: [] for agent in agents}
        
        # Initialize heap with agents and their workload
        agent_heap = [(self.agent_workload[a.id], a.id, a) for a in agents]
        heapq.heapify(agent_heap)
        
        for task in tasks:
            # Get least loaded agent
            workload, agent_id, agent = heapq.heappop(agent_heap)
            
            # Assign task
            assignments[agent].append(task)
            
            # Update workload and push back
            new_workload = workload + 1
            self.agent_workload[agent_id] = new_workload
            heapq.heappush(agent_heap, (new_workload, agent_id, agent))
        
        return assignments
    
    def _schedule_capability_based(self, 
                                 tasks: List[Task], 
                                 agents: List[Agent]) -> Dict[Agent, List[Task]]:
        """Schedule based on agent capabilities."""
        assignments = {agent: [] for agent in agents}
        unassigned_tasks = []
        
        for task in tasks:
            # Get required capabilities for task
            required_caps = self.strategy_capabilities.get(task.strategy, set())
            
            # Find best matching agent
            best_agent = None
            best_score = -1
            
            for agent in agents:
                agent_caps = self.agent_capabilities.get(agent.id, set())
                
                # Calculate capability match score
                if not required_caps:
                    score = 1.0  # No specific requirements
                else:
                    matching_caps = agent_caps.intersection(required_caps)
                    score = len(matching_caps) / len(required_caps)
                
                # Consider workload
                workload_factor = 1.0 / (1 + self.agent_workload[agent.id])
                final_score = score * workload_factor
                
                if final_score > best_score:
                    best_score = final_score
                    best_agent = agent
            
            if best_agent and best_score > 0:
                assignments[best_agent].append(task)
                self.agent_workload[best_agent.id] += 1
            else:
                unassigned_tasks.append(task)
        
        # Distribute unassigned tasks using least loaded
        if unassigned_tasks:
            remaining_assignments = self._schedule_least_loaded(unassigned_tasks, agents)
            for agent, tasks in remaining_assignments.items():
                assignments[agent].extend(tasks)
        
        return assignments
    
    def _schedule_priority_based(self, 
                               tasks: List[Task], 
                               agents: List[Agent]) -> Dict[Agent, List[Task]]:
        """Schedule high-priority tasks to best agents."""
        assignments = {agent: [] for agent in agents}
        
        # Rank agents by performance
        ranked_agents = sorted(agents, key=lambda a: (
            a.success_rate,
            -a.average_execution_time,
            a.total_tasks_completed
        ), reverse=True)
        
        # Assign high-priority tasks to best agents
        agent_index = 0
        for task in tasks:
            if task.priority >= 5:  # High priority threshold
                # Assign to best available agent
                agent = ranked_agents[agent_index % len(ranked_agents)]
                agent_index += 1
            else:
                # Use least loaded for normal priority
                min_load = min(self.agent_workload[a.id] for a in agents)
                agent = next(a for a in agents if self.agent_workload[a.id] == min_load)
            
            assignments[agent].append(task)
            self.agent_workload[agent.id] += 1
        
        return assignments
    
    def _schedule_dynamic(self, 
                        tasks: List[Task], 
                        agents: List[Agent]) -> Dict[Agent, List[Task]]:
        """Dynamic scheduling based on multiple factors."""
        assignments = {agent: [] for agent in agents}
        
        for task in tasks:
            # Calculate scores for each agent
            agent_scores = []
            
            for agent in agents:
                # Capability match
                required_caps = self.strategy_capabilities.get(task.strategy, set())
                agent_caps = self.agent_capabilities.get(agent.id, set())
                
                if required_caps:
                    cap_score = len(agent_caps.intersection(required_caps)) / len(required_caps)
                else:
                    cap_score = 0.5  # Neutral score
                
                # Workload balance
                avg_workload = sum(self.agent_workload.values()) / len(agents)
                workload_score = 1.0 - (self.agent_workload[agent.id] / (avg_workload + 1))
                
                # Performance history
                perf_score = agent.success_rate
                
                # Combine scores with weights
                total_score = (
                    0.4 * cap_score +
                    0.3 * workload_score +
                    0.3 * perf_score
                )
                
                agent_scores.append((total_score, agent))
            
            # Select best agent
            agent_scores.sort(reverse=True)
            best_agent = agent_scores[0][1]
            
            assignments[best_agent].append(task)
            self.agent_workload[best_agent.id] += 1
        
        return assignments
    
    def _schedule_work_stealing(self, 
                              tasks: List[Task], 
                              agents: List[Agent]) -> Dict[Agent, List[Task]]:
        """Schedule with work stealing support."""
        # Initial distribution using dynamic scheduling
        assignments = self._schedule_dynamic(tasks, agents)
        
        # Mark tasks as stealable
        for agent, agent_tasks in assignments.items():
            for task in agent_tasks:
                if task.priority < 5:  # Only low-priority tasks are stealable
                    self.work_steal_queue.append((agent.id, task))
        
        return assignments
    
    def steal_work(self, idle_agent: Agent) -> Optional[Task]:
        """Allow idle agent to steal work from busy agents."""
        if not self.enable_work_stealing or not self.work_steal_queue:
            return None
        
        # Find a task to steal
        while self.work_steal_queue:
            original_agent_id, task = self.work_steal_queue.popleft()
            
            # Check if task is still pending
            if task.status == TaskStatus.PENDING:
                # Update workload
                self.agent_workload[original_agent_id] -= 1
                self.agent_workload[idle_agent.id] += 1
                
                logger.info(f"Agent {idle_agent.id} stole task {task.id} from agent {original_agent_id}")
                return task
        
        return None
    
    def _enable_work_stealing(self, assignments: Dict[Agent, List[Task]]):
        """Enable work stealing for assignments."""
        # Find agents with high workload
        avg_workload = sum(len(tasks) for tasks in assignments.values()) / len(assignments)
        
        for agent, tasks in assignments.items():
            if len(tasks) > avg_workload * 1.5:  # 50% above average
                # Mark some tasks as stealable
                stealable_count = int((len(tasks) - avg_workload) / 2)
                for task in tasks[-stealable_count:]:  # Last tasks are stealable
                    if task.priority < 5:
                        self.work_steal_queue.append((agent.id, task))
    
    def _update_metrics(self, 
                       assignments: Dict[Agent, List[Task]], 
                       start_time: datetime):
        """Update scheduling metrics."""
        self.metrics.total_scheduled += sum(len(tasks) for tasks in assignments.values())
        self.metrics.scheduling_time = (datetime.now() - start_time).total_seconds()
        
        # Calculate load balance
        if assignments:
            loads = [len(tasks) for tasks in assignments.values()]
            self.metrics.max_agent_load = max(loads) if loads else 0
            self.metrics.min_agent_load = min(loads) if loads else 0
            
            avg_load = sum(loads) / len(loads) if loads else 0
            if avg_load > 0:
                variance = sum((load - avg_load) ** 2 for load in loads) / len(loads)
                self.metrics.load_balance_score = 1.0 / (1.0 + variance)
            else:
                self.metrics.load_balance_score = 1.0
    
    def get_metrics(self) -> SchedulingMetrics:
        """Get scheduling metrics."""
        return SchedulingMetrics(**self.metrics.__dict__)
    
    def mark_task_completed(self, task_id: str):
        """Mark a task as completed for dependency tracking."""
        self.completed_tasks.add(task_id)
    
    def can_execute_task(self, task: Task) -> bool:
        """Check if a task's dependencies are satisfied."""
        if not task.dependencies:
            return True
        
        return all(dep_id in self.completed_tasks for dep_id in task.dependencies)
    
    def get_agent_workload(self, agent_id: str) -> int:
        """Get current workload for an agent."""
        return self.agent_workload.get(agent_id, 0)
    
    def rebalance_workload(self, agents: List[Agent]) -> Dict[Agent, List[Task]]:
        """Rebalance workload across agents."""
        # Collect all pending tasks from agent queues
        all_tasks = []
        for agent_id, queue in self.agent_queues.items():
            while queue:
                task = queue.popleft()
                if task.status == TaskStatus.PENDING:
                    all_tasks.append(task)
        
        # Clear workload counters
        self.agent_workload.clear()
        
        # Reschedule all tasks
        return self.schedule_tasks(all_tasks, agents)