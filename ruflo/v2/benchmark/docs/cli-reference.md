# CLI Reference Guide

Complete command-line interface documentation for the swarm benchmarking tool.

## 📋 Command Overview

```
swarm-benchmark [GLOBAL OPTIONS] COMMAND [OPTIONS] [ARGS]
```

### Global Options
- `--version` - Show version and exit
- `-v, --verbose` - Enable verbose output
- `-c, --config PATH` - Configuration file path
- `--help` - Show help message and exit

### Available Commands
- `run` - Run a swarm benchmark
- `list` - List recent benchmark runs
- `show` - Show details for a specific benchmark
- `clean` - Clean up benchmark results
- `serve` - Start the web interface
- `analyze` - Analyze benchmark results
- `compare` - Compare multiple benchmarks

## 🚀 run - Execute Benchmarks

Run a swarm benchmark with the specified objective.

### Syntax
```bash
swarm-benchmark run [OPTIONS] OBJECTIVE
```

### Arguments
- `OBJECTIVE` - The goal or task for the swarm to accomplish (required)

### Options

#### Strategy Options
```bash
--strategy [auto|research|development|analysis|testing|optimization|maintenance]
    # Execution strategy (default: auto)
    
--strategy-params JSON
    # Custom strategy parameters as JSON string
    # Example: '{"search_depth": 3, "quality_iterations": 2}'
```

#### Coordination Options
```bash
--mode [centralized|distributed|hierarchical|mesh|hybrid]
    # Coordination mode (default: centralized)
    
--coordinator-count INT
    # Number of coordinators (distributed mode)
    
--hierarchy-levels INT
    # Number of hierarchy levels (hierarchical mode)
```

#### Agent Options
```bash
--max-agents INT
    # Maximum number of agents (default: 5)
    
--agent-selection [capability|load|performance|random|round-robin]
    # Agent selection strategy (default: capability)
    
--agent-pool PATH
    # Path to agent pool configuration
```

#### Task Options
```bash
--max-tasks INT
    # Maximum tasks to execute (default: 100)
    
--task-timeout INT
    # Individual task timeout in seconds (default: 300)
    
--max-retries INT
    # Maximum retries per task (default: 3)
    
--priority INT
    # Task priority 1-10 (default: 5)
```

#### Execution Options
```bash
--parallel
    # Enable parallel execution
    
--background
    # Run in background mode
    
--distributed
    # Enable distributed coordination
    
--stream-output
    # Stream real-time output
```

#### Quality Options
```bash
--quality-threshold FLOAT
    # Quality threshold 0-1 (default: 0.8)
    
--review
    # Enable peer review
    
--testing
    # Enable automated testing
    
--validation-mode [strict|normal|lenient]
    # Validation strictness (default: normal)
```

#### Performance Options
```bash
--timeout MINUTES
    # Overall timeout in minutes (default: 60)
    
--memory-limit MB
    # Memory limit in MB (default: 1024)
    
--cpu-limit PERCENT
    # CPU limit percentage (default: 80)
    
--optimization-level [0|1|2|3]
    # Optimization level (default: 1)
```

#### Monitoring Options
```bash
--monitor
    # Enable real-time monitoring
    
--metrics-interval SECONDS
    # Metrics collection interval (default: 5)
    
--profile
    # Enable performance profiling
    
--trace
    # Enable execution tracing
```

#### Output Options
```bash
--output FORMAT [FORMAT...]
    # Output formats: json, sqlite, csv, html
    # Can specify multiple formats
    
--output-dir PATH
    # Output directory (default: ./reports)
    
--compress
    # Compress output files
    
--pretty-print
    # Pretty print JSON output
```

#### Additional Options
```bash
--name TEXT
    # Benchmark name
    
--description TEXT
    # Benchmark description
    
--tags TAG [TAG...]
    # Tags for categorization
    
--metadata JSON
    # Additional metadata as JSON
    
--dry-run
    # Show configuration without executing
```

### Examples

#### Basic Usage
```bash
# Simple benchmark
swarm-benchmark run "Build a user authentication system"

# With specific strategy
swarm-benchmark run "Research cloud providers" --strategy research

# With coordination mode
swarm-benchmark run "Develop API" --mode hierarchical
```

#### Advanced Usage
```bash
# Full configuration
swarm-benchmark run "Build microservices architecture" \
  --strategy development \
  --mode hierarchical \
  --max-agents 10 \
  --parallel \
  --quality-threshold 0.9 \
  --output json sqlite \
  --monitor \
  --name "Microservices Benchmark" \
  --tags architecture api
```

