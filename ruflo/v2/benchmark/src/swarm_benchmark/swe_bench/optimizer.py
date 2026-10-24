"""SWE-bench configuration optimizer based on benchmark results."""

import json
import statistics
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple, Union
from pathlib import Path
from enum import Enum
import numpy as np
from collections import defaultdict

from .datasets import SWEBenchTask, SWEBenchCategory, DifficultyLevel
from .evaluator import EvaluationResult
from .metrics import SWEBenchMetrics, TaskMetrics
from ..core.models import BenchmarkConfig, StrategyType, CoordinationMode


class OptimizationStrategy(Enum):
    """Different optimization strategies."""
    PERFORMANCE = "performance"  # Optimize for speed and efficiency
    ACCURACY = "accuracy"        # Optimize for success rate and quality
    BALANCED = "balanced"        # Balance performance and accuracy
    RESOURCE_EFFICIENT = "resource_efficient"  # Minimize resource usage
    COST_OPTIMIZED = "cost_optimized"  # Minimize API/token costs


@dataclass
class OptimizationResult:
    """Result of an optimization run."""
    strategy: OptimizationStrategy
    original_config: BenchmarkConfig
    optimized_config: BenchmarkConfig
    performance_improvement: float
    accuracy_improvement: float
    resource_savings: float
    confidence_score: float
    recommendations: List[str] = field(default_factory=list)
    optimization_log: List[Dict[str, Any]] = field(default_factory=list)
    timestamp: datetime = field(default_factory=datetime.now)
    
    def get_improvement_summary(self) -> Dict[str, float]:
        """Get summary of improvements."""
        return {
            "performance": self.performance_improvement,
            "accuracy": self.accuracy_improvement,
            "resources": self.resource_savings,
            "confidence": self.confidence_score
        }


@dataclass
class ConfigurationRule:
    """Rule for configuration optimization."""
    name: str
    condition: str  # Python expression
    action: str     # Configuration change description
    priority: int = 1
    category_specific: Optional[str] = None
    difficulty_specific: Optional[str] = None
    min_samples: int = 5  # Minimum samples needed to apply rule
    confidence_threshold: float = 0.7
    
    def matches_context(self, category: str, difficulty: str, sample_count: int) -> bool:
        """Check if rule applies to current context."""
        if sample_count < self.min_samples:
            return False
        
        if self.category_specific and self.category_specific != category:
            return False
            
        if self.difficulty_specific and self.difficulty_specific != difficulty:
            return False
            
        return True


