"""
Unit tests for CLAUDE.md optimizer functionality.

Tests the CLAUDE.md configuration generator, use case templates,
optimization rules engine, and effectiveness benchmarking.
"""

import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import tempfile
from pathlib import Path
import json

from swarm_benchmark.core.models import BenchmarkResult, PerformanceMetrics


class MockClaudeMdConfig:
    """Mock CLAUDE.md configuration for testing."""
    
    def __init__(self, use_case: str = "api_development"):
        self.use_case = use_case
        self.focus_areas = []
        self.preferred_agents = []
        self.swarm_topology = "hierarchical"
        self.max_agents = 5
        self.critical_rules = []
        self.tool_priorities = []
        self.performance_hints = {}
        self.mle_star_config = {}
        self.optimization_rules = {}
        
    def to_dict(self) -> Dict[str, Any]:
        """Convert config to dictionary."""
        return {
            "use_case": self.use_case,
            "focus_areas": self.focus_areas,
            "preferred_agents": self.preferred_agents,
            "swarm_topology": self.swarm_topology,
            "max_agents": self.max_agents,
            "critical_rules": self.critical_rules,
            "tool_priorities": self.tool_priorities,
            "performance_hints": self.performance_hints,
            "mle_star_config": self.mle_star_config,
            "optimization_rules": self.optimization_rules
        }


