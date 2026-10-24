# Real Claude-Flow Benchmark Quick Start Guide

## Overview

The Real Benchmark Engine executes actual `claude-flow` commands and captures comprehensive performance metrics, resource usage, and quality assessments. This guide helps you get started quickly.

## Installation

1. Ensure `claude-flow` is installed and accessible:
```bash
which claude-flow
# or
claude-flow --version
```

2. Install benchmark dependencies:
```bash
cd benchmark
pip install -r requirements.txt
pip install -e .
```

## Basic Usage

### 1. Simple Benchmark

Run a basic benchmark with default settings:

```bash
python -m swarm_benchmark real "Create a hello world function"
```

### 2. Test Specific SPARC Mode

Test a specific SPARC mode:

```bash
python -m swarm_benchmark real "Build a REST API" --sparc-mode coder
python -m swarm_benchmark real "Analyze code quality" --sparc-mode analyzer
python -m swarm_benchmark real "Design system architecture" --sparc-mode architect
```

### 3. Test Swarm Strategies

Test different swarm strategies with coordination modes:

```bash
# Development strategy with hierarchical coordination
python -m swarm_benchmark real "Build a web app" \
  --strategy development \
  --mode hierarchical

# Research strategy with distributed coordination
python -m swarm_benchmark real "Research AI trends" \
  --strategy research \
  --mode distributed \
  --parallel

# Analysis strategy with mesh coordination
python -m swarm_benchmark real "Analyze codebase" \
  --strategy analysis \
  --mode mesh \
  --monitor
```

### 4. Parallel Execution

Enable parallel task execution for faster benchmarking:

```bash
python -m swarm_benchmark real "Create multiple components" \
  --parallel \
  --max-agents 4 \
  --task-timeout 60
```

### 5. Resource Monitoring

Enable detailed resource monitoring:

```bash
python -m swarm_benchmark real "Process large dataset" \
  --monitor \
  --output json sqlite \
  --output-dir ./benchmark-results
```

### 6. Comprehensive Testing

Test all SPARC modes and swarm strategies:

```bash
# WARNING: This is resource-intensive and may take a long time!
python -m swarm_benchmark real "Build a complete application" \
  --all-modes \
  --parallel \
  --timeout 120
```

## Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--strategy` | Swarm strategy (auto, research, development, etc.) | auto |
| `--mode` | Coordination mode (centralized, distributed, etc.) | centralized |
| `--sparc-mode` | Specific SPARC mode to test | None |
| `--all-modes` | Test all SPARC modes and strategies | False |
| `--max-agents` | Maximum parallel agents | 5 |
| `--timeout` | Overall timeout in minutes | 60 |
| `--task-timeout` | Individual task timeout in seconds | 300 |
| `--parallel` | Enable parallel execution | False |
| `--monitor` | Enable resource monitoring | False |
| `--output` | Output formats (json, sqlite) | json |
| `--output-dir` | Output directory | ./reports |
| `--verbose` | Enable verbose output | False |

## Examples

### Example 1: Quick SPARC Mode Comparison

```bash
#!/bin/bash
# compare_sparc_modes.sh

OBJECTIVE="Create a user authentication system"

for mode in coder architect reviewer tdd; do
    echo "Testing SPARC mode: $mode"
    python -m swarm_benchmark real "$OBJECTIVE" \
        --sparc-mode $mode \
        --output-dir ./sparc-comparison
done
```

### Example 2: Strategy Performance Analysis

```bash
#!/bin/bash
# analyze_strategies.sh

OBJECTIVE="Build a data processing pipeline"

for strategy in development research analysis optimization; do
    for mode in centralized distributed hierarchical; do
        echo "Testing $strategy with $mode coordination"
        python -m swarm_benchmark real "$OBJECTIVE" \
            --strategy $strategy \
            --mode $mode \
            --parallel \
            --monitor \
            --output json sqlite
    done
done
```

### Example 3: Resource Usage Profiling

```python
#!/usr/bin/env python3
# profile_resources.py

import asyncio
from swarm_benchmark.core.real_benchmark_engine import RealBenchmarkEngine
from swarm_benchmark.core.models import BenchmarkConfig, StrategyType

async def profile_task():
    config = BenchmarkConfig(
        name="resource-profile",
        monitoring=True,
        parallel=True,
        max_agents=3
    )
    
    engine = RealBenchmarkEngine(config)
    result = await engine.run_benchmark("Analyze system performance")
    
    # Extract resource metrics
    if result['results']:
        metrics = result['results'][0]['resource_usage']
        print(f"Peak Memory: {metrics['peak_memory_mb']:.1f} MB")
        print(f"Average CPU: {metrics['average_cpu_percent']:.1f}%")

asyncio.run(profile_task())
```

## Output Analysis

### JSON Output Structure

```json
{
  "benchmark_id": "uuid",
  "status": "success",
  "duration": 45.2,
  "results": [{
    "task_id": "uuid",
    "status": "success",
    "execution_time": 42.1,
    "resource_usage": {
      "cpu_percent": 35.2,
      "memory_mb": 128.5,
      "peak_memory_mb": 256.0
    },
    "quality_metrics": {
      "accuracy": 0.9,
      "completeness": 0.85,
      "overall": 0.88
    }
  }]
}
```

### Analyzing Results

1. **Performance Metrics**
   - Execution time comparison
   - Resource utilization patterns
   - Parallelization efficiency

2. **Quality Assessment**
   - Output completeness
   - Task accuracy
   - Consistency across runs

3. **Resource Usage**
   - CPU utilization trends
   - Memory consumption patterns
   - I/O operation statistics

## Best Practices

1. **Start Small**
   - Test individual SPARC modes first
   - Use shorter timeouts initially
   - Monitor resource usage

2. **Scale Gradually**
   - Increase parallel agents incrementally
   - Test complex strategies after simple ones
   - Use comprehensive mode sparingly

3. **Monitor Resources**
   - Always enable monitoring for long runs
   - Set appropriate resource limits
   - Watch for memory leaks

4. **Analyze Results**
   - Compare across multiple runs
   - Look for performance patterns
   - Identify bottlenecks

## Troubleshooting

### Issue: claude-flow not found
```bash
# Check installation
which claude-flow

# Add to PATH if needed
export PATH="$PATH:/path/to/claude-flow"
```

### Issue: Timeout errors
```bash
# Increase timeout
python -m swarm_benchmark real "Complex task" \
  --task-timeout 600 \
  --timeout 120
```

### Issue: Resource exhaustion
```bash
# Limit parallel execution
python -m swarm_benchmark real "Heavy task" \
  --max-agents 2 \
  --monitor
```

## Advanced Usage

For advanced usage patterns and comprehensive examples, see:
- [Real Benchmark Architecture](./real-benchmark-architecture.md)
- [Examples Directory](../examples/)
- [API Documentation](./api-reference.md)

## Next Steps

1. Run your first benchmark
2. Compare different SPARC modes
3. Test swarm strategies
4. Analyze performance patterns
5. Optimize based on results

Happy benchmarking! 🚀