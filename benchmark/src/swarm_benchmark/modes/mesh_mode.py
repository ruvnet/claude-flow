"""Mesh coordination mode implementation."""

import asyncio
import random
from typing import Dict, List, Any, Set
from ..core.models import Task, Agent, Result, AgentStatus, ResultStatus
from .base_mode import BaseCoordinationMode


class MeshMode(BaseCoordinationMode):
    """Mesh coordination with peer-to-peer communication."""
    
    def __init__(self):
        """Initialize mesh coordination mode."""
        super().__init__()
        self.peer_connections = {}
        self.task_negotiations = {}
    
    @property
    def name(self) -> str:
        """Coordination mode name."""
        return "mesh"
    
    @property
    def description(self) -> str:
        """Coordination mode description."""
        return "Peer-to-peer coordination with direct agent communication"
    
    async def coordinate(self, agents: List[Agent], tasks: List[Task]) -> List[Result]:
        """Coordinate tasks through mesh network.
        
        Args:
            agents: Available agents
            tasks: Tasks to execute
            
        Returns:
            List of execution results
        """
        if not agents or not tasks:
            return []
        
        # Establish mesh connections
        self._establish_mesh_connections(agents)
        
        # Negotiate task assignments
        task_assignments = await self._negotiate_task_assignments(agents, tasks)
        
        # Execute tasks through mesh
        results = await self._mesh_execution(task_assignments)
        
        # Record coordination session
        self._record_coordination(agents, tasks, results)
        
        return results
    
    def _establish_mesh_connections(self, agents: List[Agent]) -> None:
        """Establish peer-to-peer connections.
        
        Args:
            agents: Available agents
        """
        # Create full mesh connections (each agent knows all others)
        self.peer_connections = {}
        
        for agent in agents:
            self.peer_connections[agent.id] = {
                "peers": [a.id for a in agents if a.id != agent.id],
                "connection_strength": {
                    peer.id: random.uniform(0.7, 1.0) 
                    for peer in agents if peer.id != agent.id
                },
                "communication_latency": {
                    peer.id: random.uniform(0.01, 0.05) 
                    for peer in agents if peer.id != agent.id
                }
            }
    
    async def _negotiate_task_assignments(self, agents: List[Agent], tasks: List[Task]) -> Dict[Agent, List[Task]]:
        """Negotiate task assignments through peer communication.
        
        Args:
            agents: Available agents
            tasks: Tasks to assign
            
        Returns:
            Dictionary of agent task assignments
        """
        # Simulate mesh negotiation overhead
        negotiation_delay = 0.15 + random.uniform(0.05, 0.1)  # 150ms + jitter
        await asyncio.sleep(negotiation_delay)
        
        available_agents = [a for a in agents if a.status == AgentStatus.IDLE]
        task_assignments = {agent: [] for agent in available_agents}
        
        # Simulate decentralized task negotiation
        for task in tasks:
            # Agents "bid" for tasks based on their capabilities and load
            best_agent = self._peer_task_negotiation(task, available_agents)
            
            if best_agent:
                task_assignments[best_agent].append(task)
                self.task_negotiations[task.id] = {
                    "assigned_agent": best_agent.id,
                    "negotiation_rounds": random.randint(1, 3),
                    "peer_participants": random.randint(2, min(5, len(available_agents)))
                }
        
        return task_assignments
    
    def _peer_task_negotiation(self, task: Task, available_agents: List[Agent]) -> Agent:
        """Simulate peer-to-peer task negotiation.
        
        Args:
            task: Task to assign
            available_agents: Available agents
            
        Returns:
            Selected agent through negotiation
        """
        if not available_agents:
            return None
        
        # Simulate auction-based assignment
        agent_bids = {}
        
        for agent in available_agents:
            # Calculate bid based on success rate, current load, and random factor
            base_bid = agent.success_rate
            load_factor = 1.0 - (len([t for t in self.task_negotiations.values() 
                                      if t.get("assigned_agent") == agent.id]) * 0.1)
            random_factor = random.uniform(0.8, 1.2)
            
            bid = base_bid * load_factor * random_factor
            agent_bids[agent] = bid
        
        # Select agent with highest bid
        winning_agent = max(agent_bids.items(), key=lambda x: x[1])[0]
        return winning_agent
    
    async def _mesh_execution(self, task_assignments: Dict[Agent, List[Task]]) -> List[Result]:
        """Execute tasks through mesh coordination.
        
        Args:
            task_assignments: Agent task assignments
            
        Returns:
            List of execution results
        """
        # Execute all agents' tasks in parallel
        execution_tasks = []
        
        for agent, tasks in task_assignments.items():
            if tasks:
                agent_task = self._agent_mesh_execution(agent, tasks)
                execution_tasks.append(agent_task)
        
        # Wait for all agents to complete
        if execution_tasks:
            agent_results = await asyncio.gather(*execution_tasks, return_exceptions=True)
            
            # Flatten results
            all_results = []
            for result_group in agent_results:
                if isinstance(result_group, list):
                    all_results.extend(result_group)
                elif isinstance(result_group, Exception):
                    # Handle agent failure
                    error_result = Result(
                        task_id="unknown",
                        agent_id="failed-mesh-agent",
                        status=ResultStatus.ERROR,
                        errors=[str(result_group)]
                    )
                    all_results.append(error_result)
            
            return all_results
        
        return []
    
    async def _agent_mesh_execution(self, agent: Agent, tasks: List[Task]) -> List[Result]:
        """Execute tasks for a single agent in mesh mode.
        
        Args:
            agent: Agent executing tasks
            tasks: Tasks to execute
            
        Returns:
            List of results from this agent
        """
        results = []
        
        # Mark agent as busy
        agent.status = AgentStatus.BUSY
        
        try:
            for task in tasks:
                agent.current_task = task.id
                
                # Add mesh communication overhead
                communication_delay = self._calculate_mesh_communication_delay(agent)
                await asyncio.sleep(communication_delay)
                
                # Execute task
                result = await self._execute_mesh_task(task, agent, communication_delay)
                results.append(result)
            
        finally:
            # Release agent
            agent.status = AgentStatus.IDLE
            agent.current_task = None
        
        return results
    
    def _calculate_mesh_communication_delay(self, agent: Agent) -> float:
        """Calculate communication delay in mesh.
        
        Args:
            agent: Agent communicating
            
        Returns:
            Communication delay in seconds
        """
        agent_connections = self.peer_connections.get(agent.id, {})
        peer_latencies = agent_connections.get("communication_latency", {})
        
        if peer_latencies:
            # Average latency to all peers
            avg_latency = sum(peer_latencies.values()) / len(peer_latencies)
            return avg_latency + random.uniform(0.01, 0.03)  # Add jitter
        
        return 0.03  # Default mesh communication delay
    
    async def _execute_mesh_task(self, task: Task, agent: Agent, communication_delay: float) -> Result:
        """Execute task in mesh mode.
        
        Args:
            task: Task to execute
            agent: Agent executing the task
            communication_delay: Communication delay for this execution
            
        Returns:
            Task execution result
        """
        from ..strategies import create_strategy
        
        try:
            # Get strategy for task execution
            strategy = create_strategy(task.strategy.value.lower())
            result = await strategy.execute(task)
            
            # Add mesh coordination metrics
            result.performance_metrics.coordination_overhead = communication_delay + 0.05
            result.performance_metrics.communication_latency = communication_delay
            
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
        """Get mesh coordination metrics.
        
        Returns:
            Dictionary of coordination metrics
        """
        if not self.coordination_history:
            return {
                "coordination_mode": "mesh",
                "total_sessions": 0,
                "average_overhead": 0.0,
                "mesh_efficiency": 1.0,
                "peer_connections": 0
            }
        
        # Calculate metrics from history
        total_overhead = sum(session.get("coordination_overhead", 0) for session in self.coordination_history)
        average_overhead = total_overhead / len(self.coordination_history)
        
        total_success = sum(session.get("success_count", 0) for session in self.coordination_history)
        total_tasks = sum(session.get("task_count", 0) for session in self.coordination_history)
        mesh_efficiency = total_success / total_tasks if total_tasks > 0 else 1.0
        
        # Calculate network metrics
        total_connections = sum(len(conn.get("peers", [])) for conn in self.peer_connections.values())
        avg_connection_strength = 0.0
        if self.peer_connections:
            all_strengths = []
            for conn in self.peer_connections.values():
                strengths = conn.get("connection_strength", {}).values()
                all_strengths.extend(strengths)
            avg_connection_strength = sum(all_strengths) / len(all_strengths) if all_strengths else 0.0
        
        return {
            "coordination_mode": "mesh",
            "total_sessions": len(self.coordination_history),
            "total_coordinated_tasks": total_tasks,
            "total_successful_tasks": total_success,
            "average_overhead": average_overhead,
            "mesh_efficiency": mesh_efficiency,
            "peer_connections": total_connections,
            "average_connection_strength": avg_connection_strength,
            "negotiation_count": len(self.task_negotiations),
            "mesh_agents": len(self.peer_connections)
        }