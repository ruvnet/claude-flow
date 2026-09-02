# API Reference - Claude Flow Benchmark System

## Overview
This document provides comprehensive API documentation for the Claude Flow Benchmark System, including the new CLAUDE.md optimizer, MLE-STAR integration, and advanced metrics collection.

## Module Structure

### Core Modules
- `swarm_benchmark.core` - Core benchmarking functionality
- `swarm_benchmark.claude_optimizer` - CLAUDE.md configuration optimization
- `swarm_benchmark.mle_star` - MLE-STAR ensemble learning integration
- `swarm_benchmark.automation` - Non-interactive automation systems
- `swarm_benchmark.advanced_metrics` - Advanced performance metrics
- `swarm_benchmark.collective` - Collective intelligence benchmarking

## CLAUDE.md Optimizer API

### ClaudeMdOptimizer

The main class for generating optimized CLAUDE.md configurations.

```python
from swarm_benchmark.claude_optimizer import ClaudeMdOptimizer
```

#### Constructor

```python
ClaudeMdOptimizer()
```

Creates a new optimizer instance with all use case templates and optimization rules loaded.

#### Methods

##### generate_optimized_config

```python
generate_optimized_config(
    use_case: str,
    project_context: ProjectContext, 
    performance_targets: PerformanceTargets
) -> str
```

Generate an optimized CLAUDE.md configuration for a specific use case.

**Parameters:**
- `use_case` (str): Type of development project
  - Supported values: `"api_development"`, `"ml_pipeline"`, `"frontend_react"`, `"backend_microservices"`, `"data_pipeline"`, `"devops_automation"`, `"mobile_development"`, `"testing_automation"`, `"documentation"`, `"performance_optimization"`
- `project_context` (ProjectContext): Project-specific information
- `performance_targets` (PerformanceTargets): Performance optimization goals

**Returns:**
- `str`: Complete optimized CLAUDE.md configuration content

**Raises:**
- `ValueError`: If use_case is not supported
- `RuntimeError`: If optimization fails

**Example:**
```python
from swarm_benchmark.claude_optimizer import ClaudeMdOptimizer, ProjectContext, PerformanceTargets

optimizer = ClaudeMdOptimizer()

context = ProjectContext(
    project_type="web_api",
    team_size=5,
    complexity="medium",
    primary_languages=["Python", "JavaScript"],
    frameworks=["FastAPI", "React"],
    performance_requirements={"response_time": "<100ms"},
    existing_tools=["pytest", "docker"],
    constraints={"budget": "medium"}
)

targets = PerformanceTargets(
    priority="speed",
    target_completion_time=30.0,
    target_token_usage=500,
    target_memory_usage=1024.0,
    target_error_rate=0.01
)

config = optimizer.generate_optimized_config("api_development", context, targets)
print(config)
```

##### benchmark_config_effectiveness

```python
async benchmark_config_effectiveness(
    claude_md_content: str,
    test_tasks: List[str],
    iterations: int = 3
) -> BenchmarkMetrics
```

Benchmark the effectiveness of a CLAUDE.md configuration.

**Parameters:**
- `claude_md_content` (str): The CLAUDE.md configuration to test
- `test_tasks` (List[str]): List of tasks to run for benchmarking
- `iterations` (int, optional): Number of benchmark iterations. Default: 3

**Returns:**
- `BenchmarkMetrics`: Comprehensive performance metrics

**Example:**
```python
tasks = [
    "Create a REST API endpoint",
    "Add input validation", 
    "Write unit tests",
    "Generate documentation"
]

metrics = await optimizer.benchmark_config_effectiveness(config, tasks, iterations=5)
print(f"Optimization score: {metrics.optimization_score}")
print(f"Completion rate: {metrics.completion_rate}")
```

##### get_optimization_suggestions

```python
get_optimization_suggestions(
    current_metrics: BenchmarkMetrics,
    target_metrics: PerformanceTargets
) -> List[str]
```

Generate optimization suggestions based on current performance.

**Parameters:**
- `current_metrics` (BenchmarkMetrics): Current performance metrics
- `target_metrics` (PerformanceTargets): Desired performance targets

**Returns:**
- `List[str]`: List of specific optimization suggestions

### Data Classes

#### ProjectContext

```python
@dataclass
class ProjectContext:
    project_type: str
    team_size: int
    complexity: str  # "simple", "medium", "complex"
    primary_languages: List[str]
    frameworks: List[str]
    performance_requirements: Dict[str, Any]
    existing_tools: List[str]
    constraints: Dict[str, Any]
```

#### PerformanceTargets

```python
@dataclass
class PerformanceTargets:
    priority: str  # "speed", "accuracy", "tokens", "memory"
    target_completion_time: Optional[float] = None
    target_token_usage: Optional[int] = None
    target_memory_usage: Optional[float] = None
    target_error_rate: Optional[float] = None
```

