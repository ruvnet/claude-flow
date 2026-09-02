# Real Claude Flow Benchmarks

**CRITICAL**: These are REAL benchmarks that execute actual `./claude-flow` commands. NO simulations.

## 🎯 Overview

This benchmark suite implements real-world performance testing for Claude Flow by:

1. **Executing Real Commands**: Uses actual `./claude-flow` subprocess calls
2. **Measuring Actual Performance**: Tracks real execution time, token usage, memory consumption
3. **Parsing Real Responses**: Extracts metrics from actual JSON streaming responses
4. **Tracking Real Resources**: Monitors CPU, memory, and I/O during execution

## 📁 Structure

```
benchmark/
├── src/swarm_benchmark/scenarios/
│   ├── __init__.py
│   └── real_benchmarks.py          # Core real benchmark implementations
├── examples/
│   ├── real_swarm_benchmark.py     # Real swarm execution examples
│   ├── real_hive_mind_benchmark.py # Real hive-mind execution examples  
│   └── real_sparc_benchmark.py     # Real SPARC mode execution examples
├── test_real_benchmarks.py         # Validation tests for real benchmarks
├── run_real_benchmarks.py          # Comprehensive benchmark runner
└── REAL_BENCHMARKS_README.md       # This file
```

## 🚀 Quick Start

### 1. Test Installation

```bash
# Validate Claude Flow is available and benchmarks work
python test_real_benchmarks.py --quick
```

### 2. Run Individual Benchmarks

```bash
# Real swarm benchmark
python examples/real_swarm_benchmark.py "Create a REST API for user management"

# Real hive-mind benchmark  
python examples/real_hive_mind_benchmark.py "Design distributed system architecture"

# Real SPARC mode benchmark
python examples/real_sparc_benchmark.py coder "Implement OAuth2 authentication"
```

### 3. Run Comprehensive Suite

```bash
# Run all benchmark types
python run_real_benchmarks.py --mode comprehensive

# Run specific benchmark type
python run_real_benchmarks.py --mode swarm
python run_real_benchmarks.py --mode hive-mind  
python run_real_benchmarks.py --mode sparc
```

## 🔬 Core Components

### RealBenchmarkResult

Captures comprehensive metrics from real executions:

```python
@dataclass
class RealBenchmarkResult:
    benchmark_name: str          # Benchmark identifier
    success: bool               # Execution success
    execution_time: float       # Real execution time (seconds)
    tokens_used: int           # Actual tokens consumed by Claude
    agents_spawned: int        # Real agent count from output
    memory_usage_mb: float     # Actual memory consumption
    cpu_usage_percent: float   # Real CPU usage during execution
    output_size_bytes: int     # Size of actual output
    error_count: int           # Number of errors in stderr
    warning_count: int         # Number of warnings
    command_executed: List[str] # Actual command executed
    stdout_excerpt: str        # First 500 chars of stdout
    stderr_excerpt: str        # First 500 chars of stderr
    metrics_raw: Dict[str, Any] # Raw metrics from JSON parsing
    timestamp: str             # ISO timestamp
```

### ClaudeFlowRealExecutor

Executes real Claude Flow commands with comprehensive monitoring:

```python
executor = ClaudeFlowRealExecutor()

# Execute real swarm
result = executor.execute_swarm(
    objective="Create a REST API",
    strategy="development", 
    mode="hierarchical",
    max_agents=5,
    non_interactive=True
)

# Execute real hive-mind
result = executor.execute_hive_mind(
    task="Solve optimization problem",
    collective_mode="consensus",
    agent_count=8,
    timeout=15
)

# Execute real SPARC mode
result = executor.execute_sparc_mode(
    mode="coder",
    task="Implement authentication system",
    timeout=10
)
```

## 📊 Benchmark Scenarios

### Swarm Benchmarks

