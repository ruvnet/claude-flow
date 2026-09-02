"""
Unit tests for collective intelligence benchmarking.

Tests the hive mind benchmark system, swarm coordination, knowledge sharing,
and consensus mechanisms.
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import json
from enum import Enum

import numpy as np

from swarm_benchmark.core.models import Agent, Task, Result, AgentStatus, TaskStatus


class ConsensusType(Enum):
    """Types of consensus mechanisms."""
    VOTING = "voting"
    WEIGHTED_CONSENSUS = "weighted_consensus"
    BYZANTINE_FAULT_TOLERANT = "byzantine_fault_tolerant"
    RAFT = "raft"
    PAXOS = "paxos"


class MockSwarmAgent:
    """Mock swarm agent for testing."""
    
    def __init__(self, agent_id: str, capabilities: List[str] = None):
        self.id = agent_id
        self.capabilities = capabilities or []
        self.status = AgentStatus.IDLE
        self.knowledge_base = {}
        self.coordination_state = {}
        self.performance_metrics = {
            "tasks_completed": 0,
            "consensus_participation": 0,
            "knowledge_contributions": 0
        }
        self.last_heartbeat = datetime.now()
        
    async def process_task(self, task: Dict[str, Any]) -> Dict[str, Any]:
        """Process a task assigned to this agent."""
        self.status = AgentStatus.BUSY
        await asyncio.sleep(0.1)  # Simulate work
        
        result = {
            "agent_id": self.id,
            "task_id": task.get("id"),
            "output": f"Processed task {task.get('id')} with capabilities {self.capabilities}",
            "execution_time": 0.1,
            "success": True
        }
        
        self.performance_metrics["tasks_completed"] += 1
        self.status = AgentStatus.IDLE
        return result
    
    async def participate_in_consensus(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        """Participate in consensus decision making."""
        await asyncio.sleep(0.05)  # Simulate deliberation
        
        # Simple voting logic based on agent capabilities
        vote_strength = len(self.capabilities) / 10.0
        agreement = np.random.choice([True, False], p=[0.7, 0.3])  # 70% agree
        
        self.performance_metrics["consensus_participation"] += 1
        
        return {
            "agent_id": self.id,
            "vote": agreement,
            "vote_strength": vote_strength,
            "reasoning": f"Agent {self.id} {'supports' if agreement else 'opposes'} based on capabilities",
            "timestamp": datetime.now()
        }
    
    async def share_knowledge(self, knowledge: Dict[str, Any]) -> bool:
        """Share knowledge with other agents."""
        for key, value in knowledge.items():
            self.knowledge_base[key] = value
        
        self.performance_metrics["knowledge_contributions"] += 1
        return True
    
    async def get_knowledge(self, key: str) -> Any:
        """Retrieve knowledge from agent's knowledge base."""
        return self.knowledge_base.get(key)
    
    def update_heartbeat(self):
        """Update agent heartbeat."""
        self.last_heartbeat = datetime.now()
    
    def is_healthy(self) -> bool:
        """Check if agent is healthy (recent heartbeat)."""
        time_since_heartbeat = datetime.now() - self.last_heartbeat
        return time_since_heartbeat.total_seconds() < 30  # 30 second threshold


