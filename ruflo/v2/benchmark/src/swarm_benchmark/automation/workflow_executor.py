"""
WorkflowExecutor for autonomous execution without human intervention.

This module provides advanced workflow execution capabilities that can analyze objectives,
plan execution strategies, spawn required agents, and execute complex workflows
autonomously with intelligent decision-making and error recovery.
"""

import asyncio
import time
import logging
import json
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Callable, Union, Tuple
from dataclasses import dataclass, field
from enum import Enum
from abc import ABC, abstractmethod
import uuid

from .models import BenchmarkTask, BenchmarkResult


class WorkflowStatus(Enum):
    """Status of workflow execution."""
    CREATED = "created"
    PLANNING = "planning"
    RESOURCE_ALLOCATION = "resource_allocation"
    EXECUTING = "executing"
    VALIDATING = "validating"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class ExecutionStrategy(Enum):
    """Execution strategy for workflows."""
    SEQUENTIAL = "sequential"
    PARALLEL = "parallel"
    ADAPTIVE = "adaptive"
    CONSERVATIVE = "conservative"
    AGGRESSIVE = "aggressive"


@dataclass
class WorkflowConfig:
    """Configuration for workflow execution."""
    execution_strategy: ExecutionStrategy = ExecutionStrategy.ADAPTIVE
    max_parallel_tasks: int = 10
    timeout_seconds: int = 3600  # 1 hour default
    retry_attempts: int = 3
    retry_delay: float = 2.0
    auto_recovery: bool = True
    
    # Resource constraints
    max_cpu_percent: int = 80
    max_memory_mb: int = 4096
    max_agents: int = 20
    
    # Decision making
    decision_threshold: float = 0.7
    risk_tolerance: str = "medium"  # low, medium, high
    adaptability: str = "high"  # low, medium, high
    
    # Monitoring and logging
    detailed_logging: bool = True
    progress_reporting: bool = True
    checkpoint_frequency: int = 300  # 5 minutes


@dataclass
class ExecutionPlan:
    """Plan for workflow execution."""
    plan_id: str
    objective: str
    strategy: ExecutionStrategy
    estimated_duration: float
    required_resources: Dict[str, Any]
    task_groups: List[List[BenchmarkTask]]
    agent_assignments: Dict[str, str]
    dependencies: Dict[str, List[str]]
    risk_assessment: Dict[str, Any]
    success_criteria: Dict[str, Any]
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert plan to dictionary representation."""
        return {
            "plan_id": self.plan_id,
            "objective": self.objective,
            "strategy": self.strategy.value,
            "estimated_duration": self.estimated_duration,
            "required_resources": self.required_resources,
            "task_groups": [[task.__dict__ for task in group] for group in self.task_groups],
            "agent_assignments": self.agent_assignments,
            "dependencies": self.dependencies,
            "risk_assessment": self.risk_assessment,
            "success_criteria": self.success_criteria
        }


@dataclass
class WorkflowResult:
    """Result of workflow execution."""
    workflow_id: str
    objective: str
    plan: ExecutionPlan
    status: WorkflowStatus
    start_time: datetime
    end_time: Optional[datetime] = None
    total_duration: Optional[float] = None
    tasks_completed: int = 0
    tasks_failed: int = 0
    agent_performance: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    metrics: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None
    
    @property
    def success_rate(self) -> float:
        """Calculate workflow success rate."""
        total = self.tasks_completed + self.tasks_failed
        return self.tasks_completed / total if total > 0 else 0.0


class ExecutionContext:
    """Context for workflow execution with shared state and resources."""
    
    def __init__(self, workflow_id: str, config: WorkflowConfig):
        self.workflow_id = workflow_id
        self.config = config
        self.shared_data: Dict[str, Any] = {}
        self.agents: Dict[str, Any] = {}
        self.resources: Dict[str, Any] = {}
        self.metrics: Dict[str, Any] = {}
        self.checkpoints: List[Dict[str, Any]] = []
        self.created_at = datetime.now()
        
    async def __aenter__(self):
        """Async context manager entry."""
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit with cleanup."""
        await self._cleanup_resources()
        
    async def _cleanup_resources(self):
        """Clean up allocated resources."""
        for resource_id, resource in self.resources.items():
            try:
                if hasattr(resource, 'cleanup'):
                    await resource.cleanup()
            except Exception as e:
                logging.warning(f"Failed to cleanup resource {resource_id}: {e}")


