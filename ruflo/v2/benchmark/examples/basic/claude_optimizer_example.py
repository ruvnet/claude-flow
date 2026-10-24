#!/usr/bin/env python3
"""
CLAUDE.md Optimizer Example

This example demonstrates comprehensive usage of the CLAUDE.md optimizer
for different development scenarios and optimization strategies.
"""

import asyncio
import json
import sys
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any

# Add the benchmark source to Python path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from swarm_benchmark.claude_optimizer import (
    ClaudeMdOptimizer,
    ProjectContext,
    PerformanceTargets,
    BenchmarkMetrics
)


class ClaudeOptimizerDemo:
    """
    Comprehensive demonstration of CLAUDE.md optimization capabilities.
    """
    
    def __init__(self):
        """Initialize the demo with optimizer and example scenarios."""
        self.optimizer = ClaudeMdOptimizer()
        self.results: List[Dict] = []
        
    async def run_complete_demo(self):
        """Run complete demonstration of all optimization features."""
        print("🚀 CLAUDE.md Optimizer Comprehensive Demo")
        print("=" * 50)
        
        # Run all optimization scenarios
        await self.demo_api_development()
        await self.demo_ml_pipeline()
        await self.demo_performance_optimization()
        await self.demo_testing_automation()
        await self.demo_custom_optimization()
        
        # Generate comparison report
        self.generate_comparison_report()
        
        print("\n✅ Demo completed successfully!")
        print(f"📊 Results saved to: optimization_demo_results.json")
    
    async def demo_api_development(self):
        """Demonstrate API development optimization."""
        print("\n🔧 API Development Optimization")
        print("-" * 30)
        
        # Define project context for a high-performance API
        context = ProjectContext(
            project_type="e_commerce_api",
            team_size=6,
            complexity="complex",
            primary_languages=["Python", "TypeScript"],
            frameworks=["FastAPI", "React", "PostgreSQL", "Redis"],
            performance_requirements={
                "response_time": "<50ms",
                "throughput": ">1000 rps",
                "availability": "99.9%",
                "test_coverage": ">95%"
            },
            existing_tools=["pytest", "docker", "kubernetes", "prometheus"],
            constraints={
                "budget": "medium",
                "timeline": "3 months",
                "team_experience": "senior"
            }
        )
        
        # Test different optimization priorities
        priorities = ["speed", "accuracy", "tokens"]
        
        for priority in priorities:
            targets = PerformanceTargets(
                priority=priority,
                target_completion_time=60.0,
                target_token_usage=500 if priority == "tokens" else 800,
                target_memory_usage=2048.0,
                target_error_rate=0.01 if priority == "accuracy" else 0.05
            )
            
            print(f"\n  📋 Optimizing for: {priority.upper()}")
            
            # Generate optimized configuration
            config = self.optimizer.generate_optimized_config(
                "api_development", context, targets
            )
            
            # Save configuration
            config_file = f"api_development_{priority}_claude.md"
            with open(config_file, "w") as f:
                f.write(config)
            
            print(f"  ✅ Configuration saved: {config_file}")
            
            # Benchmark the configuration
            test_tasks = [
                "Design RESTful API with proper resource modeling",
                "Implement CRUD endpoints with validation and error handling",
                "Add comprehensive authentication and authorization",
                "Create integration tests with >95% coverage",
                "Generate OpenAPI documentation",
                "Implement caching and performance optimization",
                "Add monitoring, logging, and health checks",
                "Deploy with Docker and Kubernetes"
            ]
            
            metrics = await self.optimizer.benchmark_config_effectiveness(
                config, test_tasks, iterations=3
            )
            
            # Store results
            result = {
                "use_case": "api_development",
                "priority": priority,
                "context": context.__dict__,
                "targets": targets.__dict__,
                "metrics": metrics.__dict__,
                "config_file": config_file,
                "timestamp": datetime.now().isoformat()
            }
            self.results.append(result)
            
            # Display metrics
            print(f"  📊 Optimization Score: {metrics.optimization_score:.3f}")
            print(f"  📊 Completion Rate: {metrics.completion_rate:.1%}")
            print(f"  📊 Avg Execution Time: {metrics.avg_execution_time:.2f}s")
            print(f"  📊 Token Efficiency: {metrics.avg_tokens_per_task} tokens/task")
            
            # Get optimization suggestions
            suggestions = self.optimizer.get_optimization_suggestions(metrics, targets)
            if suggestions:
                print(f"  💡 Suggestions: {suggestions[0]}")
    
    async def demo_ml_pipeline(self):
        """Demonstrate ML pipeline optimization."""
        print("\n🧠 ML Pipeline Optimization")
        print("-" * 30)
        
        context = ProjectContext(
            project_type="ml_classification",
            team_size=4,
            complexity="complex",
            primary_languages=["Python", "R"],
            frameworks=["PyTorch", "scikit-learn", "MLflow", "Airflow"],
            performance_requirements={
                "model_accuracy": ">92%",
                "training_time": "<30min",
                "inference_latency": "<100ms",
                "reproducibility": "100%"
            },
            existing_tools=["jupyter", "wandb", "docker", "kubernetes"],
            constraints={
                "gpu_budget": "limited",
                "data_size": "large",
                "interpretability": "required"
            }
        )
        
        targets = PerformanceTargets(
            priority="accuracy",
            target_completion_time=90.0,
            target_token_usage=1000,
            target_memory_usage=4096.0,
            target_error_rate=0.005
        )
        
        print("  📋 Optimizing ML pipeline for accuracy")
        
        # Generate MLE-STAR optimized configuration
        config = self.optimizer.generate_optimized_config(
            "ml_pipeline", context, targets
        )
        
        config_file = "ml_pipeline_claude.md"
        with open(config_file, "w") as f:
            f.write(config)
        
        print(f"  ✅ Configuration saved: {config_file}")
        
        # ML-specific benchmark tasks
        ml_tasks = [
            "Design data preprocessing pipeline with feature engineering",
            "Implement cross-validation strategy for model selection",
            "Create ensemble learning setup with MLE-STAR coordination",
            "Build hyperparameter optimization with Bayesian search",
            "Implement model evaluation with comprehensive metrics",
            "Create model interpretation and explainability features",
            "Set up experiment tracking and model versioning",
            "Deploy model with A/B testing capabilities"
        ]
        
        metrics = await self.optimizer.benchmark_config_effectiveness(
            config, ml_tasks, iterations=2  # Fewer iterations for ML tasks
        )
        
        # Store results
        result = {
            "use_case": "ml_pipeline",
            "priority": "accuracy",
            "context": context.__dict__,
            "targets": targets.__dict__,
            "metrics": metrics.__dict__,
            "config_file": config_file,
            "mle_star_enabled": True,
            "timestamp": datetime.now().isoformat()
        }
        self.results.append(result)
        
        print(f"  📊 Optimization Score: {metrics.optimization_score:.3f}")
        print(f"  📊 Completion Rate: {metrics.completion_rate:.1%}")
        print(f"  🧠 MLE-STAR ensemble coordination enabled")
    
    async def demo_performance_optimization(self):
        """Demonstrate performance optimization scenario."""
        print("\n⚡ Performance Optimization")
        print("-" * 30)
        
        context = ProjectContext(
            project_type="performance_tuning",
            team_size=3,
            complexity="medium",
            primary_languages=["Python", "Go", "JavaScript"],
            frameworks=["Flask", "Gin", "Node.js"],
            performance_requirements={
                "latency_reduction": ">50%",
                "throughput_increase": ">100%",
                "memory_optimization": ">30%",
                "cpu_optimization": ">40%"
            },
            existing_tools=["profiler", "benchmark", "monitoring"],
            constraints={
                "no_architecture_changes": True,
                "backward_compatibility": "required"
            }
        )
        
        targets = PerformanceTargets(
            priority="speed",
            target_completion_time=45.0,
            target_token_usage=400,  # Aggressive token optimization
            target_memory_usage=1024.0,
            target_error_rate=0.02
        )
        
        print("  📋 Optimizing for maximum performance")
        
        config = self.optimizer.generate_optimized_config(
            "performance_optimization", context, targets
        )
        
        config_file = "performance_optimization_claude.md"
        with open(config_file, "w") as f:
            f.write(config)
        
        performance_tasks = [
            "Profile application to identify bottlenecks",
            "Optimize database queries and indexing",
            "Implement caching at multiple layers",
            "Optimize algorithms and data structures",
            "Tune memory allocation and garbage collection",
            "Implement parallel processing where possible",
            "Set up continuous performance monitoring",
            "Create performance regression testing"
        ]
        
        metrics = await self.optimizer.benchmark_config_effectiveness(
            config, performance_tasks, iterations=3
        )
        
        result = {
            "use_case": "performance_optimization",
            "priority": "speed",
            "context": context.__dict__,
            "targets": targets.__dict__,
            "metrics": metrics.__dict__,
            "config_file": config_file,
            "timestamp": datetime.now().isoformat()
        }
        self.results.append(result)
        
        print(f"  📊 Optimization Score: {metrics.optimization_score:.3f}")
        print(f"  ⚡ Parallel Efficiency: {metrics.parallel_efficiency:.1%}")
    
    async def demo_testing_automation(self):
        """Demonstrate testing automation optimization."""
        print("\n🧪 Testing Automation Optimization") 
        print("-" * 30)
        
        context = ProjectContext(
            project_type="test_automation",
            team_size=5,
            complexity="medium",
            primary_languages=["Python", "JavaScript", "Java"],
            frameworks=["pytest", "jest", "selenium", "testcontainers"],
            performance_requirements={
                "test_coverage": ">95%",
                "test_execution_time": "<5min",
                "flaky_test_rate": "<1%",
                "maintenance_overhead": "<10%"
            },
            existing_tools=["CI/CD", "test-reporting", "parallel-execution"],
            constraints={
                "existing_test_suite": "large",
                "integration_complexity": "high"
            }
        )
        
        targets = PerformanceTargets(
            priority="accuracy",
            target_completion_time=30.0,
            target_token_usage=600,
            target_memory_usage=1536.0,
            target_error_rate=0.01
        )
        
        print("  📋 Optimizing testing automation for accuracy")
        
        config = self.optimizer.generate_optimized_config(
            "testing_automation", context, targets
        )
        
        config_file = "testing_automation_claude.md"
        with open(config_file, "w") as f:
            f.write(config)
        
        testing_tasks = [
            "Design comprehensive test strategy and framework",
            "Implement unit tests with high coverage",
            "Create integration tests for critical paths",
            "Build end-to-end test automation",
            "Set up performance and load testing",
            "Implement test data management and fixtures",
            "Create test reporting and analytics",
            "Optimize test execution with parallelization"
        ]
        
        metrics = await self.optimizer.benchmark_config_effectiveness(
            config, testing_tasks, iterations=3
        )
        
        result = {
            "use_case": "testing_automation",
            "priority": "accuracy",
            "context": context.__dict__,
            "targets": targets.__dict__,
            "metrics": metrics.__dict__,
            "config_file": config_file,
            "timestamp": datetime.now().isoformat()
        }
        self.results.append(result)
        
        print(f"  📊 Optimization Score: {metrics.optimization_score:.3f}")
        print(f"  🎯 Error Rate: {metrics.error_rate:.1%}")
    
    async def demo_custom_optimization(self):
        """Demonstrate custom optimization rules."""
        print("\n🔧 Custom Optimization Rules")
        print("-" * 30)
        
        from swarm_benchmark.claude_optimizer import OptimizationRulesEngine, OptimizationRule
        
        # Create custom rules for a specific scenario
        custom_rules = [
            OptimizationRule(
                name="legacy_system_integration",
                description="Optimize for legacy system compatibility",
                condition="legacy_integration == True",
                action="enable_legacy_compatibility_mode",
                priority=9,
                impact="high"
            ),
            OptimizationRule(
                name="regulatory_compliance",
                description="Enable compliance-focused development",
                condition="regulatory_requirements == 'strict'",
                action="enable_compliance_mode",
                priority=10,
                impact="high"
            ),
            OptimizationRule(
                name="resource_constraints",
                description="Optimize for limited resources",
                condition="resource_budget == 'limited'",
                action="enable_resource_optimization",
                priority=8,
                impact="medium"
            )
        ]
        
        # Apply custom rules
        rules_engine = OptimizationRulesEngine()
        
        # Base configuration
        base_config = {
            "use_case": "custom_development",
            "max_agents": 4,
            "swarm_topology": "hierarchical",
            "critical_rules": ["Standard development practices"]
        }
        
        # Apply custom rules
        optimized_config = rules_engine.apply_custom_rules(base_config, custom_rules)
        
        print("  ✅ Applied custom optimization rules:")
        for rule in custom_rules:
            print(f"    - {rule.name}: {rule.description}")
        
        # Get rules summary
        summary = rules_engine.get_applied_rules_summary()
        print(f"  📊 Total rule applications: {summary['total_applications']}")
        
        # Store custom rule result
        result = {
            "use_case": "custom_optimization",
            "priority": "custom",
            "custom_rules_count": len(custom_rules),
            "rules_applied": [rule.name for rule in custom_rules],
            "base_config": base_config,
            "optimized_config": optimized_config,
            "timestamp": datetime.now().isoformat()
        }
        self.results.append(result)
    
    def generate_comparison_report(self):
        """Generate comprehensive comparison report."""
        print("\n📊 Optimization Results Comparison")
        print("=" * 50)
        
        # Group results by use case
        use_cases = {}
        for result in self.results:
            use_case = result["use_case"]
            if use_case not in use_cases:
                use_cases[use_case] = []
            use_cases[use_case].append(result)
        
        # Generate comparison table
        print(f"{'Use Case':<25} {'Priority':<10} {'Opt Score':<10} {'Completion':<12} {'Exec Time':<10}")
        print("-" * 80)
        
        for use_case, results in use_cases.items():
            for result in results:
                if "metrics" in result:
                    metrics = result["metrics"]
                    print(f"{use_case:<25} {result.get('priority', 'N/A'):<10} "
                          f"{metrics['optimization_score']:.3f}     "
                          f"{metrics['completion_rate']:.1%}        "
                          f"{metrics['avg_execution_time']:.2f}s")
        
        # Find best performing configurations
        best_overall = max(
            [r for r in self.results if "metrics" in r],
            key=lambda x: x["metrics"]["optimization_score"]
        )
        
        fastest = min(
            [r for r in self.results if "metrics" in r],
            key=lambda x: x["metrics"]["avg_execution_time"]
        )
        
        most_accurate = max(
            [r for r in self.results if "metrics" in r],
            key=lambda x: x["metrics"]["completion_rate"]
        )
        
        print(f"\n🏆 Best Performing Configurations:")
        print(f"  Highest Optimization Score: {best_overall['use_case']} ({best_overall['priority']}) - {best_overall['metrics']['optimization_score']:.3f}")
        print(f"  Fastest Execution: {fastest['use_case']} ({fastest['priority']}) - {fastest['metrics']['avg_execution_time']:.2f}s")
        print(f"  Most Accurate: {most_accurate['use_case']} ({most_accurate['priority']}) - {most_accurate['metrics']['completion_rate']:.1%}")
        
        # Save detailed results
        with open("optimization_demo_results.json", "w") as f:
            json.dump(self.results, f, indent=2, default=str)
        
        # Generate summary statistics
        if self.results:
            total_optimizations = len(self.results)
            with_metrics = [r for r in self.results if "metrics" in r]
            
            if with_metrics:
                avg_score = sum(r["metrics"]["optimization_score"] for r in with_metrics) / len(with_metrics)
                avg_completion = sum(r["metrics"]["completion_rate"] for r in with_metrics) / len(with_metrics)
                avg_time = sum(r["metrics"]["avg_execution_time"] for r in with_metrics) / len(with_metrics)
                
                print(f"\n📈 Summary Statistics:")
                print(f"  Total Optimizations: {total_optimizations}")
                print(f"  Average Optimization Score: {avg_score:.3f}")
                print(f"  Average Completion Rate: {avg_completion:.1%}")
                print(f"  Average Execution Time: {avg_time:.2f}s")


async def main():
    """Run the complete CLAUDE.md optimizer demonstration."""
    demo = ClaudeOptimizerDemo()
    
    try:
        await demo.run_complete_demo()
    except KeyboardInterrupt:
        print("\n\n⚠️ Demo interrupted by user")
    except Exception as e:
        print(f"\n❌ Demo failed with error: {str(e)}")
        import traceback
        traceback.print_exc()
    

if __name__ == "__main__":
    # Run the demo
    asyncio.run(main())