#### BenchmarkMetrics

```python
@dataclass
class BenchmarkMetrics:
    completion_rate: float = 0.0
    avg_tokens_per_task: int = 0
    avg_execution_time: float = 0.0
    error_rate: float = 0.0
    peak_memory_mb: float = 0.0
    optimization_score: float = 0.0
    cache_hit_rate: float = 0.0
    parallel_efficiency: float = 0.0
```

### TemplateEngine

Generates CLAUDE.md files from configuration dictionaries.

```python
from swarm_benchmark.claude_optimizer import TemplateEngine
```

#### Methods

##### generate_claude_md

```python
generate_claude_md(config: Dict[str, Any]) -> str
```

Generate a complete CLAUDE.md file from configuration.

**Parameters:**
- `config` (Dict[str, Any]): Configuration dictionary containing all settings

**Returns:**
- `str`: Complete CLAUDE.md content as string

**Example:**
```python
template_engine = TemplateEngine()

config = {
    "use_case": "api_development",
    "max_agents": 5,
    "swarm_topology": "hierarchical",
    "preferred_agents": ["backend-dev", "api-docs", "tester"],
    "critical_rules": ["Always validate input parameters", "Batch operations"]
}

claude_md = template_engine.generate_claude_md(config)
```

### OptimizationRulesEngine

Apply optimization rules to CLAUDE.md configurations.

```python
from swarm_benchmark.claude_optimizer import OptimizationRulesEngine
```

#### Methods

##### optimize_for_speed

```python
optimize_for_speed(config: Dict) -> Dict
```

Optimize configuration for maximum execution speed.

**Parameters:**
- `config` (Dict): Base configuration dictionary

**Returns:**
- `Dict`: Speed-optimized configuration

##### optimize_for_accuracy

```python
optimize_for_accuracy(config: Dict) -> Dict
```

Optimize configuration for maximum accuracy and correctness.

##### optimize_for_tokens

```python
optimize_for_tokens(config: Dict) -> Dict
```

Optimize configuration for token efficiency.

##### optimize_for_memory

```python
optimize_for_memory(config: Dict) -> Dict
```

Optimize configuration for memory efficiency.

## Core Benchmark Engine API

### BenchmarkEngine

Main engine for running benchmark tests.

```python
from swarm_benchmark.core import BenchmarkEngine
```

#### Constructor

```python
BenchmarkEngine(
    strategy_name: str = "development",
    mode_name: str = "hierarchical",
    config: Optional[Dict] = None
)
```

#### Methods

##### run_benchmark

```python
async run_benchmark(
    task: str,
    num_agents: int = 4,
    iterations: int = 1,
    enable_metrics: bool = True
) -> BenchmarkResult
```

Run a complete benchmark test.

**Parameters:**
- `task` (str): Description of the task to benchmark
- `num_agents` (int): Number of agents to use
- `iterations` (int): Number of iterations to run
- `enable_metrics` (bool): Whether to collect detailed metrics

**Returns:**
- `BenchmarkResult`: Complete benchmark results

## MLE-STAR Integration API

### MLEStarEnsembleExecutor

Execute MLE-STAR ensemble benchmarks with multiple models.

```python
from swarm_benchmark.mle_star import MLEStarEnsembleExecutor
```

#### Constructor

```python
MLEStarEnsembleExecutor(config: MLEStarConfig)
```

#### Methods

##### execute_ensemble_benchmark

```python
async execute_ensemble_benchmark(
    task: str,
    dataset: Any
) -> BenchmarkResult
```

Execute a complete ensemble benchmark.

## Advanced Metrics API

### TokenOptimizationTracker

Track and optimize token usage across benchmark runs.

```python
from swarm_benchmark.advanced_metrics import TokenOptimizationTracker
```

#### Methods

##### measure_token_usage

```python
measure_token_usage(
    task: str,
    execution_log: ExecutionLog
) -> TokenMetrics
```

Measure token usage for a task execution.

### MemoryPersistenceProfiler

Profile memory persistence overhead and optimization.

```python
from swarm_benchmark.advanced_metrics import MemoryPersistenceProfiler
```

#### Methods

##### profile_memory_persistence

```python
async profile_memory_persistence(swarm_id: str) -> MemoryProfile
```

Profile memory persistence for a swarm.

## CLI API

### Command Line Interface

The benchmark system provides a comprehensive CLI for running benchmarks and optimizations.

#### Basic Usage

```bash
# Run a basic benchmark
python -m swarm_benchmark benchmark --task "Create API" --strategy development

# Generate optimized CLAUDE.md
python -m swarm_benchmark optimize --use-case api_development --output claude.md

# Run performance analysis
python -m swarm_benchmark analyze --config-file claude.md --tasks tasks.txt
```

#### Available Commands

##### benchmark

```bash
python -m swarm_benchmark benchmark [OPTIONS]
```