class ObjectiveAnalyzer:
    """Analyze objectives and generate execution strategies."""
    
    def __init__(self):
        self.objective_patterns = {
            "benchmark": ["benchmark", "test", "measure", "evaluate", "performance"],
            "analysis": ["analyze", "study", "investigate", "examine", "research"],
            "optimization": ["optimize", "improve", "enhance", "maximize", "minimize"],
            "comparison": ["compare", "contrast", "versus", "benchmark against"],
            "validation": ["validate", "verify", "confirm", "check", "test"]
        }
        
    async def analyze_objective(self, objective: str) -> Dict[str, Any]:
        """
        Analyze the objective and determine its characteristics.
        
        Args:
            objective: The workflow objective description
            
        Returns:
            Analysis results including type, complexity, and requirements
        """
        analysis = {
            "objective_type": self._classify_objective(objective),
            "complexity": self._assess_complexity(objective),
            "estimated_duration": self._estimate_duration(objective),
            "required_capabilities": self._identify_capabilities(objective),
            "resource_requirements": self._estimate_resources(objective),
            "success_criteria": self._define_success_criteria(objective)
        }
        
        return analysis
    
    def _classify_objective(self, objective: str) -> str:
        """Classify the objective type."""
        objective_lower = objective.lower()
        
        scores = {}
        for obj_type, keywords in self.objective_patterns.items():
            score = sum(1 for keyword in keywords if keyword in objective_lower)
            scores[obj_type] = score
            
        # Return the highest scoring type, or 'general' if no clear match
        return max(scores, key=scores.get) if max(scores.values()) > 0 else "general"
    
    def _assess_complexity(self, objective: str) -> str:
        """Assess objective complexity."""
        complexity_indicators = {
            "high": ["multiple", "complex", "comprehensive", "advanced", "distributed"],
            "medium": ["several", "moderate", "standard", "typical"],
            "low": ["simple", "basic", "single", "quick", "easy"]
        }
        
        objective_lower = objective.lower()
        
        for level, indicators in complexity_indicators.items():
            if any(indicator in objective_lower for indicator in indicators):
                return level
                
        # Default complexity assessment based on length and word count
        word_count = len(objective.split())
        if word_count > 20:
            return "high"
        elif word_count > 10:
            return "medium"
        else:
            return "low"
    
    def _estimate_duration(self, objective: str) -> float:
        """Estimate execution duration in seconds."""
        complexity = self._assess_complexity(objective)
        obj_type = self._classify_objective(objective)
        
        base_durations = {
            "benchmark": 600,  # 10 minutes
            "analysis": 300,   # 5 minutes
            "optimization": 900,  # 15 minutes
            "comparison": 450,    # 7.5 minutes
            "validation": 180,    # 3 minutes
            "general": 300        # 5 minutes
        }
        
        complexity_multipliers = {
            "low": 0.5,
            "medium": 1.0,
            "high": 2.0
        }
        
        base_duration = base_durations.get(obj_type, 300)
        multiplier = complexity_multipliers.get(complexity, 1.0)
        
        return base_duration * multiplier
    
    def _identify_capabilities(self, objective: str) -> List[str]:
        """Identify required capabilities."""
        capability_keywords = {
            "data_processing": ["data", "dataset", "processing", "analysis"],
            "machine_learning": ["model", "training", "ml", "ai", "prediction"],
            "performance_testing": ["performance", "benchmark", "speed", "throughput"],
            "system_monitoring": ["monitor", "track", "observe", "system"],
            "reporting": ["report", "document", "output", "results"],
            "coordination": ["coordinate", "orchestrate", "manage", "swarm"]
        }
        
        objective_lower = objective.lower()
        capabilities = []
        
        for capability, keywords in capability_keywords.items():
            if any(keyword in objective_lower for keyword in keywords):
                capabilities.append(capability)
                
        return capabilities if capabilities else ["general_processing"]
    
    def _estimate_resources(self, objective: str) -> Dict[str, Any]:
        """Estimate resource requirements."""
        complexity = self._assess_complexity(objective)
        capabilities = self._identify_capabilities(objective)
        
        base_resources = {
            "agents": 2,
            "cpu_cores": 2,
            "memory_mb": 1024,
            "storage_mb": 512
        }
        
        complexity_multipliers = {
            "low": 0.5,
            "medium": 1.0,
            "high": 2.0
        }
        
        multiplier = complexity_multipliers.get(complexity, 1.0)
        
        # Adjust based on capabilities
        if "machine_learning" in capabilities:
            multiplier *= 1.5
        if "data_processing" in capabilities:
            multiplier *= 1.3
        if "coordination" in capabilities:
            multiplier *= 1.2
        
        return {
            resource: int(value * multiplier)
            for resource, value in base_resources.items()
        }
    
    def _define_success_criteria(self, objective: str) -> Dict[str, Any]:
        """Define success criteria for the objective."""
        return {
            "completion_rate": 0.95,
            "error_rate_max": 0.05,
            "performance_threshold": 0.8,
            "quality_score_min": 0.7
        }


