# CLAUDE.md Optimizer Guide

## Overview

The CLAUDE.md Optimizer is an intelligent system that generates optimized CLAUDE.md configurations for specific development use cases. It analyzes project requirements, performance targets, and team context to create tailored configurations that maximize Claude Code's effectiveness.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Use Cases](#use-cases)  
3. [Configuration Options](#configuration-options)
4. [Optimization Strategies](#optimization-strategies)
5. [Benchmarking](#benchmarking)
6. [Advanced Features](#advanced-features)
7. [Best Practices](#best-practices)
8. [Troubleshooting](#troubleshooting)

## Quick Start

### Installation

The optimizer is included with the benchmark system:

```bash
pip install -e /path/to/benchmark
```

### Basic Usage

```python
from swarm_benchmark.claude_optimizer import ClaudeMdOptimizer, ProjectContext, PerformanceTargets

# Create optimizer instance
optimizer = ClaudeMdOptimizer()

# Define your project
context = ProjectContext(
    project_type="web_api",
    team_size=4,
    complexity="medium", 
    primary_languages=["Python"],
    frameworks=["FastAPI"],
    performance_requirements={"response_time": "<100ms"},
    existing_tools=["pytest", "docker"],
    constraints={"timeline": "tight"}
)

# Set performance targets
targets = PerformanceTargets(
    priority="speed",
    target_completion_time=30.0,
    target_token_usage=500
)

# Generate optimized configuration
config = optimizer.generate_optimized_config("api_development", context, targets)

# Save to file
with open("claude.md", "w") as f:
    f.write(config)
```

### CLI Usage

```bash
# Generate optimized CLAUDE.md for API development
python -m swarm_benchmark optimize \
  --use-case api_development \
  --team-size 4 \
  --complexity medium \
  --priority speed \
  --output claude.md

# Benchmark a configuration
python -m swarm_benchmark analyze \
  --config-file claude.md \
  --tasks api_tasks.txt \
  --iterations 3
```

## Use Cases

The optimizer supports 10 specialized use cases, each with tailored configurations:

### 1. API Development (`api_development`)

**Optimized for:**
- REST/GraphQL API creation
- OpenAPI documentation generation
- Comprehensive testing
- Performance optimization

**Key Features:**
- Hierarchical agent coordination
- Batch endpoint creation
- Parallel test execution
- Automatic documentation generation

**Example Configuration:**
```python
config = optimizer.generate_optimized_config(
    "api_development",
    ProjectContext(
        project_type="rest_api",
        team_size=5,
        complexity="medium",
        frameworks=["FastAPI", "SQLAlchemy"],
        performance_requirements={"response_time": "<100ms"}
    ),
    PerformanceTargets(priority="speed")
)
```

### 2. Machine Learning Pipeline (`ml_pipeline`)

**Optimized for:**
- Model training and evaluation
- Feature engineering
- Hyperparameter optimization
- Ensemble learning with MLE-STAR

**Key Features:**
- Mesh topology for parallel processing
- MLE-STAR ensemble coordination
- GPU optimization support
- Cross-validation integration

**Example Configuration:**
```python
config = optimizer.generate_optimized_config(
    "ml_pipeline",
    ProjectContext(
        project_type="ml_model",
        complexity="complex",
        frameworks=["scikit-learn", "pytorch"],
        performance_requirements={"accuracy": ">90%", "training_time": "<30min"}
    ),
    PerformanceTargets(priority="accuracy")
)
```

### 3. Frontend React Development (`frontend_react`)

**Optimized for:**
- Component development
- State management
- UI/UX implementation
- Bundle optimization

**Key Features:**
- Component-focused workflows
- TypeScript integration
- Performance optimization
- Responsive design patterns

### 4. Backend Microservices (`backend_microservices`)

**Optimized for:**
- Service architecture design
- API gateway implementation
- Database integration
- Distributed system patterns

**Key Features:**
- Mesh topology for service coordination
- Circuit breaker patterns
- Distributed tracing
- Service health monitoring

### 5. Data Pipeline (`data_pipeline`)

**Optimized for:**
- ETL process implementation
- Data validation and quality
- Pipeline orchestration
- Data lineage tracking

### 6. DevOps Automation (`devops_automation`)

**Optimized for:**
- CI/CD pipeline creation
- Infrastructure as code
- Monitoring and alerting
- Security compliance

### 7. Mobile Development (`mobile_development`)

**Optimized for:**
- Cross-platform development
- Performance optimization
- Offline capabilities
- Platform-specific features

### 8. Testing Automation (`testing_automation`)

**Optimized for:**
- Test suite creation
- Quality assurance
- Coverage analysis
- Performance testing

### 9. Documentation (`documentation`)

**Optimized for:**
- Technical writing
- API documentation
- User guide creation
- Documentation maintenance

### 10. Performance Optimization (`performance_optimization`)

**Optimized for:**
- Bottleneck identification
- Performance analysis
- Optimization implementation
- Monitoring setup

## Configuration Options

### ProjectContext Parameters

```python
ProjectContext(
    project_type: str,          # Type of project being developed
    team_size: int,             # Number of team members
    complexity: str,            # "simple", "medium", "complex"
    primary_languages: List[str], # Programming languages used
    frameworks: List[str],       # Frameworks and libraries
    performance_requirements: Dict, # Performance targets
    existing_tools: List[str],   # Tools already in use
    constraints: Dict           # Project constraints
)
```

### PerformanceTargets Parameters

```python
PerformanceTargets(
    priority: str,                    # "speed", "accuracy", "tokens", "memory"
    target_completion_time: float,    # Maximum execution time (seconds)
    target_token_usage: int,          # Maximum tokens per task
    target_memory_usage: float,       # Maximum memory usage (MB)
    target_error_rate: float         # Maximum acceptable error rate
)
```

## Optimization Strategies

### Speed Optimization

Focus on minimizing execution time through aggressive parallelization and caching.

**Configuration Changes:**
- Enables aggressive parallel execution
- Increases agent count for better parallelization
- Implements memory caching
- Uses mesh topology for optimal coordination
- Minimizes explanatory text

**Example:**
```python
targets = PerformanceTargets(
    priority="speed",
    target_completion_time=30.0
)
```

### Accuracy Optimization

Prioritizes correctness and quality through comprehensive testing and validation.

**Configuration Changes:**
- Enables comprehensive testing
- Adds reviewer and tester agents
- Implements strict validation
- Includes error handling patterns
- Uses hierarchical coordination for quality control

**Example:**
```python
targets = PerformanceTargets(
    priority="accuracy",
    target_error_rate=0.01
)
```

### Token Efficiency

Optimizes for minimal token usage while maintaining functionality.

**Configuration Changes:**
- Enables concise response mode
- Implements aggressive operation batching
- Reduces explanatory text
- Optimizes prompt templates
- Uses efficient tool selection

**Example:**
```python
targets = PerformanceTargets(
    priority="tokens",
    target_token_usage=500
)
```

### Memory Optimization

Minimizes memory usage through efficient resource management.

**Configuration Changes:**
- Enables memory monitoring
- Implements streaming for large data
- Reduces agent count
- Uses memory-efficient algorithms
- Implements garbage collection optimizations

**Example:**
```python
targets = PerformanceTargets(
    priority="memory",
    target_memory_usage=1024.0
)
```

## Benchmarking

### Running Benchmarks

```python
# Define test tasks
test_tasks = [
    "Create API endpoint with validation",
    "Add comprehensive error handling",
    "Write unit tests",
    "Generate documentation"
]

# Run benchmark
metrics = await optimizer.benchmark_config_effectiveness(
    claude_md_content=config,
    test_tasks=test_tasks,
    iterations=5
)

print(f"Optimization Score: {metrics.optimization_score}")
print(f"Completion Rate: {metrics.completion_rate}")
print(f"Avg Execution Time: {metrics.avg_execution_time}s")
```

### Metrics Interpretation

**Optimization Score (0.0 - 1.0):**
- 0.9-1.0: Excellent optimization
- 0.7-0.9: Good optimization  
- 0.5-0.7: Fair optimization
- <0.5: Poor optimization, needs improvement

**Completion Rate (0.0 - 1.0):**
- 1.0: All tasks completed successfully
- 0.9+: High reliability
- <0.9: May need accuracy improvements

**Token Efficiency:**
- <500 tokens/task: Very efficient
- 500-1000 tokens/task: Good efficiency
- >1000 tokens/task: May need optimization

### Performance Analysis

```python
# Get optimization suggestions
suggestions = optimizer.get_optimization_suggestions(metrics, targets)

for suggestion in suggestions:
    print(f"Suggestion: {suggestion}")

# Export benchmark history
optimizer.export_benchmark_history("benchmark_history.json")
```

## Advanced Features

### Custom Templates

Create custom use case templates:

```python
from swarm_benchmark.claude_optimizer import TemplateEngine

template_engine = TemplateEngine()

custom_config = {
    "use_case": "custom_development",
    "focus_areas": ["Custom area 1", "Custom area 2"],
    "preferred_agents": ["custom-agent", "tester"],
    "critical_rules": ["Custom rule 1", "Custom rule 2"]
}

claude_md = template_engine.generate_claude_md(custom_config)
```

### Custom Optimization Rules

```python
from swarm_benchmark.claude_optimizer import OptimizationRule

custom_rules = [
    OptimizationRule(
        name="custom_speed_rule",
        description="Custom speed optimization",
        condition="performance_priority == 'speed'",
        action="enable_custom_optimization",
        priority=10,
        impact="high"
    )
]

rules_engine = OptimizationRulesEngine()
optimized_config = rules_engine.apply_custom_rules(config, custom_rules)
```

### Configuration Caching

The optimizer automatically caches generated configurations:

```python
# Cache is automatically used for identical requests
config1 = optimizer.generate_optimized_config(use_case, context, targets)
config2 = optimizer.generate_optimized_config(use_case, context, targets)  # Uses cache

# Clear cache if needed
optimizer.optimization_cache.clear()
```

## Best Practices

### 1. Choose the Right Use Case

Select the use case that best matches your primary development focus:

- **API Development**: For REST/GraphQL APIs
- **ML Pipeline**: For machine learning projects
- **Frontend React**: For React-based frontends
- **Backend Microservices**: For distributed backend systems

### 2. Provide Accurate Context

Be specific about your project context:

```python
# Good - Specific and detailed
context = ProjectContext(
    project_type="e_commerce_api",
    team_size=6,
    complexity="complex",
    primary_languages=["Python", "TypeScript"],
    frameworks=["FastAPI", "React", "PostgreSQL"],
    performance_requirements={
        "response_time": "<50ms",
        "throughput": ">1000 rps",
        "availability": "99.9%"
    },
    existing_tools=["pytest", "docker", "k8s"],
    constraints={"budget": "medium", "timeline": "6 months"}
)

# Avoid - Too generic
context = ProjectContext(
    project_type="web_app",
    team_size=5,
    complexity="medium",
    primary_languages=["Python"],
    frameworks=[],
    performance_requirements={},
    existing_tools=[],
    constraints={}
)
```

### 3. Set Realistic Targets

Define achievable performance targets:

```python
# Realistic targets
targets = PerformanceTargets(
    priority="speed",
    target_completion_time=60.0,    # 1 minute for complex tasks
    target_token_usage=800,         # Reasonable token budget
    target_memory_usage=2048.0,     # 2GB memory limit
    target_error_rate=0.05          # 5% error tolerance
)
```

### 4. Iterate and Refine

Use benchmark results to improve configurations:

```python
# Initial optimization
config_v1 = optimizer.generate_optimized_config(use_case, context, targets)
metrics_v1 = await optimizer.benchmark_config_effectiveness(config_v1, tasks)

# Refine based on results
if metrics_v1.optimization_score < 0.8:
    # Adjust targets or context
    targets.priority = "accuracy"  # Focus on accuracy instead of speed
    config_v2 = optimizer.generate_optimized_config(use_case, context, targets)
```

### 5. Monitor Performance

Track optimization effectiveness over time:

```python
# Regular benchmarking
monthly_metrics = []
for month in range(6):
    metrics = await optimizer.benchmark_config_effectiveness(config, tasks)
    monthly_metrics.append(metrics)
    
# Analyze trends
avg_score = sum(m.optimization_score for m in monthly_metrics) / len(monthly_metrics)
print(f"Average optimization score: {avg_score}")
```

## Configuration Examples

### High-Performance API

```python
# Configuration for high-performance API development
optimizer = ClaudeMdOptimizer()

context = ProjectContext(
    project_type="high_performance_api",
    team_size=8,
    complexity="complex",
    primary_languages=["Go", "Python"],
    frameworks=["Gin", "FastAPI", "Redis", "PostgreSQL"],
    performance_requirements={
        "response_time": "<10ms",
        "throughput": ">10000 rps",
        "availability": "99.99%"
    },
    existing_tools=["k6", "prometheus", "grafana", "docker", "kubernetes"],
    constraints={"timeline": "aggressive", "budget": "high"}
)

targets = PerformanceTargets(
    priority="speed",
    target_completion_time=45.0,
    target_token_usage=600,
    target_memory_usage=4096.0,
    target_error_rate=0.001
)

config = optimizer.generate_optimized_config("api_development", context, targets)
```

### Machine Learning Research

```python
# Configuration for ML research project
context = ProjectContext(
    project_type="ml_research",
    team_size=4,
    complexity="complex",
    primary_languages=["Python", "R"],
    frameworks=["PyTorch", "scikit-learn", "pandas", "numpy"],
    performance_requirements={
        "model_accuracy": ">95%",
        "training_time": "<2hours",
        "reproducibility": "100%"
    },
    existing_tools=["jupyter", "mlflow", "wandb", "docker"],
    constraints={"compute_budget": "limited", "timeline": "research"}
)

targets = PerformanceTargets(
    priority="accuracy",
    target_completion_time=120.0,
    target_error_rate=0.001
)

config = optimizer.generate_optimized_config("ml_pipeline", context, targets)
```

## Troubleshooting

### Common Issues

#### Low Optimization Score

**Symptoms:**
- Optimization score < 0.5
- High error rates
- Slow execution times

**Solutions:**
1. Verify use case matches project type
2. Check context accuracy
3. Adjust performance targets
4. Review benchmark tasks

```python
# Debug low scores
if metrics.optimization_score < 0.5:
    print("Debugging low optimization score...")
    print(f"Completion rate: {metrics.completion_rate}")
    print(f"Error rate: {metrics.error_rate}")
    print(f"Execution time: {metrics.avg_execution_time}")
    
    # Get suggestions for improvement
    suggestions = optimizer.get_optimization_suggestions(metrics, targets)
    for suggestion in suggestions:
        print(f"Try: {suggestion}")
```

#### High Token Usage

**Symptoms:**
- Token usage > targets
- Slow response times
- Budget concerns

**Solutions:**
1. Set priority to "tokens"
2. Enable concise mode
3. Reduce agent count
4. Optimize prompt templates

```python
# Optimize for tokens
targets.priority = "tokens"
targets.target_token_usage = 400

config = optimizer.generate_optimized_config(use_case, context, targets)
```

#### Memory Issues

**Symptoms:**
- High memory usage
- System slowdowns
- Out of memory errors

**Solutions:**
1. Set priority to "memory"
2. Reduce agent count
3. Enable streaming mode
4. Implement garbage collection

```python
# Optimize for memory
targets.priority = "memory"
targets.target_memory_usage = 1024.0

# Reduce complexity if needed
context.complexity = "medium"  # Instead of "complex"
```

### Getting Help

1. **Check logs**: Enable debug logging for detailed information
2. **Review documentation**: API reference and examples
3. **Benchmark analysis**: Use metrics to identify issues
4. **Community support**: GitHub issues and discussions

```python
# Enable debug logging
import logging
logging.basicConfig(level=logging.DEBUG)

# Export detailed metrics for analysis
optimizer.export_benchmark_history("debug_metrics.json")
```

This guide provides comprehensive information for using the CLAUDE.md optimizer effectively. For additional examples and advanced usage patterns, refer to the examples directory and API reference documentation.