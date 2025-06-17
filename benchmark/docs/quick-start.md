# Quick Start Guide

Get started with swarm benchmarking in 5 minutes!

## 🚀 Installation

```bash
# Install the benchmark tool
cd benchmark/
pip install -e .
```

## 🎯 Your First Benchmark

### 1. Basic Benchmark

Run a simple benchmark with default settings:

```bash
swarm-benchmark run "Build a user authentication system"
```

### 2. Specify Strategy

Choose a specific strategy for your task:

```bash
swarm-benchmark run "Research cloud providers" --strategy research
```

### 3. Select Coordination Mode

Test different coordination patterns:

```bash
swarm-benchmark run "Develop microservices" --mode distributed
```

### 4. View Results

Check your benchmark results:

```bash
# List recent benchmarks
swarm-benchmark list

# Show specific benchmark details
swarm-benchmark show <benchmark-id>
```

## 📊 Understanding Output

After running a benchmark, you'll see:

```
✅ Benchmark completed successfully!
📊 Results saved to: ./reports
```

The JSON output includes:
- **Task execution time**: How long each task took
- **Resource usage**: CPU and memory consumption
- **Success rate**: Percentage of successful tasks
- **Quality scores**: Accuracy and completeness metrics

## 🎨 Common Scenarios

### Development Tasks
```bash
swarm-benchmark run "Create REST API with authentication" \
  --strategy development \
  --mode hierarchical \
  --max-agents 6
```

### Research Tasks
```bash
swarm-benchmark run "Analyze market trends" \
  --strategy research \
  --mode distributed \
  --parallel
```

### Optimization Tasks
```bash
swarm-benchmark run "Optimize database performance" \
  --strategy optimization \
  --mode hybrid \
  --monitor
```

## 🔧 Quick Tips

1. **Use `--parallel`** for faster execution with multiple agents
2. **Add `--monitor`** to see real-time progress
3. **Use `-v`** flag for verbose output
4. **Check `./reports/` for detailed JSON results**

## 📚 Next Steps

- Read the [Basic Usage Guide](basic-usage.md) for more examples
- Learn about [Swarm Strategies](strategies.md)
- Explore [Coordination Modes](coordination-modes.md)
- See [Optimization Guide](optimization-guide.md) for performance tips

## ❓ Need Help?

- Run `swarm-benchmark --help` for command help
- Check [Troubleshooting Guide](troubleshooting.md) for common issues
- See [CLI Reference](cli-reference.md) for all commands