**Options:**
- `--task TEXT`: Task description to benchmark
- `--strategy CHOICE`: Strategy to use (development, testing, optimization, etc.)
- `--mode CHOICE`: Coordination mode (hierarchical, mesh, distributed, etc.)
- `--agents INTEGER`: Number of agents to use
- `--iterations INTEGER`: Number of iterations to run
- `--output PATH`: Output file for results

##### optimize

```bash
python -m swarm_benchmark optimize [OPTIONS]
```

**Options:**
- `--use-case CHOICE`: Use case to optimize for
- `--team-size INTEGER`: Team size
- `--complexity CHOICE`: Project complexity level
- `--priority CHOICE`: Optimization priority (speed, accuracy, tokens, memory)
- `--output PATH`: Output file for optimized CLAUDE.md

##### analyze

```bash
python -m swarm_benchmark analyze [OPTIONS]
```

**Options:**
- `--config-file PATH`: CLAUDE.md configuration file
- `--tasks PATH`: File containing test tasks
- `--iterations INTEGER`: Number of benchmark iterations
- `--report-format CHOICE`: Output report format (json, html, markdown)

## Error Handling

### Exception Classes

#### BenchmarkError

Base exception class for benchmark-related errors.

```python
class BenchmarkError(Exception):
    """Base exception for benchmark errors."""
    pass
```

#### OptimizationError

Exception raised during configuration optimization.

```python
class OptimizationError(BenchmarkError):
    """Exception raised during configuration optimization."""
    pass
```

#### ConfigurationError

Exception raised for invalid configuration.

```python
class ConfigurationError(BenchmarkError):
    """Exception raised for invalid configuration."""
    pass
```

## Configuration Reference

### Environment Variables

- `CLAUDE_FLOW_LOG_LEVEL`: Logging level (DEBUG, INFO, WARNING, ERROR)
- `CLAUDE_FLOW_CONFIG_PATH`: Path to configuration file
- `CLAUDE_FLOW_CACHE_DIR`: Directory for caching optimization results

### Configuration File Format

The system supports YAML and JSON configuration files:

```yaml
# benchmark_config.yaml
benchmark:
  default_strategy: "development" 
  default_mode: "hierarchical"
  default_agents: 4
  enable_metrics: true

optimization:
  cache_enabled: true
  cache_ttl: 3600
  max_cache_size: 1000

logging:
  level: "INFO"
  format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
```

## Examples

### Complete Optimization Workflow

```python
import asyncio
from swarm_benchmark.claude_optimizer import (
    ClaudeMdOptimizer, 
    ProjectContext, 
    PerformanceTargets
)

async def optimize_for_project():
    # Initialize optimizer
    optimizer = ClaudeMdOptimizer()
    
    # Define project context
    context = ProjectContext(
        project_type="microservice_api",
        team_size=8,
        complexity="complex",
        primary_languages=["Python", "Go"],
        frameworks=["FastAPI", "Gin", "Docker"],
        performance_requirements={
            "response_time": "<50ms",
            "throughput": ">1000 rps",
            "availability": "99.9%"
        },
        existing_tools=["pytest", "k6", "prometheus"],
        constraints={"budget": "high", "timeline": "aggressive"}
    )
    
    # Define performance targets
    targets = PerformanceTargets(
        priority="speed",
        target_completion_time=60.0,
        target_token_usage=800,
        target_memory_usage=2048.0,
        target_error_rate=0.005
    )
    
    # Generate optimized configuration
    config = optimizer.generate_optimized_config(
        "backend_microservices", 
        context, 
        targets
    )
    
    # Save to file
    with open("optimized_claude.md", "w") as f:
        f.write(config)
    
    # Benchmark the configuration
    test_tasks = [
        "Design microservice architecture",
        "Implement API endpoints with validation",
        "Add comprehensive error handling", 
        "Write unit and integration tests",
        "Set up monitoring and logging",
        "Deploy with Docker containers"
    ]
    
    metrics = await optimizer.benchmark_config_effectiveness(
        config, 
        test_tasks, 
        iterations=5
    )
    
    print(f"Configuration Performance:")
    print(f"  Optimization Score: {metrics.optimization_score:.3f}")
    print(f"  Completion Rate: {metrics.completion_rate:.1%}")
    print(f"  Avg Execution Time: {metrics.avg_execution_time:.2f}s")
    print(f"  Token Efficiency: {metrics.avg_tokens_per_task} tokens/task")
    
    # Get optimization suggestions
    suggestions = optimizer.get_optimization_suggestions(metrics, targets)
    
    if suggestions:
        print("\nOptimization Suggestions:")
        for suggestion in suggestions:
            print(f"  - {suggestion}")

# Run the optimization
asyncio.run(optimize_for_project())
```

This API reference provides comprehensive documentation for using the Claude Flow Benchmark System's optimization and benchmarking capabilities. For additional examples and advanced usage patterns, see the examples directory and user guides.