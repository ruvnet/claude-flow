# Basic Usage Guide

Learn how to use the swarm benchmarking tool effectively with practical examples and common workflows.

## 🎯 Core Concepts

Before diving into usage, understand these key concepts:

1. **Objective**: The task you want the swarm to accomplish
2. **Strategy**: How the swarm approaches the task (auto, research, development, etc.)
3. **Coordination Mode**: How agents work together (centralized, distributed, etc.)
4. **Agents**: Individual workers in the swarm
5. **Benchmark**: A complete test run with metrics and results

## 🚀 Basic Commands

### Running Your First Benchmark

The simplest way to start:

```bash
swarm-benchmark run "Create a hello world API"
```

This command:
- Uses the `auto` strategy (automatically selects approach)
- Uses `centralized` coordination (single coordinator)
- Allocates 5 agents (default)
- Saves results to `./reports/`

### Viewing Results

After running a benchmark:

```bash
# List all benchmarks
swarm-benchmark list

# Output:
# ID                                   | Name                    | Status    | Duration
# ------------------------------------ | ----------------------- | --------- | --------
# 7263107f-9031-4403-901c-9db6e3fc96c6 | benchmark-auto-central  | completed | 0.20s
```

View specific benchmark details:

```bash
swarm-benchmark show 7263107f-9031-4403-901c-9db6e3fc96c6
```

## 📚 Common Workflows

### 1. Research Workflow

When you need to gather information:

```bash
# Research a topic with distributed agents
swarm-benchmark run "Research best practices for REST API design" \
  --strategy research \
  --mode distributed \
  --max-agents 6

# View the research results
swarm-benchmark show <benchmark-id> --format detailed
```

### 2. Development Workflow

For code creation tasks:

```bash
# Step 1: Research the requirements
swarm-benchmark run "Research authentication methods" --strategy research

# Step 2: Develop the solution
swarm-benchmark run "Implement JWT authentication for Node.js API" \
  --strategy development \
  --mode hierarchical \
  --quality-threshold 0.9

# Step 3: Create tests
swarm-benchmark run "Write unit tests for JWT authentication" \
  --strategy testing
```

### 3. Analysis Workflow

For data analysis tasks:

```bash
# Analyze data with collaborative agents
swarm-benchmark run "Analyze user engagement metrics from CSV data" \
  --strategy analysis \
  --mode mesh \
  --quality-threshold 0.95 \
  --parallel
```

### 4. Optimization Workflow

For performance improvements:

```bash
# Profile and optimize
swarm-benchmark run "Optimize database query performance" \
  --strategy optimization \
  --mode hybrid \
  --monitor \
  --profile
```

## 🎨 Strategy Selection Examples

### Auto Strategy (Default)

Let the system choose the best approach:

```bash
# The system analyzes your objective and selects a strategy
swarm-benchmark run "Build a user registration form"
# Auto-selects: development strategy

swarm-benchmark run "Find the best Python web frameworks"
# Auto-selects: research strategy

swarm-benchmark run "Check API response times"
# Auto-selects: testing strategy
```

### Research Strategy

Best for information gathering:

```bash
# Market research
swarm-benchmark run "Research competitor pricing strategies" \
  --strategy research \
  --max-agents 8 \
  --parallel

# Technical research
swarm-benchmark run "Compare cloud providers for ML workloads" \
  --strategy research \
  --output json html
```

### Development Strategy

For creating code and systems:

```bash
# API development
swarm-benchmark run "Create CRUD API for product management" \
  --strategy development \
  --mode hierarchical \
  --review

# Frontend development
swarm-benchmark run "Build React dashboard component" \
  --strategy development \
  --quality-threshold 0.85
```

### Analysis Strategy

For data processing and insights:

```bash
# Business analysis
swarm-benchmark run "Analyze Q4 sales data and identify trends" \
  --strategy analysis \
  --mode mesh

# Log analysis
swarm-benchmark run "Analyze server logs for error patterns" \
  --strategy analysis \
  --parallel
```

### Testing Strategy

For quality assurance:

```bash
# API testing
swarm-benchmark run "Create comprehensive test suite for user API" \
  --strategy testing \
  --mode distributed

# Performance testing
swarm-benchmark run "Load test the checkout process" \
  --strategy testing \
  --max-agents 10
```

### Optimization Strategy

For performance improvements:

```bash
# Code optimization
swarm-benchmark run "Optimize image processing algorithm" \
  --strategy optimization \
  --profile

# Query optimization
swarm-benchmark run "Optimize slow database queries" \
  --strategy optimization \
  --monitor
```

### Maintenance Strategy

For updates and documentation:

```bash
# Documentation
swarm-benchmark run "Update API documentation for v2" \
  --strategy maintenance \
  --mode centralized

# Refactoring
swarm-benchmark run "Refactor user service to use async/await" \
  --strategy maintenance
```

## 🔗 Coordination Mode Examples

### Centralized (Simple Tasks)

Best for small teams and straightforward tasks:

```bash
# Simple task with few agents
swarm-benchmark run "Create a contact form" \
  --mode centralized \
  --max-agents 3
```

### Distributed (Parallel Work)

For tasks that can be split across multiple coordinators:

```bash
# Parallel research across topics
swarm-benchmark run "Research multiple database technologies" \
  --mode distributed \
  --max-agents 8 \
  --parallel
```

### Hierarchical (Complex Projects)

For multi-layered projects with clear structure:

```bash
# Large development project
swarm-benchmark run "Build e-commerce platform" \
  --mode hierarchical \
  --max-agents 10 \
  --task-timeout 600
```

### Mesh (Collaborative Work)

When agents need to work together closely:

```bash
# Collaborative code review
swarm-benchmark run "Review and improve codebase architecture" \
  --mode mesh \
  --max-agents 5 \
  --review
```

### Hybrid (Adaptive)

Let the system choose the best mode per task:

```bash
# Mixed workload
swarm-benchmark run "Complete full project lifecycle" \
  --mode hybrid \
  --adaptive \
  --max-agents 8
```

## 📊 Output Management

### Output Formats

Save results in different formats:

```bash
# Multiple output formats
swarm-benchmark run "Analyze data" \
  --output json sqlite csv \
  --output-dir ./analysis-results

# Pretty-printed JSON
swarm-benchmark run "Task" \
  --output json \
  --pretty-print

# Compressed output
swarm-benchmark run "Large analysis" \
  --output json \
  --compress
```

### Working with Results

```bash
# Export specific benchmark
swarm-benchmark show <id> --format json > benchmark-result.json

# Process results with jq
swarm-benchmark show <id> --format json | \
  jq '.results[] | {task: .task_id, time: .execution_time}'

# Generate HTML report
swarm-benchmark show <id> --format report --export report.html
```

## ⚡ Performance Options

### Parallel Execution

Speed up execution with parallel processing:

```bash
# Enable parallel execution
swarm-benchmark run "Process multiple files" \
  --parallel \
  --max-agents 8

# Parallel with monitoring
swarm-benchmark run "Analyze dataset" \
  --parallel \
  --monitor \
  --metrics-interval 2
```

### Resource Limits

Control resource usage:

```bash
# Set resource limits
swarm-benchmark run "Resource-intensive task" \
  --memory-limit 2048 \
  --cpu-limit 75 \
  --timeout 30
```

### Background Execution

Run long benchmarks in the background:

```bash
# Start in background
swarm-benchmark run "Long analysis task" \
  --background \
  --name "overnight-analysis"

# Check status later
swarm-benchmark list --filter-name "overnight-analysis"
```

## 🎯 Quality Control

### Quality Thresholds

Ensure high-quality results:

```bash
# High quality requirement
swarm-benchmark run "Critical calculation" \
  --quality-threshold 0.95 \
  --max-retries 5

# With review process
swarm-benchmark run "Important document" \
  --quality-threshold 0.9 \
  --review \
  --testing
```

### Validation

Enable strict validation:

```bash
# Strict validation
swarm-benchmark run "Generate secure code" \
  --validation-mode strict \
  --testing

# With automated testing
swarm-benchmark run "Create API endpoints" \
  --testing \
  --test-coverage 0.8
```

## 📈 Monitoring and Debugging

### Real-time Monitoring

Watch execution in real-time:

```bash
# Basic monitoring
swarm-benchmark run "Long task" --monitor

# Detailed monitoring
swarm-benchmark run "Complex task" \
  --monitor \
  --verbose \
  --metrics-interval 1
```

### Debugging

Troubleshoot issues:

```bash
# Verbose output
swarm-benchmark -v run "Problematic task"

# With execution trace
swarm-benchmark run "Debug this" \
  --verbose \
  --trace \
  --profile

# Dry run to check configuration
swarm-benchmark run "Test configuration" \
  --dry-run \
  --verbose
```

## 🔄 Cleanup and Maintenance

### Managing Results

Keep your results organized:

```bash
# Clean old results
swarm-benchmark clean --older-than 7

# Keep only recent benchmarks
swarm-benchmark clean --keep-recent 50

# Clean by status
swarm-benchmark clean --status failed
```

## 💡 Best Practices

### 1. Start Simple

Begin with basic commands and add complexity:

```bash
# Start here
swarm-benchmark run "Your task"

# Then add strategy
swarm-benchmark run "Your task" --strategy development

# Then optimize
swarm-benchmark run "Your task" \
  --strategy development \
  --mode hierarchical \
  --parallel
```

### 2. Use Descriptive Objectives

Be specific about what you want:

```bash
# ❌ Too vague
swarm-benchmark run "Make API"

# ✅ Clear and specific
swarm-benchmark run "Create REST API for user management with JWT authentication"
```

### 3. Monitor Important Runs

Always monitor critical benchmarks:

```bash
swarm-benchmark run "Production task" \
  --monitor \
  --quality-threshold 0.9 \
  --name "prod-deploy-$(date +%Y%m%d)"
```

### 4. Save Important Results

Export and backup critical benchmarks:

```bash
# Export important results
swarm-benchmark show <important-id> --format json \
  > backups/benchmark-$(date +%Y%m%d).json

# Compress old results
tar -czf benchmarks-archive.tar.gz ./reports/
```

### 5. Use Configuration Files

For complex or repeated benchmarks:

```yaml
# benchmark-config.yaml
name: "Daily Analysis"
strategy: analysis
mode: distributed
max_agents: 8
parallel: true
output_formats:
  - json
  - sqlite
```

```bash
swarm-benchmark -c benchmark-config.yaml run "Daily data analysis"
```

## 🎉 Next Steps

Now that you understand basic usage:

1. Explore [Optimization Guide](optimization-guide.md) for performance tips
2. Read [Strategies Guide](strategies.md) for detailed strategy information
3. Check [Coordination Modes](coordination-modes.md) for mode selection
4. See [CLI Reference](cli-reference.md) for all available options

Happy benchmarking! 🚀