#### Performance Optimization
```bash
# Optimized for speed
swarm-benchmark run "Quick analysis" \
  --strategy analysis \
  --mode distributed \
  --parallel \
  --task-timeout 60 \
  --optimization-level 3

# Optimized for quality
swarm-benchmark run "Critical system" \
  --strategy development \
  --mode mesh \
  --quality-threshold 0.95 \
  --review \
  --testing \
  --max-retries 5
```

## 📋 list - View Benchmarks

List recent benchmark runs.

### Syntax
```bash
swarm-benchmark list [OPTIONS]
```

### Options
```bash
--format [table|json|csv]
    # Output format (default: table)
    
--filter-strategy TEXT
    # Filter by strategy name
    
--filter-mode TEXT
    # Filter by coordination mode
    
--filter-status [completed|failed|running]
    # Filter by status
    
--limit INT
    # Limit number of results (default: 10)
    
--offset INT
    # Offset for pagination (default: 0)
    
--sort-by [date|duration|status|strategy]
    # Sort results (default: date)
    
--reverse
    # Reverse sort order
    
--since DATE
    # Show benchmarks since date
    
--until DATE
    # Show benchmarks until date
```

### Examples
```bash
# List recent benchmarks
swarm-benchmark list

# Filter by strategy
swarm-benchmark list --filter-strategy development

# Export as JSON
swarm-benchmark list --format json --limit 50

# List failed benchmarks
swarm-benchmark list --filter-status failed
```

## 🔍 show - Benchmark Details

Show details for a specific benchmark run.

### Syntax
```bash
swarm-benchmark show [OPTIONS] BENCHMARK_ID
```

### Arguments
- `BENCHMARK_ID` - Benchmark identifier (required)

### Options
```bash
--format [json|summary|detailed|report]
    # Output format (default: summary)
    
--include [all|results|metrics|logs]
    # What to include (default: all)
    
--export PATH
    # Export to file
    
--pretty
    # Pretty print output
```

### Examples
```bash
# Show benchmark summary
swarm-benchmark show abc123

# Detailed JSON output
swarm-benchmark show abc123 --format json --pretty

# Export detailed report
swarm-benchmark show abc123 --format report --export report.html
```

## 🧹 clean - Cleanup Results

Clean up benchmark results.

### Syntax
```bash
swarm-benchmark clean [OPTIONS]
```

### Options
```bash
--all
    # Delete all benchmark results
    
--older-than DAYS
    # Delete results older than N days
    
--strategy TEXT
    # Delete results for specific strategy
    
--status [completed|failed|all]
    # Delete by status (default: all)
    
--keep-recent INT
    # Keep N most recent benchmarks
    
--dry-run
    # Show what would be deleted
    
--force
    # Skip confirmation prompt
```

### Examples
```bash
# Clean old results
swarm-benchmark clean --older-than 30

# Clean failed benchmarks
swarm-benchmark clean --status failed

# Keep only recent
swarm-benchmark clean --keep-recent 100
```

## 🌐 serve - Web Interface

Start the benchmark web interface.

### Syntax
```bash
swarm-benchmark serve [OPTIONS]
```

### Options
```bash
--port INT
    # Server port (default: 8080)
    
--host TEXT
    # Server host (default: localhost)
    
--public
    # Allow external connections
    
--auth USERNAME:PASSWORD
    # Enable basic authentication
    
--ssl-cert PATH
    # SSL certificate path
    
--ssl-key PATH
    # SSL key path
```

### Examples
```bash
# Start local server
swarm-benchmark serve

# Public server with auth
swarm-benchmark serve --public --auth admin:password --port 8443
```

## 📊 analyze - Result Analysis

Analyze benchmark results.

### Syntax
```bash
swarm-benchmark analyze [OPTIONS] [BENCHMARK_ID]
```

### Options
```bash
--type [performance|quality|resource|coordination]
    # Analysis type (default: performance)
    
--compare-with ID [ID...]
    # Compare with other benchmarks
    
--report FORMAT
    # Generate report (html, pdf, json)
    
--metrics METRIC [METRIC...]
    # Specific metrics to analyze
    
--export PATH
    # Export analysis results
```

### Examples
```bash
# Analyze specific benchmark
swarm-benchmark analyze abc123

# Compare benchmarks
swarm-benchmark analyze --compare-with abc123 def456 ghi789

# Generate performance report
swarm-benchmark analyze --type performance --report html
```

## 🔄 compare - Compare Benchmarks

Compare multiple benchmark runs.

### Syntax
```bash
swarm-benchmark compare [OPTIONS] ID1 ID2 [ID3...]
```

### Arguments
- `ID1, ID2, ...` - Benchmark IDs to compare (minimum 2)

