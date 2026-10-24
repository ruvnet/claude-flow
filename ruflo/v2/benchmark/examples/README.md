# Claude Flow Benchmark Examples

This directory contains organized examples for using the Claude Flow benchmark suite with different strategies, coordination modes, and real-world scenarios.

## Directory Structure

```
examples/
├── basic/                  # Simple examples for getting started
├── advanced/               # Complex examples with advanced features
├── real/                   # Real claude-flow execution examples
├── cli/                    # Command-line interface examples
└── output/                 # Generated results and metrics
```

## Basic Examples (`basic/`)

**Getting started with simple benchmarks:**

- `simple_swarm.py` - Basic swarm coordination benchmark
- `simple_hive_mind.py` - Basic hive-mind collective intelligence
- `simple_sparc.py` - Basic SPARC methodology (TDD approach)
- `claude_optimizer_example.py` - Claude optimizer usage
- `example_usage.py` - General usage patterns

**Run a basic example:**
```bash
cd basic/
python3 simple_swarm.py
```

## Advanced Examples (`advanced/`)

**Complex benchmarks with advanced features:**

- `parallel_benchmarks.py` - Concurrent execution strategies
- `optimization_suite.py` - Performance tuning and efficiency analysis
- `comparative_analysis.py` - Multi-strategy comparison
- `demo_comprehensive.py` - Comprehensive feature demonstration
- `parallel_benchmark_demo.py` - Parallel execution patterns

**Run an advanced example:**
```bash
cd advanced/
python3 parallel_benchmarks.py
```

## Real Examples (`real/`)

**Production-ready benchmarks with actual claude-flow execution:**

- `real_swarm_benchmark.py` - Real swarm execution with comprehensive metrics
- `real_token_tracking.py` - Token consumption analysis and cost optimization
- `real_performance.py` - System performance monitoring and analysis
- `real_hive_mind_benchmark.py` - Real hive-mind collective intelligence
- `real_sparc_benchmark.py` - Real SPARC methodology execution
- `real_benchmark_examples.py` - Various real benchmark scenarios

**Run a real example:**
```bash
cd real/
python3 real_swarm_benchmark.py
```

## CLI Examples (`cli/`)

**Command-line interface demonstrations:**

- `cli_examples.sh` - Comprehensive CLI usage examples
- `batch_benchmarks.sh` - Batch execution scripts

**Run CLI examples:**
```bash
cd cli/
./cli_examples.sh
```

**Run batch benchmarks:**
```bash
cd cli/
./batch_benchmarks.sh
```

## Quick Start

### 1. Simple Swarm Benchmark
```bash
python3 basic/simple_swarm.py
```

### 2. Real Performance Analysis
```bash
python3 real/real_performance.py
```

### 3. Token Tracking and Cost Analysis
```bash
python3 real/real_token_tracking.py
```

### 4. Comprehensive CLI Demo
```bash
./cli/cli_examples.sh
```

## Example Types by Use Case

### Learning and Testing
- `basic/simple_*.py` - Start here for learning
- `cli/cli_examples.sh` - Command-line reference

### Development and Optimization
- `advanced/optimization_suite.py` - Performance tuning
- `real/real_performance.py` - System monitoring
- `real/real_token_tracking.py` - Cost optimization

### Production Assessment
- `real/real_swarm_benchmark.py` - Production readiness
- `advanced/comparative_analysis.py` - Strategy comparison
- `cli/batch_benchmarks.sh` - Automated testing

### Research and Analysis
- `advanced/parallel_benchmarks.py` - Concurrent execution
- `real/real_hive_mind_benchmark.py` - Collective intelligence
- `advanced/comparative_analysis.py` - Multi-methodology comparison

## Output and Results

All examples save results to the `output/` directory with timestamps:

```
output/
├── simple_swarm_metrics.json
├── parallel_benchmark_results.json
├── token_tracking_metrics_*.json
├── performance_analysis_*.json
└── batch_results_*/
```

## Requirements

**Python Dependencies:**
```bash
pip install psutil  # For system monitoring
```

**Claude Flow:**
```bash
npm install -g claude-flow@alpha
```

**Benchmark Suite:**
```bash
pip install -e .  # From benchmark root directory
```

## Configuration

Most examples can be configured by modifying parameters at the top of each script:

```python
# Example configuration
config = {
    "agents": 5,
    "coordination": "hierarchical",
    "strategy": "development",
    "timeout": 180
}
```

## Best Practices

1. **Start Simple**: Begin with `basic/` examples
2. **Monitor Resources**: Use `real/real_performance.py` for system analysis
3. **Track Costs**: Use `real/real_token_tracking.py` for cost optimization
4. **Compare Strategies**: Use `advanced/comparative_analysis.py`
5. **Automate Testing**: Use `cli/batch_benchmarks.sh`

## Integration with CI/CD

Use batch scripts for automated testing:

```yaml
# GitHub Actions example
- name: Run Benchmark Suite
  run: |
    cd benchmark/examples/cli/
    ./batch_benchmarks.sh
    
- name: Upload Results
  uses: actions/upload-artifact@v3
  with:
    name: benchmark-results
    path: benchmark/examples/output/
```

## Troubleshooting

**Common Issues:**

1. **Command not found**: Ensure `claude-flow@alpha` is installed globally
2. **Permission denied**: Run `chmod +x cli/*.sh`
3. **Import errors**: Install with `pip install -e .` from benchmark root
4. **Timeout errors**: Increase timeout values in configurations

**Debug Mode:**

Add `--debug` flag to commands for verbose output:
```bash
python3 real/real_swarm_benchmark.py --debug
```

## Contributing

To add new examples:

1. Choose appropriate directory (`basic/`, `advanced/`, `real/`, `cli/`)
2. Follow naming convention: `{purpose}_{type}_{description}.py`
3. Include comprehensive docstrings and comments
4. Save outputs to `output/` directory with timestamps
5. Update this README with usage instructions

## Support

- **Documentation**: `/workspaces/claude-code-flow/benchmark/docs/`
- **Issues**: Create GitHub issues with example logs
- **Community**: Join discussions in GitHub Discussions

---

**Next Steps:**
1. Try basic examples to understand concepts
2. Run real examples for production insights
3. Use CLI examples for automation
4. Customize advanced examples for specific needs