- **Development Swarm**: `development` strategy with `centralized` mode
- **Research Swarm**: `research` strategy with `distributed` mode  
- **Optimization Swarm**: `optimization` strategy with `hybrid` mode
- **Analysis Swarm**: `analysis` strategy with `mesh` mode

### Hive-Mind Benchmarks

- **Consensus Mode**: Democratic decision-making with 6-8 agents
- **Collective Intelligence**: Advanced problem-solving with 10-12 agents
- **Memory Shared**: Persistent knowledge sharing with 6 agents

### SPARC Mode Benchmarks

- **Coder**: Implementation tasks
- **TDD**: Test-driven development
- **Architect**: System design
- **Optimizer**: Performance optimization
- **Researcher**: Information gathering
- **Reviewer**: Code review
- **Analyzer**: System analysis

## 🎯 Usage Examples

### Simple Swarm Benchmark

```python
from swarm_benchmark.scenarios.real_benchmarks import RealSwarmBenchmark

benchmark = RealSwarmBenchmark()
result = benchmark.benchmark_swarm_task("Create a simple API endpoint")

print(f"Success: {result.success}")
print(f"Time: {result.execution_time:.2f}s")
print(f"Tokens: {result.tokens_used}")
print(f"Agents: {result.agents_spawned}")
```

### Multi-Scenario Benchmark

```python
from swarm_benchmark.scenarios.real_benchmarks import RealBenchmarkSuite

suite = RealBenchmarkSuite(output_dir="./results")
results = suite.run_comprehensive_benchmark()

# Results contain actual metrics from real executions
for category, benchmarks in results.items():
    for benchmark in benchmarks:
        print(f"{benchmark.benchmark_name}: {benchmark.execution_time:.2f}s")
```

### Custom Real Executor

```python
from swarm_benchmark.scenarios.real_benchmarks import ClaudeFlowRealExecutor

executor = ClaudeFlowRealExecutor(
    claude_flow_path="/path/to/claude-flow",
    working_dir="/workspace"
)

# Real execution with resource monitoring
result = executor.execute_swarm(
    objective="Build microservices architecture",
    strategy="development",
    mode="hierarchical", 
    max_agents=6,
    timeout=20
)

# Actual metrics from real execution
print(f"Real execution time: {result.execution_time:.2f}s")
print(f"Actual tokens used: {result.tokens_used}")
print(f"Real memory usage: {result.memory_usage_mb:.2f} MB")
```

## 📈 Performance Monitoring

### Real-Time Resource Monitoring

The `ResourceMonitor` class tracks actual system resources during benchmark execution:

```python
class ResourceMonitor:
    def start_monitoring(self, interval: float = 1.0)
    def stop_monitoring(self) -> List[SystemMetrics]
    
    # Tracks:
    # - CPU usage percentage
    # - Memory consumption (MB)
    # - Disk I/O (read/write MB)
    # - Network bytes sent/received
```

### Metrics Extraction

Real output parsing extracts actual metrics:

```python
# Extract token usage from real Claude Flow output
tokens = executor._extract_token_usage(stdout)

# Extract actual agent count from output  
agents = executor._extract_agent_count(stdout)

# Parse JSON metrics from streaming responses
metrics = executor._parse_json_metrics(stdout)
```

## 🔧 Configuration

### Environment Setup

Required environment for real benchmarks:

```bash
# Ensure claude-flow is available
export PATH="/path/to/claude-flow/bin:$PATH"

# Set working directory
export CLAUDE_WORKING_DIR="/workspace"

# Optional: Custom claude-flow path
export CLAUDE_FLOW_PATH="/custom/path/claude-flow"
```

### Benchmark Configuration

```python
# Swarm configuration
config = SwarmConfig(
    objective="Task description",
    strategy=ExecutionStrategy.DEVELOPMENT,
    mode=CoordinationMode.HIERARCHICAL,
    max_agents=5,
    timeout=15,  # minutes
    output_dir="./results"
)

# SPARC configuration  
config = SparcConfig(
    prompt="Task description",
    mode=SparcMode.CODER,
    timeout=10,  # minutes
    parallel=False,
    monitor=True
)
```

