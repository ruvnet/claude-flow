"""
DecisionEngine for autonomous decision-making during workflow execution.

This module provides intelligent decision-making capabilities that can analyze
context, performance metrics, and execution history to make optimal decisions
about resource allocation, task routing, error recovery, and workflow optimization.
"""

import asyncio
import time
import logging
import json
import statistics
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Callable, Union, Tuple
from dataclasses import dataclass, field
from enum import Enum
from abc import ABC, abstractmethod
import uuid
import math

from .models import BenchmarkTask, BenchmarkResult


class DecisionType(Enum):
    """Types of decisions the engine can make."""
    RESOURCE_ALLOCATION = "resource_allocation"
    TASK_ROUTING = "task_routing"
    ERROR_RECOVERY = "error_recovery"
    SCALING = "scaling"
    OPTIMIZATION = "optimization"
    WORKFLOW_ADAPTATION = "workflow_adaptation"
    PRIORITY_ADJUSTMENT = "priority_adjustment"


class ConfidenceLevel(Enum):
    """Confidence levels for decisions."""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    VERY_HIGH = "very_high"


@dataclass
class DecisionContext:
    """Context information for decision making."""
    # Current state
    current_metrics: Dict[str, Any] = field(default_factory=dict)
    resource_status: Dict[str, Any] = field(default_factory=dict)
    task_queue_status: Dict[str, Any] = field(default_factory=dict)
    error_history: List[Dict[str, Any]] = field(default_factory=list)
    
    # Historical data
    performance_history: List[Dict[str, Any]] = field(default_factory=list)
    decision_history: List['DecisionResult'] = field(default_factory=list)
    
    # Constraints and objectives
    objectives: Dict[str, float] = field(default_factory=dict)
    constraints: Dict[str, Any] = field(default_factory=dict)
    preferences: Dict[str, Any] = field(default_factory=dict)
    
    # External factors
    system_load: float = 0.0
    time_constraints: Optional[datetime] = None
    budget_constraints: Optional[float] = None
    quality_requirements: Dict[str, float] = field(default_factory=dict)


@dataclass
class DecisionCriteria:
    """Criteria for evaluating decision options."""
    name: str
    weight: float = 1.0
    maximize: bool = True  # True to maximize, False to minimize
    threshold: Optional[float] = None
    required: bool = False


@dataclass
class DecisionOption:
    """A potential decision option."""
    option_id: str
    name: str
    description: str
    estimated_impact: Dict[str, float] = field(default_factory=dict)
    cost: float = 0.0
    risk_level: float = 0.0  # 0-1, higher is riskier
    confidence: float = 0.0  # 0-1, higher is more confident
    prerequisites: List[str] = field(default_factory=list)
    side_effects: List[str] = field(default_factory=list)


@dataclass
class DecisionResult:
    """Result of a decision-making process."""
    decision_id: str
    decision_type: DecisionType
    context_snapshot: Dict[str, Any]
    
    # Decision details
    selected_option: DecisionOption
    alternative_options: List[DecisionOption] = field(default_factory=list)
    rationale: str = ""
    confidence: ConfidenceLevel = ConfidenceLevel.MEDIUM
    
    # Execution tracking
    timestamp: datetime = field(default_factory=datetime.now)
    executed: bool = False
    execution_result: Optional[Dict[str, Any]] = None
    
    # Evaluation
    success_metrics: Dict[str, float] = field(default_factory=dict)
    actual_impact: Dict[str, float] = field(default_factory=dict)
    lessons_learned: List[str] = field(default_factory=list)


class DecisionStrategy(ABC):
    """Abstract base class for decision strategies."""
    
    @abstractmethod
    async def evaluate_options(self, 
                             options: List[DecisionOption], 
                             context: DecisionContext,
                             criteria: List[DecisionCriteria]) -> List[Tuple[DecisionOption, float]]:
        """
        Evaluate decision options and return scores.
        
        Args:
            options: Available decision options
            context: Current decision context
            criteria: Evaluation criteria
            
        Returns:
            List of (option, score) tuples sorted by score
        """
        pass