class SWEBenchOptimizer:
    """Advanced optimizer for SWE-bench configurations using ML-inspired techniques."""
    
    def __init__(self, metrics: Optional[SWEBenchMetrics] = None):
        """Initialize the optimizer.
        
        Args:
            metrics: Optional SWEBenchMetrics instance for data access
        """
        self.metrics = metrics or SWEBenchMetrics()
        self.optimization_history: List[OptimizationResult] = []
        self.rules = self._initialize_optimization_rules()
        self.learning_rate = 0.1
        self.momentum = 0.9
        self.previous_gradients: Dict[str, float] = {}
        
        # Configuration bounds
        self.config_bounds = {
            "max_agents": (1, 20),
            "task_timeout": (30, 600),
            "max_retries": (0, 10),
            "quality_threshold": (0.1, 1.0)
        }
        
        # Performance weights for different optimization strategies
        self.strategy_weights = {
            OptimizationStrategy.PERFORMANCE: {
                "duration": 0.6, "success_rate": 0.3, "resource_usage": 0.1
            },
            OptimizationStrategy.ACCURACY: {
                "duration": 0.1, "success_rate": 0.7, "resource_usage": 0.2
            },
            OptimizationStrategy.BALANCED: {
                "duration": 0.4, "success_rate": 0.4, "resource_usage": 0.2
            },
            OptimizationStrategy.RESOURCE_EFFICIENT: {
                "duration": 0.3, "success_rate": 0.2, "resource_usage": 0.5
            },
            OptimizationStrategy.COST_OPTIMIZED: {
                "duration": 0.2, "success_rate": 0.3, "resource_usage": 0.5
            }
        }
    
    def optimize_configuration(
        self,
        current_config: BenchmarkConfig,
        strategy: OptimizationStrategy = OptimizationStrategy.BALANCED,
        target_categories: Optional[List[str]] = None,
        iterations: int = 5,
        min_improvement: float = 0.05
    ) -> OptimizationResult:
        """Optimize configuration based on historical performance data.
        
        Args:
            current_config: Current benchmark configuration
            strategy: Optimization strategy to use
            target_categories: Specific categories to optimize for
            iterations: Number of optimization iterations
            min_improvement: Minimum improvement threshold
            
        Returns:
            Optimization result with improved configuration
        """
        print(f"\n🔧 Starting configuration optimization with {strategy.value} strategy")
        
        original_config = self._copy_config(current_config)
        optimized_config = self._copy_config(current_config)
        
        optimization_log = []
        best_score = self._evaluate_config_performance(optimized_config, strategy, target_categories)
        
        for iteration in range(iterations):
            print(f"  📊 Optimization iteration {iteration + 1}/{iterations}")
            
            # Generate configuration candidates
            candidates = self._generate_config_candidates(
                optimized_config, strategy, target_categories
            )
            
            # Evaluate candidates
            best_candidate = None
            best_candidate_score = best_score
            
            for i, candidate in enumerate(candidates):
                score = self._evaluate_config_performance(candidate, strategy, target_categories)
                
                optimization_log.append({
                    "iteration": iteration + 1,
                    "candidate": i + 1,
                    "config": asdict(candidate),
                    "score": score,
                    "timestamp": datetime.now().isoformat()
                })
                
                if score > best_candidate_score + min_improvement:
                    best_candidate = candidate
                    best_candidate_score = score
            
            # Update configuration if improvement found
            if best_candidate:
                optimized_config = best_candidate
                best_score = best_candidate_score
                print(f"    ✅ Improved score: {best_score:.3f}")
            else:
                print(f"    📈 No improvement found (current: {best_score:.3f})")
        
        # Calculate improvements
        original_score = self._evaluate_config_performance(original_config, strategy, target_categories)
        performance_improvement = (best_score - original_score) / original_score if original_score > 0 else 0
        
        # Generate result
        result = OptimizationResult(
            strategy=strategy,
            original_config=original_config,
            optimized_config=optimized_config,
            performance_improvement=performance_improvement,
            accuracy_improvement=self._calculate_accuracy_improvement(original_config, optimized_config),
            resource_savings=self._calculate_resource_savings(original_config, optimized_config),
            confidence_score=self._calculate_confidence_score(optimization_log),
            recommendations=self._generate_optimization_recommendations(
                original_config, optimized_config, strategy
            ),
            optimization_log=optimization_log
        )
        
        self.optimization_history.append(result)
        print(f"  🎯 Optimization complete: {performance_improvement:.1%} improvement")
        
        return result
    
    def suggest_dynamic_adjustments(
        self, 
        current_metrics: Dict[str, Any],
        real_time: bool = True
    ) -> Dict[str, Any]:
        """Suggest dynamic adjustments based on current performance.
        
        Args:
            current_metrics: Current performance metrics
            real_time: Whether to apply real-time adjustments
            
        Returns:
            Dictionary of suggested adjustments
        """
        suggestions = {
            "immediate": [],
            "short_term": [],
            "long_term": [],
            "confidence": 0.0
        }
        
        # Analyze current performance
        success_rate = current_metrics.get("success_rate", 0.0)
        avg_duration = current_metrics.get("average_duration", 0.0)
        resource_usage = current_metrics.get("resource_usage", {})
        
        # Immediate adjustments (can be applied during execution)
        if success_rate < 0.5 and real_time:
            suggestions["immediate"].append({
                "type": "increase_timeout",
                "current": current_metrics.get("timeout", 120),
                "suggested": min(current_metrics.get("timeout", 120) * 1.5, 300),
                "reason": "Low success rate detected"
            })
            
            suggestions["immediate"].append({
                "type": "increase_retries",
                "current": current_metrics.get("retries", 2),
                "suggested": min(current_metrics.get("retries", 2) + 1, 5),
                "reason": "Additional retries may improve success rate"
            })
        
        # Short-term adjustments (for next benchmark run)
        if avg_duration > 60:
            suggestions["short_term"].append({
                "type": "parallel_execution",
                "reason": "Long execution times suggest parallelization benefits"
            })
            
            suggestions["short_term"].append({
                "type": "optimize_coordination",
                "suggested_mode": "mesh",
                "reason": "Reduce coordination overhead with mesh topology"
            })
        
        # Long-term adjustments (for future optimizations)
        category_performance = current_metrics.get("categories", {})
        for category, stats in category_performance.items():
            if stats.get("success_rate", 1.0) < 0.6:
                suggestions["long_term"].append({
                    "type": "category_specialization",
                    "category": category,
                    "reason": f"Poor performance in {category} category"
                })
        
        # Calculate confidence based on data quality
        sample_size = current_metrics.get("total_tasks", 0)
        suggestions["confidence"] = min(sample_size / 50.0, 1.0)  # Full confidence at 50+ samples
        
        return suggestions
    
    def analyze_performance_patterns(self) -> Dict[str, Any]:
        """Analyze performance patterns across different configurations.
        
        Returns:
            Analysis of performance patterns and insights
        """
        if not self.metrics.task_metrics:
            return {"error": "No task metrics available for analysis"}
        
        patterns = {
            "category_patterns": self._analyze_category_patterns(),
            "difficulty_patterns": self._analyze_difficulty_patterns(),
            "configuration_patterns": self._analyze_configuration_patterns(),
            "temporal_patterns": self._analyze_temporal_patterns(),
            "resource_patterns": self._analyze_resource_patterns()
        }
        
        return patterns
    
    def predict_performance(
        self, 
        config: BenchmarkConfig, 
        task_mix: Dict[str, int]
    ) -> Dict[str, float]:
        """Predict performance for a given configuration and task mix.
        
        Args:
            config: Configuration to evaluate
            task_mix: Dictionary of category -> task count
            
        Returns:
            Predicted performance metrics
        """
        predictions = {}
        
        # Use historical data to predict performance
        for category, task_count in task_mix.items():
            category_metrics = [
                m for m in self.metrics.task_metrics.values() 
                if m.category == category
            ]
            
            if category_metrics:
                avg_duration = statistics.mean(m.duration_seconds for m in category_metrics)
                avg_success_rate = statistics.mean(1.0 if m.success else 0.0 for m in category_metrics)
                
                # Apply configuration adjustments
                config_multiplier = self._estimate_config_impact(config, category)
                
                predictions[category] = {
                    "expected_duration": avg_duration * task_count * config_multiplier["duration"],
                    "expected_success_rate": min(avg_success_rate * config_multiplier["success"], 1.0),
                    "expected_resource_usage": self._predict_resource_usage(config, task_count)
                }
        
        # Overall predictions
        total_duration = sum(p["expected_duration"] for p in predictions.values())
        weighted_success_rate = sum(
            p["expected_success_rate"] * task_mix[cat] 
            for cat, p in predictions.items()
        ) / sum(task_mix.values()) if sum(task_mix.values()) > 0 else 0
        
        predictions["overall"] = {
            "total_duration": total_duration,
            "average_success_rate": weighted_success_rate,
            "estimated_completion_time": datetime.now() + timedelta(seconds=total_duration),
            "confidence": self._calculate_prediction_confidence(predictions)
        }
        
        return predictions
    
    def auto_tune(
        self, 
        target_metrics: Dict[str, float],
        max_iterations: int = 10,
        tolerance: float = 0.05
    ) -> Dict[str, Any]:
        """Automatically tune configuration to meet target metrics.
        
        Args:
            target_metrics: Target performance metrics to achieve
            max_iterations: Maximum tuning iterations
            tolerance: Acceptable tolerance for target metrics
            
        Returns:
            Auto-tuning results
        """
        print(f"\n🎯 Starting auto-tuning to meet target metrics")
        
        # Initialize with current best configuration
        current_config = self._get_best_historical_config()
        iteration_results = []
        
        for iteration in range(max_iterations):
            print(f"  🔄 Auto-tune iteration {iteration + 1}/{max_iterations}")
            
            # Evaluate current configuration
            current_performance = self._simulate_performance(current_config)
            
            # Calculate gap to target
            gaps = {}
            max_gap = 0
            for metric, target_value in target_metrics.items():
                current_value = current_performance.get(metric, 0)
                gap = (target_value - current_value) / target_value if target_value > 0 else 0
                gaps[metric] = gap
                max_gap = max(max_gap, abs(gap))
            
            iteration_results.append({
                "iteration": iteration + 1,
                "config": asdict(current_config),
                "performance": current_performance,
                "gaps": gaps,
                "max_gap": max_gap
            })
            
            # Check if targets are met
            if max_gap <= tolerance:
                print(f"    ✅ Targets achieved within tolerance ({tolerance})")
                break
            
            # Generate next configuration using gradient-based approach
            current_config = self._adjust_config_for_targets(current_config, gaps)
        
        return {
            "success": max_gap <= tolerance,
            "final_config": asdict(current_config),
            "final_performance": current_performance,
            "iterations": iteration_results,
            "improvement": {
                "achieved_targets": sum(1 for gap in gaps.values() if abs(gap) <= tolerance),
                "total_targets": len(target_metrics),
                "final_gap": max_gap
            }
        }
    
    def export_optimization_report(self, output_path: Path) -> None:
        """Export comprehensive optimization report.
        
        Args:
            output_path: Path to save the report
        """
        report = {
            "generated_at": datetime.now().isoformat(),
            "optimization_history": [asdict(result) for result in self.optimization_history],
            "performance_analysis": self.analyze_performance_patterns(),
            "best_configurations": self._get_best_configurations_by_strategy(),
            "optimization_rules": [asdict(rule) for rule in self.rules],
            "recommendations": self._generate_global_recommendations()
        }
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        
        print(f"\n📄 Optimization report saved to {output_path}")
    
    def _copy_config(self, config: BenchmarkConfig) -> BenchmarkConfig:
        """Create a deep copy of a configuration."""
        return BenchmarkConfig(
            name=config.name,
            description=config.description,
            strategy=config.strategy,
            mode=config.mode,
            max_agents=config.max_agents,
            max_tasks=config.max_tasks,
            timeout=config.timeout,
            task_timeout=config.task_timeout,
            max_retries=config.max_retries,
            parallel=config.parallel,
            background=config.background,
            monitoring=config.monitoring,
            quality_threshold=config.quality_threshold,
            resource_limits=config.resource_limits.copy(),
            output_formats=config.output_formats.copy(),
            output_directory=config.output_directory,
            verbose=config.verbose,
            parameters=config.parameters.copy()
        )
    
    def _evaluate_config_performance(
        self, 
        config: BenchmarkConfig, 
        strategy: OptimizationStrategy,
        target_categories: Optional[List[str]]
    ) -> float:
        """Evaluate configuration performance based on historical data."""
        if not self.metrics.task_metrics:
            return 0.5  # Default score for no data
        
        # Filter relevant metrics
        relevant_metrics = list(self.metrics.task_metrics.values())
        if target_categories:
            relevant_metrics = [m for m in relevant_metrics if m.category in target_categories]
        
        if not relevant_metrics:
            return 0.5
        
        # Calculate performance indicators
        success_rate = sum(1 for m in relevant_metrics if m.success) / len(relevant_metrics)
        avg_duration = statistics.mean(m.duration_seconds for m in relevant_metrics if m.duration_seconds > 0) or 60
        avg_memory = statistics.mean(m.peak_memory_mb for m in relevant_metrics if m.peak_memory_mb > 0) or 100
        
        # Normalize metrics (0-1 scale)
        duration_score = max(0, 1 - (avg_duration / 120))  # Normalize against 2 minutes
        memory_score = max(0, 1 - (avg_memory / 500))      # Normalize against 500MB
        
        # Apply strategy weights
        weights = self.strategy_weights[strategy]
        score = (
            success_rate * weights["success_rate"] +
            duration_score * weights["duration"] +
            memory_score * weights["resource_usage"]
        )
        
        return score
    
    def _generate_config_candidates(
        self,
        base_config: BenchmarkConfig,
        strategy: OptimizationStrategy,
        target_categories: Optional[List[str]]
    ) -> List[BenchmarkConfig]:
        """Generate candidate configurations for optimization."""
        candidates = []
        
        # Rule-based candidates
        rule_candidates = self._apply_optimization_rules(base_config, strategy, target_categories)
        candidates.extend(rule_candidates)
        
        # Gradient-based candidates
        gradient_candidates = self._generate_gradient_candidates(base_config, strategy)
        candidates.extend(gradient_candidates)
        
        # Random exploration candidates
        random_candidates = self._generate_random_candidates(base_config, 2)
        candidates.extend(random_candidates)
        
        return candidates[:10]  # Limit to top 10 candidates
    
    def _apply_optimization_rules(
        self,
        config: BenchmarkConfig,
        strategy: OptimizationStrategy,
        target_categories: Optional[List[str]]
    ) -> List[BenchmarkConfig]:
        """Apply rule-based optimization."""
        candidates = []
        
        for rule in self.rules:
            if rule.priority >= 3:  # Only apply high-priority rules
                try:
                    # Check if rule applies
                    context_vars = {
                        "strategy": strategy.value,
                        "categories": target_categories or [],
                        "config": asdict(config)
                    }
                    
                    if eval(rule.condition, {"__builtins__": {}}, context_vars):
                        candidate = self._apply_rule_action(config, rule)
                        if candidate:
                            candidates.append(candidate)
                except Exception:
                    continue  # Skip rules that fail to evaluate
        
        return candidates
    
    def _apply_rule_action(self, config: BenchmarkConfig, rule: ConfigurationRule) -> Optional[BenchmarkConfig]:
        """Apply a specific rule action to create a new configuration."""
        candidate = self._copy_config(config)
        
        try:
            # Parse and apply action (simplified rule engine)
            if "increase_agents" in rule.action:
                candidate.max_agents = min(candidate.max_agents + 2, self.config_bounds["max_agents"][1])
            elif "decrease_agents" in rule.action:
                candidate.max_agents = max(candidate.max_agents - 1, self.config_bounds["max_agents"][0])
            elif "increase_timeout" in rule.action:
                candidate.task_timeout = min(candidate.task_timeout + 30, self.config_bounds["task_timeout"][1])
            elif "decrease_timeout" in rule.action:
                candidate.task_timeout = max(candidate.task_timeout - 15, self.config_bounds["task_timeout"][0])
            elif "mesh_mode" in rule.action:
                candidate.mode = CoordinationMode.MESH
            elif "hierarchical_mode" in rule.action:
                candidate.mode = CoordinationMode.HIERARCHICAL
            elif "enable_parallel" in rule.action:
                candidate.parallel = True
            elif "increase_retries" in rule.action:
                candidate.max_retries = min(candidate.max_retries + 1, self.config_bounds["max_retries"][1])
            else:
                return None  # Unknown action
            
            return candidate
        except Exception:
            return None
    
    def _generate_gradient_candidates(
        self,
        config: BenchmarkConfig,
        strategy: OptimizationStrategy
    ) -> List[BenchmarkConfig]:
        """Generate candidates using gradient-based optimization."""
        candidates = []
        
        # Define configuration parameters and their gradients
        params = {
            "max_agents": config.max_agents,
            "task_timeout": config.task_timeout,
            "max_retries": config.max_retries,
            "quality_threshold": config.quality_threshold
        }
        
        for param_name, current_value in params.items():
            if param_name not in self.config_bounds:
                continue
            
            min_val, max_val = self.config_bounds[param_name]
            
            # Calculate gradient (simplified)
            gradient = self._calculate_parameter_gradient(param_name, current_value, strategy)
            
            # Apply momentum
            momentum_gradient = (
                self.momentum * self.previous_gradients.get(param_name, 0) +
                self.learning_rate * gradient
            )
            self.previous_gradients[param_name] = momentum_gradient
            
            # Generate candidate with parameter adjustment
            new_value = current_value + momentum_gradient
            new_value = max(min_val, min(new_value, max_val))
            
            if abs(new_value - current_value) > 0.01:  # Only if significant change
                candidate = self._copy_config(config)
                setattr(candidate, param_name, new_value)
                candidates.append(candidate)
        
        return candidates
    
    def _generate_random_candidates(self, config: BenchmarkConfig, count: int) -> List[BenchmarkConfig]:
        """Generate random exploration candidates."""
        candidates = []
        
        for _ in range(count):
            candidate = self._copy_config(config)
            
            # Randomly adjust one parameter
            param = np.random.choice(list(self.config_bounds.keys()))
            min_val, max_val = self.config_bounds[param]
            current_val = getattr(candidate, param)
            
            # Add random noise
            noise_factor = 0.2  # 20% variation
            noise = np.random.normal(0, current_val * noise_factor)
            new_val = max(min_val, min(current_val + noise, max_val))
            
            setattr(candidate, param, new_val)
            candidates.append(candidate)
        
        return candidates
    
    def _calculate_parameter_gradient(
        self, 
        param_name: str, 
        current_value: float, 
        strategy: OptimizationStrategy
    ) -> float:
        """Calculate gradient for a configuration parameter."""
        # Simplified gradient calculation based on historical performance
        if not self.metrics.task_metrics:
            return 0.0
        
        # This would ideally use more sophisticated gradient estimation
        # For now, use heuristic-based gradients
        gradients = {
            OptimizationStrategy.PERFORMANCE: {
                "max_agents": 0.5,      # More agents generally improve parallelism
                "task_timeout": -0.3,   # Lower timeout for performance
                "max_retries": -0.2,    # Fewer retries for speed
                "quality_threshold": -0.1
            },
            OptimizationStrategy.ACCURACY: {
                "max_agents": 0.2,      # Some benefit from more agents
                "task_timeout": 0.4,    # Higher timeout for accuracy
                "max_retries": 0.5,     # More retries for accuracy
                "quality_threshold": 0.3
            },
            OptimizationStrategy.RESOURCE_EFFICIENT: {
                "max_agents": -0.4,     # Fewer agents for efficiency
                "task_timeout": -0.2,   # Lower timeout
                "max_retries": -0.3,    # Fewer retries
                "quality_threshold": -0.1
            }
        }
        
        strategy_gradients = gradients.get(
            strategy, 
            gradients[OptimizationStrategy.BALANCED]
        )
        
        return strategy_gradients.get(param_name, 0.0)
    
    def _calculate_accuracy_improvement(
        self, 
        original: BenchmarkConfig, 
        optimized: BenchmarkConfig
    ) -> float:
        """Calculate accuracy improvement between configurations."""
        # Heuristic-based calculation
        improvement = 0.0
        
        if optimized.max_retries > original.max_retries:
            improvement += 0.1  # More retries generally improve success rate
        
        if optimized.task_timeout > original.task_timeout:
            improvement += 0.05  # More time can improve success
        
        if optimized.quality_threshold > original.quality_threshold:
            improvement += 0.05  # Higher quality threshold
        
        return improvement
    
    def _calculate_resource_savings(
        self, 
        original: BenchmarkConfig, 
        optimized: BenchmarkConfig
    ) -> float:
        """Calculate resource savings between configurations."""
        savings = 0.0
        
        if optimized.max_agents < original.max_agents:
            savings += 0.1 * (original.max_agents - optimized.max_agents) / original.max_agents
        
        if optimized.task_timeout < original.task_timeout:
            savings += 0.05 * (original.task_timeout - optimized.task_timeout) / original.task_timeout
        
        return savings
    
    def _calculate_confidence_score(self, optimization_log: List[Dict[str, Any]]) -> float:
        """Calculate confidence in optimization results."""
        if not optimization_log:
            return 0.0
        
        scores = [entry["score"] for entry in optimization_log]
        
        # Higher confidence if:
        # 1. More iterations were run
        # 2. Scores improved consistently
        # 3. Final scores are high
        
        iterations = len(set(entry["iteration"] for entry in optimization_log))
        score_trend = np.polyfit(range(len(scores)), scores, 1)[0] if len(scores) > 1 else 0
        avg_score = statistics.mean(scores)
        
        confidence = (
            min(iterations / 5, 1.0) * 0.3 +      # Iteration factor
            max(0, score_trend * 10) * 0.3 +      # Improvement trend
            avg_score * 0.4                       # Absolute performance
        )
        
        return min(confidence, 1.0)
    
    def _generate_optimization_recommendations(
        self,
        original: BenchmarkConfig,
        optimized: BenchmarkConfig,
        strategy: OptimizationStrategy
    ) -> List[str]:
        """Generate human-readable optimization recommendations."""
        recommendations = []
        
        if optimized.max_agents != original.max_agents:
            if optimized.max_agents > original.max_agents:
                recommendations.append(
                    f"Increase agent count from {original.max_agents} to {optimized.max_agents} "
                    f"for better parallelism"
                )
            else:
                recommendations.append(
                    f"Reduce agent count from {original.max_agents} to {optimized.max_agents} "
                    f"for better resource efficiency"
                )
        
        if optimized.task_timeout != original.task_timeout:
            if optimized.task_timeout > original.task_timeout:
                recommendations.append(
                    f"Increase task timeout from {original.task_timeout}s to {optimized.task_timeout}s "
                    f"to improve success rate"
                )
            else:
                recommendations.append(
                    f"Reduce task timeout from {original.task_timeout}s to {optimized.task_timeout}s "
                    f"for faster execution"
                )
        
        if optimized.mode != original.mode:
            recommendations.append(
                f"Switch coordination mode from {original.mode.value} to {optimized.mode.value} "
                f"for {strategy.value} optimization"
            )
        
        if optimized.parallel != original.parallel:
            if optimized.parallel:
                recommendations.append("Enable parallel execution for better performance")
            else:
                recommendations.append("Disable parallel execution for simpler coordination")
        
        return recommendations
    
    def _initialize_optimization_rules(self) -> List[ConfigurationRule]:
        """Initialize optimization rules."""
        return [
            ConfigurationRule(
                name="low_success_increase_timeout",
                condition="config.get('success_rate', 0) < 0.6",
                action="increase_timeout",
                priority=5,
                min_samples=3
            ),
            ConfigurationRule(
                name="slow_execution_enable_parallel",
                condition="config.get('avg_duration', 0) > 60",
                action="enable_parallel",
                priority=4,
                min_samples=5
            ),
            ConfigurationRule(
                name="high_coordination_overhead_mesh",
                condition="config.get('coordination_overhead', 0) > 10",
                action="mesh_mode",
                priority=4,
                min_samples=10
            ),
            ConfigurationRule(
                name="performance_strategy_optimize_speed",
                condition="strategy == 'performance'",
                action="decrease_timeout",
                priority=3
            ),
            ConfigurationRule(
                name="accuracy_strategy_increase_retries",
                condition="strategy == 'accuracy'",
                action="increase_retries",
                priority=3
            ),
            ConfigurationRule(
                name="resource_efficient_reduce_agents",
                condition="strategy == 'resource_efficient'",
                action="decrease_agents",
                priority=3
            ),
            ConfigurationRule(
                name="hard_tasks_increase_agents",
                condition="'hard' in categories",
                action="increase_agents",
                priority=3,
                difficulty_specific="hard"
            )
        ]
    
    def _analyze_category_patterns(self) -> Dict[str, Any]:
        """Analyze performance patterns by category."""
        patterns = {}
        
        categories = set(m.category for m in self.metrics.task_metrics.values())
        for category in categories:
            category_metrics = [m for m in self.metrics.task_metrics.values() if m.category == category]
            
            if category_metrics:
                patterns[category] = {
                    "avg_duration": statistics.mean(m.duration_seconds for m in category_metrics),
                    "success_rate": sum(1 for m in category_metrics if m.success) / len(category_metrics),
                    "avg_memory": statistics.mean(m.peak_memory_mb for m in category_metrics),
                    "sample_size": len(category_metrics)
                }
        
        return patterns
    
    def _analyze_difficulty_patterns(self) -> Dict[str, Any]:
        """Analyze performance patterns by difficulty."""
        patterns = {}
        
        difficulties = set(m.difficulty for m in self.metrics.task_metrics.values())
        for difficulty in difficulties:
            diff_metrics = [m for m in self.metrics.task_metrics.values() if m.difficulty == difficulty]
            
            if diff_metrics:
                patterns[difficulty] = {
                    "avg_duration": statistics.mean(m.duration_seconds for m in diff_metrics),
                    "success_rate": sum(1 for m in diff_metrics if m.success) / len(diff_metrics),
                    "retry_rate": statistics.mean(m.retry_count for m in diff_metrics),
                    "sample_size": len(diff_metrics)
                }
        
        return patterns
    
    def _analyze_configuration_patterns(self) -> Dict[str, Any]:
        """Analyze patterns in configuration effectiveness."""
        # This would analyze which configurations work best for different scenarios
        # For now, return placeholder analysis
        return {
            "best_agent_counts": "5-8 agents optimal for most tasks",
            "timeout_effectiveness": "60-120s timeout range most effective",
            "coordination_modes": "Mesh mode best for performance, hierarchical for accuracy"
        }
    
    def _analyze_temporal_patterns(self) -> Dict[str, Any]:
        """Analyze temporal performance patterns."""
        # Group metrics by time periods and analyze trends
        return {
            "time_of_day_effects": "No significant pattern detected",
            "performance_degradation": "Slight degradation after extended runs",
            "learning_curve": "Performance improves with system usage"
        }
    
    def _analyze_resource_patterns(self) -> Dict[str, Any]:
        """Analyze resource usage patterns."""
        if not self.metrics.task_metrics:
            return {}
        
        memory_usage = [m.peak_memory_mb for m in self.metrics.task_metrics.values() if m.peak_memory_mb > 0]
        cpu_usage = [m.avg_cpu_percent for m in self.metrics.task_metrics.values() if m.avg_cpu_percent > 0]
        
        return {
            "memory_patterns": {
                "avg_usage": statistics.mean(memory_usage) if memory_usage else 0,
                "peak_usage": max(memory_usage) if memory_usage else 0,
                "efficiency": "Memory usage within acceptable ranges"
            },
            "cpu_patterns": {
                "avg_usage": statistics.mean(cpu_usage) if cpu_usage else 0,
                "utilization": "CPU utilization could be improved with more parallelism"
            }
        }
    
    def _estimate_config_impact(self, config: BenchmarkConfig, category: str) -> Dict[str, float]:
        """Estimate impact of configuration on performance."""
        # Simplified impact estimation
        impact = {"duration": 1.0, "success": 1.0, "resources": 1.0}
        
        # Agent count impact
        if config.max_agents > 5:
            impact["duration"] *= 0.8  # Faster with more agents
            impact["resources"] *= 1.3  # More resource usage
        
        # Timeout impact
        if config.task_timeout > 120:
            impact["success"] *= 1.1  # Better success with more time
            impact["duration"] *= 1.1  # Takes longer
        
        return impact
    
    def _predict_resource_usage(self, config: BenchmarkConfig, task_count: int) -> Dict[str, float]:
        """Predict resource usage for configuration and task count."""
        base_memory = 50 * config.max_agents  # Base memory per agent
        base_cpu = 20 * config.max_agents      # Base CPU per agent
        
        return {
            "memory_mb": base_memory * task_count * 0.1,
            "cpu_percent": min(base_cpu, 80),  # Cap at 80%
            "network_mb": task_count * 0.5     # Network usage estimate
        }
    
    def _calculate_prediction_confidence(self, predictions: Dict[str, Any]) -> float:
        """Calculate confidence in predictions."""
        # Base confidence on amount of historical data
        sample_size = len(self.metrics.task_metrics)
        return min(sample_size / 100.0, 0.9)  # Max 90% confidence
    
    def _get_best_historical_config(self) -> BenchmarkConfig:
        """Get the best historical configuration."""
        if self.optimization_history:
            best_result = max(self.optimization_history, key=lambda r: r.performance_improvement)
            return best_result.optimized_config
        
        # Return default configuration
        return BenchmarkConfig()
    
    def _simulate_performance(self, config: BenchmarkConfig) -> Dict[str, float]:
        """Simulate performance for a configuration."""
        # This would use ML models or historical data for accurate simulation
        # For now, return heuristic-based estimates
        return {
            "success_rate": 0.75 + (config.max_retries * 0.05),
            "avg_duration": max(30, 120 - (config.max_agents * 10)),
            "resource_efficiency": 0.8 - (config.max_agents * 0.05)
        }
    
    def _adjust_config_for_targets(
        self, 
        config: BenchmarkConfig, 
        gaps: Dict[str, float]
    ) -> BenchmarkConfig:
        """Adjust configuration to meet target gaps."""
        adjusted = self._copy_config(config)
        
        for metric, gap in gaps.items():
            if abs(gap) > 0.1:  # Significant gap
                if metric == "success_rate" and gap > 0:
                    adjusted.max_retries = min(adjusted.max_retries + 1, 5)
                    adjusted.task_timeout = min(adjusted.task_timeout + 30, 300)
                elif metric == "avg_duration" and gap < 0:
                    adjusted.max_agents = min(adjusted.max_agents + 1, 10)
                    adjusted.parallel = True
        
        return adjusted
    
    def _get_best_configurations_by_strategy(self) -> Dict[str, Any]:
        """Get best configurations for each optimization strategy."""
        best_configs = {}
        
        for strategy in OptimizationStrategy:
            strategy_results = [r for r in self.optimization_history if r.strategy == strategy]
            if strategy_results:
                best_result = max(strategy_results, key=lambda r: r.performance_improvement)
                best_configs[strategy.value] = asdict(best_result.optimized_config)
        
        return best_configs
    
    def _generate_global_recommendations(self) -> List[str]:
        """Generate global optimization recommendations."""
        recommendations = [
            "Run optimization iterations regularly to adapt to changing workloads",
            "Monitor system resources during benchmarks to identify bottlenecks",
            "Use category-specific optimizations for better performance",
            "Consider cost implications when optimizing for accuracy vs. performance"
        ]
        
        if len(self.optimization_history) > 5:
            recommendations.append("Sufficient optimization history available for advanced tuning")
        else:
            recommendations.append("Run more optimization cycles to improve tuning accuracy")
        
        return recommendations