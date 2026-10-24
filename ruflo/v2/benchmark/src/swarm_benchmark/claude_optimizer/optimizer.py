"""
CLAUDE.md Configuration Optimizer

Generates optimized CLAUDE.md configurations for specific use cases,
improving Claude Code's performance and accuracy for different scenarios.
"""

import asyncio
import json
import time
from datetime import datetime
from typing import Dict, List, Any, Optional, Union
from dataclasses import dataclass, asdict
from pathlib import Path

from .templates import TemplateEngine
from .rules_engine import OptimizationRulesEngine


@dataclass
class BenchmarkMetrics:
    """Metrics for evaluating CLAUDE.md configuration effectiveness."""
    completion_rate: float = 0.0
    avg_tokens_per_task: int = 0
    avg_execution_time: float = 0.0
    error_rate: float = 0.0
    peak_memory_mb: float = 0.0
    optimization_score: float = 0.0
    cache_hit_rate: float = 0.0
    parallel_efficiency: float = 0.0


@dataclass
class ProjectContext:
    """Context information about the project being optimized for."""
    project_type: str
    team_size: int
    complexity: str  # "simple", "medium", "complex"
    primary_languages: List[str]
    frameworks: List[str]
    performance_requirements: Dict[str, Any]
    existing_tools: List[str]
    constraints: Dict[str, Any]


@dataclass 
class PerformanceTargets:
    """Performance optimization targets."""
    priority: str  # "speed", "accuracy", "tokens", "memory"
    target_completion_time: Optional[float] = None
    target_token_usage: Optional[int] = None
    target_memory_usage: Optional[float] = None
    target_error_rate: Optional[float] = None