class UtilityBasedStrategy(DecisionStrategy):
    """Multi-criteria utility-based decision strategy."""
    
    async def evaluate_options(self, 
                             options: List[DecisionOption], 
                             context: DecisionContext,
                             criteria: List[DecisionCriteria]) -> List[Tuple[DecisionOption, float]]:
        """Evaluate options using weighted utility function."""
        scored_options = []
        
        for option in options:
            utility_score = await self._calculate_utility(option, context, criteria)
            scored_options.append((option, utility_score))
        
        # Sort by score (higher is better)
        scored_options.sort(key=lambda x: x[1], reverse=True)
        return scored_options
    
    async def _calculate_utility(self, 
                               option: DecisionOption,
                               context: DecisionContext,
                               criteria: List[DecisionCriteria]) -> float:
        """Calculate utility score for an option."""
        total_utility = 0.0
        total_weight = 0.0
        
        for criterion in criteria:
            # Get criterion value for this option
            value = self._get_criterion_value(option, criterion, context)
            
            # Normalize to 0-1 scale
            normalized_value = self._normalize_value(value, criterion)
            
            # Apply direction (maximize vs minimize)
            if not criterion.maximize:
                normalized_value = 1.0 - normalized_value
            
            # Check required thresholds
            if criterion.required and criterion.threshold:
                if (criterion.maximize and value < criterion.threshold) or \
                   (not criterion.maximize and value > criterion.threshold):
                    return -1.0  # Option fails required criterion
            
            # Add weighted contribution
            weighted_value = normalized_value * criterion.weight
            total_utility += weighted_value
            total_weight += criterion.weight
        
        # Normalize by total weight
        utility = total_utility / total_weight if total_weight > 0 else 0.0
        
        # Apply risk and confidence factors
        risk_penalty = option.risk_level * 0.2  # Up to 20% penalty for risk
        confidence_bonus = option.confidence * 0.1  # Up to 10% bonus for confidence
        
        final_utility = utility - risk_penalty + confidence_bonus
        return max(0.0, min(1.0, final_utility))
    
    def _get_criterion_value(self, 
                           option: DecisionOption,
                           criterion: DecisionCriteria,
                           context: DecisionContext) -> float:
        """Get the value for a specific criterion."""
        # Check option's estimated impact first
        if criterion.name in option.estimated_impact:
            return option.estimated_impact[criterion.name]
        
        # Check context metrics
        if criterion.name in context.current_metrics:
            return context.current_metrics[criterion.name]
        
        # Default values based on criterion name
        defaults = {
            "cost": option.cost,
            "risk": option.risk_level,
            "confidence": option.confidence,
            "performance": 0.5,
            "efficiency": 0.5,
            "reliability": 0.7
        }
        
        return defaults.get(criterion.name, 0.5)
    
    def _normalize_value(self, value: float, criterion: DecisionCriteria) -> float:
        """Normalize a value to 0-1 scale."""
        # Simple normalization - in practice, this could be more sophisticated
        if criterion.threshold:
            return min(1.0, max(0.0, value / criterion.threshold))
        else:
            return min(1.0, max(0.0, value))


class RiskAverseStrategy(DecisionStrategy):
    """Conservative strategy that minimizes risk."""
    
    async def evaluate_options(self, 
                             options: List[DecisionOption], 
                             context: DecisionContext,
                             criteria: List[DecisionCriteria]) -> List[Tuple[DecisionOption, float]]:
        """Evaluate options with risk-averse scoring."""
        scored_options = []
        
        for option in options:
            # Base utility calculation
            base_score = 0.5  # Conservative baseline
            
            # Heavily penalize high-risk options
            risk_penalty = option.risk_level ** 2  # Quadratic penalty
            
            # Reward high confidence
            confidence_bonus = option.confidence * 0.3
            
            # Consider cost efficiency
            cost_factor = max(0, 1.0 - option.cost / 100.0)  # Assume max cost is 100
            
            # Final score
            score = base_score - risk_penalty + confidence_bonus + cost_factor * 0.2
            scored_options.append((option, max(0.0, score)))
        
        scored_options.sort(key=lambda x: x[1], reverse=True)
        return scored_options


class AggressiveStrategy(DecisionStrategy):
    """Aggressive strategy that maximizes potential gains."""
    
    async def evaluate_options(self, 
                             options: List[DecisionOption], 
                             context: DecisionContext,
                             criteria: List[DecisionCriteria]) -> List[Tuple[DecisionOption, float]]:
        """Evaluate options with aggressive scoring."""
        scored_options = []
        
        for option in options:
            # Start with high baseline for aggressive approach
            base_score = 0.7
            
            # Reward high potential impact
            impact_sum = sum(option.estimated_impact.values())
            impact_bonus = min(0.5, impact_sum / 10.0)  # Up to 50% bonus
            
            # Accept moderate risk for high reward
            risk_adjustment = option.risk_level * 0.1  # Light risk penalty
            
            # Confidence still matters
            confidence_factor = option.confidence * 0.2
            
            score = base_score + impact_bonus - risk_adjustment + confidence_factor
            scored_options.append((option, min(1.0, score)))
        
        scored_options.sort(key=lambda x: x[1], reverse=True)
        return scored_options