class MockOptimizationRulesEngine:
    """Mock optimization rules engine for testing."""
    
    def optimize_for_speed(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Optimize configuration for execution speed."""
        config.update({
            "parallel_execution": "aggressive",
            "cache_strategy": "memory",
            "batch_size": "large",
            "concurrency_level": "maximum",
            "rules": [
                "ALWAYS batch operations in single message",
                "Use Task tool for parallel agent execution",
                "Enable memory caching for repeated operations",
                "Prefer MultiEdit over multiple Edit calls"
            ]
        })
        return config
    
    def optimize_for_accuracy(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Optimize configuration for accuracy and correctness."""
        config.update({
            "validation_level": "strict",
            "testing_coverage": "comprehensive",
            "review_cycles": 2,
            "rules": [
                "Always run tests after changes",
                "Use type checking and linting",
                "Implement comprehensive error handling",
                "Request code review from reviewer agent"
            ]
        })
        return config
    
    def optimize_for_tokens(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Optimize configuration for token efficiency."""
        config.update({
            "response_style": "concise",
            "explanation_level": "minimal",
            "batch_operations": True,
            "rules": [
                "Minimize explanatory text",
                "Batch all related operations",
                "Use grep/glob before reading files", 
                "Avoid redundant file reads"
            ]
        })
        return config
    
    def optimize_for_swarm(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Optimize configuration for swarm coordination."""
        config.update({
            "coordination_strategy": "hierarchical",
            "agent_specialization": "high",
            "communication_pattern": "hub_and_spoke",
            "rules": [
                "Use specialized agents for different tasks",
                "Coordinate through central coordinator",
                "Share knowledge through swarm memory",
                "Monitor agent performance and adjust"
            ]
        })
        return config
    
    def optimize_for_memory(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Optimize configuration for memory usage."""
        config.update({
            "memory_strategy": "conservative",
            "garbage_collection": "aggressive",
            "caching_policy": "lru",
            "rules": [
                "Clear intermediate results early",
                "Use streaming for large data",
                "Implement memory pooling",
                "Monitor memory usage continuously"
            ]
        })
        return config


class MockClaudeMdOptimizer:
    """Mock CLAUDE.md optimizer for testing."""
    
    def __init__(self):
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
        
        self.optimization_rules = MockOptimizationRulesEngine()
        self.benchmark_history = []
        
    def generate_optimized_config(self, 
                                  use_case: str, 
                                  project_context: Dict[str, Any],
                                  performance_targets: Dict[str, Any]) -> str:
        """Generate an optimized CLAUDE.md configuration."""
        if use_case not in self.use_case_templates:
            raise ValueError(f"Unknown use case: {use_case}")
        
        # Get base template
        base_config = self.use_case_templates[use_case](project_context)
        
        # Apply optimization rules
        for rule_name, target_value in performance_targets.items():
            if hasattr(self.optimization_rules, f"optimize_for_{rule_name}"):
                optimizer_func = getattr(self.optimization_rules, f"optimize_for_{rule_name}")
                base_config = optimizer_func(base_config)
        
        # Add project-specific customizations
        base_config = self._add_project_specifics(base_config, project_context)
        
        # Generate final CLAUDE.md content
        return self._generate_claude_md_content(base_config)
    
    def benchmark_config_effectiveness(self, 
                                      claude_md_content: str,
                                      test_tasks: List[str]) -> Dict[str, Any]:
        """Benchmark the effectiveness of a CLAUDE.md configuration."""
        metrics = {
            "completion_rate": 0.0,
            "avg_tokens_per_task": 0,
            "avg_execution_time": 0.0,
            "error_rate": 0.0,
            "peak_memory_mb": 0.0,
            "optimization_score": 0.0
        }
        
        # Simulate benchmarking
        total_tasks = len(test_tasks)
        completed_tasks = 0
        total_tokens = 0
        total_time = 0.0
        errors = 0
        
        for i, task in enumerate(test_tasks):
            # Simulate task execution
            execution_result = self._simulate_task_execution(claude_md_content, task)
            
            if execution_result["success"]:
                completed_tasks += 1
            else:
                errors += 1
            
            total_tokens += execution_result["tokens_used"]
            total_time += execution_result["execution_time"]
        
        # Calculate metrics
        metrics["completion_rate"] = completed_tasks / total_tasks if total_tasks > 0 else 0
        metrics["avg_tokens_per_task"] = total_tokens / total_tasks if total_tasks > 0 else 0
        metrics["avg_execution_time"] = total_time / total_tasks if total_tasks > 0 else 0
        metrics["error_rate"] = errors / total_tasks if total_tasks > 0 else 0
        metrics["peak_memory_mb"] = 150.0 + (total_tasks * 2)  # Simulate memory usage
        
        # Calculate optimization score
        metrics["optimization_score"] = self._calculate_optimization_score(metrics)
        
        # Store in history
        benchmark_record = {
            "config_content": claude_md_content,
            "test_tasks": test_tasks,
            "metrics": metrics,
            "timestamp": datetime.now()
        }
        self.benchmark_history.append(benchmark_record)
        
        return metrics
    
    def _api_template(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate API development optimized configuration."""
        return {
            "use_case": "api_development",
            "focus_areas": ["REST endpoints", "GraphQL schemas", "OpenAPI docs"],
            "preferred_agents": ["backend-dev", "api-docs", "tester"],
            "swarm_topology": "hierarchical",
            "max_agents": 5,
            "critical_rules": [
                "Always validate input parameters",
                "Implement proper error handling",
                "Follow RESTful conventions",
                "Generate OpenAPI documentation"
            ],
            "tool_priorities": ["Edit", "MultiEdit", "Grep", "Test"],
            "performance_hints": {
                "batch_endpoints": True,
                "parallel_testing": True,
                "cache_responses": True
            },
            "api_standards": context.get("api_standards", "REST"),
            "database_type": context.get("database", "PostgreSQL")
        }
    
    def _ml_template(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate ML pipeline optimized configuration."""
        return {
            "use_case": "ml_pipeline",
            "focus_areas": ["Model training", "Data preprocessing", "Feature engineering"],
            "preferred_agents": ["ml-developer", "performance-benchmarker", "researcher"],
            "swarm_topology": "mesh",
            "max_agents": 8,
            "critical_rules": [
                "Use MLE-STAR for ensemble coordination",
                "Implement cross-validation",
                "Track all experiments",
                "Optimize hyperparameters"
            ],
            "mle_star_config": {
                "ensemble_size": 5,
                "voting_strategy": "weighted",
                "model_diversity": "high"
            },
            "performance_hints": {
                "gpu_optimization": True,
                "batch_processing": True,
                "distributed_training": True
            },
            "ml_framework": context.get("framework", "scikit-learn"),
            "data_size": context.get("data_size", "medium")
        }
    
    def _frontend_template(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate frontend React optimized configuration."""
        return {
            "use_case": "frontend_react",
            "focus_areas": ["Component design", "State management", "Performance optimization"],
            "preferred_agents": ["frontend-dev", "ui-designer", "performance-benchmarker"],
            "swarm_topology": "centralized",
            "max_agents": 4,
            "critical_rules": [
                "Use functional components with hooks",
                "Implement proper error boundaries",
                "Optimize bundle size",
                "Follow accessibility guidelines"
            ],
            "tool_priorities": ["Edit", "MultiEdit", "Read", "Bash"],
            "performance_hints": {
                "code_splitting": True,
                "lazy_loading": True,
                "memoization": True
            },
            "react_version": context.get("react_version", "18"),
            "state_management": context.get("state_library", "Redux")
        }
    
    def _microservices_template(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate microservices optimized configuration."""
        return {
            "use_case": "backend_microservices",
            "focus_areas": ["Service design", "API gateways", "Container orchestration"],
            "preferred_agents": ["system-architect", "backend-dev", "devops-engineer"],
            "swarm_topology": "hierarchical",
            "max_agents": 8,
            "critical_rules": [
                "Design loosely coupled services",
                "Implement circuit breakers",
                "Use async communication",
                "Monitor service health"
            ],
            "tool_priorities": ["Edit", "MultiEdit", "Bash", "Read"],
            "performance_hints": {
                "service_mesh": True,
                "load_balancing": True,
                "auto_scaling": True
            },
            "container_platform": context.get("platform", "Kubernetes"),
            "service_count": context.get("services", 5)
        }
    
    def _data_template(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate data pipeline optimized configuration."""
        return {
            "use_case": "data_pipeline",
            "focus_areas": ["Data ingestion", "Transformation", "Quality validation"],
            "preferred_agents": ["data-engineer", "ml-developer", "tester"],
            "swarm_topology": "distributed",
            "max_agents": 6,
            "critical_rules": [
                "Validate data quality at each step",
                "Implement idempotent operations",
                "Monitor data lineage",
                "Handle schema evolution"
            ],
            "performance_hints": {
                "stream_processing": True,
                "parallel_processing": True,
                "data_partitioning": True
            },
            "data_volume": context.get("volume", "TB"),
            "processing_framework": context.get("framework", "Spark")
        }
    
    def _devops_template(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate DevOps automation optimized configuration."""
        return {
            "use_case": "devops_automation",
            "focus_areas": ["CI/CD pipelines", "Infrastructure as Code", "Monitoring"],
            "preferred_agents": ["devops-engineer", "security-specialist", "monitor"],
            "swarm_topology": "centralized",
            "max_agents": 5,
            "critical_rules": [
                "Automate all deployments",
                "Implement security scanning",
                "Monitor system health",
                "Maintain infrastructure as code"
            ],
            "performance_hints": {
                "parallel_builds": True,
                "artifact_caching": True,
                "rollback_automation": True
            },
            "cloud_provider": context.get("cloud", "AWS"),
            "deployment_strategy": context.get("deployment", "blue-green")
        }
    
    def _mobile_template(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate mobile development optimized configuration."""
        return {
            "use_case": "mobile_development",
            "focus_areas": ["Cross-platform compatibility", "Performance optimization", "User experience"],
            "preferred_agents": ["mobile-dev", "ui-designer", "performance-benchmarker"],
            "swarm_topology": "centralized",
            "max_agents": 4,
            "critical_rules": [
                "Optimize for battery life",
                "Handle network interruptions",
                "Follow platform guidelines",
                "Test on real devices"
            ],
            "performance_hints": {
                "lazy_loading": True,
                "image_optimization": True,
                "offline_support": True
            },
            "platform": context.get("platform", "React Native"),
            "target_devices": context.get("devices", ["iOS", "Android"])
        }
    
    def _testing_template(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate testing automation optimized configuration."""
        return {
            "use_case": "testing_automation",
            "focus_areas": ["Test coverage", "Automated testing", "Quality assurance"],
            "preferred_agents": ["tester", "qa-specialist", "performance-benchmarker"],
            "swarm_topology": "distributed",
            "max_agents": 6,
            "critical_rules": [
                "Achieve 95% test coverage",
                "Implement all test types",
                "Automate test execution",
                "Generate detailed reports"
            ],
            "performance_hints": {
                "parallel_testing": True,
                "test_data_management": True,
                "flaky_test_detection": True
            },
            "testing_framework": context.get("framework", "pytest"),
            "coverage_target": context.get("coverage", 95)
        }
    
    def _docs_template(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate documentation optimized configuration."""
        return {
            "use_case": "documentation",
            "focus_areas": ["API documentation", "User guides", "Code documentation"],
            "preferred_agents": ["documenter", "technical-writer", "api-docs"],
            "swarm_topology": "centralized",
            "max_agents": 3,
            "critical_rules": [
                "Keep documentation up to date",
                "Include code examples",
                "Use consistent formatting",
                "Generate from code comments"
            ],
            "performance_hints": {
                "automated_generation": True,
                "version_control": True,
                "interactive_examples": True
            },
            "doc_format": context.get("format", "Markdown"),
            "auto_generation": context.get("auto_gen", True)
        }
    
    def _perf_template(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Generate performance optimization optimized configuration."""
        return {
            "use_case": "performance_optimization",
            "focus_areas": ["Bottleneck identification", "Resource optimization", "Scalability"],
            "preferred_agents": ["performance-benchmarker", "system-architect", "optimizer"],
            "swarm_topology": "mesh",
            "max_agents": 6,
            "critical_rules": [
                "Profile before optimizing",
                "Measure performance impact",
                "Optimize critical paths first",
                "Monitor continuously"
            ],
            "performance_hints": {
                "profiling_tools": True,
                "benchmark_automation": True,
                "performance_budgets": True
            },
            "performance_targets": context.get("targets", {}),
            "optimization_focus": context.get("focus", "latency")
        }
    
    def _add_project_specifics(self, config: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Add project-specific customizations to the configuration."""
        # Add project name and description
        config["project_name"] = context.get("project_name", "Unknown Project")
        config["project_description"] = context.get("description", "")
        
        # Add team size considerations
        team_size = context.get("team_size", 1)
        if team_size > 5:
            config["max_agents"] = min(config["max_agents"] + 2, 10)
            config["coordination_complexity"] = "high"
        elif team_size > 2:
            config["coordination_complexity"] = "medium"
        else:
            config["coordination_complexity"] = "low"
        
        # Add technology stack considerations
        tech_stack = context.get("tech_stack", [])
        if tech_stack:
            config["tech_stack"] = tech_stack
            
            # Adjust agents based on tech stack
            if "Python" in tech_stack:
                config["preferred_agents"].append("python-specialist")
            if "JavaScript" in tech_stack:
                config["preferred_agents"].append("js-specialist")
            if "Docker" in tech_stack:
                config["preferred_agents"].append("containerization-expert")
        
        # Add deadline pressure considerations
        deadline = context.get("deadline", "normal")
        if deadline == "urgent":
            config["optimization_priority"] = "speed"
            config["parallel_execution"] = "aggressive"
        elif deadline == "relaxed":
            config["optimization_priority"] = "quality"
            config["review_cycles"] = config.get("review_cycles", 1) + 1
        
        return config
    
    def _generate_claude_md_content(self, config: Dict[str, Any]) -> str:
        """Generate CLAUDE.md content from configuration."""
        content = f"""# CLAUDE.md - Optimized for {config['use_case'].replace('_', ' ').title()}

## 🎯 Project Configuration
- **Use Case**: {config['use_case']}
- **Project**: {config.get('project_name', 'Unknown')}
- **Team Size**: {config.get('coordination_complexity', 'medium').title()} complexity

## 🚀 Swarm Configuration
- **Topology**: {config['swarm_topology']}
- **Max Agents**: {config['max_agents']}
- **Preferred Agents**: {', '.join(config['preferred_agents'])}

## 📋 Focus Areas
"""
        
        for area in config['focus_areas']:
            content += f"- {area}\n"
        
        content += """
## 🔧 Critical Rules
"""
        
        for rule in config['critical_rules']:
            content += f"- {rule}\n"
        
        content += """
## ⚡ Performance Optimizations
"""
        
        for key, value in config['performance_hints'].items():
            content += f"- **{key.replace('_', ' ').title()}**: {value}\n"
        
        if config.get('mle_star_config'):
            content += """
## 🧠 MLE-STAR Configuration
"""
            mle_config = config['mle_star_config']
            for key, value in mle_config.items():
                content += f"- **{key.replace('_', ' ').title()}**: {value}\n"
        
        content += """
## 🛠️ Tool Priorities
"""
        
        for i, tool in enumerate(config['tool_priorities'], 1):
            content += f"{i}. {tool}\n"
        
        content += f"""
## 📊 Generated Configuration
- **Generated**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
- **Optimization Level**: Advanced
- **Configuration Version**: 1.0
"""
        
        return content
    
    def _simulate_task_execution(self, claude_md_content: str, task: str) -> Dict[str, Any]:
        """Simulate task execution with given configuration."""
        # Parse configuration effectiveness from content
        config_quality = self._assess_config_quality(claude_md_content)
        
        # Simulate execution based on task complexity and config quality
        task_complexity = self._assess_task_complexity(task)
        
        # Calculate success probability based on config quality and task complexity
        base_success_rate = 0.7  # Base success rate
        config_bonus = config_quality * 0.2  # Up to 20% bonus from good config
        complexity_penalty = task_complexity * 0.1  # Up to 10% penalty for complex tasks
        
        success_probability = base_success_rate + config_bonus - complexity_penalty
        success = np.random.random() < success_probability
        
        # Simulate execution metrics
        base_time = 5.0  # Base execution time in seconds
        time_factor = 1.0 + (task_complexity - config_quality)  # Config quality reduces time
        execution_time = base_time * max(0.5, time_factor)
        
        # Token usage simulation
        base_tokens = 200
        token_factor = 1.0 + (task_complexity * 0.5) - (config_quality * 0.3)
        tokens_used = int(base_tokens * max(0.5, token_factor))
        
        return {
            "success": success,
            "execution_time": execution_time,
            "tokens_used": tokens_used,
            "config_quality": config_quality,
            "task_complexity": task_complexity
        }
    
    def _assess_config_quality(self, claude_md_content: str) -> float:
        """Assess the quality of a CLAUDE.md configuration."""
        quality_indicators = [
            "swarm_topology",
            "preferred_agents",
            "critical_rules",
            "performance_hints",
            "tool_priorities"
        ]
        
        present_indicators = sum(1 for indicator in quality_indicators if indicator in claude_md_content.lower())
        return present_indicators / len(quality_indicators)
    
    def _assess_task_complexity(self, task: str) -> float:
        """Assess the complexity of a task."""
        complexity_keywords = {
            "simple": ["create", "add", "basic", "simple"],
            "medium": ["implement", "build", "design", "optimize"],
            "complex": ["architect", "integrate", "coordinate", "comprehensive"]
        }
        
        task_lower = task.lower()
        
        if any(keyword in task_lower for keyword in complexity_keywords["complex"]):
            return 0.8
        elif any(keyword in task_lower for keyword in complexity_keywords["medium"]):
            return 0.5
        else:
            return 0.2
    
    def _calculate_optimization_score(self, metrics: Dict[str, Any]) -> float:
        """Calculate overall optimization score from metrics."""
        # Weight different metrics
        weights = {
            "completion_rate": 0.3,
            "avg_execution_time": 0.2,  # Lower is better, so invert
            "error_rate": 0.2,         # Lower is better, so invert
            "avg_tokens_per_task": 0.2, # Lower is better, so invert
            "peak_memory_mb": 0.1      # Lower is better, so invert
        }
        
        # Normalize and weight metrics
        score = 0.0
        score += weights["completion_rate"] * metrics["completion_rate"]
        score += weights["avg_execution_time"] * max(0, 1 - (metrics["avg_execution_time"] / 60))  # Normalize to 60s max
        score += weights["error_rate"] * (1 - metrics["error_rate"])
        score += weights["avg_tokens_per_task"] * max(0, 1 - (metrics["avg_tokens_per_task"] / 1000))  # Normalize to 1000 tokens max
        score += weights["peak_memory_mb"] * max(0, 1 - (metrics["peak_memory_mb"] / 500))  # Normalize to 500MB max
        
        return min(1.0, score)


# Import numpy for random functions
import numpy as np


class TestClaudeMdOptimizer:
    """Test the CLAUDE.md optimizer functionality."""
    
    @pytest.fixture
    def optimizer(self):
        """Provide CLAUDE.md optimizer instance."""
        return MockClaudeMdOptimizer()
    
    @pytest.fixture
    def sample_project_context(self):
        """Provide sample project context."""
        return {
            "project_name": "E-commerce API",
            "description": "REST API for online shopping platform",
            "team_size": 3,
            "tech_stack": ["Python", "FastAPI", "PostgreSQL", "Docker"],
            "deadline": "normal",
            "api_standards": "REST",
            "database": "PostgreSQL"
        }
    
    @pytest.fixture
    def sample_performance_targets(self):
        """Provide sample performance targets."""
        return {
            "speed": True,
            "accuracy": True,
            "tokens": True
        }
    
    def test_optimizer_initialization(self, optimizer):
        """Test optimizer initialization."""
        assert len(optimizer.use_case_templates) == 10
        assert "api_development" in optimizer.use_case_templates
        assert "ml_pipeline" in optimizer.use_case_templates
        assert optimizer.optimization_rules is not None
        assert optimizer.benchmark_history == []
    
    def test_generate_optimized_config_api_development(self, optimizer, sample_project_context, sample_performance_targets):
        """Test generating optimized config for API development."""
        config_content = optimizer.generate_optimized_config(
            "api_development",
            sample_project_context,
            sample_performance_targets
        )
        
        assert isinstance(config_content, str)
        assert "api_development" in config_content.lower()
        assert "REST endpoints" in config_content
        assert "backend-dev" in config_content
        assert "hierarchical" in config_content
        assert sample_project_context["project_name"] in config_content
    
    def test_generate_optimized_config_ml_pipeline(self, optimizer):
        """Test generating optimized config for ML pipeline."""
        context = {
            "project_name": "Fraud Detection",
            "framework": "TensorFlow", 
            "data_size": "large",
            "team_size": 5
        }
        targets = {"speed": True, "memory": True}
        
        config_content = optimizer.generate_optimized_config(
            "ml_pipeline",
            context,
            targets
        )
        
        assert "ml_pipeline" in config_content.lower()
        assert "MLE-STAR" in config_content
        assert "ensemble_size" in config_content
        assert "mesh" in config_content
        assert "ml-developer" in config_content
    
    def test_generate_optimized_config_invalid_use_case(self, optimizer):
        """Test error handling for invalid use case."""
        with pytest.raises(ValueError, match="Unknown use case"):
            optimizer.generate_optimized_config(
                "invalid_use_case",
                {},
                {}
            )
    
    def test_benchmark_config_effectiveness(self, optimizer):
        """Test benchmarking config effectiveness."""
        claude_md_content = """# CLAUDE.md - Optimized for API Development
        
## Swarm Configuration  
- Topology: hierarchical
- Preferred Agents: backend-dev, api-docs, tester
- Critical Rules: Validate inputs, Handle errors
- Performance Hints: batch_operations, parallel_testing
"""
        
        test_tasks = [
            "Create user registration endpoint",
            "Implement authentication middleware", 
            "Build user profile API",
            "Add input validation"
        ]
        
        metrics = optimizer.benchmark_config_effectiveness(claude_md_content, test_tasks)
        
        assert "completion_rate" in metrics
        assert "avg_tokens_per_task" in metrics
        assert "avg_execution_time" in metrics
        assert "error_rate" in metrics
        assert "peak_memory_mb" in metrics
        assert "optimization_score" in metrics
        
        # Metrics should be within reasonable ranges
        assert 0 <= metrics["completion_rate"] <= 1
        assert metrics["avg_tokens_per_task"] > 0
        assert metrics["avg_execution_time"] > 0
        assert 0 <= metrics["error_rate"] <= 1
        assert metrics["peak_memory_mb"] > 0
        assert 0 <= metrics["optimization_score"] <= 1
        
        # Should store benchmark history
        assert len(optimizer.benchmark_history) == 1
        assert optimizer.benchmark_history[0]["config_content"] == claude_md_content
    
    @pytest.mark.parametrize("use_case", [
        "api_development",
        "ml_pipeline", 
        "frontend_react",
        "backend_microservices",
        "data_pipeline"
    ])
    def test_all_use_case_templates(self, optimizer, use_case):
        """Test all use case templates generate valid configurations."""
        context = {"project_name": f"Test {use_case}", "team_size": 3}
        targets = {"speed": True}
        
        config_content = optimizer.generate_optimized_config(use_case, context, targets)
        
        assert isinstance(config_content, str)
        assert use_case in config_content.lower()
        assert "CLAUDE.md" in config_content
        assert "Swarm Configuration" in config_content
        assert "Focus Areas" in config_content
        assert "Critical Rules" in config_content


class TestOptimizationRulesEngine:
    """Test the optimization rules engine."""
    
    @pytest.fixture
    def rules_engine(self):
        """Provide optimization rules engine instance."""
        return MockOptimizationRulesEngine()
    
    @pytest.fixture
    def base_config(self):
        """Provide base configuration for testing."""
        return {
            "use_case": "test",
            "max_agents": 5,
            "swarm_topology": "centralized"
        }
    
    def test_optimize_for_speed(self, rules_engine, base_config):
        """Test speed optimization rules."""
        optimized = rules_engine.optimize_for_speed(base_config.copy())
        
        assert optimized["parallel_execution"] == "aggressive"
        assert optimized["cache_strategy"] == "memory"
        assert optimized["batch_size"] == "large"
        assert optimized["concurrency_level"] == "maximum"
        assert len(optimized["rules"]) == 4
        assert "ALWAYS batch operations" in optimized["rules"][0]
    
    def test_optimize_for_accuracy(self, rules_engine, base_config):
        """Test accuracy optimization rules."""
        optimized = rules_engine.optimize_for_accuracy(base_config.copy())
        
        assert optimized["validation_level"] == "strict"
        assert optimized["testing_coverage"] == "comprehensive"
        assert optimized["review_cycles"] == 2
        assert "Always run tests after changes" in optimized["rules"]
        assert "Use type checking and linting" in optimized["rules"]
    
    def test_optimize_for_tokens(self, rules_engine, base_config):
        """Test token optimization rules."""
        optimized = rules_engine.optimize_for_tokens(base_config.copy())
        
        assert optimized["response_style"] == "concise"
        assert optimized["explanation_level"] == "minimal"
        assert optimized["batch_operations"] is True
        assert "Minimize explanatory text" in optimized["rules"]
        assert "Batch all related operations" in optimized["rules"]
    
    def test_optimize_for_swarm(self, rules_engine, base_config):
        """Test swarm optimization rules."""
        optimized = rules_engine.optimize_for_swarm(base_config.copy())
        
        assert optimized["coordination_strategy"] == "hierarchical"
        assert optimized["agent_specialization"] == "high"
        assert optimized["communication_pattern"] == "hub_and_spoke"
        assert "Use specialized agents" in optimized["rules"][0]
    
    def test_optimize_for_memory(self, rules_engine, base_config):
        """Test memory optimization rules."""
        optimized = rules_engine.optimize_for_memory(base_config.copy())
        
        assert optimized["memory_strategy"] == "conservative"
        assert optimized["garbage_collection"] == "aggressive"
        assert optimized["caching_policy"] == "lru"
        assert "Clear intermediate results early" in optimized["rules"]


class TestUseCaseTemplates:
    """Test individual use case templates."""
    
    @pytest.fixture
    def optimizer(self):
        """Provide optimizer for template testing."""
        return MockClaudeMdOptimizer()
    
    def test_api_template(self, optimizer):
        """Test API development template."""
        context = {
            "api_standards": "GraphQL",
            "database": "MongoDB",
            "team_size": 4
        }
        
        config = optimizer._api_template(context)
        
        assert config["use_case"] == "api_development"
        assert "REST endpoints" in config["focus_areas"]
        assert "backend-dev" in config["preferred_agents"]
        assert config["swarm_topology"] == "hierarchical"
        assert config["max_agents"] == 5
        assert config["api_standards"] == "GraphQL"
        assert config["database_type"] == "MongoDB"
    
    def test_ml_template(self, optimizer):
        """Test ML pipeline template."""
        context = {
            "framework": "PyTorch",
            "data_size": "large"
        }
        
        config = optimizer._ml_template(context)
        
        assert config["use_case"] == "ml_pipeline"
        assert "Model training" in config["focus_areas"]
        assert "ml-developer" in config["preferred_agents"]
        assert config["swarm_topology"] == "mesh"
        assert config["max_agents"] == 8
        assert "mle_star_config" in config
        assert config["mle_star_config"]["ensemble_size"] == 5
        assert config["ml_framework"] == "PyTorch"
    
    def test_frontend_template(self, optimizer):
        """Test frontend React template."""
        context = {
            "react_version": "18",
            "state_library": "Zustand"
        }
        
        config = optimizer._frontend_template(context)
        
        assert config["use_case"] == "frontend_react"
        assert "Component design" in config["focus_areas"]
        assert "frontend-dev" in config["preferred_agents"]
        assert config["react_version"] == "18"
        assert config["state_management"] == "Zustand"
    
    def test_microservices_template(self, optimizer):
        """Test microservices template."""
        context = {
            "platform": "Docker Swarm",
            "services": 8
        }
        
        config = optimizer._microservices_template(context)
        
        assert config["use_case"] == "backend_microservices"
        assert "Service design" in config["focus_areas"]
        assert "system-architect" in config["preferred_agents"]
        assert config["container_platform"] == "Docker Swarm"
        assert config["service_count"] == 8
    
    def test_devops_template(self, optimizer):
        """Test DevOps template."""
        context = {
            "cloud": "GCP",
            "deployment": "rolling"
        }
        
        config = optimizer._devops_template(context)
        
        assert config["use_case"] == "devops_automation"
        assert "CI/CD pipelines" in config["focus_areas"]
        assert "devops-engineer" in config["preferred_agents"]
        assert config["cloud_provider"] == "GCP"
        assert config["deployment_strategy"] == "rolling"


class TestProjectContextHandling:
    """Test project context handling and customization."""
    
    @pytest.fixture
    def optimizer(self):
        """Provide optimizer instance."""
        return MockClaudeMdOptimizer()
    
    def test_team_size_scaling(self, optimizer):
        """Test configuration scaling based on team size."""
        base_config = {"max_agents": 5}
        
        # Small team
        small_context = {"team_size": 1}
        result = optimizer._add_project_specifics(base_config.copy(), small_context)
        assert result["coordination_complexity"] == "low"
        assert result["max_agents"] == 5
        
        # Medium team
        medium_context = {"team_size": 3}
        result = optimizer._add_project_specifics(base_config.copy(), medium_context)
        assert result["coordination_complexity"] == "medium"
        
        # Large team
        large_context = {"team_size": 8}
        result = optimizer._add_project_specifics(base_config.copy(), large_context)
        assert result["coordination_complexity"] == "high"
        assert result["max_agents"] == 7  # Original 5 + 2
    
    def test_tech_stack_agent_selection(self, optimizer):
        """Test agent selection based on tech stack."""
        base_config = {"preferred_agents": ["base-agent"]}
        
        context = {
            "tech_stack": ["Python", "JavaScript", "Docker"]
        }
        
        result = optimizer._add_project_specifics(base_config, context)
        
        assert "python-specialist" in result["preferred_agents"]
        assert "js-specialist" in result["preferred_agents"]
        assert "containerization-expert" in result["preferred_agents"]
        assert result["tech_stack"] == ["Python", "JavaScript", "Docker"]
    
    def test_deadline_pressure_optimization(self, optimizer):
        """Test optimization based on deadline pressure."""
        base_config = {"review_cycles": 1}
        
        # Urgent deadline
        urgent_context = {"deadline": "urgent"}
        result = optimizer._add_project_specifics(base_config.copy(), urgent_context)
        assert result["optimization_priority"] == "speed"
        assert result["parallel_execution"] == "aggressive"
        
        # Relaxed deadline
        relaxed_context = {"deadline": "relaxed"}
        result = optimizer._add_project_specifics(base_config.copy(), relaxed_context)
        assert result["optimization_priority"] == "quality"
        assert result["review_cycles"] == 2  # Original 1 + 1


class TestConfigurationBenchmarking:
    """Test configuration effectiveness benchmarking."""
    
    @pytest.fixture
    def optimizer(self):
        """Provide optimizer instance."""
        return MockClaudeMdOptimizer()
    
    def test_task_complexity_assessment(self, optimizer):
        """Test task complexity assessment."""
        simple_task = "Create a basic function"
        medium_task = "Implement authentication system"
        complex_task = "Architect comprehensive microservices platform"
        
        simple_complexity = optimizer._assess_task_complexity(simple_task)
        medium_complexity = optimizer._assess_task_complexity(medium_task)
        complex_complexity = optimizer._assess_task_complexity(complex_task)
        
        assert simple_complexity < medium_complexity < complex_complexity
        assert 0 <= simple_complexity <= 1
        assert 0 <= complex_complexity <= 1
    
    def test_config_quality_assessment(self, optimizer):
        """Test configuration quality assessment."""
        high_quality_config = """
        swarm_topology: hierarchical
        preferred_agents: backend-dev, tester
        critical_rules: validate inputs
        performance_hints: batch operations
        tool_priorities: Edit, MultiEdit
        """
        
        low_quality_config = """
        basic configuration
        no specific optimizations
        """
        
        high_quality = optimizer._assess_config_quality(high_quality_config)
        low_quality = optimizer._assess_config_quality(low_quality_config)
        
        assert high_quality > low_quality
        assert 0 <= high_quality <= 1
        assert 0 <= low_quality <= 1
    
    def test_optimization_score_calculation(self, optimizer):
        """Test optimization score calculation."""
        excellent_metrics = {
            "completion_rate": 0.95,
            "avg_execution_time": 5.0,
            "error_rate": 0.05,
            "avg_tokens_per_task": 200,
            "peak_memory_mb": 100
        }
        
        poor_metrics = {
            "completion_rate": 0.60,
            "avg_execution_time": 50.0,
            "error_rate": 0.30,
            "avg_tokens_per_task": 800,
            "peak_memory_mb": 400
        }
        
        excellent_score = optimizer._calculate_optimization_score(excellent_metrics)
        poor_score = optimizer._calculate_optimization_score(poor_metrics)
        
        assert excellent_score > poor_score
        assert 0 <= excellent_score <= 1
        assert 0 <= poor_score <= 1
    
    def test_benchmark_history_tracking(self, optimizer):
        """Test benchmark history tracking."""
        config_content = "test configuration"
        test_tasks = ["task1", "task2"]
        
        # Run first benchmark
        metrics1 = optimizer.benchmark_config_effectiveness(config_content, test_tasks)
        assert len(optimizer.benchmark_history) == 1
        
        # Run second benchmark
        metrics2 = optimizer.benchmark_config_effectiveness(config_content, test_tasks)
        assert len(optimizer.benchmark_history) == 2
        
        # Verify history structure
        for record in optimizer.benchmark_history:
            assert "config_content" in record
            assert "test_tasks" in record
            assert "metrics" in record
            assert "timestamp" in record


class TestIntegrationScenarios:
    """Test integration scenarios combining multiple features."""
    
    @pytest.fixture
    def optimizer(self):
        """Provide optimizer instance."""
        return MockClaudeMdOptimizer()
    
    def test_end_to_end_api_optimization(self, optimizer):
        """Test complete end-to-end API optimization scenario."""
        # Project context
        context = {
            "project_name": "High-Performance Trading API",
            "description": "Low-latency financial trading platform",
            "team_size": 6,
            "tech_stack": ["Python", "FastAPI", "Redis", "PostgreSQL"],
            "deadline": "urgent",
            "performance_requirements": {
                "latency": "<10ms",
                "throughput": ">10000 rps"
            }
        }
        
        # Performance targets
        targets = {
            "speed": True,
            "memory": True,
            "tokens": True
        }
        
        # Generate optimized configuration
        config_content = optimizer.generate_optimized_config(
            "api_development",
            context,
            targets
        )
        
        # Test configuration
        test_tasks = [
            "Create high-frequency trading endpoint",
            "Implement order matching algorithm",
            "Build real-time market data feed",
            "Add risk management middleware"
        ]
        
        # Benchmark effectiveness
        metrics = optimizer.benchmark_config_effectiveness(config_content, test_tasks)
        
        # Verify optimization worked
        assert "High-Performance Trading API" in config_content
        assert "urgent" in config_content.lower() or "aggressive" in config_content.lower()
        assert metrics["completion_rate"] > 0.7  # Should be reasonably successful
        assert metrics["optimization_score"] > 0.6  # Should be well optimized
    
    def test_ml_pipeline_with_constraints(self, optimizer):
        """Test ML pipeline optimization with resource constraints."""
        context = {
            "project_name": "Edge AI Model",
            "framework": "TensorFlow Lite",
            "data_size": "medium",
            "deployment_target": "mobile",
            "constraints": {
                "model_size": "<50MB",
                "inference_time": "<100ms",
                "memory_usage": "<512MB"
            }
        }
        
        targets = {
            "memory": True,
            "speed": True
        }
        
        config_content = optimizer.generate_optimized_config(
            "ml_pipeline",
            context,
            targets
        )
        
        # Should optimize for mobile constraints
        assert "Edge AI Model" in config_content
        assert "memory" in config_content.lower()
        assert "TensorFlow Lite" in config_content or "tensorflow" in config_content.lower()


class TestErrorHandlingAndEdgeCases:
    """Test error handling and edge cases."""
    
    @pytest.fixture
    def optimizer(self):
        """Provide optimizer instance."""
        return MockClaudeMdOptimizer()
    
    def test_empty_project_context(self, optimizer):
        """Test handling of empty project context."""
        config_content = optimizer.generate_optimized_config(
            "api_development",
            {},  # Empty context
            {"speed": True}
        )
        
        assert isinstance(config_content, str)
        assert "Unknown Project" in config_content  # Default project name
        assert "api_development" in config_content.lower()
    
    def test_empty_performance_targets(self, optimizer):
        """Test handling of empty performance targets."""
        context = {"project_name": "Test Project"}
        
        config_content = optimizer.generate_optimized_config(
            "api_development",
            context,
            {}  # Empty targets
        )
        
        assert isinstance(config_content, str)
        assert "Test Project" in config_content
    
    def test_empty_test_tasks_benchmark(self, optimizer):
        """Test benchmarking with empty test tasks."""
        config_content = "test configuration"
        
        metrics = optimizer.benchmark_config_effectiveness(config_content, [])
        
        assert metrics["completion_rate"] == 0
        assert metrics["avg_tokens_per_task"] == 0
        assert metrics["avg_execution_time"] == 0
        assert metrics["error_rate"] == 0
    
    def test_malformed_config_quality_assessment(self, optimizer):
        """Test quality assessment with malformed configuration."""
        malformed_config = "not a proper configuration format"
        
        quality = optimizer._assess_config_quality(malformed_config)
        
        assert 0 <= quality <= 1
        # Should handle gracefully and return low quality score


class TestPerformanceAndScaling:
    """Test performance characteristics and scaling behavior."""
    
    @pytest.fixture
    def optimizer(self):
        """Provide optimizer instance."""
        return MockClaudeMdOptimizer()
    
    @pytest.mark.performance
    def test_large_project_context_handling(self, optimizer):
        """Test handling of large project contexts."""
        large_context = {
            "project_name": "Enterprise Platform",
            "tech_stack": [f"Technology_{i}" for i in range(50)],
            "team_size": 25,
            "departments": [f"Department_{i}" for i in range(10)],
            "requirements": [f"Requirement_{i}" for i in range(100)]
        }
        
        start_time = datetime.now()
        config_content = optimizer.generate_optimized_config(
            "backend_microservices",
            large_context,
            {"speed": True, "memory": True}
        )
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 1.0  # Should generate quickly
        assert isinstance(config_content, str)
        assert len(config_content) > 0
    
    @pytest.mark.performance  
    def test_many_test_tasks_benchmark(self, optimizer):
        """Test benchmarking with many test tasks."""
        config_content = "optimized configuration"
        test_tasks = [f"Task {i}: Implement feature {i}" for i in range(100)]
        
        start_time = datetime.now()
        metrics = optimizer.benchmark_config_effectiveness(config_content, test_tasks)
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 2.0  # Should benchmark efficiently
        assert metrics["avg_tokens_per_task"] > 0
        assert 0 <= metrics["optimization_score"] <= 1
    
    @pytest.mark.stress
    def test_concurrent_config_generation(self, optimizer):
        """Test concurrent configuration generation."""
        import threading
        import concurrent.futures
        
        def generate_config(use_case, context, targets):
            return optimizer.generate_optimized_config(use_case, context, targets)
        
        # Generate configurations concurrently
        contexts = [
            {"project_name": f"Project_{i}", "team_size": i % 10 + 1}
            for i in range(20)
        ]
        
        start_time = datetime.now()
        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [
                executor.submit(generate_config, "api_development", context, {"speed": True})
                for context in contexts
            ]
            results = [future.result() for future in concurrent.futures.as_completed(futures)]
        end_time = datetime.now()
        
        duration = (end_time - start_time).total_seconds()
        assert duration < 5.0  # Should handle concurrency efficiently
        assert len(results) == 20
        assert all(isinstance(result, str) for result in results)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])