### Options
```bash
--metrics METRIC [METRIC...]
    # Metrics to compare
    
--format [table|chart|json]
    # Output format (default: table)
    
--export PATH
    # Export comparison
    
--visualization [bar|line|radar]
    # Chart type for visual comparison
```

### Examples
```bash
# Compare two benchmarks
swarm-benchmark compare abc123 def456

# Compare specific metrics
swarm-benchmark compare abc123 def456 --metrics execution_time quality_score

# Export comparison chart
swarm-benchmark compare abc123 def456 ghi789 --format chart --export comparison.png
```

## 🎯 Advanced Usage

### Configuration Files

Create a configuration file for complex benchmarks:

```yaml
# benchmark.yaml
name: "Production Benchmark"
strategy: development
mode: hierarchical
max_agents: 10
parallel: true
quality_threshold: 0.9
output_formats:
  - json
  - sqlite
  - html
monitoring:
  enabled: true
  interval: 5
resource_limits:
  memory_mb: 2048
  cpu_percent: 75
```

Use with:
```bash
swarm-benchmark -c benchmark.yaml run "Build production system"
```

### Environment Variables

```bash
# Set defaults via environment
export SWARM_BENCHMARK_OUTPUT_DIR="/var/benchmarks"
export SWARM_BENCHMARK_DEFAULT_STRATEGY="development"
export SWARM_BENCHMARK_MAX_AGENTS="8"

# Run with environment defaults
swarm-benchmark run "Task"
```

### Pipelines and Automation

```bash
# Chain commands
swarm-benchmark run "Research task" --strategy research --output json | \
  jq '.results[0].output' | \
  swarm-benchmark run "Implement findings" --strategy development

# Batch processing
for task in tasks/*.txt; do
  swarm-benchmark run "$(cat $task)" --output-dir "results/$(basename $task .txt)"
done
```

### Scripting Examples

```bash
#!/bin/bash
# benchmark-suite.sh

# Run benchmark suite
strategies=("auto" "research" "development" "analysis" "testing")
modes=("centralized" "distributed" "hierarchical")

for strategy in "${strategies[@]}"; do
  for mode in "${modes[@]}"; do
    echo "Testing $strategy with $mode coordination..."
    swarm-benchmark run "Test task for $strategy" \
      --strategy "$strategy" \
      --mode "$mode" \
      --name "suite-$strategy-$mode" \
      --output json
  done
done

# Generate comparison report
swarm-benchmark list --format json | \
  jq -r '.[] | select(.name | startswith("suite-")) | .id' | \
  xargs swarm-benchmark compare --format chart --export suite-comparison.html
```

## 💡 Tips and Tricks

### Performance Tips
```bash
# Use aliases for common operations
alias sb='swarm-benchmark'
alias sbr='swarm-benchmark run'
alias sbl='swarm-benchmark list'

# Quick benchmark with monitoring
sbr "Quick test" --monitor --parallel

# Benchmark with profiling
sbr "Performance test" --profile --output json | \
  jq '.performance_metrics'
```

### Debugging
```bash
# Verbose mode for troubleshooting
swarm-benchmark -v run "Debug task" --trace

# Dry run to check configuration
swarm-benchmark run "Test" --dry-run --verbose

# Check coordination overhead
swarm-benchmark analyze --type coordination
```

### Integration
```bash
# CI/CD integration
swarm-benchmark run "$CI_COMMIT_MESSAGE" \
  --name "CI-$CI_PIPELINE_ID" \
  --metadata '{"commit": "'$CI_COMMIT_SHA'", "branch": "'$CI_COMMIT_BRANCH'"}'

# Slack notification
swarm-benchmark run "Deploy task" --output json | \
  jq '{text: "Benchmark completed: \(.status)"}' | \
  curl -X POST -H 'Content-type: application/json' \
    --data @- $SLACK_WEBHOOK_URL
```

## 🎉 Quick Reference Card

```bash
# Most common commands
swarm-benchmark run "Task"                    # Basic run
swarm-benchmark run "Task" -v                 # Verbose
swarm-benchmark list                          # List results  
swarm-benchmark show <id>                     # Show details
swarm-benchmark clean --older-than 30         # Cleanup

# Strategy shortcuts
sbr "Task" --strategy auto                    # Auto-select
sbr "Task" --strategy research                # Research
sbr "Task" --strategy development             # Development

# Mode shortcuts  
sbr "Task" --mode centralized                 # Simple
sbr "Task" --mode distributed                 # Parallel
sbr "Task" --mode hierarchical                # Complex

# Common combinations
sbr "Research task" --strategy research --mode distributed --parallel
sbr "Build system" --strategy development --mode hierarchical --monitor
sbr "Optimize code" --strategy optimization --mode hybrid --profile
```