class AdaptiveStrategy(DecisionStrategy):
    """Adaptive strategy that learns from decision history."""
    
    def __init__(self):
        self.success_patterns: Dict[str, float] = {}
        self.failure_patterns: Dict[str, float] = {}
        
    async def evaluate_options(self, 
                             options: List[DecisionOption], 
                             context: DecisionContext,
                             criteria: List[DecisionCriteria]) -> List[Tuple[DecisionOption, float]]:
        """Evaluate options using historical learning."""
        # Update patterns from decision history
        self._update_learning_patterns(context.decision_history)
        
        scored_options = []
        
        for option in options:
            # Base utility score
            base_score = await self._calculate_base_utility(option, context, criteria)
            
            # Apply learning adjustments
            learning_adjustment = self._get_learning_adjustment(option)
            
            # Context-aware adjustments
            context_adjustment = self._get_context_adjustment(option, context)
            
            final_score = base_score + learning_adjustment + context_adjustment
            scored_options.append((option, max(0.0, min(1.0, final_score))))
        
        scored_options.sort(key=lambda x: x[1], reverse=True)
        return scored_options
    
    async def _calculate_base_utility(self, 
                                    option: DecisionOption,
                                    context: DecisionContext,
                                    criteria: List[DecisionCriteria]) -> float:
        """Calculate base utility using standard approach."""
        # Use utility-based calculation as baseline
        utility_strategy = UtilityBasedStrategy()
        return await utility_strategy._calculate_utility(option, context, criteria)
    
    def _update_learning_patterns(self, decision_history: List[DecisionResult]):
        """Update learning patterns from decision history."""
        for decision in decision_history[-10:]:  # Consider recent decisions
            option_key = self._get_option_key(decision.selected_option)
            
            # Determine success based on actual vs estimated impact
            success_score = self._calculate_success_score(decision)
            
            if success_score > 0.7:
                self.success_patterns[option_key] = self.success_patterns.get(option_key, 0) + 0.1
            elif success_score < 0.3:
                self.failure_patterns[option_key] = self.failure_patterns.get(option_key, 0) + 0.1
    
    def _get_option_key(self, option: DecisionOption) -> str:
        """Generate a key for option pattern matching."""
        return f"{option.name}_{option.risk_level:.1f}_{option.cost:.1f}"
    
    def _calculate_success_score(self, decision: DecisionResult) -> float:
        """Calculate success score for a decision."""
        if not decision.execution_result or not decision.success_metrics:
            return 0.5  # Neutral if no data
        
        # Compare actual vs expected impact
        expected = decision.selected_option.estimated_impact
        actual = decision.actual_impact
        
        if not expected or not actual:
            return 0.5
        
        # Calculate accuracy of estimates
        accuracies = []
        for key in expected:
            if key in actual:
                expected_val = expected[key]
                actual_val = actual[key]
                if expected_val != 0:
                    accuracy = 1.0 - abs(expected_val - actual_val) / abs(expected_val)
                    accuracies.append(max(0, accuracy))
        
        return sum(accuracies) / len(accuracies) if accuracies else 0.5
    
    def _get_learning_adjustment(self, option: DecisionOption) -> float:
        """Get learning-based adjustment for option."""
        option_key = self._get_option_key(option)
        
        success_boost = self.success_patterns.get(option_key, 0) * 0.2
        failure_penalty = self.failure_patterns.get(option_key, 0) * 0.3
        
        return success_boost - failure_penalty
    
    def _get_context_adjustment(self, option: DecisionOption, context: DecisionContext) -> float:
        """Get context-aware adjustment."""
        adjustment = 0.0
        
        # Adjust based on current system load
        if context.system_load > 0.8:
            # High load - prefer low-cost options
            adjustment -= option.cost * 0.1
        elif context.system_load < 0.3:
            # Low load - can afford higher-cost options
            adjustment += option.cost * 0.05
        
        # Adjust based on time constraints
        if context.time_constraints:
            time_pressure = self._calculate_time_pressure(context.time_constraints)
            if time_pressure > 0.7:
                # High time pressure - prefer fast, reliable options
                adjustment += option.confidence * 0.1
                adjustment -= option.risk_level * 0.2
        
        return adjustment
    
    def _calculate_time_pressure(self, deadline: datetime) -> float:
        """Calculate time pressure (0-1, higher is more pressure)."""
        remaining = (deadline - datetime.now()).total_seconds()
        if remaining <= 0:
            return 1.0
        elif remaining > 3600:  # More than 1 hour
            return 0.0
        else:
            return 1.0 - (remaining / 3600.0)


