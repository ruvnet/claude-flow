"""
Optimization Rules Engine

Apply optimization rules to CLAUDE.md configurations based on
performance targets and requirements.
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import copy


@dataclass
class OptimizationRule:
    """Represents a single optimization rule."""
    name: str
    description: str
    condition: str
    action: str
    priority: int = 1
    impact: str = "medium"


class OptimizationRulesEngine:
    """
    Apply optimization rules to CLAUDE.md configurations.
    
    This engine contains a comprehensive set of rules for optimizing
    configurations based on different performance priorities and targets.
    """
    
    def __init__(self):
        """Initialize the rules engine with predefined rules."""
        self.speed_rules = self._initialize_speed_rules()
        self.accuracy_rules = self._initialize_accuracy_rules() 
        self.token_rules = self._initialize_token_rules()
        self.memory_rules = self._initialize_memory_rules()
        self.concurrency_rules = self._initialize_concurrency_rules()
        
        # Rule application history
        self.applied_rules: List[Dict] = []
    
    def optimize_for_speed(self, config: Dict) -> Dict:
        """
        Optimize configuration for maximum execution speed.
        
        Args:
            config: Base configuration dictionary
            
        Returns:
            Speed-optimized configuration
        """
        optimized = copy.deepcopy(config)
        applied_rules = []
        
        # Apply speed-focused optimizations
        optimizations = {
            "parallel_execution": "aggressive",
            "cache_strategy": "memory",
            "batch_size": "large",
            "concurrency_level": "maximum",
            "response_style": "minimal",
            "explanation_level": "none"
        }
        
        optimized.update(optimizations)
        
        # Speed-specific rules
        speed_rules = [
            "ALWAYS batch operations in single message",
            "Use Task tool for parallel agent execution", 
            "Enable memory caching for repeated operations",
            "Prefer MultiEdit over multiple Edit calls",
            "Minimize file reads with targeted searches",
            "Use Glob before Grep for file discovery",
            "Execute all related operations concurrently",
            "Avoid explanatory text in responses",
            "Cache computation results aggressively",
            "Prioritize parallel over sequential execution"
        ]
        
        if "critical_rules" not in optimized:
            optimized["critical_rules"] = []
        optimized["critical_rules"].extend(speed_rules)
        
        # Increase agent count for parallelism
        if optimized.get("max_agents", 0) < 8:
            optimized["max_agents"] = min(8, optimized.get("max_agents", 4) + 2)
        
        # Optimize topology for speed
        optimized["swarm_topology"] = "mesh"  # Best for parallel execution
        
        # Tool priorities for speed
        optimized["tool_priorities"] = ["MultiEdit", "Bash", "Edit", "Grep", "Read"]
        
        applied_rules.extend([f"Speed optimization: {rule}" for rule in speed_rules[:5]])
        self._record_applied_rules("speed", applied_rules)
        
        return optimized
    
    def optimize_for_accuracy(self, config: Dict) -> Dict:
        """
        Optimize configuration for maximum accuracy and correctness.
        
        Args:
            config: Base configuration dictionary
            
        Returns:
            Accuracy-optimized configuration
        """
        optimized = copy.deepcopy(config)
        applied_rules = []
        
        # Apply accuracy-focused optimizations
        optimizations = {
            "validation_level": "strict",
            "testing_coverage": "comprehensive",
            "review_cycles": 2,
            "error_handling": "comprehensive",
            "logging_level": "detailed",
            "verification_steps": "mandatory"
        }
        
        optimized.update(optimizations)
        
        # Accuracy-specific rules
        accuracy_rules = [
            "Always run tests after changes",
            "Use type checking and linting",
            "Implement comprehensive error handling",
            "Request code review from reviewer agent",
            "Validate all inputs and outputs",
            "Use static analysis tools",
            "Implement integration testing",
            "Add comprehensive logging",
            "Verify requirements before implementation",
            "Use defensive programming practices"
        ]
        
        if "critical_rules" not in optimized:
            optimized["critical_rules"] = []
        optimized["critical_rules"].extend(accuracy_rules)
        
        # Add reviewer and tester agents
        preferred_agents = optimized.get("preferred_agents", [])
        if "reviewer" not in preferred_agents:
            preferred_agents.append("reviewer")
        if "tester" not in preferred_agents:
            preferred_agents.append("tester")
        optimized["preferred_agents"] = preferred_agents
        
        # Tool priorities for accuracy
        optimized["tool_priorities"] = ["Read", "Edit", "Bash", "MultiEdit", "Grep"]
        
        applied_rules.extend([f"Accuracy optimization: {rule}" for rule in accuracy_rules[:5]])
        self._record_applied_rules("accuracy", applied_rules)
        
        return optimized
    
    def optimize_for_tokens(self, config: Dict) -> Dict:
        """
        Optimize configuration for token efficiency.
        
        Args:
            config: Base configuration dictionary
            
        Returns:
            Token-optimized configuration
        """
        optimized = copy.deepcopy(config)
        applied_rules = []
        
        # Apply token-focused optimizations
        optimizations = {
            "response_style": "concise",
            "explanation_level": "minimal", 
            "batch_operations": True,
            "compress_output": True,
            "minimize_context": True,
            "cache_responses": "aggressive"
        }
        
        optimized.update(optimizations)
        
        # Token efficiency rules
        token_rules = [
            "Minimize explanatory text",
            "Batch all related operations",
            "Use grep/glob before reading files",
            "Avoid redundant file reads",
            "Cache frequently accessed data",
            "Compress large outputs",
            "Use concise variable names",
            "Eliminate verbose logging in production",
            "Optimize prompt templates",
            "Reuse computed results"
        ]
        
        if "critical_rules" not in optimized:
            optimized["critical_rules"] = []
        optimized["critical_rules"].extend(token_rules)
        
        # Reduce agent count to minimize communication overhead
        if optimized.get("max_agents", 10) > 5:
            optimized["max_agents"] = max(3, optimized.get("max_agents", 5) - 1)
        
        # Tool priorities for token efficiency
        optimized["tool_priorities"] = ["Grep", "Glob", "MultiEdit", "Edit", "Read"]
        
        applied_rules.extend([f"Token optimization: {rule}" for rule in token_rules[:5]])
        self._record_applied_rules("tokens", applied_rules)
        
        return optimized
    
    def optimize_for_memory(self, config: Dict) -> Dict:
        """
        Optimize configuration for memory efficiency.
        
        Args:
            config: Base configuration dictionary
            
        Returns:
            Memory-optimized configuration
        """
        optimized = copy.deepcopy(config)
        applied_rules = []
        
        # Apply memory-focused optimizations
        optimizations = {
            "memory_management": "aggressive",
            "cache_size": "limited",
            "garbage_collection": "frequent",
            "streaming_mode": "enabled",
            "memory_monitoring": "continuous"
        }
        
        optimized.update(optimizations)
        
        # Memory efficiency rules
        memory_rules = [
            "Enable memory monitoring and cleanup",
            "Use streaming for large data processing",
            "Implement memory-mapped file access",
            "Clear caches after operations",
            "Use generators instead of lists",
            "Implement lazy loading patterns",
            "Monitor memory usage continuously",
            "Optimize data structures for memory",
            "Use memory pools for frequent allocations",
            "Implement memory leak detection"
        ]
        
        if "critical_rules" not in optimized:
            optimized["critical_rules"] = []
        optimized["critical_rules"].extend(memory_rules)
        
        # Reduce agent count for memory efficiency
        if optimized.get("max_agents", 10) > 4:
            optimized["max_agents"] = max(3, optimized.get("max_agents", 5) - 2)
        
        # Memory-efficient topology
        optimized["swarm_topology"] = "hierarchical"  # Less memory overhead
        
        applied_rules.extend([f"Memory optimization: {rule}" for rule in memory_rules[:5]])
        self._record_applied_rules("memory", applied_rules)
        
        return optimized
    
    def optimize_for_concurrency(self, config: Dict) -> Dict:
        """
        Optimize configuration for maximum concurrency.
        
        Args:
            config: Base configuration dictionary
            
        Returns:
            Concurrency-optimized configuration
        """
        optimized = copy.deepcopy(config)
        applied_rules = []
        
        # Apply concurrency optimizations
        optimizations = {
            "parallel_execution": "maximum",
            "async_operations": "enabled",
            "thread_pool_size": "optimal",
            "synchronization": "minimal",
            "deadlock_prevention": "enabled"
        }
        
        optimized.update(optimizations)
        
        # Concurrency-specific rules
        concurrency_rules = [
            "Execute all independent operations in parallel",
            "Use async/await patterns consistently",
            "Minimize shared state between agents",
            "Implement lock-free data structures",
            "Use message passing for coordination",
            "Avoid blocking operations in critical paths",
            "Implement work-stealing for load balancing",
            "Use parallel algorithms where possible",
            "Optimize thread pool configuration",
            "Monitor and prevent deadlocks"
        ]
        
        if "critical_rules" not in optimized:
            optimized["critical_rules"] = []
        optimized["critical_rules"].extend(concurrency_rules)
        
        # Optimize for maximum parallelism
        optimized["max_agents"] = min(12, optimized.get("max_agents", 5) + 3)
        optimized["swarm_topology"] = "mesh"  # Best for parallel execution
        
        applied_rules.extend([f"Concurrency optimization: {rule}" for rule in concurrency_rules[:5]])
        self._record_applied_rules("concurrency", applied_rules)
        
        return optimized
    
    def apply_custom_rules(self, config: Dict, rules: List[OptimizationRule]) -> Dict:
        """
        Apply custom optimization rules to configuration.
        
        Args:
            config: Base configuration dictionary
            rules: List of custom optimization rules
            
        Returns:
            Configuration with custom rules applied
        """
        optimized = copy.deepcopy(config)
        applied_rules = []
        
        # Sort rules by priority
        sorted_rules = sorted(rules, key=lambda x: x.priority, reverse=True)
        
        for rule in sorted_rules:
            if self._evaluate_rule_condition(rule.condition, optimized):
                optimized = self._apply_rule_action(rule.action, optimized)
                applied_rules.append(f"Custom rule: {rule.name}")
        
        self._record_applied_rules("custom", applied_rules)
        
        return optimized
    
    def get_optimization_recommendations(self, 
                                       config: Dict,
                                       performance_profile: Dict) -> List[str]:
        """
        Get optimization recommendations based on performance profile.
        
        Args:
            config: Current configuration
            performance_profile: Performance metrics and bottlenecks
            
        Returns:
            List of optimization recommendations
        """
        recommendations = []
        
        # Analyze performance bottlenecks
        bottlenecks = performance_profile.get("bottlenecks", [])
        
        if "cpu" in bottlenecks:
            recommendations.extend([
                "Consider increasing agent count for better parallelization",
                "Optimize CPU-intensive operations with caching",
                "Use async processing for I/O operations"
            ])
        
        if "memory" in bottlenecks:
            recommendations.extend([
                "Enable memory optimization mode",
                "Reduce agent pool size",
                "Implement streaming for large data"
            ])
        
        if "tokens" in bottlenecks:
            recommendations.extend([
                "Enable concise response mode", 
                "Batch operations more aggressively",
                "Reduce explanatory text in rules"
            ])
        
        if "coordination" in bottlenecks:
            recommendations.extend([
                "Optimize swarm topology",
                "Reduce inter-agent communication",
                "Implement better load balancing"
            ])
        
        return recommendations
    
    def get_applied_rules_summary(self) -> Dict[str, List[str]]:
        """Get summary of all applied optimization rules."""
        return {
            "total_applications": len(self.applied_rules),
            "by_category": self._group_rules_by_category(),
            "recent_rules": self.applied_rules[-10:] if self.applied_rules else []
        }
    
    # Private helper methods
    
    def _initialize_speed_rules(self) -> List[OptimizationRule]:
        """Initialize speed optimization rules."""
        return [
            OptimizationRule(
                name="aggressive_parallelism",
                description="Enable aggressive parallel execution",
                condition="performance_priority == 'speed'",
                action="set_parallel_execution_aggressive",
                priority=10,
                impact="high"
            ),
            OptimizationRule(
                name="memory_caching",
                description="Enable aggressive memory caching",
                condition="available_memory > 4GB",
                action="enable_memory_caching",
                priority=8,
                impact="medium"
            )
            # Add more speed rules...
        ]
    
    def _initialize_accuracy_rules(self) -> List[OptimizationRule]:
        """Initialize accuracy optimization rules."""
        return [
            OptimizationRule(
                name="comprehensive_testing",
                description="Enable comprehensive test coverage",
                condition="accuracy_priority == 'high'",
                action="enable_comprehensive_testing",
                priority=10,
                impact="high"
            ),
            OptimizationRule(
                name="code_review",
                description="Mandatory code review for all changes",
                condition="team_size > 1",
                action="enable_code_review",
                priority=9,
                impact="high"
            )
            # Add more accuracy rules...
        ]
    
    def _initialize_token_rules(self) -> List[OptimizationRule]:
        """Initialize token optimization rules."""
        return [
            OptimizationRule(
                name="concise_responses",
                description="Enable concise response mode",
                condition="token_budget < 1000",
                action="enable_concise_mode",
                priority=10,
                impact="high"
            ),
            OptimizationRule(
                name="operation_batching",
                description="Batch operations to reduce token usage",
                condition="operation_count > 3",
                action="enable_operation_batching",
                priority=8,
                impact="medium"
            )
            # Add more token rules...
        ]
    
    def _initialize_memory_rules(self) -> List[OptimizationRule]:
        """Initialize memory optimization rules."""
        return [
            OptimizationRule(
                name="streaming_mode",
                description="Enable streaming for large data",
                condition="data_size > 100MB",
                action="enable_streaming",
                priority=10,
                impact="high"
            ),
            OptimizationRule(
                name="garbage_collection",
                description="Aggressive garbage collection",
                condition="memory_usage > 80%",
                action="enable_aggressive_gc",
                priority=9,
                impact="medium"
            )
            # Add more memory rules...
        ]
    
    def _initialize_concurrency_rules(self) -> List[OptimizationRule]:
        """Initialize concurrency optimization rules."""
        return [
            OptimizationRule(
                name="parallel_agent_spawn",
                description="Spawn agents in parallel",
                condition="agent_count > 3",
                action="enable_parallel_spawn",
                priority=10,
                impact="high"
            ),
            OptimizationRule(
                name="async_operations",
                description="Use async operations everywhere",
                condition="io_intensive == True",
                action="enable_async_ops",
                priority=8,
                impact="medium"
            )
            # Add more concurrency rules...
        ]
    
    def _evaluate_rule_condition(self, condition: str, config: Dict) -> bool:
        """Evaluate if a rule condition is met."""
        # Simplified condition evaluation
        # In a real implementation, this would be more sophisticated
        return True  # For demo purposes
    
    def _apply_rule_action(self, action: str, config: Dict) -> Dict:
        """Apply a rule action to the configuration."""
        # Simplified action application
        # In a real implementation, this would interpret action strings
        return config
    
    def _record_applied_rules(self, category: str, rules: List[str]) -> None:
        """Record applied rules for tracking."""
        self.applied_rules.append({
            "category": category,
            "rules": rules,
            "timestamp": self._get_timestamp()
        })
    
    def _group_rules_by_category(self) -> Dict[str, int]:
        """Group applied rules by category."""
        categories = {}
        for rule_set in self.applied_rules:
            category = rule_set["category"]
            categories[category] = categories.get(category, 0) + len(rule_set["rules"])
        return categories
    
    def _get_timestamp(self) -> str:
        """Get current timestamp."""
        from datetime import datetime
        return datetime.now().isoformat()


class RuleValidator:
    """
    Validate optimization rules and their effects.
    """
    
    @staticmethod
    def validate_rule(rule: OptimizationRule) -> List[str]:
        """
        Validate a single optimization rule.
        
        Returns:
            List of validation errors (empty if valid)
        """
        errors = []
        
        if not rule.name:
            errors.append("Rule name is required")
        
        if not rule.description:
            errors.append("Rule description is required")
        
        if not rule.condition:
            errors.append("Rule condition is required")
        
        if not rule.action:
            errors.append("Rule action is required")
        
        if rule.priority < 1 or rule.priority > 10:
            errors.append("Rule priority must be between 1 and 10")
        
        return errors
    
    @staticmethod
    def validate_config_changes(original: Dict, optimized: Dict) -> Dict[str, Any]:
        """
        Validate changes made to a configuration.
        
        Returns:
            Dictionary with validation results
        """
        results = {
            "valid": True,
            "changes": [],
            "warnings": [],
            "errors": []
        }
        
        # Check for critical field changes
        critical_fields = ["max_agents", "swarm_topology", "critical_rules"]
        
        for field in critical_fields:
            if field in original and field in optimized:
                if original[field] != optimized[field]:
                    results["changes"].append(f"{field}: {original[field]} → {optimized[field]}")
        
        # Validate agent count
        max_agents = optimized.get("max_agents", 0)
        if max_agents > 15:
            results["warnings"].append("Agent count > 15 may cause performance issues")
        
        # Validate rules
        rules = optimized.get("critical_rules", [])
        if len(rules) > 20:
            results["warnings"].append("Too many rules may impact performance")
        
        return results