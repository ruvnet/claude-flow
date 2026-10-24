# Claude-Flow Integration Guide

This guide explains how to use the claude-flow integration layer for benchmark testing and automation.

## Overview

The integration layer provides a robust Python interface to execute claude-flow commands with:

- **Command Construction**: Build valid claude-flow commands with proper validation
- **Subprocess Execution**: Execute commands with timeout and error handling
- **Output Capture**: Comprehensive capture and parsing of command output
- **Performance Monitoring**: Track CPU, memory, disk, and network usage
- **Error Handling**: Categorize errors and provide recovery suggestions
- **Retry Logic**: Automatic retry for transient failures

## Installation

The integration layer is part of the benchmark suite. Ensure you have:

```bash
# Claude-flow installed and accessible
claude-flow --version

# Python dependencies
pip install psutil
```

## Core Components

### 1. ClaudeFlowExecutor

The main executor class for running claude-flow commands:

```python
from swarm_benchmark.core.claude_flow_executor import (
    ClaudeFlowExecutor, SwarmConfig, SparcConfig,
    ExecutionStrategy, CoordinationMode, SparcMode
)

# Initialize executor
executor = ClaudeFlowExecutor(
    claude_flow_path=None,  # Auto-detect
    working_dir=None,       # Use current directory
    retry_attempts=3,       # Retry failed commands
    retry_delay=2.0        # Seconds between retries
)

# Validate installation
if executor.validate_installation():
    print("Claude-flow is ready!")
```

### 2. Swarm Execution

Execute swarm commands with full configuration:

```python
# Configure swarm
config = SwarmConfig(
    objective="Build a REST API with authentication",
    strategy=ExecutionStrategy.DEVELOPMENT,
    mode=CoordinationMode.HIERARCHICAL,
    max_agents=8,
    timeout=30,  # minutes
    parallel=True,
    monitor=True,
    output=OutputFormat.JSON,
    output_dir="./reports",
    
    # Advanced options
    batch_optimized=True,
    memory_shared=True,
    file_ops_parallel=True
)

# Execute
result = executor.execute_swarm(config)

# Check results
if result.success:
    print(f"Success! Duration: {result.duration}s")
    print(f"Output files: {result.output_files}")
    print(f"Metrics: {result.metrics}")
else:
    print(f"Failed: {result.stderr}")
```

### 3. SPARC Execution

Execute SPARC commands with different modes:

```python
# Configure SPARC
config = SparcConfig(
    prompt="Optimize database queries for performance",
    mode=SparcMode.OPTIMIZER,
    memory_key="db_optimization",
    parallel=True,
    batch=True,
    timeout=15  # minutes
)

# Execute
result = executor.execute_sparc(config)
```

### 4. Output Parsing

Parse and extract structured information from output:

```python
from swarm_benchmark.core.integration_utils import OutputParser

# Parse command output
parsed = OutputParser.parse_output(result.stdout)

# Access parsed data
print(f"Tasks created: {parsed['tasks']['created']}")
print(f"Agents used: {parsed['agents']['started']}")
print(f"Errors: {parsed['errors']}")
print(f"Test coverage: {parsed['tests']['coverage']}%")

# Extract JSON blocks
json_blocks = OutputParser.extract_json_blocks(result.stdout)
```

### 5. Performance Monitoring

Monitor system resources during execution:

```python
from swarm_benchmark.core.integration_utils import performance_monitoring

# Monitor performance
with performance_monitoring(interval=1.0) as monitor:
    result = executor.execute_swarm(config)
    
# Get metrics
metrics = monitor.metrics.get_summary()
print(f"Average CPU: {metrics['cpu']['avg']}%")
print(f"Peak Memory: {metrics['memory']['max']}%")
print(f"Total disk write: {metrics['disk_io']['write_total']} bytes")
```

### 6. Error Handling

Handle and categorize errors intelligently:

```python
from swarm_benchmark.core.integration_utils import ErrorHandler

if not result.success:
    # Categorize error
    category = ErrorHandler.categorize_error(result.stderr)
    suggestion = ErrorHandler.get_recovery_suggestion(category)
    should_retry = ErrorHandler.should_retry(category)
    
    print(f"Error category: {category}")
    print(f"Suggestion: {suggestion}")
    
    if should_retry:
        # Retry with different configuration
        config.timeout *= 2
        result = executor.execute_swarm(config)
```

## Usage Patterns

### Basic Swarm Execution

```python
# Simple development swarm
config = SwarmConfig(
    objective="Create a TODO app with React",
    strategy=ExecutionStrategy.DEVELOPMENT,
    max_agents=5
)
result = executor.execute_swarm(config)
```

### Research Swarm with Parallel Execution

```python
# Research swarm with advanced features
config = SwarmConfig(
    objective="Research microservices best practices",
    strategy=ExecutionStrategy.RESEARCH,
    mode=CoordinationMode.DISTRIBUTED,
    max_agents=10,
    parallel=True,
    batch_optimized=True,
    memory_shared=True
)
result = executor.execute_swarm(config)
```