class ClaudeMdOptimizer:
    """
    Generates optimized CLAUDE.md configurations for specific use cases.
    
    This optimizer analyzes project requirements and generates tailored
    CLAUDE.md files that maximize efficiency for different scenarios.
    """
    
    def __init__(self):
        """Initialize the optimizer with template and rules engines."""
        self.template_engine = TemplateEngine()
        self.rules_engine = OptimizationRulesEngine()
        
        self.use_case_templates = {
            "api_development": self._api_template,
            "ml_pipeline": self._ml_template,
            "frontend_react": self._frontend_template,
            "backend_microservices": self._microservices_template,
            "data_pipeline": self._data_template,
            "devops_automation": self._devops_template,
            "mobile_development": self._mobile_template,
            "testing_automation": self._testing_template,
            "documentation": self._docs_template,
            "performance_optimization": self._perf_template
        }
        
        self.optimization_rules = {
            "concurrency": self.rules_engine.optimize_for_concurrency,
            "memory_usage": self.rules_engine.optimize_for_memory,
            "token_efficiency": self.rules_engine.optimize_for_tokens,
            "swarm_coordination": self._optimize_swarm,
            "tool_selection": self._optimize_tools
        }
        
        # Performance tracking
        self.benchmark_history: List[Dict] = []
        self.optimization_cache: Dict[str, str] = {}
    
    def generate_optimized_config(self, 
                                  use_case: str, 
                                  project_context: ProjectContext,
                                  performance_targets: PerformanceTargets) -> str:
        """
        Generate an optimized CLAUDE.md for specific use case.
        
        Args:
            use_case: Type of development (api, ml, frontend, etc.)
            project_context: Project-specific information
            performance_targets: Performance goals to optimize for
            
        Returns:
            Optimized CLAUDE.md content as string
            
        Raises:
            ValueError: If use_case is not supported
            RuntimeError: If optimization fails
        """
        if use_case not in self.use_case_templates:
            raise ValueError(f"Unsupported use case: {use_case}")
        
        try:
            # Generate cache key
            cache_key = self._generate_cache_key(use_case, project_context, performance_targets)
            
            # Check cache first
            if cache_key in self.optimization_cache:
                return self.optimization_cache[cache_key]
            
            # Get base template for use case
            base_config = self.use_case_templates[use_case](project_context)
            
            # Apply optimization rules based on performance targets
            optimized_config = self._apply_optimization_rules(
                base_config, 
                performance_targets
            )
            
            # Add project-specific customizations
            customized_config = self._add_project_specifics(
                optimized_config, 
                project_context
            )
            
            # Generate final CLAUDE.md content
            final_content = self._finalize_config(customized_config)
            
            # Cache the result
            self.optimization_cache[cache_key] = final_content
            
            return final_content
            
        except Exception as e:
            raise RuntimeError(f"Failed to generate optimized config: {str(e)}")
    
    async def benchmark_config_effectiveness(self, 
                                           claude_md_content: str,
                                           test_tasks: List[str],
                                           iterations: int = 3) -> BenchmarkMetrics:
        """
        Benchmark the effectiveness of a CLAUDE.md configuration.
        
        Args:
            claude_md_content: The CLAUDE.md configuration to test
            test_tasks: List of tasks to run for benchmarking
            iterations: Number of benchmark iterations to run
            
        Returns:
            BenchmarkMetrics: Comprehensive metrics on configuration performance
        """
        metrics = BenchmarkMetrics()
        total_results = []
        
        # Run benchmark iterations
        for iteration in range(iterations):
            iteration_metrics = await self._run_single_benchmark(
                claude_md_content, 
                test_tasks,
                iteration
            )
            total_results.append(iteration_metrics)
        
        # Aggregate results
        metrics = self._aggregate_metrics(total_results)
        
        # Calculate optimization score
        metrics.optimization_score = self._calculate_optimization_score(metrics)
        
        # Store in history
        self.benchmark_history.append({
            "timestamp": datetime.now().isoformat(),
            "metrics": asdict(metrics),
            "config_hash": hash(claude_md_content),
            "task_count": len(test_tasks),
            "iterations": iterations
        })
        
        return metrics
    
    def get_optimization_suggestions(self, 
                                   current_metrics: BenchmarkMetrics,
                                   target_metrics: PerformanceTargets) -> List[str]:
        """
        Generate optimization suggestions based on current performance.
        
        Args:
            current_metrics: Current performance metrics
            target_metrics: Desired performance targets
            
        Returns:
            List of specific optimization suggestions
        """
        suggestions = []
        
        # Analyze completion rate
        if current_metrics.completion_rate < 0.95:
            suggestions.append("Increase error handling and retry mechanisms")
            suggestions.append("Add more comprehensive validation rules")
        
        # Analyze execution time
        if (target_metrics.target_completion_time and 
            current_metrics.avg_execution_time > target_metrics.target_completion_time):
            suggestions.append("Enable aggressive parallel execution")
            suggestions.append("Increase batch operation sizes")
            suggestions.append("Optimize tool selection priorities")
        
        # Analyze token usage
        if (target_metrics.target_token_usage and 
            current_metrics.avg_tokens_per_task > target_metrics.target_token_usage):
            suggestions.append("Enable concise response mode")
            suggestions.append("Reduce explanatory text in rules")
            suggestions.append("Implement more aggressive caching")
        
        # Analyze memory usage
        if (target_metrics.target_memory_usage and 
            current_metrics.peak_memory_mb > target_metrics.target_memory_usage):
            suggestions.append("Enable memory optimization mode")
            suggestions.append("Reduce agent pool size")
            suggestions.append("Implement memory cleanup rules")
        
        # Analyze parallel efficiency
        if current_metrics.parallel_efficiency < 0.8:
            suggestions.append("Review task dependencies for better parallelization")
            suggestions.append("Optimize swarm coordination strategy")
            suggestions.append("Balance workload distribution")
        
        return suggestions
    
    def export_benchmark_history(self, filepath: Union[str, Path]) -> None:
        """Export benchmark history to JSON file."""
        with open(filepath, 'w') as f:
            json.dump(self.benchmark_history, f, indent=2)
    
    def import_benchmark_history(self, filepath: Union[str, Path]) -> None:
        """Import benchmark history from JSON file."""
        with open(filepath, 'r') as f:
            self.benchmark_history = json.load(f)
    
    # Private methods for template generation
    
    def _api_template(self, context: ProjectContext) -> Dict:
        """Generate API development optimized configuration."""
        return {
            "use_case": "api_development",
            "focus_areas": ["REST endpoints", "GraphQL schemas", "OpenAPI docs"],
            "preferred_agents": ["backend-dev", "api-docs", "tester", "reviewer"],
            "swarm_topology": "hierarchical",
            "max_agents": min(6, context.team_size + 2),
            "critical_rules": [
                "Always validate input parameters",
                "Implement proper error handling", 
                "Follow RESTful conventions",
                "Generate OpenAPI documentation",
                "ALWAYS batch operations in single message",
                "Use MultiEdit for endpoint creation",
                "Parallel test execution mandatory"
            ],
            "tool_priorities": ["MultiEdit", "Edit", "Grep", "Bash"],
            "performance_hints": {
                "batch_endpoints": True,
                "parallel_testing": True,
                "cache_responses": True,
                "aggressive_concurrency": True
            },
            "agent_coordination": {
                "pre_task_hooks": True,
                "post_edit_memory": True,
                "session_restore": True,
                "performance_analysis": True
            }
        }
    
    def _ml_template(self, context: ProjectContext) -> Dict:
        """Generate ML pipeline optimized configuration."""
        return {
            "use_case": "ml_pipeline", 
            "focus_areas": ["Model training", "Data preprocessing", "Feature engineering"],
            "preferred_agents": ["ml-developer", "performance-benchmarker", "researcher"],
            "swarm_topology": "mesh",
            "max_agents": min(8, context.team_size + 3),
            "critical_rules": [
                "Use MLE-STAR for ensemble coordination",
                "Implement cross-validation",
                "Track all experiments",
                "Optimize hyperparameters",
                "ALWAYS execute models in parallel",
                "Batch data processing operations",
                "Enable memory persistence for training state"
            ],
            "mle_star_config": {
                "ensemble_size": 5,
                "voting_strategy": "weighted",
                "model_diversity": "high"
            },
            "performance_hints": {
                "gpu_optimization": True,
                "batch_processing": True,
                "distributed_training": True,
                "memory_mapping": True
            },
            "agent_coordination": {
                "neural_patterns": ["convergent", "systems"],
                "memory_sharing": True,
                "collective_intelligence": True
            }
        }
    
    def _frontend_template(self, context: ProjectContext) -> Dict:
        """Generate frontend React optimized configuration."""
        return {
            "use_case": "frontend_react",
            "focus_areas": ["Component development", "State management", "UI/UX"],
            "preferred_agents": ["mobile-dev", "tester", "reviewer", "performance-benchmarker"],
            "swarm_topology": "hierarchical",
            "max_agents": min(5, context.team_size + 2),
            "critical_rules": [
                "Follow React best practices",
                "Implement proper state management",
                "Ensure responsive design",
                "Optimize bundle size",
                "ALWAYS batch component updates",
                "Parallel testing of components",
                "Use TypeScript for type safety"
            ],
            "tool_priorities": ["MultiEdit", "Edit", "Bash", "Read"],
            "performance_hints": {
                "component_batching": True,
                "bundle_optimization": True,
                "lazy_loading": True,
                "concurrent_rendering": True
            },
            "frameworks": context.frameworks or ["React", "TypeScript"]
        }
    
    def _microservices_template(self, context: ProjectContext) -> Dict:
        """Generate backend microservices optimized configuration.""" 
        return {
            "use_case": "backend_microservices",
            "focus_areas": ["Service architecture", "API gateways", "Database design"],
            "preferred_agents": ["backend-dev", "system-architect", "tester", "performance-benchmarker"],
            "swarm_topology": "mesh",
            "max_agents": min(8, context.team_size + 3),
            "critical_rules": [
                "Design for scalability",
                "Implement circuit breakers",
                "Use distributed tracing",
                "Ensure data consistency",
                "ALWAYS batch service deployments",
                "Parallel integration testing",
                "Monitor service health"
            ],
            "tool_priorities": ["MultiEdit", "Bash", "Edit", "Grep"],
            "performance_hints": {
                "service_batching": True,
                "async_communication": True,
                "caching_layers": True,
                "load_balancing": True
            }
        }
    
    def _data_template(self, context: ProjectContext) -> Dict:
        """Generate data pipeline optimized configuration."""
        return {
            "use_case": "data_pipeline",
            "focus_areas": ["ETL processes", "Data validation", "Pipeline orchestration"],
            "preferred_agents": ["ml-developer", "performance-benchmarker", "tester"],
            "swarm_topology": "hierarchical",
            "max_agents": min(6, context.team_size + 2),
            "critical_rules": [
                "Implement data quality checks",
                "Handle schema evolution",
                "Ensure data lineage tracking",
                "Optimize for throughput",
                "ALWAYS batch data operations",
                "Parallel pipeline execution",
                "Monitor data drift"
            ]
        }
    
    def _devops_template(self, context: ProjectContext) -> Dict:
        """Generate DevOps automation optimized configuration."""
        return {
            "use_case": "devops_automation",
            "focus_areas": ["CI/CD pipelines", "Infrastructure as code", "Monitoring"],
            "preferred_agents": ["cicd-engineer", "system-architect", "tester"],
            "swarm_topology": "hierarchical",
            "max_agents": min(5, context.team_size + 2),
            "critical_rules": [
                "Automate all deployments",
                "Implement infrastructure testing",
                "Monitor system health",
                "Ensure security compliance",
                "ALWAYS batch infrastructure changes",
                "Parallel environment provisioning"
            ]
        }
    
    def _mobile_template(self, context: ProjectContext) -> Dict:
        """Generate mobile development optimized configuration."""
        return {
            "use_case": "mobile_development", 
            "focus_areas": ["Cross-platform development", "Performance optimization", "UI/UX"],
            "preferred_agents": ["mobile-dev", "tester", "reviewer", "performance-benchmarker"],
            "swarm_topology": "hierarchical",
            "max_agents": min(5, context.team_size + 2),
            "critical_rules": [
                "Optimize for mobile performance",
                "Implement offline capabilities",
                "Ensure platform consistency",
                "Test on multiple devices",
                "ALWAYS batch UI updates",
                "Parallel device testing"
            ]
        }
    
    def _testing_template(self, context: ProjectContext) -> Dict:
        """Generate testing automation optimized configuration."""
        return {
            "use_case": "testing_automation",
            "focus_areas": ["Test automation", "Quality assurance", "Coverage analysis"],
            "preferred_agents": ["tester", "performance-benchmarker", "reviewer"],
            "swarm_topology": "mesh",
            "max_agents": min(6, context.team_size + 2),
            "critical_rules": [
                "Achieve high test coverage",
                "Implement parallel test execution",
                "Use property-based testing",
                "Monitor test performance",
                "ALWAYS batch test runs",
                "Parallel coverage analysis"
            ]
        }
    
    def _docs_template(self, context: ProjectContext) -> Dict:
        """Generate documentation optimized configuration."""
        return {
            "use_case": "documentation",
            "focus_areas": ["Technical writing", "API documentation", "User guides"],
            "preferred_agents": ["api-docs", "reviewer", "tester"],
            "swarm_topology": "hierarchical", 
            "max_agents": min(4, context.team_size + 1),
            "critical_rules": [
                "Maintain documentation consistency",
                "Generate docs from code",
                "Include practical examples",
                "Ensure accessibility",
                "ALWAYS batch documentation updates"
            ]
        }
    
    def _perf_template(self, context: ProjectContext) -> Dict:
        """Generate performance optimization configuration."""
        return {
            "use_case": "performance_optimization",
            "focus_areas": ["Bottleneck identification", "Performance testing", "Optimization"],
            "preferred_agents": ["performance-benchmarker", "perf-analyzer", "optimizer"],
            "swarm_topology": "mesh",
            "max_agents": min(6, context.team_size + 2),
            "critical_rules": [
                "Profile before optimizing",
                "Measure everything",
                "Implement performance budgets",
                "Monitor continuously",
                "ALWAYS batch performance tests",
                "Parallel benchmarking"
            ]
        }
    
    # Private optimization methods
    
    def _apply_optimization_rules(self, 
                                config: Dict, 
                                targets: PerformanceTargets) -> Dict:
        """Apply optimization rules based on performance targets."""
        optimized_config = config.copy()
        
        if targets.priority == "speed":
            optimized_config = self.rules_engine.optimize_for_speed(optimized_config)
        elif targets.priority == "accuracy":
            optimized_config = self.rules_engine.optimize_for_accuracy(optimized_config)
        elif targets.priority == "tokens":
            optimized_config = self.rules_engine.optimize_for_tokens(optimized_config)
        elif targets.priority == "memory":
            optimized_config = self.rules_engine.optimize_for_memory(optimized_config)
        
        return optimized_config
    
    def _add_project_specifics(self, 
                             config: Dict, 
                             context: ProjectContext) -> Dict:
        """Add project-specific customizations to the configuration."""
        customized_config = config.copy()
        
        # Adjust based on team size
        if context.team_size > 10:
            customized_config["max_agents"] = min(12, customized_config["max_agents"] + 2)
            customized_config["swarm_topology"] = "mesh"  # Better for large teams
        
        # Adjust based on complexity
        if context.complexity == "complex":
            customized_config["critical_rules"].extend([
                "Implement comprehensive logging",
                "Use distributed tracing",
                "Enable advanced monitoring"
            ])
        
        # Add language-specific optimizations
        if "Python" in context.primary_languages:
            customized_config["tool_priorities"] = ["MultiEdit", "Edit", "Bash", "Read"]
        elif "JavaScript" in context.primary_languages:
            customized_config["tool_priorities"] = ["MultiEdit", "Edit", "Bash", "WebFetch"]
        
        return customized_config
    
    def _finalize_config(self, config: Dict) -> str:
        """Generate the final CLAUDE.md content from configuration."""
        return self.template_engine.generate_claude_md(config)
    
    def _generate_cache_key(self, 
                          use_case: str, 
                          context: ProjectContext, 
                          targets: PerformanceTargets) -> str:
        """Generate a cache key for the configuration."""
        key_data = {
            "use_case": use_case,
            "context": asdict(context),
            "targets": asdict(targets)
        }
        return str(hash(json.dumps(key_data, sort_keys=True)))
    
    async def _run_single_benchmark(self, 
                                   config: str, 
                                   tasks: List[str],
                                   iteration: int) -> BenchmarkMetrics:
        """Run a single benchmark iteration."""
        metrics = BenchmarkMetrics()
        start_time = time.time()
        
        # Simulate task execution with the configuration
        # In real implementation, this would interact with Claude Code
        completed_tasks = 0
        total_tokens = 0
        errors = 0
        
        for i, task in enumerate(tasks):
            try:
                # Simulate task execution
                await asyncio.sleep(0.1)  # Simulate processing time
                
                # Simulate metrics collection
                task_tokens = len(task.split()) * 10  # Rough token estimate
                total_tokens += task_tokens
                completed_tasks += 1
                
            except Exception:
                errors += 1
        
        execution_time = time.time() - start_time
        
        # Calculate metrics
        metrics.completion_rate = completed_tasks / len(tasks) if tasks else 0
        metrics.avg_tokens_per_task = total_tokens // len(tasks) if tasks else 0
        metrics.avg_execution_time = execution_time
        metrics.error_rate = errors / len(tasks) if tasks else 0
        metrics.peak_memory_mb = 256.0  # Simulated
        metrics.parallel_efficiency = 0.85  # Simulated
        
        return metrics
    
    def _aggregate_metrics(self, results: List[BenchmarkMetrics]) -> BenchmarkMetrics:
        """Aggregate metrics from multiple benchmark runs."""
        if not results:
            return BenchmarkMetrics()
        
        aggregated = BenchmarkMetrics()
        
        # Average the metrics
        aggregated.completion_rate = sum(r.completion_rate for r in results) / len(results)
        aggregated.avg_tokens_per_task = int(sum(r.avg_tokens_per_task for r in results) / len(results))
        aggregated.avg_execution_time = sum(r.avg_execution_time for r in results) / len(results)
        aggregated.error_rate = sum(r.error_rate for r in results) / len(results)
        aggregated.peak_memory_mb = max(r.peak_memory_mb for r in results)
        aggregated.parallel_efficiency = sum(r.parallel_efficiency for r in results) / len(results)
        
        return aggregated
    
    def _calculate_optimization_score(self, metrics: BenchmarkMetrics) -> float:
        """Calculate overall optimization score from metrics."""
        # Weighted scoring based on different factors
        weights = {
            "completion_rate": 0.3,
            "execution_time": 0.25,
            "error_rate": 0.2,
            "token_efficiency": 0.15,
            "parallel_efficiency": 0.1
        }
        
        # Normalize metrics to 0-1 scale
        completion_score = metrics.completion_rate
        time_score = max(0, 1 - (metrics.avg_execution_time / 10))  # Assume 10s is poor
        error_score = max(0, 1 - metrics.error_rate)
        token_score = max(0, 1 - (metrics.avg_tokens_per_task / 1000))  # Assume 1000 tokens is poor
        parallel_score = metrics.parallel_efficiency
        
        # Calculate weighted score
        total_score = (
            completion_score * weights["completion_rate"] +
            time_score * weights["execution_time"] +
            error_score * weights["error_rate"] +
            token_score * weights["token_efficiency"] +
            parallel_score * weights["parallel_efficiency"]
        )
        
        return min(1.0, max(0.0, total_score))
    
    def _optimize_swarm(self, config: Dict, target_value: Any) -> Dict:
        """Optimize swarm coordination settings."""
        optimized = config.copy()
        
        # Optimize topology based on use case
        if config.get("use_case") in ["ml_pipeline", "testing_automation"]:
            optimized["swarm_topology"] = "mesh"
        elif config.get("use_case") in ["api_development", "documentation"]:
            optimized["swarm_topology"] = "hierarchical"
        
        # Add coordination rules
        if "critical_rules" not in optimized:
            optimized["critical_rules"] = []
        
        optimized["critical_rules"].extend([
            "Enable swarm memory synchronization",
            "Use collective decision making",
            "Implement agent load balancing"
        ])
        
        return optimized
    
    def _optimize_tools(self, config: Dict, target_value: Any) -> Dict:
        """Optimize tool selection and priorities."""
        optimized = config.copy()
        
        # Set tool priorities based on use case
        use_case = config.get("use_case", "")
        
        if use_case == "api_development":
            optimized["tool_priorities"] = ["MultiEdit", "Edit", "Bash", "Grep"]
        elif use_case == "ml_pipeline":
            optimized["tool_priorities"] = ["MultiEdit", "Bash", "Edit", "Read"]
        elif use_case == "performance_optimization":
            optimized["tool_priorities"] = ["Bash", "MultiEdit", "Grep", "Edit"]
        else:
            optimized["tool_priorities"] = ["MultiEdit", "Edit", "Read", "Bash"]
        
        return optimized