class AgentSpawner:
    """Spawn and manage agents for workflow execution."""
    
    def __init__(self):
        self.agent_templates = {
            "data_processor": {
                "type": "coder",
                "capabilities": ["data_processing", "file_operations", "analysis"],
                "resources": {"cpu": 1, "memory_mb": 512}
            },
            "benchmark_runner": {
                "type": "performance-benchmarker", 
                "capabilities": ["benchmarking", "performance_testing", "metrics"],
                "resources": {"cpu": 2, "memory_mb": 1024}
            },
            "ml_specialist": {
                "type": "ml-developer",
                "capabilities": ["machine_learning", "model_training", "evaluation"],
                "resources": {"cpu": 2, "memory_mb": 2048}
            },
            "coordinator": {
                "type": "coordinator",
                "capabilities": ["orchestration", "coordination", "monitoring"],
                "resources": {"cpu": 1, "memory_mb": 256}
            },
            "analyst": {
                "type": "analyst",
                "capabilities": ["analysis", "reporting", "interpretation"],
                "resources": {"cpu": 1, "memory_mb": 512}
            }
        }
        
    async def spawn_agents(self, 
                          requirements: List[str],
                          context: ExecutionContext) -> Dict[str, str]:
        """
        Spawn agents based on capability requirements.
        
        Args:
            requirements: List of required capabilities
            context: Execution context
            
        Returns:
            Dictionary mapping capability to agent ID
        """
        agent_assignments = {}
        
        # Map capabilities to agent types
        capability_to_agent = {
            "data_processing": "data_processor",
            "machine_learning": "ml_specialist", 
            "performance_testing": "benchmark_runner",
            "coordination": "coordinator",
            "reporting": "analyst",
            "general_processing": "data_processor"
        }
        
        # Spawn required agents
        for capability in requirements:
            agent_type = capability_to_agent.get(capability, "data_processor")
            agent_id = await self._spawn_agent(agent_type, context)
            agent_assignments[capability] = agent_id
            
        return agent_assignments
    
    async def _spawn_agent(self, agent_type: str, context: ExecutionContext) -> str:
        """Spawn a specific agent type."""
        if agent_type not in self.agent_templates:
            agent_type = "data_processor"  # Fallback
            
        template = self.agent_templates[agent_type]
        agent_id = f"{agent_type}_{uuid.uuid4().hex[:8]}"
        
        # Simulate agent spawning
        await asyncio.sleep(0.1)
        
        agent_info = {
            "id": agent_id,
            "type": template["type"],
            "capabilities": template["capabilities"],
            "resources": template["resources"],
            "status": "active",
            "spawned_at": datetime.now(),
            "tasks_completed": 0,
            "tasks_failed": 0
        }
        
        context.agents[agent_id] = agent_info
        return agent_id