### Testing Swarm with Coverage

```python
# Comprehensive testing
config = SwarmConfig(
    objective="Run full test suite with coverage",
    strategy=ExecutionStrategy.TESTING,
    mode=CoordinationMode.DISTRIBUTED,
    max_agents=12,
    parallel=True,
    test_types=["unit", "integration", "e2e"],
    coverage_target=90,
    file_ops_parallel=True
)
result = executor.execute_swarm(config)
```

### SPARC Mode Execution

```python
# Different SPARC modes
modes = [
    (SparcMode.TDD, "Create tests for user service"),
    (SparcMode.CODER, "Implement user authentication"),
    (SparcMode.REVIEWER, "Review security implementation"),
    (SparcMode.OPTIMIZER, "Optimize query performance"),
    (SparcMode.DOCUMENTER, "Generate API documentation")
]

for mode, prompt in modes:
    config = SparcConfig(prompt=prompt, mode=mode)
    result = executor.execute_sparc(config)
```

### Memory Operations

```python
# Store results in memory
data = {"benchmark": "results", "score": 95}
executor.execute_memory_store("benchmark_key", data)

# Retrieve from memory
result, data = executor.execute_memory_get("benchmark_key")
```

## Advanced Features

### Async Execution

```python
import asyncio

async def run_multiple_swarms():
    configs = [
        SwarmConfig(objective="Task 1", strategy=ExecutionStrategy.DEVELOPMENT),
        SwarmConfig(objective="Task 2", strategy=ExecutionStrategy.TESTING),
        SwarmConfig(objective="Task 3", strategy=ExecutionStrategy.ANALYSIS)
    ]
    
    # Execute in parallel
    tasks = [
        executor.execute_async("swarm", config) 
        for config in configs
    ]
    results = await asyncio.gather(*tasks)
    return results
```

### Progress Tracking

```python
from swarm_benchmark.core.integration_utils import ProgressTracker

tracker = ProgressTracker()
tracker.start()

# Parse output stream
for line in result.stdout.splitlines():
    tracker.parse_output_stream(line)
    
# Get summary
summary = tracker.get_summary()
print(f"Tasks completed: {summary['tasks']['completed']}")
```

### Command Validation

```python
from swarm_benchmark.core.integration_utils import CommandBuilder

# Validate configuration
config_dict = {
    "objective": "Build API",
    "strategy": "development",
    "max_agents": 5
}

errors = CommandBuilder.validate_swarm_config(config_dict)
if errors:
    print(f"Configuration errors: {errors}")
```

## Best Practices

1. **Always validate installation** before running commands
2. **Use dry_run=True** for testing configurations
3. **Set appropriate timeouts** based on task complexity
4. **Enable performance monitoring** for resource-intensive tasks
5. **Parse output** to extract meaningful metrics
6. **Handle errors gracefully** with retry logic
7. **Use memory** for cross-agent coordination
8. **Monitor progress** for long-running tasks

## Error Recovery

The integration layer provides automatic error recovery:

```python
# Configure with retry
executor = ClaudeFlowExecutor(
    retry_attempts=5,
    retry_delay=3.0
)

# Errors are automatically retried for:
# - Network failures
# - Timeouts
# - Resource exhaustion

# Manual retry logic
max_attempts = 3
for attempt in range(max_attempts):
    result = executor.execute_swarm(config)
    if result.success:
        break
    
    if not ErrorHandler.should_retry(
        ErrorHandler.categorize_error(result.stderr)
    ):
        break
        
    # Increase timeout for next attempt
    config.timeout *= 1.5
```

## Troubleshooting

### Command Not Found

```python
# Specify explicit path
executor = ClaudeFlowExecutor(
    claude_flow_path="/path/to/claude-flow"
)
```

### Timeout Issues

```python
# Increase timeout
config.timeout = 120  # 2 hours

# Or disable timeout
result = executor._execute_command(
    command, 
    timeout=None
)
```

### Output Too Large

```python
# Use output files instead
config.output = OutputFormat.JSON
config.output_dir = "./large_output"

# Files will be in result.output_files
```

## Example Scripts

See the following example scripts:

- `example_usage.py` - Comprehensive examples
- `test_integration.py` - Integration test suite
- `quick_test_integration.py` - Quick validation test

## Integration with Benchmarks

The integration layer is designed to work seamlessly with the benchmark system:

```python
from swarm_benchmark.core.benchmark_runner import BenchmarkRunner
from swarm_benchmark.core.claude_flow_executor import ClaudeFlowExecutor

# Use executor within benchmarks
class MyBenchmark:
    def __init__(self):
        self.executor = ClaudeFlowExecutor()
        
    def run_test(self):
        config = SwarmConfig(...)
        result = self.executor.execute_swarm(config)
        return result.metrics
```