class MockSwarm:
    """Mock swarm for testing collective intelligence."""
    
    def __init__(self, swarm_size: int = 10):
        self.agents = []
        self.swarm_size = swarm_size
        self.coordination_mechanisms = {}
        self.knowledge_graph = {}
        self.consensus_history = []
        self.performance_stats = {
            "total_tasks": 0,
            "successful_consensus": 0,
            "knowledge_sharing_events": 0
        }
        
        # Initialize agents with diverse capabilities
        for i in range(swarm_size):
            capabilities = self._generate_agent_capabilities(i)
            agent = MockSwarmAgent(f"agent_{i}", capabilities)
            self.agents.append(agent)
    
    def _generate_agent_capabilities(self, agent_index: int) -> List[str]:
        """Generate diverse capabilities for agents."""
        all_capabilities = [
            "analysis", "synthesis", "optimization", "coordination",
            "research", "development", "testing", "monitoring",
            "decision_making", "knowledge_management"
        ]
        
        # Each agent gets 2-4 random capabilities
        num_capabilities = np.random.randint(2, 5)
        return list(np.random.choice(all_capabilities, num_capabilities, replace=False))
    
    async def reach_consensus(self, proposal: Dict[str, Any], mechanism: str) -> Dict[str, Any]:
        """Reach consensus on a proposal using specified mechanism."""
        if mechanism == "voting":
            return await self._voting_consensus(proposal)
        elif mechanism == "weighted_consensus":
            return await self._weighted_consensus(proposal)
        elif mechanism == "byzantine_fault_tolerant":
            return await self._byzantine_consensus(proposal)
        elif mechanism == "raft":
            return await self._raft_consensus(proposal)
        elif mechanism == "paxos":
            return await self._paxos_consensus(proposal)
        else:
            raise ValueError(f"Unknown consensus mechanism: {mechanism}")
    
    async def _voting_consensus(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        """Simple majority voting consensus."""
        votes = []
        
        # Collect votes from all agents
        vote_tasks = []
        for agent in self.agents:
            if agent.is_healthy():
                task = agent.participate_in_consensus(proposal)
                vote_tasks.append(task)
        
        vote_results = await asyncio.gather(*vote_tasks, return_exceptions=True)
        
        # Process votes
        for result in vote_results:
            if not isinstance(result, Exception):
                votes.append(result)
        
        # Calculate consensus
        total_votes = len(votes)
        positive_votes = sum(1 for vote in votes if vote["vote"])
        consensus_reached = positive_votes > total_votes / 2
        
        consensus_result = {
            "proposal_id": proposal.get("id", "unknown"),
            "mechanism": "voting",
            "consensus_reached": consensus_reached,
            "vote_count": total_votes,
            "positive_votes": positive_votes,
            "consensus_strength": positive_votes / total_votes if total_votes > 0 else 0,
            "participating_agents": [vote["agent_id"] for vote in votes],
            "timestamp": datetime.now()
        }
        
        self.consensus_history.append(consensus_result)
        if consensus_reached:
            self.performance_stats["successful_consensus"] += 1
        
        return consensus_result
    
    async def _weighted_consensus(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        """Weighted consensus based on agent capabilities."""
        votes = []
        vote_tasks = []
        
        for agent in self.agents:
            if agent.is_healthy():
                task = agent.participate_in_consensus(proposal)
                vote_tasks.append(task)
        
        vote_results = await asyncio.gather(*vote_tasks, return_exceptions=True)
        
        # Process weighted votes
        total_weight = 0
        positive_weight = 0
        
        for result in vote_results:
            if not isinstance(result, Exception):
                votes.append(result)
                weight = result["vote_strength"]
                total_weight += weight
                if result["vote"]:
                    positive_weight += weight
        
        consensus_strength = positive_weight / total_weight if total_weight > 0 else 0
        consensus_reached = consensus_strength > 0.5
        
        consensus_result = {
            "proposal_id": proposal.get("id", "unknown"),
            "mechanism": "weighted_consensus",
            "consensus_reached": consensus_reached,
            "total_weight": total_weight,
            "positive_weight": positive_weight,
            "consensus_strength": consensus_strength,
            "participating_agents": [vote["agent_id"] for vote in votes],
            "timestamp": datetime.now()
        }
        
        self.consensus_history.append(consensus_result)
        if consensus_reached:
            self.performance_stats["successful_consensus"] += 1
        
        return consensus_result
    
    async def _byzantine_consensus(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        """Byzantine fault tolerant consensus."""
        # Simulate some agents being faulty (up to 1/3)
        max_faulty = len(self.agents) // 3
        faulty_agents = set(np.random.choice(range(len(self.agents)), max_faulty, replace=False))
        
        votes = []
        for i, agent in enumerate(self.agents):
            if agent.is_healthy() and i not in faulty_agents:
                vote_result = await agent.participate_in_consensus(proposal)
                votes.append(vote_result)
        
        # Byzantine consensus requires 2/3 + 1 agreement
        total_votes = len(votes)
        required_votes = (2 * total_votes) // 3 + 1
        positive_votes = sum(1 for vote in votes if vote["vote"])
        
        consensus_reached = positive_votes >= required_votes
        
        consensus_result = {
            "proposal_id": proposal.get("id", "unknown"),
            "mechanism": "byzantine_fault_tolerant",
            "consensus_reached": consensus_reached,
            "total_votes": total_votes,
            "positive_votes": positive_votes,
            "required_votes": required_votes,
            "faulty_agents": len(faulty_agents),
            "consensus_strength": positive_votes / total_votes if total_votes > 0 else 0,
            "timestamp": datetime.now()
        }
        
        self.consensus_history.append(consensus_result)
        if consensus_reached:
            self.performance_stats["successful_consensus"] += 1
        
        return consensus_result
    
    async def _raft_consensus(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        """Raft consensus algorithm simulation."""
        # Select a leader randomly
        leader = np.random.choice(self.agents)
        
        # Leader proposes to followers
        followers = [agent for agent in self.agents if agent.id != leader.id and agent.is_healthy()]
        
        # Simulate leader election and log replication
        votes = []
        for follower in followers:
            vote_result = await follower.participate_in_consensus(proposal)
            votes.append(vote_result)
        
        # Raft requires majority
        total_votes = len(votes) + 1  # +1 for leader
        majority_threshold = total_votes // 2 + 1
        positive_votes = sum(1 for vote in votes if vote["vote"]) + 1  # +1 leader vote
        
        consensus_reached = positive_votes >= majority_threshold
        
        consensus_result = {
            "proposal_id": proposal.get("id", "unknown"),
            "mechanism": "raft",
            "leader": leader.id,
            "consensus_reached": consensus_reached,
            "total_votes": total_votes,
            "positive_votes": positive_votes,
            "majority_threshold": majority_threshold,
            "timestamp": datetime.now()
        }
        
        self.consensus_history.append(consensus_result)
        if consensus_reached:
            self.performance_stats["successful_consensus"] += 1
        
        return consensus_result
    
    async def _paxos_consensus(self, proposal: Dict[str, Any]) -> Dict[str, Any]:
        """Paxos consensus algorithm simulation."""
        # Phase 1: Prepare
        proposal_number = len(self.consensus_history) + 1
        promises = []
        
        for agent in self.agents:
            if agent.is_healthy():
                # Simulate promise/reject
                promise = np.random.choice([True, False], p=[0.8, 0.2])
                if promise:
                    promises.append({"agent_id": agent.id, "promise_number": proposal_number})
        
        # Phase 2: Accept (if majority promised)
        if len(promises) > len(self.agents) // 2:
            acceptances = []
            for promise in promises:
                agent = next(a for a in self.agents if a.id == promise["agent_id"])
                vote_result = await agent.participate_in_consensus(proposal)
                if vote_result["vote"]:
                    acceptances.append(vote_result)
            
            consensus_reached = len(acceptances) > len(promises) // 2
        else:
            consensus_reached = False
            acceptances = []
        
        consensus_result = {
            "proposal_id": proposal.get("id", "unknown"),
            "mechanism": "paxos",
            "proposal_number": proposal_number,
            "promises": len(promises),
            "acceptances": len(acceptances),
            "consensus_reached": consensus_reached,
            "timestamp": datetime.now()
        }
        
        self.consensus_history.append(consensus_result)
        if consensus_reached:
            self.performance_stats["successful_consensus"] += 1
        
        return consensus_result
    
    async def share_knowledge_across_swarm(self, source_agent_id: str, knowledge: Dict[str, Any]) -> Dict[str, Any]:
        """Share knowledge across all agents in the swarm."""
        source_agent = next((a for a in self.agents if a.id == source_agent_id), None)
        if not source_agent:
            raise ValueError(f"Agent {source_agent_id} not found")
        
        # Share knowledge with all other agents
        sharing_tasks = []
        for agent in self.agents:
            if agent.id != source_agent_id and agent.is_healthy():
                task = agent.share_knowledge(knowledge)
                sharing_tasks.append(task)
        
        results = await asyncio.gather(*sharing_tasks, return_exceptions=True)
        
        successful_shares = sum(1 for result in results if result is True)
        self.performance_stats["knowledge_sharing_events"] += 1
        
        # Update knowledge graph
        for key, value in knowledge.items():
            if key not in self.knowledge_graph:
                self.knowledge_graph[key] = {"value": value, "contributors": []}
            self.knowledge_graph[key]["contributors"].append(source_agent_id)
        
        return {
            "source_agent": source_agent_id,
            "knowledge_shared": list(knowledge.keys()),
            "successful_shares": successful_shares,
            "total_agents": len(self.agents) - 1,
            "success_rate": successful_shares / (len(self.agents) - 1) if len(self.agents) > 1 else 0,
            "timestamp": datetime.now()
        }
    
    def get_swarm_health(self) -> Dict[str, Any]:
        """Get overall swarm health metrics."""
        healthy_agents = sum(1 for agent in self.agents if agent.is_healthy())
        avg_tasks_per_agent = sum(a.performance_metrics["tasks_completed"] for a in self.agents) / len(self.agents)
        avg_consensus_participation = sum(a.performance_metrics["consensus_participation"] for a in self.agents) / len(self.agents)
        
        return {
            "total_agents": len(self.agents),
            "healthy_agents": healthy_agents,
            "health_percentage": healthy_agents / len(self.agents),
            "avg_tasks_per_agent": avg_tasks_per_agent,
            "avg_consensus_participation": avg_consensus_participation,
            "total_consensus_attempts": len(self.consensus_history),
            "successful_consensus_rate": self.performance_stats["successful_consensus"] / len(self.consensus_history) if self.consensus_history else 0,
            "knowledge_sharing_events": self.performance_stats["knowledge_sharing_events"],
            "knowledge_graph_size": len(self.knowledge_graph)
        }


class MockHiveMindBenchmark:
    """Mock hive mind benchmark system."""
    
    def __init__(self, swarm_size: int = 10):
        self.swarm_size = swarm_size
        self.consensus_mechanisms = [
            "voting",
            "weighted_consensus", 
            "byzantine_fault_tolerant",
            "raft",
            "paxos"
        ]
        
    async def benchmark_collective_intelligence(self) -> Dict[str, Any]:
        """Benchmark collective intelligence capabilities."""
        # Initialize swarm
        swarm = await self._initialize_hive_mind_swarm()
        
        results = {
            "swarm_id": f"hive_mind_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
            "swarm_size": self.swarm_size,
            "consensus_results": {},
            "knowledge_sharing": None,
            "emergent_behaviors": None,
            "fault_tolerance": None,
            "overall_score": 0.0
        }
        
        # Test consensus mechanisms
        for mechanism in self.consensus_mechanisms:
            consensus_result = await self._test_consensus(swarm, mechanism)
            results["consensus_results"][mechanism] = consensus_result
        
        # Test knowledge sharing
        knowledge_result = await self._test_knowledge_sharing(swarm)
        results["knowledge_sharing"] = knowledge_result
        
        # Test emergent behaviors
        emergent_result = await self._test_emergent_behaviors(swarm)
        results["emergent_behaviors"] = emergent_result
        
        # Test fault tolerance
        fault_result = await self._test_fault_tolerance(swarm)
        results["fault_tolerance"] = fault_result
        
        # Calculate overall score
        results["overall_score"] = self._calculate_overall_score(results)
        
        return results
    
    async def _initialize_hive_mind_swarm(self) -> MockSwarm:
        """Initialize a hive mind swarm."""
        swarm = MockSwarm(self.swarm_size)
        
        # Warm up the swarm with some initial interactions
        for agent in swarm.agents:
            agent.update_heartbeat()
        
        return swarm
    
    async def _test_consensus(self, swarm: MockSwarm, mechanism: str) -> Dict[str, Any]:
        """Test a specific consensus mechanism."""
        # Create test proposals
        proposals = [
            {"id": f"{mechanism}_proposal_1", "type": "resource_allocation", "priority": "high"},
            {"id": f"{mechanism}_proposal_2", "type": "task_assignment", "priority": "medium"},
            {"id": f"{mechanism}_proposal_3", "type": "strategy_change", "priority": "low"}
        ]
        
        consensus_results = []
        total_time = 0
        
        for proposal in proposals:
            start_time = datetime.now()
            result = await swarm.reach_consensus(proposal, mechanism)
            end_time = datetime.now()
            
            consensus_time = (end_time - start_time).total_seconds()
            result["consensus_time"] = consensus_time
            total_time += consensus_time
            
            consensus_results.append(result)
        
        # Calculate metrics
        successful_consensus = sum(1 for r in consensus_results if r["consensus_reached"])
        avg_consensus_time = total_time / len(proposals)
        avg_consensus_strength = sum(r.get("consensus_strength", 0) for r in consensus_results) / len(consensus_results)
        
        return {
            "mechanism": mechanism,
            "total_proposals": len(proposals),
            "successful_consensus": successful_consensus,
            "success_rate": successful_consensus / len(proposals),
            "average_consensus_time": avg_consensus_time,
            "average_consensus_strength": avg_consensus_strength,
            "consensus_details": consensus_results
        }
    
    async def _test_knowledge_sharing(self, swarm: MockSwarm) -> Dict[str, Any]:
        """Test knowledge sharing efficiency."""
        # Create knowledge to share
        knowledge_items = [
            {"optimization_technique": "gradient_descent", "effectiveness": 0.85},
            {"best_practice": "error_handling", "implementation": "try_catch_finally"},
            {"performance_tip": "caching", "impact": "30%_improvement"},
            {"security_guideline": "input_validation", "criticality": "high"}
        ]
        
        sharing_results = []
        
        for i, knowledge in enumerate(knowledge_items):
            source_agent_id = f"agent_{i % len(swarm.agents)}"
            
            start_time = datetime.now()
            result = await swarm.share_knowledge_across_swarm(source_agent_id, knowledge)
            end_time = datetime.now()
            
            result["sharing_time"] = (end_time - start_time).total_seconds()
            sharing_results.append(result)
        
        # Calculate metrics
        avg_success_rate = sum(r["success_rate"] for r in sharing_results) / len(sharing_results)
        avg_sharing_time = sum(r["sharing_time"] for r in sharing_results) / len(sharing_results)
        total_knowledge_items = len(knowledge_items)
        
        return {
            "total_knowledge_items": total_knowledge_items,
            "sharing_attempts": len(sharing_results),
            "average_success_rate": avg_success_rate,
            "average_sharing_time": avg_sharing_time,
            "knowledge_graph_size": len(swarm.knowledge_graph),
            "sharing_details": sharing_results
        }
    
    async def _test_emergent_behaviors(self, swarm: MockSwarm) -> Dict[str, Any]:
        """Test emergent behavior patterns."""
        # Simulate complex task that requires coordination
        complex_task = {
            "id": "emergent_test",
            "type": "multi_agent_coordination",
            "requirements": ["analysis", "synthesis", "optimization"],
            "complexity": "high"
        }
        
        # Monitor agent interactions during task execution
        start_time = datetime.now()
        
        # Simulate emergent coordination patterns
        coordination_events = []
        
        # Create sub-tasks that require different capabilities
        sub_tasks = [
            {"id": "subtask_1", "capability": "analysis", "agents_needed": 3},
            {"id": "subtask_2", "capability": "synthesis", "agents_needed": 2}, 
            {"id": "subtask_3", "capability": "optimization", "agents_needed": 2}
        ]
        
        for sub_task in sub_tasks:
            # Find agents with required capability
            capable_agents = [
                agent for agent in swarm.agents 
                if sub_task["capability"] in agent.capabilities and agent.is_healthy()
            ]
            
            if len(capable_agents) >= sub_task["agents_needed"]:
                selected_agents = capable_agents[:sub_task["agents_needed"]]
                
                # Simulate coordination
                coordination_event = {
                    "sub_task_id": sub_task["id"],
                    "selected_agents": [agent.id for agent in selected_agents],
                    "capability": sub_task["capability"],
                    "coordination_success": True
                }
            else:
                # Emergent behavior: agents collaborate across capabilities
                coordination_event = {
                    "sub_task_id": sub_task["id"],
                    "selected_agents": [agent.id for agent in swarm.agents[:sub_task["agents_needed"]]],
                    "capability": sub_task["capability"],
                    "coordination_success": False,
                    "emergent_adaptation": True
                }
            
            coordination_events.append(coordination_event)
            await asyncio.sleep(0.1)  # Simulate coordination time
        
        end_time = datetime.now()
        total_coordination_time = (end_time - start_time).total_seconds()
        
        # Analyze emergent patterns
        successful_coordinations = sum(1 for event in coordination_events if event["coordination_success"])
        emergent_adaptations = sum(1 for event in coordination_events if event.get("emergent_adaptation", False))
        
        return {
            "task_complexity": complex_task["complexity"],
            "coordination_events": len(coordination_events),
            "successful_coordinations": successful_coordinations,
            "emergent_adaptations": emergent_adaptations,
            "total_coordination_time": total_coordination_time,
            "coordination_efficiency": successful_coordinations / len(coordination_events),
            "emergent_behavior_rate": emergent_adaptations / len(coordination_events),
            "coordination_details": coordination_events
        }
    
    async def _test_fault_tolerance(self, swarm: MockSwarm) -> Dict[str, Any]:
        """Test fault tolerance capabilities."""
        initial_health = swarm.get_swarm_health()
        
        # Simulate agent failures
        num_failures = max(1, len(swarm.agents) // 4)  # Fail 25% of agents
        failed_agents = np.random.choice(swarm.agents, num_failures, replace=False)
        
        # Mark agents as unhealthy
        for agent in failed_agents:
            agent.last_heartbeat = datetime.now() - timedelta(seconds=60)  # Old heartbeat
        
        # Test consensus with failures
        fault_test_proposal = {
            "id": "fault_tolerance_test",
            "type": "system_recovery",
            "priority": "critical"
        }
        
        start_time = datetime.now()
        consensus_result = await swarm.reach_consensus(fault_test_proposal, "byzantine_fault_tolerant")
        end_time = datetime.now()
        
        recovery_time = (end_time - start_time).total_seconds()
        
        # Test knowledge sharing with failures
        knowledge_test = {"emergency_protocol": "activate_backup_systems"}
        remaining_healthy_agent = next(agent for agent in swarm.agents if agent.is_healthy())
        
        sharing_result = await swarm.share_knowledge_across_swarm(remaining_healthy_agent.id, knowledge_test)
        
        final_health = swarm.get_swarm_health()
        
        return {
            "initial_healthy_agents": initial_health["healthy_agents"],
            "simulated_failures": num_failures,
            "final_healthy_agents": final_health["healthy_agents"],
            "health_degradation": (initial_health["healthy_agents"] - final_health["healthy_agents"]) / initial_health["healthy_agents"],
            "consensus_with_failures": consensus_result["consensus_reached"],
            "recovery_time": recovery_time,
            "knowledge_sharing_resilience": sharing_result["success_rate"],
            "fault_tolerance_score": self._calculate_fault_tolerance_score(initial_health, final_health, consensus_result, sharing_result)
        }
    
    def _calculate_fault_tolerance_score(self, initial_health: Dict, final_health: Dict, 
                                       consensus_result: Dict, sharing_result: Dict) -> float:
        """Calculate fault tolerance score."""
        # Factors: health degradation, consensus success, sharing resilience
        health_factor = final_health["healthy_agents"] / initial_health["healthy_agents"]
        consensus_factor = 1.0 if consensus_result["consensus_reached"] else 0.0
        sharing_factor = sharing_result["success_rate"]
        
        return (health_factor + consensus_factor + sharing_factor) / 3
    
    def _calculate_overall_score(self, results: Dict[str, Any]) -> float:
        """Calculate overall collective intelligence score."""
        scores = []
        
        # Consensus mechanism scores
        for mechanism, result in results["consensus_results"].items():
            scores.append(result["success_rate"])
        
        # Knowledge sharing score
        if results["knowledge_sharing"]:
            scores.append(results["knowledge_sharing"]["average_success_rate"])
        
        # Emergent behavior score
        if results["emergent_behaviors"]:
            scores.append(results["emergent_behaviors"]["coordination_efficiency"])
        
        # Fault tolerance score
        if results["fault_tolerance"]:
            scores.append(results["fault_tolerance"]["fault_tolerance_score"])
        
        return sum(scores) / len(scores) if scores else 0.0


class TestSwarmAgent:
    """Test individual swarm agent functionality."""
    
    @pytest.fixture
    def sample_agent(self):
        """Provide a sample agent for testing."""
        return MockSwarmAgent("test_agent", ["analysis", "coordination"])
    
    def test_agent_initialization(self, sample_agent):
        """Test agent initialization."""
        assert sample_agent.id == "test_agent"
        assert "analysis" in sample_agent.capabilities
        assert "coordination" in sample_agent.capabilities
        assert sample_agent.status == AgentStatus.IDLE
        assert sample_agent.knowledge_base == {}
        assert sample_agent.performance_metrics["tasks_completed"] == 0
    
    @pytest.mark.asyncio
    async def test_agent_task_processing(self, sample_agent):
        """Test agent task processing."""
        task = {"id": "test_task", "type": "analysis", "data": "sample data"}
        
        result = await sample_agent.process_task(task)
        
        assert result["agent_id"] == "test_agent"
        assert result["task_id"] == "test_task"
        assert result["success"] is True
        assert result["execution_time"] > 0
        assert sample_agent.performance_metrics["tasks_completed"] == 1
        assert sample_agent.status == AgentStatus.IDLE  # Should return to idle
    
    @pytest.mark.asyncio
    async def test_agent_consensus_participation(self, sample_agent):
        """Test agent participation in consensus."""
        proposal = {"id": "test_proposal", "type": "decision", "content": "Should we proceed?"}
        
        vote_result = await sample_agent.participate_in_consensus(proposal)
        
        assert vote_result["agent_id"] == "test_agent"
        assert "vote" in vote_result
        assert "vote_strength" in vote_result
        assert "reasoning" in vote_result
        assert isinstance(vote_result["vote"], bool)
        assert 0 <= vote_result["vote_strength"] <= 1
        assert sample_agent.performance_metrics["consensus_participation"] == 1
    
    @pytest.mark.asyncio
    async def test_agent_knowledge_sharing(self, sample_agent):
        """Test agent knowledge sharing."""
        knowledge = {
            "best_practice": "Always validate inputs",
            "technique": "Use caching for performance"
        }
        
        success = await sample_agent.share_knowledge(knowledge)
        
        assert success is True
        assert sample_agent.knowledge_base["best_practice"] == "Always validate inputs"
        assert sample_agent.knowledge_base["technique"] == "Use caching for performance"
        assert sample_agent.performance_metrics["knowledge_contributions"] == 1
    
    @pytest.mark.asyncio
    async def test_agent_knowledge_retrieval(self, sample_agent):
        """Test agent knowledge retrieval."""
        # First add some knowledge
        knowledge = {"test_key": "test_value"}
        await sample_agent.share_knowledge(knowledge)
        
        # Then retrieve it
        retrieved_value = await sample_agent.get_knowledge("test_key")
        
        assert retrieved_value == "test_value"
        
        # Test non-existent key
        non_existent = await sample_agent.get_knowledge("non_existent_key")
        assert non_existent is None
    
    def test_agent_health_check(self, sample_agent):
        """Test agent health checking."""
        # Agent should be healthy initially
        assert sample_agent.is_healthy() is True
        
        # Simulate old heartbeat
        sample_agent.last_heartbeat = datetime.now() - timedelta(seconds=60)
        assert sample_agent.is_healthy() is False
        
        # Update heartbeat
        sample_agent.update_heartbeat()
        assert sample_agent.is_healthy() is True


class TestSwarm:
    """Test swarm collective behavior."""
    
    @pytest.fixture
    def sample_swarm(self):
        """Provide a sample swarm for testing."""
        return MockSwarm(swarm_size=5)
    
    def test_swarm_initialization(self, sample_swarm):
        """Test swarm initialization."""
        assert len(sample_swarm.agents) == 5
        assert sample_swarm.swarm_size == 5
        assert len(sample_swarm.consensus_history) == 0
        
        # Check agent diversity
        all_capabilities = set()
        for agent in sample_swarm.agents:
            all_capabilities.update(agent.capabilities)
        
        assert len(all_capabilities) > 2  # Should have diverse capabilities
    
    @pytest.mark.asyncio
    async def test_voting_consensus(self, sample_swarm):
        """Test simple voting consensus."""
        proposal = {"id": "voting_test", "type": "simple_decision"}
        
        result = await sample_swarm.reach_consensus(proposal, "voting")
        
        assert result["mechanism"] == "voting"
        assert "consensus_reached" in result
        assert "vote_count" in result
        assert "positive_votes" in result
        assert result["vote_count"] == len(sample_swarm.agents)
        assert len(result["participating_agents"]) == len(sample_swarm.agents)
        assert len(sample_swarm.consensus_history) == 1
    
    @pytest.mark.asyncio
    async def test_weighted_consensus(self, sample_swarm):
        """Test weighted consensus mechanism."""
        proposal = {"id": "weighted_test", "type": "complex_decision"}
        
        result = await sample_swarm.reach_consensus(proposal, "weighted_consensus")
        
        assert result["mechanism"] == "weighted_consensus"
        assert "total_weight" in result
        assert "positive_weight" in result
        assert "consensus_strength" in result
        assert 0 <= result["consensus_strength"] <= 1
    
    @pytest.mark.asyncio
    async def test_byzantine_consensus(self, sample_swarm):
        """Test Byzantine fault tolerant consensus."""
        proposal = {"id": "byzantine_test", "type": "critical_decision"}
        
        result = await sample_swarm.reach_consensus(proposal, "byzantine_fault_tolerant")
        
        assert result["mechanism"] == "byzantine_fault_tolerant"
        assert "faulty_agents" in result
        assert "required_votes" in result
        assert result["faulty_agents"] <= len(sample_swarm.agents) // 3
    
    @pytest.mark.asyncio
    async def test_raft_consensus(self, sample_swarm):
        """Test Raft consensus algorithm."""
        proposal = {"id": "raft_test", "type": "leadership_decision"}
        
        result = await sample_swarm.reach_consensus(proposal, "raft")
        
        assert result["mechanism"] == "raft"
        assert "leader" in result
        assert "majority_threshold" in result
        assert result["leader"] in [agent.id for agent in sample_swarm.agents]
    
    @pytest.mark.asyncio
    async def test_paxos_consensus(self, sample_swarm):
        """Test Paxos consensus algorithm."""
        proposal = {"id": "paxos_test", "type": "distributed_decision"}
        
        result = await sample_swarm.reach_consensus(proposal, "paxos")
        
        assert result["mechanism"] == "paxos"
        assert "proposal_number" in result
        assert "promises" in result
        assert "acceptances" in result
    
    @pytest.mark.asyncio
    async def test_knowledge_sharing_across_swarm(self, sample_swarm):
        """Test knowledge sharing across entire swarm."""
        knowledge = {
            "optimization_tip": "Use batch processing",
            "security_note": "Validate all inputs"
        }
        source_agent_id = sample_swarm.agents[0].id
        
        result = await sample_swarm.share_knowledge_across_swarm(source_agent_id, knowledge)
        
        assert result["source_agent"] == source_agent_id
        assert result["successful_shares"] >= 0
        assert result["total_agents"] == len(sample_swarm.agents) - 1
        assert 0 <= result["success_rate"] <= 1
        
        # Check that knowledge was actually shared
        for agent in sample_swarm.agents[1:]:  # Skip source agent
            assert await agent.get_knowledge("optimization_tip") == "Use batch processing"
    
    @pytest.mark.asyncio
    async def test_invalid_consensus_mechanism(self, sample_swarm):
        """Test error handling for invalid consensus mechanism."""
        proposal = {"id": "invalid_test", "type": "test"}
        
        with pytest.raises(ValueError, match="Unknown consensus mechanism"):
            await sample_swarm.reach_consensus(proposal, "invalid_mechanism")
    
    def test_swarm_health_metrics(self, sample_swarm):
        """Test swarm health metrics calculation."""
        health = sample_swarm.get_swarm_health()
        
        assert health["total_agents"] == len(sample_swarm.agents)
        assert health["healthy_agents"] <= health["total_agents"]
        assert 0 <= health["health_percentage"] <= 1
        assert health["avg_tasks_per_agent"] >= 0
        assert health["total_consensus_attempts"] == len(sample_swarm.consensus_history)


class TestHiveMindBenchmark:
    """Test the complete hive mind benchmark system."""
    
    @pytest.fixture
    def hive_benchmark(self):
        """Provide hive mind benchmark instance."""
        return MockHiveMindBenchmark(swarm_size=8)
    
    def test_hive_benchmark_initialization(self, hive_benchmark):
        """Test hive mind benchmark initialization."""
        assert hive_benchmark.swarm_size == 8
        assert len(hive_benchmark.consensus_mechanisms) == 5
        assert "voting" in hive_benchmark.consensus_mechanisms
        assert "paxos" in hive_benchmark.consensus_mechanisms
    
    @pytest.mark.asyncio
    async def test_complete_collective_intelligence_benchmark(self, hive_benchmark):
        """Test complete collective intelligence benchmark."""
        results = await hive_benchmark.benchmark_collective_intelligence()
        
        assert "swarm_id" in results
        assert results["swarm_size"] == 8
        assert "consensus_results" in results
        assert "knowledge_sharing" in results
        assert "emergent_behaviors" in results
        assert "fault_tolerance" in results
        assert "overall_score" in results
        
        # Check consensus results
        assert len(results["consensus_results"]) == 5  # All mechanisms tested
        for mechanism in hive_benchmark.consensus_mechanisms:
            assert mechanism in results["consensus_results"]
            consensus_result = results["consensus_results"][mechanism]
            assert "success_rate" in consensus_result
            assert "average_consensus_time" in consensus_result
        
        # Verify overall score
        assert 0 <= results["overall_score"] <= 1
    
    @pytest.mark.asyncio
    async def test_swarm_initialization(self, hive_benchmark):
        """Test hive mind swarm initialization."""
        swarm = await hive_benchmark._initialize_hive_mind_swarm()
        
        assert isinstance(swarm, MockSwarm)
        assert len(swarm.agents) == hive_benchmark.swarm_size
        
        # All agents should be healthy after initialization
        for agent in swarm.agents:
            assert agent.is_healthy()
    
    @pytest.mark.asyncio
    async def test_consensus_testing(self, hive_benchmark):
        """Test consensus mechanism testing."""
        swarm = MockSwarm(5)
        
        consensus_result = await hive_benchmark._test_consensus(swarm, "voting")
        
        assert consensus_result["mechanism"] == "voting"
        assert consensus_result["total_proposals"] == 3
        assert "successful_consensus" in consensus_result
        assert "success_rate" in consensus_result
        assert "average_consensus_time" in consensus_result
        assert len(consensus_result["consensus_details"]) == 3
    
    @pytest.mark.asyncio
    async def test_knowledge_sharing_testing(self, hive_benchmark):
        """Test knowledge sharing testing."""
        swarm = MockSwarm(5)
        
        sharing_result = await hive_benchmark._test_knowledge_sharing(swarm)
        
        assert sharing_result["total_knowledge_items"] == 4
        assert "average_success_rate" in sharing_result
        assert "average_sharing_time" in sharing_result
        assert "knowledge_graph_size" in sharing_result
        assert len(sharing_result["sharing_details"]) == 4
    
    @pytest.mark.asyncio
    async def test_emergent_behavior_testing(self, hive_benchmark):
        """Test emergent behavior testing."""
        swarm = MockSwarm(8)  # Larger swarm for emergent behaviors
        
        emergent_result = await hive_benchmark._test_emergent_behaviors(swarm)
        
        assert emergent_result["task_complexity"] == "high"
        assert "coordination_events" in emergent_result
        assert "successful_coordinations" in emergent_result
        assert "emergent_adaptations" in emergent_result
        assert "coordination_efficiency" in emergent_result
        assert "emergent_behavior_rate" in emergent_result
        assert len(emergent_result["coordination_details"]) >= 3
    
    @pytest.mark.asyncio
    async def test_fault_tolerance_testing(self, hive_benchmark):
        """Test fault tolerance testing."""
        swarm = MockSwarm(8)
        
        fault_result = await hive_benchmark._test_fault_tolerance(swarm)
        
        assert "initial_healthy_agents" in fault_result
        assert "simulated_failures" in fault_result
        assert "final_healthy_agents" in fault_result
        assert "health_degradation" in fault_result
        assert "consensus_with_failures" in fault_result
        assert "recovery_time" in fault_result
        assert "knowledge_sharing_resilience" in fault_result
        assert "fault_tolerance_score" in fault_result
        
        # Health should degrade after simulated failures
        assert fault_result["final_healthy_agents"] < fault_result["initial_healthy_agents"]
        assert 0 <= fault_result["fault_tolerance_score"] <= 1


class TestConsensusAlgorithms:
    """Test specific consensus algorithm implementations."""
    
    @pytest.fixture
    def consensus_swarm(self):
        """Provide a swarm optimized for consensus testing."""
        return MockSwarm(swarm_size=7)  # Odd number for better consensus
    
    @pytest.mark.parametrize("mechanism", ["voting", "weighted_consensus", "byzantine_fault_tolerant", "raft", "paxos"])
    @pytest.mark.asyncio
    async def test_all_consensus_mechanisms(self, consensus_swarm, mechanism):
        """Test all consensus mechanisms with same proposal."""
        proposal = {"id": f"{mechanism}_test", "type": "test_decision", "priority": "medium"}
        
        result = await consensus_swarm.reach_consensus(proposal, mechanism)
        
        assert result["mechanism"] == mechanism
        assert "consensus_reached" in result
        assert "timestamp" in result
        assert isinstance(result["consensus_reached"], bool)
    
    @pytest.mark.asyncio
    async def test_consensus_with_agent_failures(self, consensus_swarm):
        """Test consensus behavior with some agent failures."""
        # Simulate some agent failures
        failed_count = 2
        for i in range(failed_count):
            consensus_swarm.agents[i].last_heartbeat = datetime.now() - timedelta(seconds=60)
        
        proposal = {"id": "failure_test", "type": "critical_decision"}
        
        # Byzantine should handle failures well
        result = await consensus_swarm.reach_consensus(proposal, "byzantine_fault_tolerant")
        
        assert result["mechanism"] == "byzantine_fault_tolerant"
        assert result["faulty_agents"] <= len(consensus_swarm.agents) // 3
    
    @pytest.mark.asyncio
    async def test_consensus_performance_comparison(self, consensus_swarm):
        """Compare performance of different consensus mechanisms."""
        proposal = {"id": "performance_test", "type": "benchmark"}
        mechanisms = ["voting", "weighted_consensus", "raft"]
        
        performance_results = {}
        
        for mechanism in mechanisms:
            start_time = datetime.now()
            result = await consensus_swarm.reach_consensus(proposal, mechanism)
            end_time = datetime.now()
            
            duration = (end_time - start_time).total_seconds()
            performance_results[mechanism] = {
                "duration": duration,
                "consensus_reached": result["consensus_reached"]
            }
        
        # All mechanisms should complete within reasonable time
        for mechanism, perf in performance_results.items():
            assert perf["duration"] < 1.0  # Should be fast for small swarm


class TestKnowledgeSharing:
    """Test knowledge sharing mechanisms."""
    
    @pytest.fixture
    def knowledge_swarm(self):
        """Provide a swarm for knowledge sharing tests."""
        return MockSwarm(swarm_size=6)
    
    @pytest.mark.asyncio
    async def test_bidirectional_knowledge_sharing(self, knowledge_swarm):
        """Test bidirectional knowledge sharing."""
        agent_a = knowledge_swarm.agents[0]
        agent_b = knowledge_swarm.agents[1]
        
        # Agent A shares knowledge
        knowledge_a = {"tip_a": "Use async for I/O operations"}
        await agent_a.share_knowledge(knowledge_a)
        
        # Agent B shares knowledge
        knowledge_b = {"tip_b": "Cache expensive computations"}
        await agent_b.share_knowledge(knowledge_b)
        
        # Share across swarm
        await knowledge_swarm.share_knowledge_across_swarm(agent_a.id, knowledge_a)
        await knowledge_swarm.share_knowledge_across_swarm(agent_b.id, knowledge_b)
        
        # All agents should have both pieces of knowledge
        for agent in knowledge_swarm.agents:
            if agent.id != agent_a.id:
                assert await agent.get_knowledge("tip_a") == "Use async for I/O operations"
            if agent.id != agent_b.id:
                assert await agent.get_knowledge("tip_b") == "Cache expensive computations"
    
    @pytest.mark.asyncio
    async def test_knowledge_graph_building(self, knowledge_swarm):
        """Test knowledge graph construction."""
        # Multiple agents contribute to knowledge graph
        knowledge_items = [
            ("agent_0", {"pattern": "singleton", "use_case": "database_connection"}),
            ("agent_1", {"pattern": "observer", "use_case": "event_handling"}),
            ("agent_2", {"pattern": "factory", "use_case": "object_creation"}),
        ]
        
        for agent_id, knowledge in knowledge_items:
            await knowledge_swarm.share_knowledge_across_swarm(agent_id, knowledge)
        
        # Check knowledge graph
        assert len(knowledge_swarm.knowledge_graph) == 3
        assert "pattern" in knowledge_swarm.knowledge_graph
        assert len(knowledge_swarm.knowledge_graph["pattern"]["contributors"]) == 3
    
    @pytest.mark.asyncio
    async def test_knowledge_sharing_failure_handling(self, knowledge_swarm):
        """Test knowledge sharing with some agent failures."""
        # Simulate some agent failures
        knowledge_swarm.agents[2].last_heartbeat = datetime.now() - timedelta(seconds=60)
        knowledge_swarm.agents[3].last_heartbeat = datetime.now() - timedelta(seconds=60)
        
        knowledge = {"emergency_protocol": "activate_failover"}
        
        result = await knowledge_swarm.share_knowledge_across_swarm("agent_0", knowledge)
        
        # Should still succeed with remaining healthy agents
        expected_healthy = len([a for a in knowledge_swarm.agents if a.is_healthy()]) - 1  # -1 for source
        assert result["successful_shares"] == expected_healthy
        assert result["success_rate"] == 1.0  # 100% success rate with healthy agents


class TestErrorHandlingAndEdgeCases:
    """Test error handling and edge cases."""
    
    @pytest.mark.asyncio
    async def test_empty_swarm_consensus(self):
        """Test consensus with empty swarm."""
        empty_swarm = MockSwarm(0)  # No agents
        proposal = {"id": "empty_test"}
        
        result = await empty_swarm.reach_consensus(proposal, "voting")
        
        assert result["vote_count"] == 0
        assert result["consensus_reached"] is False
    
    @pytest.mark.asyncio
    async def test_single_agent_consensus(self):
        """Test consensus with single agent."""
        single_swarm = MockSwarm(1)
        proposal = {"id": "single_test"}
        
        result = await single_swarm.reach_consensus(proposal, "voting")
        
        assert result["vote_count"] == 1
        # Single agent should always reach consensus
        assert result["consensus_reached"] is True
    
    @pytest.mark.asyncio
    async def test_knowledge_sharing_nonexistent_agent(self):
        """Test knowledge sharing with nonexistent source agent."""
        swarm = MockSwarm(3)
        knowledge = {"test": "value"}
        
        with pytest.raises(ValueError, match="Agent nonexistent not found"):
            await swarm.share_knowledge_across_swarm("nonexistent", knowledge)
    
    @pytest.mark.asyncio
    async def test_agent_task_processing_failure(self):
        """Test agent task processing with simulated failure."""
        agent = MockSwarmAgent("test_agent")
        
        # Mock the process_task method to raise an exception
        original_method = agent.process_task
        
        async def failing_process(task):
            raise Exception("Task processing failed")
        
        agent.process_task = failing_process
        
        with pytest.raises(Exception, match="Task processing failed"):
            await agent.process_task({"id": "fail_test"})


class TestPerformanceAndScaling:
    """Test performance characteristics and scaling behavior."""
    
    @pytest.mark.asyncio
    @pytest.mark.performance
    async def test_large_swarm_consensus(self):
        """Test consensus with large swarm."""
        large_swarm = MockSwarm(swarm_size=50)
        proposal = {"id": "large_test", "type": "scalability_test"}
        
        start_time = datetime.now()
        result = await large_swarm.reach_consensus(proposal, "voting")
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 5.0  # Should complete within 5 seconds
        assert result["vote_count"] == 50
        assert len(result["participating_agents"]) == 50
    
    @pytest.mark.asyncio
    @pytest.mark.performance
    async def test_concurrent_consensus_operations(self):
        """Test multiple concurrent consensus operations."""
        swarm = MockSwarm(swarm_size=10)
        
        # Create multiple proposals
        proposals = [
            {"id": f"concurrent_test_{i}", "type": "parallel_decision"}
            for i in range(5)
        ]
        
        # Run consensus in parallel
        start_time = datetime.now()
        tasks = [
            swarm.reach_consensus(proposal, "voting") 
            for proposal in proposals
        ]
        results = await asyncio.gather(*tasks)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 2.0  # Parallel execution should be efficient
        assert len(results) == 5
        
        # All should have reached some consensus
        for result in results:
            assert "consensus_reached" in result
    
    @pytest.mark.asyncio
    @pytest.mark.stress
    async def test_knowledge_sharing_stress(self):
        """Test knowledge sharing under stress."""
        swarm = MockSwarm(swarm_size=20)
        
        # Share many knowledge items concurrently
        knowledge_items = [
            {"key": f"stress_test_{i}", "value": f"value_{i}"}
            for i in range(100)
        ]
        
        sharing_tasks = []
        for i, knowledge in enumerate(knowledge_items):
            source_agent = swarm.agents[i % len(swarm.agents)]
            task = swarm.share_knowledge_across_swarm(source_agent.id, knowledge)
            sharing_tasks.append(task)
        
        start_time = datetime.now()
        results = await asyncio.gather(*sharing_tasks)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 10.0  # Should handle stress efficiently
        assert len(results) == 100
        
        # Most sharing should succeed
        avg_success_rate = sum(r["success_rate"] for r in results) / len(results)
        assert avg_success_rate > 0.95  # 95% success rate


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])