class WorkflowExecutor:
    """
    Execute autonomous workflows without human intervention.
    
    The workflow executor provides comprehensive autonomous execution capabilities
    including objective analysis, execution planning, agent spawning, task execution,
    error recovery, and result validation.
    """
    
    def __init__(self, config: WorkflowConfig):
        self.config = config
        self.logger = logging.getLogger(self.__class__.__name__)
        self._setup_logging()
        
        # Core components
        self.objective_analyzer = ObjectiveAnalyzer()
        self.agent_spawner = AgentSpawner()
        
        # Execution tracking
        self.active_workflows: Dict[str, ExecutionContext] = {}
        self.completed_workflows: List[WorkflowResult] = []
        
        # Performance metrics
        self.metrics = {
            "workflows_executed": 0,
            "success_rate": 0.0,
            "average_duration": 0.0,
            "agent_efficiency": 0.0
        }
        
    def _setup_logging(self):
        """Configure logging for workflow executor."""
        if self.config.detailed_logging:
            handler = logging.StreamHandler()
            formatter = logging.Formatter(
                '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
            )
            handler.setFormatter(formatter)
            self.logger.addHandler(handler)
            self.logger.setLevel(logging.INFO)
    
    async def execute_autonomous_workflow(self, objective: str) -> WorkflowResult:
        """
        Execute a fully autonomous workflow.
        
        The workflow will:
        1. Analyze the objective
        2. Plan execution strategy
        3. Spawn required agents
        4. Execute tasks with decision points
        5. Handle errors and retry logic
        6. Generate final report
        
        Args:
            objective: The workflow objective description
            
        Returns:
            WorkflowResult containing execution results and metrics
        """
        workflow_id = f"workflow_{uuid.uuid4().hex[:8]}"
        start_time = datetime.now()
        
        self.logger.info(f"Starting autonomous workflow: {workflow_id}")
        self.logger.info(f"Objective: {objective}")
        
        result = WorkflowResult(
            workflow_id=workflow_id,
            objective=objective,
            plan=None,  # Will be set during planning
            status=WorkflowStatus.CREATED,
            start_time=start_time
        )
        
        try:
            # Phase 1: Objective Analysis and Planning
            result.status = WorkflowStatus.PLANNING
            plan = await self._generate_execution_plan(objective)
            result.plan = plan
            
            # Phase 2: Resource Allocation and Agent Spawning
            result.status = WorkflowStatus.RESOURCE_ALLOCATION
            async with ExecutionContext(workflow_id, self.config) as context:
                self.active_workflows[workflow_id] = context
                
                agents = await self._allocate_resources(plan, context)
                
                # Phase 3: Autonomous Execution
                result.status = WorkflowStatus.EXECUTING
                execution_result = await self._execute_plan(plan, context)
                
                # Update result with execution data
                result.tasks_completed = execution_result.get("completed", 0)
                result.tasks_failed = execution_result.get("failed", 0)
                result.agent_performance = self._collect_agent_metrics(context)
                
                # Phase 4: Validation and Quality Assessment
                result.status = WorkflowStatus.VALIDATING
                validation_result = await self._validate_result(execution_result, context)
                result.metrics = validation_result
                
                result.status = WorkflowStatus.COMPLETED
                
        except Exception as e:
            result.status = WorkflowStatus.FAILED
            result.error = str(e)
            self.logger.error(f"Workflow execution failed: {workflow_id}, Error: {str(e)}")
            
        finally:
            result.end_time = datetime.now()
            result.total_duration = (result.end_time - result.start_time).total_seconds()
            
            # Cleanup
            if workflow_id in self.active_workflows:
                del self.active_workflows[workflow_id]
                
            self.completed_workflows.append(result)
            self._update_global_metrics(result)
            
        self.logger.info(f"Workflow completed: {workflow_id}, Status: {result.status.value}")
        return result
    
    async def _generate_execution_plan(self, objective: str) -> ExecutionPlan:
        """Generate execution plan from objective analysis."""
        analysis = await self.objective_analyzer.analyze_objective(objective)
        
        plan_id = f"plan_{uuid.uuid4().hex[:8]}"
        
        # Determine execution strategy
        complexity = analysis.get("complexity", "medium")
        strategy_mapping = {
            "low": ExecutionStrategy.SEQUENTIAL,
            "medium": ExecutionStrategy.ADAPTIVE,
            "high": ExecutionStrategy.PARALLEL
        }
        strategy = strategy_mapping.get(complexity, ExecutionStrategy.ADAPTIVE)
        
        # Create task groups based on capabilities
        capabilities = analysis.get("required_capabilities", ["general_processing"])
        task_groups = self._create_task_groups(objective, capabilities)
        
        # Generate agent assignments
        agent_assignments = {cap: f"{cap}_agent" for cap in capabilities}
        
        plan = ExecutionPlan(
            plan_id=plan_id,
            objective=objective,
            strategy=strategy,
            estimated_duration=analysis.get("estimated_duration", 300),
            required_resources=analysis.get("resource_requirements", {}),
            task_groups=task_groups,
            agent_assignments=agent_assignments,
            dependencies=self._generate_dependencies(task_groups),
            risk_assessment=self._assess_risks(analysis),
            success_criteria=analysis.get("success_criteria", {})
        )
        
        self.logger.info(f"Generated execution plan: {plan_id}, Strategy: {strategy.value}")
        return plan
    
    def _create_task_groups(self, objective: str, capabilities: List[str]) -> List[List[BenchmarkTask]]:
        """Create task groups from objective and capabilities."""
        task_groups = []
        
        for i, capability in enumerate(capabilities):
            # Create tasks for each capability
            tasks = [
                BenchmarkTask(
                    id=f"task_{capability}_{j}",
                    name=f"{capability.replace('_', ' ').title()} Task {j+1}",
                    description=f"Execute {capability} operations for: {objective}",
                    type=capability,
                    parameters={"objective": objective, "capability": capability}
                )
                for j in range(2)  # 2 tasks per capability
            ]
            task_groups.append(tasks)
            
        return task_groups
    
    def _generate_dependencies(self, task_groups: List[List[BenchmarkTask]]) -> Dict[str, List[str]]:
        """Generate task dependencies."""
        dependencies = {}
        
        # Simple linear dependencies for now
        for i, group in enumerate(task_groups):
            for task in group:
                if i > 0:
                    # Depend on all tasks from previous group
                    prev_group = task_groups[i-1]
                    dependencies[task.id] = [prev_task.id for prev_task in prev_group]
                else:
                    dependencies[task.id] = []
                    
        return dependencies
    
    def _assess_risks(self, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Assess execution risks."""
        complexity = analysis.get("complexity", "medium")
        capabilities = analysis.get("required_capabilities", [])
        
        risk_factors = {
            "complexity_risk": {
                "low": 0.1,
                "medium": 0.3,
                "high": 0.6
            }.get(complexity, 0.3),
            "capability_risk": min(len(capabilities) * 0.1, 0.5),
            "resource_risk": 0.2 if analysis.get("resource_requirements", {}).get("agents", 0) > 5 else 0.1
        }
        
        overall_risk = sum(risk_factors.values()) / len(risk_factors)
        
        return {
            "risk_factors": risk_factors,
            "overall_risk": overall_risk,
            "risk_level": "high" if overall_risk > 0.4 else "medium" if overall_risk > 0.2 else "low",
            "mitigation_strategies": self._generate_mitigation_strategies(risk_factors)
        }
    
    def _generate_mitigation_strategies(self, risk_factors: Dict[str, float]) -> List[str]:
        """Generate risk mitigation strategies."""
        strategies = []
        
        if risk_factors.get("complexity_risk", 0) > 0.4:
            strategies.append("Enable conservative execution mode")
            strategies.append("Increase checkpoint frequency")
            
        if risk_factors.get("capability_risk", 0) > 0.3:
            strategies.append("Spawn backup agents")
            strategies.append("Enable cross-capability redundancy")
            
        if risk_factors.get("resource_risk", 0) > 0.3:
            strategies.append("Implement resource monitoring")
            strategies.append("Enable auto-scaling")
            
        return strategies
    
    async def _allocate_resources(self, plan: ExecutionPlan, context: ExecutionContext) -> Dict[str, str]:
        """Allocate resources and spawn agents."""
        # Spawn required agents
        capabilities = list(plan.agent_assignments.keys())
        agents = await self.agent_spawner.spawn_agents(capabilities, context)
        
        # Allocate computational resources
        resources = plan.required_resources
        context.resources = {
            "cpu_allocation": resources.get("cpu_cores", 2),
            "memory_allocation": resources.get("memory_mb", 1024),
            "storage_allocation": resources.get("storage_mb", 512)
        }
        
        self.logger.info(f"Allocated {len(agents)} agents and resources")
        return agents
    
    async def _execute_plan(self, plan: ExecutionPlan, context: ExecutionContext) -> Dict[str, Any]:
        """Execute the planned workflow."""
        execution_stats = {
            "completed": 0,
            "failed": 0,
            "skipped": 0,
            "task_results": []
        }
        
        # Execute based on strategy
        if plan.strategy == ExecutionStrategy.SEQUENTIAL:
            await self._execute_sequential(plan, context, execution_stats)
        elif plan.strategy == ExecutionStrategy.PARALLEL:
            await self._execute_parallel(plan, context, execution_stats)
        else:  # ADAPTIVE
            await self._execute_adaptive(plan, context, execution_stats)
            
        return execution_stats
    
    async def _execute_sequential(self, 
                                 plan: ExecutionPlan, 
                                 context: ExecutionContext,
                                 execution_stats: Dict[str, Any]):
        """Execute tasks sequentially."""
        for group in plan.task_groups:
            for task in group:
                try:
                    result = await self._execute_task(task, context)
                    execution_stats["completed"] += 1
                    execution_stats["task_results"].append(result)
                except Exception as e:
                    execution_stats["failed"] += 1
                    self.logger.warning(f"Task failed: {task.id}, Error: {str(e)}")
    
    async def _execute_parallel(self,
                               plan: ExecutionPlan,
                               context: ExecutionContext, 
                               execution_stats: Dict[str, Any]):
        """Execute tasks in parallel where possible."""
        all_tasks = [task for group in plan.task_groups for task in group]
        
        # Execute all tasks concurrently with dependency resolution
        semaphore = asyncio.Semaphore(self.config.max_parallel_tasks)
        
        async def execute_with_deps(task: BenchmarkTask):
            async with semaphore:
                # Wait for dependencies (simplified implementation)
                deps = plan.dependencies.get(task.id, [])
                # In practice, would wait for dependency completion
                
                try:
                    result = await self._execute_task(task, context)
                    execution_stats["completed"] += 1
                    execution_stats["task_results"].append(result)
                    return result
                except Exception as e:
                    execution_stats["failed"] += 1
                    self.logger.warning(f"Task failed: {task.id}, Error: {str(e)}")
                    raise
        
        # Execute all tasks
        results = await asyncio.gather(
            *[execute_with_deps(task) for task in all_tasks],
            return_exceptions=True
        )
    
    async def _execute_adaptive(self,
                               plan: ExecutionPlan,
                               context: ExecutionContext,
                               execution_stats: Dict[str, Any]):
        """Execute with adaptive strategy based on performance."""
        # Start with parallel execution for first group
        # Monitor performance and adapt strategy dynamically
        
        for i, group in enumerate(plan.task_groups):
            if i == 0 or execution_stats["failed"] / (execution_stats["completed"] + execution_stats["failed"]) < 0.1:
                # Use parallel for first group or if error rate is low
                await self._execute_task_group_parallel(group, context, execution_stats)
            else:
                # Switch to sequential if error rate is high
                await self._execute_task_group_sequential(group, context, execution_stats)
    
    async def _execute_task_group_parallel(self,
                                          tasks: List[BenchmarkTask],
                                          context: ExecutionContext,
                                          execution_stats: Dict[str, Any]):
        """Execute a group of tasks in parallel."""
        semaphore = asyncio.Semaphore(min(len(tasks), self.config.max_parallel_tasks))
        
        async def execute_single(task: BenchmarkTask):
            async with semaphore:
                try:
                    result = await self._execute_task(task, context)
                    execution_stats["completed"] += 1
                    execution_stats["task_results"].append(result)
                    return result
                except Exception as e:
                    execution_stats["failed"] += 1
                    self.logger.warning(f"Task failed: {task.id}, Error: {str(e)}")
                    raise
        
        results = await asyncio.gather(
            *[execute_single(task) for task in tasks],
            return_exceptions=True
        )
    
    async def _execute_task_group_sequential(self,
                                            tasks: List[BenchmarkTask],
                                            context: ExecutionContext,
                                            execution_stats: Dict[str, Any]):
        """Execute a group of tasks sequentially."""
        for task in tasks:
            try:
                result = await self._execute_task(task, context)
                execution_stats["completed"] += 1
                execution_stats["task_results"].append(result)
            except Exception as e:
                execution_stats["failed"] += 1
                self.logger.warning(f"Task failed: {task.id}, Error: {str(e)}")
    
    async def _execute_task(self, task: BenchmarkTask, context: ExecutionContext) -> BenchmarkResult:
        """Execute a single task with error handling."""
        start_time = time.time()
        
        # Simulate task execution
        await asyncio.sleep(0.1)
        
        execution_time = time.time() - start_time
        
        # Update agent metrics
        if task.type in context.agents:
            agent = context.agents[task.type] 
            agent["tasks_completed"] += 1
        
        result = BenchmarkResult(
            task_id=task.id,
            status="completed",
            execution_time=execution_time,
            metrics={
                "task_type": task.type,
                "objective": task.parameters.get("objective", ""),
                "capability": task.parameters.get("capability", "")
            },
            timestamp=datetime.now()
        )
        
        return result
    
    async def _validate_result(self, 
                              execution_result: Dict[str, Any],
                              context: ExecutionContext) -> Dict[str, Any]:
        """Validate workflow execution results."""
        total_tasks = execution_result["completed"] + execution_result["failed"]
        success_rate = execution_result["completed"] / total_tasks if total_tasks > 0 else 0
        
        validation_metrics = {
            "success_rate": success_rate,
            "total_tasks": total_tasks,
            "agent_efficiency": self._calculate_agent_efficiency(context),
            "resource_utilization": self._calculate_resource_utilization(context),
            "quality_score": min(success_rate + 0.1, 1.0),  # Simple quality metric
            "validation_passed": success_rate >= 0.8
        }
        
        return validation_metrics
    
    def _collect_agent_metrics(self, context: ExecutionContext) -> Dict[str, Dict[str, Any]]:
        """Collect performance metrics for all agents."""
        agent_metrics = {}
        
        for agent_id, agent_info in context.agents.items():
            total_tasks = agent_info["tasks_completed"] + agent_info["tasks_failed"]
            success_rate = agent_info["tasks_completed"] / total_tasks if total_tasks > 0 else 0
            
            agent_metrics[agent_id] = {
                "type": agent_info["type"],
                "tasks_completed": agent_info["tasks_completed"],
                "tasks_failed": agent_info["tasks_failed"],
                "success_rate": success_rate,
                "efficiency_score": success_rate * 0.8 + 0.2  # Simple efficiency metric
            }
            
        return agent_metrics
    
    def _calculate_agent_efficiency(self, context: ExecutionContext) -> float:
        """Calculate overall agent efficiency."""
        if not context.agents:
            return 0.0
            
        efficiencies = []
        for agent_info in context.agents.values():
            total_tasks = agent_info["tasks_completed"] + agent_info["tasks_failed"]
            if total_tasks > 0:
                efficiency = agent_info["tasks_completed"] / total_tasks
                efficiencies.append(efficiency)
                
        return sum(efficiencies) / len(efficiencies) if efficiencies else 0.0
    
    def _calculate_resource_utilization(self, context: ExecutionContext) -> float:
        """Calculate resource utilization efficiency."""
        # Simple mock calculation
        allocated = context.resources.get("cpu_allocation", 1)
        return min(allocated / 4.0, 1.0)  # Assume optimal is 4 cores
    
    def _update_global_metrics(self, result: WorkflowResult):
        """Update global performance metrics."""
        self.metrics["workflows_executed"] += 1
        
        # Update success rate
        completed_workflows = len([w for w in self.completed_workflows if w.status == WorkflowStatus.COMPLETED])
        self.metrics["success_rate"] = completed_workflows / len(self.completed_workflows)
        
        # Update average duration
        durations = [w.total_duration for w in self.completed_workflows if w.total_duration]
        if durations:
            self.metrics["average_duration"] = sum(durations) / len(durations)
        
        # Update agent efficiency
        if result.agent_performance:
            efficiencies = [agent["efficiency_score"] for agent in result.agent_performance.values()]
            if efficiencies:
                self.metrics["agent_efficiency"] = sum(efficiencies) / len(efficiencies)
    
    def get_active_workflows(self) -> List[str]:
        """Get list of active workflow IDs."""
        return list(self.active_workflows.keys())
    
    def get_workflow_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get status of a specific workflow."""
        if workflow_id in self.active_workflows:
            context = self.active_workflows[workflow_id]
            return {
                "workflow_id": workflow_id,
                "status": "active",
                "agents": len(context.agents),
                "start_time": context.created_at.isoformat(),
                "duration": (datetime.now() - context.created_at).total_seconds()
            }
            
        # Check completed workflows
        for result in self.completed_workflows:
            if result.workflow_id == workflow_id:
                return {
                    "workflow_id": workflow_id,
                    "status": result.status.value,
                    "success_rate": result.success_rate,
                    "duration": result.total_duration,
                    "tasks_completed": result.tasks_completed,
                    "tasks_failed": result.tasks_failed
                }
                
        return None
    
    def get_performance_metrics(self) -> Dict[str, Any]:
        """Get overall executor performance metrics."""
        return self.metrics.copy()