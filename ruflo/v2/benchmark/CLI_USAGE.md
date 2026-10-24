# Swarm-Benchmark CLI Usage Guide

## Overview
The `swarm-benchmark` CLI provides comprehensive benchmarking for Claude Flow with real command execution.

## Installation
```bash
cd benchmark
pip install -e .
```

## Commands

### Real Execution (Production)
Execute actual claude-flow commands and measure real performance:

```bash
# Basic swarm benchmark
swarm-benchmark real swarm "Build a REST API" --strategy development

# Hive-mind benchmark
swarm-benchmark real hive-mind "Design architecture" --max-workers 8

# SPARC mode benchmark
swarm-benchmark real sparc coder "Implement authentication"

# Test all modes
swarm-benchmark real swarm "Create microservice" --all-modes --parallel
```

### Options

#### Global Options
- `--verbose, -v`: Enable verbose output
- `--config PATH`: Configuration file path
- `--version`: Show version

#### Real Command Options
- `--strategy`: Execution strategy (auto, research, development, etc.)
- `--mode`: Coordination mode (centralized, distributed, hierarchical, mesh, hybrid)
- `--sparc-mode`: Specific SPARC mode to test
- `--all-modes`: Test all SPARC modes and strategies
- `--max-agents`: Maximum number of agents (default: 5)
- `--timeout`: Overall timeout in minutes (default: 60)
- `--task-timeout`: Individual task timeout in seconds (default: 300)
- `--parallel`: Enable parallel execution
- `--monitor`: Enable real-time monitoring
- `--output`: Output format (json, sqlite)
- `--output-dir`: Output directory (default: ./reports)

## Important Notes on Multi-Word Tasks

When running commands with multi-word tasks from the shell, ensure proper quoting:

```bash
# CORRECT - Use quotes around the entire task
swarm-benchmark real hive-mind "Design hello world" --max-workers 4

# For complex tasks with special characters, use single quotes
swarm-benchmark real swarm 'Build REST API with /users endpoint' --strategy development

# Or use a Python script for reliability
python -c "
import subprocess
subprocess.run(['swarm-benchmark', 'real', 'hive-mind', 
                'Design hello world in ./hello-bench/', 
                '--max-workers', '8'])"
```

## Examples

### Simple Benchmark
```bash
swarm-benchmark real swarm "echo hello world" --max-agents 1 --timeout 1
```

### Development Benchmark
```bash
swarm-benchmark real swarm "Build user authentication system" \
  --strategy development \
  --mode hierarchical \
  --max-agents 5 \
  --monitor \
  --output json \
  --output-dir ./results
```

### Comparative Analysis
```bash
# Test different strategies
for strategy in auto research development optimization; do
  swarm-benchmark real swarm "Optimize database queries" \
    --strategy $strategy \
    --output json \
    --name "strategy-$strategy"
done
```

### Batch Processing
```bash
# Run multiple benchmarks
cat tasks.txt | while read task; do
  swarm-benchmark real swarm "$task" \
    --parallel \
    --output json
done
```

## Output

Results are saved in JSON format with comprehensive metrics:
- Token usage (input/output)
- Execution time
- Agent activity
- Memory usage
- Error rates
- Command details

Example output structure:
```json
{
  "benchmark_id": "...",
  "objective": "Build a REST API",
  "metrics": {
    "total_tokens": 4351,
    "execution_time": 95.2,
    "agents_spawned": 3,
    "memory_peak_mb": 156.4
  },
  "command": ["./claude-flow", "swarm", "..."],
  "timestamp": "2025-01-06T02:45:00Z"
}
```

## Performance Tips

1. **Use --parallel** for multiple independent tasks
2. **Set appropriate timeouts** to avoid hanging
3. **Monitor resource usage** with --monitor flag
4. **Use --all-modes** for comprehensive testing
5. **Save results** with --output-dir for analysis

## Troubleshooting

### Command not found
```bash
# Ensure installation
pip install -e .
# Check PATH
which swarm-benchmark
```

### Timeout issues
```bash
# Increase timeouts for complex tasks
swarm-benchmark real swarm "Complex task" --timeout 120 --task-timeout 600
```

### Memory issues
```bash
# Limit agents for resource-constrained environments
swarm-benchmark real swarm "Task" --max-agents 2
```

## Integration

### CI/CD Pipeline
```yaml
# GitHub Actions example
- name: Run benchmarks
  run: |
    cd benchmark
    pip install -e .
    swarm-benchmark real swarm "${{ github.event.inputs.task }}" \
      --output json \
      --output-dir ./artifacts
```

### Python API
```python
from swarm_benchmark import BenchmarkEngine

engine = BenchmarkEngine(use_real_executor=True)
result = await engine.run_real_benchmark("Your task here")
```

## Best Practices

1. **Start small**: Test with simple tasks first
2. **Monitor resources**: Use --monitor for production runs
3. **Save results**: Always specify --output-dir
4. **Use timeouts**: Prevent hanging on complex tasks
5. **Parallel execution**: Use --parallel for independent tasks

---

For more information, see the [full documentation](README.md).