class DecisionEngine:
    """
    Autonomous decision-making engine for workflow execution.
    
    The decision engine analyzes context, evaluates options, and makes optimal
    decisions based on multiple criteria, learning from past decisions to
    improve future performance.
    """
    
    def __init__(self, strategy: str = "adaptive"):
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Decision strategies
        self.strategies = {
            "utility": UtilityBasedStrategy(),
            "risk_averse": RiskAverseStrategy(),
            "aggressive": AggressiveStrategy(),
            "adaptive": AdaptiveStrategy()
        }
        
        self.current_strategy = self.strategies.get(strategy, self.strategies["adaptive"])
        
        # Decision history and learning
        self.decision_history: List[DecisionResult] = []
        self.performance_metrics: Dict[str, Any] = {
            "decisions_made": 0,
            "successful_decisions": 0,
            "decision_accuracy": 0.0,
            "average_confidence": 0.0,
            "strategy_effectiveness": {}
        }
        
        # Decision templates
        self.decision_templates = self._initialize_templates()
        
    def _initialize_templates(self) -> Dict[DecisionType, Dict[str, Any]]:
        """Initialize decision templates for different types."""
        return {
            DecisionType.RESOURCE_ALLOCATION: {
                "criteria": [
                    DecisionCriteria("cost", weight=0.3, maximize=False),
                    DecisionCriteria("performance", weight=0.4, maximize=True),
                    DecisionCriteria("reliability", weight=0.2, maximize=True),
                    DecisionCriteria("availability", weight=0.1, maximize=True)
                ],
                "option_generators": ["allocate_new", "reuse_existing", "scale_up"]
            },
            DecisionType.TASK_ROUTING: {
                "criteria": [
                    DecisionCriteria("efficiency", weight=0.4, maximize=True),
                    DecisionCriteria("load_balance", weight=0.3, maximize=True),
                    DecisionCriteria("latency", weight=0.2, maximize=False),
                    DecisionCriteria("specialization", weight=0.1, maximize=True)
                ],
                "option_generators": ["round_robin", "least_loaded", "capability_match"]
            },
            DecisionType.ERROR_RECOVERY: {
                "criteria": [
                    DecisionCriteria("recovery_time", weight=0.3, maximize=False),
                    DecisionCriteria("success_probability", weight=0.4, maximize=True),
                    DecisionCriteria("impact_minimization", weight=0.2, maximize=True),
                    DecisionCriteria("cost", weight=0.1, maximize=False)
                ],
                "option_generators": ["retry", "fallback", "skip", "escalate"]
            },
            DecisionType.SCALING: {
                "criteria": [
                    DecisionCriteria("throughput_gain", weight=0.4, maximize=True),
                    DecisionCriteria("cost_efficiency", weight=0.3, maximize=True),
                    DecisionCriteria("response_time", weight=0.2, maximize=False),
                    DecisionCriteria("stability", weight=0.1, maximize=True)
                ],
                "option_generators": ["scale_up", "scale_down", "maintain", "redistribute"]
            }
        }
    
    async def make_decision(self, 
                           decision_type: DecisionType,
                           context: DecisionContext,
                           custom_criteria: Optional[List[DecisionCriteria]] = None) -> DecisionResult:
        """
        Make a decision based on type, context, and criteria.
        
        Args:
            decision_type: Type of decision to make
            context: Current decision context
            custom_criteria: Optional custom criteria (overrides template)
            
        Returns:
            DecisionResult with selected option and rationale
        """
        decision_id = f"decision_{decision_type.value}_{uuid.uuid4().hex[:8]}"
        
        self.logger.info(f"Making decision: {decision_id} ({decision_type.value})")
        
        try:
            # Get criteria (custom or template)
            criteria = custom_criteria or self._get_template_criteria(decision_type)
            
            # Generate decision options
            options = await self._generate_options(decision_type, context)
            
            if not options:
                raise ValueError(f"No options available for decision type: {decision_type.value}")
            
            # Evaluate options using current strategy
            scored_options = await self.current_strategy.evaluate_options(options, context, criteria)
            
            # Select best option
            best_option, best_score = scored_options[0] if scored_options else (None, 0)
            
            if not best_option:
                raise ValueError("No viable option found")
            
            # Determine confidence level
            confidence = self._determine_confidence(best_score, scored_options)
            
            # Generate rationale
            rationale = self._generate_rationale(best_option, scored_options, criteria, context)
            
            # Create decision result
            decision = DecisionResult(
                decision_id=decision_id,
                decision_type=decision_type,
                context_snapshot=self._snapshot_context(context),
                selected_option=best_option,
                alternative_options=[opt for opt, _ in scored_options[1:5]],  # Top 5 alternatives
                rationale=rationale,
                confidence=confidence
            )
            
            # Store decision
            self.decision_history.append(decision)
            self._update_metrics(decision)
            
            self.logger.info(f"Decision made: {decision_id}, Option: {best_option.name}, "
                           f"Confidence: {confidence.value}")
            
            return decision
            
        except Exception as e:
            self.logger.error(f"Decision making failed: {decision_id}, Error: {e}")
            # Create fallback decision
            return self._create_fallback_decision(decision_id, decision_type, context, str(e))
    
    async def execute_decision(self, decision: DecisionResult) -> bool:
        """
        Execute a decision and track the results.
        
        Args:
            decision: The decision to execute
            
        Returns:
            True if execution was successful
        """
        if decision.executed:
            self.logger.warning(f"Decision already executed: {decision.decision_id}")
            return True
        
        try:
            self.logger.info(f"Executing decision: {decision.decision_id}")
            
            # Execute the decision (implementation would depend on decision type)
            execution_result = await self._execute_decision_option(decision.selected_option, decision.decision_type)
            
            # Mark as executed
            decision.executed = True
            decision.execution_result = execution_result
            
            # Track success metrics
            decision.success_metrics = await self._measure_decision_success(decision)
            
            self.logger.info(f"Decision executed successfully: {decision.decision_id}")
            return True
            
        except Exception as e:
            self.logger.error(f"Decision execution failed: {decision.decision_id}, Error: {e}")
            decision.execution_result = {"error": str(e), "success": False}
            return False
    
    def learn_from_outcomes(self, decisions: Optional[List[DecisionResult]] = None):
        """
        Learn from decision outcomes to improve future decisions.
        
        Args:
            decisions: Specific decisions to learn from (default: all recent decisions)
        """
        learning_decisions = decisions or self.decision_history[-20:]  # Last 20 decisions
        
        if not learning_decisions:
            return
        
        # Analyze decision patterns
        self._analyze_success_patterns(learning_decisions)
        self._analyze_failure_patterns(learning_decisions)
        self._update_strategy_effectiveness(learning_decisions)
        
        # Update adaptive strategy if using it
        if isinstance(self.current_strategy, AdaptiveStrategy):
            # Learning is built into the strategy
            pass
        
        self.logger.info(f"Learned from {len(learning_decisions)} decisions")
    
    def switch_strategy(self, strategy_name: str):
        """Switch to a different decision strategy."""
        if strategy_name in self.strategies:
            old_strategy = type(self.current_strategy).__name__
            self.current_strategy = self.strategies[strategy_name]
            self.logger.info(f"Switched decision strategy from {old_strategy} to {strategy_name}")
        else:
            self.logger.warning(f"Unknown strategy: {strategy_name}")
    
    def get_decision_metrics(self) -> Dict[str, Any]:
        """Get decision-making performance metrics."""
        return self.performance_metrics.copy()
    
    def get_recent_decisions(self, count: int = 10) -> List[DecisionResult]:
        """Get recent decisions."""
        return self.decision_history[-count:]
    
    async def _generate_options(self, 
                               decision_type: DecisionType,
                               context: DecisionContext) -> List[DecisionOption]:
        """Generate decision options for a given type and context."""
        if decision_type == DecisionType.RESOURCE_ALLOCATION:
            return await self._generate_resource_allocation_options(context)
        elif decision_type == DecisionType.TASK_ROUTING:
            return await self._generate_task_routing_options(context)
        elif decision_type == DecisionType.ERROR_RECOVERY:
            return await self._generate_error_recovery_options(context)
        elif decision_type == DecisionType.SCALING:
            return await self._generate_scaling_options(context)
        else:
            return await self._generate_generic_options(context)
    
    async def _generate_resource_allocation_options(self, context: DecisionContext) -> List[DecisionOption]:
        """Generate resource allocation options."""
        options = []
        
        # Option 1: Allocate new resource
        options.append(DecisionOption(
            option_id="allocate_new",
            name="Allocate New Resource",
            description="Create and allocate a new computational resource",
            estimated_impact={"performance": 0.8, "cost": 0.6},
            cost=50.0,
            risk_level=0.3,
            confidence=0.7
        ))
        
        # Option 2: Reuse existing resource
        options.append(DecisionOption(
            option_id="reuse_existing",
            name="Reuse Existing Resource",
            description="Share an existing resource with current allocation",
            estimated_impact={"performance": 0.6, "cost": 0.2},
            cost=10.0,
            risk_level=0.5,
            confidence=0.9
        ))
        
        # Option 3: Wait for resource
        options.append(DecisionOption(
            option_id="wait_for_resource",
            name="Wait for Resource",
            description="Wait for an existing resource to become available",
            estimated_impact={"performance": 0.4, "cost": 0.1},
            cost=5.0,
            risk_level=0.4,
            confidence=0.8
        ))
        
        return options
    
    async def _generate_task_routing_options(self, context: DecisionContext) -> List[DecisionOption]:
        """Generate task routing options."""
        options = []
        
        # Round-robin routing
        options.append(DecisionOption(
            option_id="round_robin",
            name="Round-Robin Routing",
            description="Distribute tasks evenly across available agents",
            estimated_impact={"load_balance": 0.8, "efficiency": 0.6},
            cost=5.0,
            risk_level=0.2,
            confidence=0.9
        ))
        
        # Capability-based routing
        options.append(DecisionOption(
            option_id="capability_match",
            name="Capability-Based Routing",
            description="Route tasks to agents with matching capabilities",
            estimated_impact={"efficiency": 0.9, "specialization": 0.8},
            cost=10.0,
            risk_level=0.3,
            confidence=0.8
        ))
        
        # Load-based routing
        options.append(DecisionOption(
            option_id="least_loaded",
            name="Least Loaded Routing",
            description="Route tasks to the least loaded agents",
            estimated_impact={"load_balance": 0.9, "latency": 0.7},
            cost=8.0,
            risk_level=0.25,
            confidence=0.85
        ))
        
        return options
    
    async def _generate_error_recovery_options(self, context: DecisionContext) -> List[DecisionOption]:
        """Generate error recovery options."""
        options = []
        
        # Retry with exponential backoff
        options.append(DecisionOption(
            option_id="retry_backoff",
            name="Retry with Backoff",
            description="Retry the failed task with exponential backoff",
            estimated_impact={"success_probability": 0.7, "recovery_time": 0.3},
            cost=15.0,
            risk_level=0.4,
            confidence=0.6
        ))
        
        # Fallback to alternative approach
        options.append(DecisionOption(
            option_id="fallback",
            name="Use Fallback Method",
            description="Switch to a fallback implementation",
            estimated_impact={"success_probability": 0.8, "impact_minimization": 0.7},
            cost=25.0,
            risk_level=0.3,
            confidence=0.8
        ))
        
        # Skip and continue
        options.append(DecisionOption(
            option_id="skip_continue",
            name="Skip and Continue",
            description="Skip the failed task and continue with others",
            estimated_impact={"recovery_time": 0.9, "impact_minimization": 0.4},
            cost=5.0,
            risk_level=0.6,
            confidence=0.9
        ))
        
        return options
    
    async def _generate_scaling_options(self, context: DecisionContext) -> List[DecisionOption]:
        """Generate scaling options."""
        options = []
        
        # Scale up
        options.append(DecisionOption(
            option_id="scale_up",
            name="Scale Up",
            description="Add more resources to handle increased load",
            estimated_impact={"throughput_gain": 0.8, "response_time": 0.7},
            cost=40.0,
            risk_level=0.3,
            confidence=0.7
        ))
        
        # Scale down
        options.append(DecisionOption(
            option_id="scale_down",
            name="Scale Down",
            description="Reduce resources to optimize costs",
            estimated_impact={"cost_efficiency": 0.8, "stability": 0.6},
            cost=-20.0,  # Negative cost (saves money)
            risk_level=0.4,
            confidence=0.8
        ))
        
        # Maintain current scale
        options.append(DecisionOption(
            option_id="maintain_scale",
            name="Maintain Scale",
            description="Keep current resource allocation",
            estimated_impact={"stability": 0.9, "cost_efficiency": 0.5},
            cost=0.0,
            risk_level=0.1,
            confidence=0.95
        ))
        
        return options
    
    async def _generate_generic_options(self, context: DecisionContext) -> List[DecisionOption]:
        """Generate generic options for unknown decision types."""
        return [
            DecisionOption(
                option_id="default_action",
                name="Default Action",
                description="Take the default action for this situation",
                estimated_impact={"general": 0.5},
                cost=10.0,
                risk_level=0.3,
                confidence=0.7
            )
        ]
    
    def _get_template_criteria(self, decision_type: DecisionType) -> List[DecisionCriteria]:
        """Get criteria template for decision type."""
        template = self.decision_templates.get(decision_type, {})
        return template.get("criteria", [])
    
    def _determine_confidence(self, 
                            best_score: float,
                            scored_options: List[Tuple[DecisionOption, float]]) -> ConfidenceLevel:
        """Determine confidence level based on scores."""
        if len(scored_options) < 2:
            return ConfidenceLevel.MEDIUM
        
        # Calculate score spread
        second_best_score = scored_options[1][1] if len(scored_options) > 1 else 0
        score_gap = best_score - second_best_score
        
        # Determine confidence based on best score and gap
        if best_score > 0.8 and score_gap > 0.2:
            return ConfidenceLevel.VERY_HIGH
        elif best_score > 0.7 and score_gap > 0.15:
            return ConfidenceLevel.HIGH
        elif best_score > 0.5 and score_gap > 0.1:
            return ConfidenceLevel.MEDIUM
        else:
            return ConfidenceLevel.LOW
    
    def _generate_rationale(self, 
                          selected_option: DecisionOption,
                          scored_options: List[Tuple[DecisionOption, float]],
                          criteria: List[DecisionCriteria],
                          context: DecisionContext) -> str:
        """Generate human-readable rationale for the decision."""
        rationale_parts = []
        
        # Main selection reason
        score = scored_options[0][1] if scored_options else 0
        rationale_parts.append(f"Selected '{selected_option.name}' with score {score:.2f}")
        
        # Key criteria influences
        top_criteria = sorted(criteria, key=lambda c: c.weight, reverse=True)[:3]
        criteria_reasons = []
        for criterion in top_criteria:
            value = selected_option.estimated_impact.get(criterion.name, 0.5)
            criteria_reasons.append(f"{criterion.name}={value:.2f}")
        
        if criteria_reasons:
            rationale_parts.append(f"Key factors: {', '.join(criteria_reasons)}")
        
        # Risk and confidence
        rationale_parts.append(f"Risk level: {selected_option.risk_level:.2f}, "
                             f"Confidence: {selected_option.confidence:.2f}")
        
        # Context considerations
        if context.system_load > 0.8:
            rationale_parts.append("High system load influenced selection")
        elif context.system_load < 0.3:
            rationale_parts.append("Low system load allowed for optimal choice")
        
        return ". ".join(rationale_parts)
    
    def _snapshot_context(self, context: DecisionContext) -> Dict[str, Any]:
        """Create a snapshot of the decision context."""
        return {
            "metrics": context.current_metrics.copy(),
            "system_load": context.system_load,
            "timestamp": datetime.now().isoformat(),
            "constraints": context.constraints.copy(),
            "objectives": context.objectives.copy()
        }
    
    def _create_fallback_decision(self, 
                                 decision_id: str,
                                 decision_type: DecisionType,
                                 context: DecisionContext,
                                 error: str) -> DecisionResult:
        """Create a fallback decision when normal processing fails."""
        fallback_option = DecisionOption(
            option_id="fallback",
            name="Fallback Action",
            description=f"Fallback due to error: {error}",
            estimated_impact={"reliability": 0.5},
            cost=0.0,
            risk_level=0.5,
            confidence=0.3
        )
        
        return DecisionResult(
            decision_id=decision_id,
            decision_type=decision_type,
            context_snapshot=self._snapshot_context(context),
            selected_option=fallback_option,
            rationale=f"Fallback decision due to error: {error}",
            confidence=ConfidenceLevel.LOW
        )
    
    async def _execute_decision_option(self, 
                                      option: DecisionOption,
                                      decision_type: DecisionType) -> Dict[str, Any]:
        """Execute a specific decision option."""
        # This would contain the actual implementation logic for each option
        # For now, simulate execution
        await asyncio.sleep(0.1)  # Simulate execution time
        
        return {
            "success": True,
            "execution_time": 0.1,
            "option_id": option.option_id,
            "estimated_impact": option.estimated_impact,
            "actual_cost": option.cost
        }
    
    async def _measure_decision_success(self, decision: DecisionResult) -> Dict[str, float]:
        """Measure the success of a decision after execution."""
        if not decision.execution_result:
            return {"success": 0.0}
        
        # Simple success measurement
        base_success = 1.0 if decision.execution_result.get("success", False) else 0.0
        
        # Adjust based on confidence accuracy
        confidence_accuracy = self._calculate_confidence_accuracy(decision)
        
        return {
            "success": base_success,
            "confidence_accuracy": confidence_accuracy,
            "overall_score": (base_success + confidence_accuracy) / 2
        }
    
    def _calculate_confidence_accuracy(self, decision: DecisionResult) -> float:
        """Calculate how accurate the confidence assessment was."""
        if not decision.execution_result:
            return 0.5
        
        success = decision.execution_result.get("success", False)
        confidence_map = {
            ConfidenceLevel.LOW: 0.25,
            ConfidenceLevel.MEDIUM: 0.5, 
            ConfidenceLevel.HIGH: 0.75,
            ConfidenceLevel.VERY_HIGH: 0.9
        }
        
        predicted_success = confidence_map.get(decision.confidence, 0.5)
        actual_success = 1.0 if success else 0.0
        
        # Calculate accuracy (higher is better)
        return 1.0 - abs(predicted_success - actual_success)
    
    def _update_metrics(self, decision: DecisionResult):
        """Update performance metrics after a decision."""
        self.performance_metrics["decisions_made"] += 1
        
        if decision.executed and decision.success_metrics:
            success = decision.success_metrics.get("success", 0)
            if success > 0.7:
                self.performance_metrics["successful_decisions"] += 1
        
        # Update running averages
        total_decisions = self.performance_metrics["decisions_made"]
        success_rate = self.performance_metrics["successful_decisions"] / total_decisions
        self.performance_metrics["decision_accuracy"] = success_rate
        
        # Update average confidence
        confidence_values = [self._confidence_to_float(d.confidence) for d in self.decision_history[-10:]]
        if confidence_values:
            self.performance_metrics["average_confidence"] = statistics.mean(confidence_values)
    
    def _confidence_to_float(self, confidence: ConfidenceLevel) -> float:
        """Convert confidence level to float value."""
        mapping = {
            ConfidenceLevel.LOW: 0.25,
            ConfidenceLevel.MEDIUM: 0.5,
            ConfidenceLevel.HIGH: 0.75,
            ConfidenceLevel.VERY_HIGH: 0.9
        }
        return mapping.get(confidence, 0.5)
    
    def _analyze_success_patterns(self, decisions: List[DecisionResult]):
        """Analyze patterns in successful decisions."""
        successful_decisions = [d for d in decisions 
                              if d.success_metrics and d.success_metrics.get("success", 0) > 0.7]
        
        if not successful_decisions:
            return
        
        # Analyze common characteristics of successful decisions
        avg_confidence = statistics.mean([self._confidence_to_float(d.confidence) 
                                        for d in successful_decisions])
        avg_risk = statistics.mean([d.selected_option.risk_level 
                                  for d in successful_decisions])
        
        self.logger.info(f"Success pattern: avg_confidence={avg_confidence:.2f}, avg_risk={avg_risk:.2f}")
    
    def _analyze_failure_patterns(self, decisions: List[DecisionResult]):
        """Analyze patterns in failed decisions."""
        failed_decisions = [d for d in decisions 
                          if d.success_metrics and d.success_metrics.get("success", 1) < 0.3]
        
        if not failed_decisions:
            return
        
        # Analyze common characteristics of failed decisions
        avg_confidence = statistics.mean([self._confidence_to_float(d.confidence) 
                                        for d in failed_decisions])
        avg_risk = statistics.mean([d.selected_option.risk_level 
                                  for d in failed_decisions])
        
        self.logger.info(f"Failure pattern: avg_confidence={avg_confidence:.2f}, avg_risk={avg_risk:.2f}")
    
    def _update_strategy_effectiveness(self, decisions: List[DecisionResult]):
        """Update effectiveness metrics for different strategies."""
        # This would track which strategy was used for each decision
        # and measure their relative effectiveness
        strategy_name = type(self.current_strategy).__name__
        
        successful_decisions = [d for d in decisions 
                              if d.success_metrics and d.success_metrics.get("success", 0) > 0.7]
        
        success_rate = len(successful_decisions) / len(decisions) if decisions else 0
        
        if strategy_name not in self.performance_metrics["strategy_effectiveness"]:
            self.performance_metrics["strategy_effectiveness"][strategy_name] = []
        
        self.performance_metrics["strategy_effectiveness"][strategy_name].append(success_rate)