## 📊 Output Format

Real benchmark results are saved as JSON:

```json
{
  "benchmark_name": "swarm_development_hierarchical",
  "success": true,
  "execution_time": 45.67,
  "tokens_used": 2456,
  "agents_spawned": 5,
  "memory_usage_mb": 128.5,
  "cpu_usage_percent": 23.8,
  "output_size_bytes": 15420,
  "error_count": 0,
  "warning_count": 1,
  "command_executed": ["./claude-flow", "swarm", "..."],
  "stdout_excerpt": "Starting swarm execution...",
  "stderr_excerpt": "",
  "metrics_raw": {"performance": 0.95},
  "timestamp": "2025-08-06T10:30:45.123456"
}
```

## 🧪 Testing

### Validation Tests

```bash
# Quick validation (no real execution)
python test_real_benchmarks.py --quick

# Full validation with real executions
python test_real_benchmarks.py

# Structure validation only
python test_real_benchmarks.py --validate-only
```

### Example Execution Tests

```bash
# Test individual examples
python examples/real_swarm_benchmark.py --multiple
python examples/real_hive_mind_benchmark.py --suite  
python examples/real_sparc_benchmark.py --workflow
```

## 🚨 Important Notes

### Real Execution Requirements

1. **Claude Flow Installation**: Must have working `./claude-flow` executable
2. **Network Access**: Real benchmarks may require internet connectivity
3. **API Limits**: Respect Claude API rate limits and token usage
4. **Execution Time**: Real benchmarks take actual time to complete
5. **Resource Usage**: Real benchmarks consume actual system resources

### Safety Considerations

1. **Non-Interactive Mode**: Always use `--non-interactive` flag
2. **Timeout Limits**: Set reasonable timeouts to prevent hanging
3. **Resource Monitoring**: Monitor CPU/memory usage during execution
4. **Error Handling**: Benchmarks gracefully handle execution failures
5. **Result Validation**: Verify benchmark results are sane

### Performance Guidelines

1. **Concurrent Execution**: Avoid running multiple benchmarks simultaneously
2. **Resource Allocation**: Ensure sufficient system resources
3. **Timeout Configuration**: Set appropriate timeouts for task complexity
4. **Output Management**: Clean up large output files regularly
5. **Monitoring Overhead**: Resource monitoring adds minimal overhead

## 📚 Advanced Usage

### Custom Benchmark Creation

```python
class CustomRealBenchmark:
    def __init__(self):
        self.executor = ClaudeFlowRealExecutor()
    
    def benchmark_custom_workflow(self, task: str) -> RealBenchmarkResult:
        # Execute real custom command
        command = [
            self.executor.executor.claude_flow_path,
            "custom-command",
            task,
            "--mode", "custom",
            "--non-interactive"
        ]
        
        # Monitor and execute
        self.executor.resource_monitor.start_monitoring()
        
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=600
        )
        
        metrics = self.executor.resource_monitor.stop_monitoring()
        
        # Parse and return results
        return self._build_result(result, metrics)
```

### Integration with CI/CD

```python
# Automated benchmark execution
def run_ci_benchmarks():
    suite = RealBenchmarkSuite()
    results = suite.run_comprehensive_benchmark()
    
    # Validate performance thresholds
    for category, benchmarks in results.items():
        for benchmark in benchmarks:
            if benchmark.execution_time > 120:  # 2 minutes
                raise Exception(f"Benchmark {benchmark.benchmark_name} exceeded time limit")
            
            if not benchmark.success:
                raise Exception(f"Benchmark {benchmark.benchmark_name} failed")
    
    return results
```

This real benchmark implementation provides comprehensive, accurate performance measurement for Claude Flow operations using actual command execution and real-world metrics.