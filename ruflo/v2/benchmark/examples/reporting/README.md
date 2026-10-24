# Enhanced Benchmark Reporting Tools

This directory contains advanced tools for viewing, analyzing, and comparing Claude Flow benchmark reports with detailed metrics and file references.

## 🛠️ Available Tools

### 1. Enhanced Report Viewer (`enhanced_report_viewer.py`)
Advanced report analysis with detailed metrics and file references.

```bash
# View summary of all reports
python enhanced_report_viewer.py --summary

# View detailed report for specific benchmark
python enhanced_report_viewer.py --id <benchmark-id>

# View latest benchmark report
python enhanced_report_viewer.py --latest

# Analyze trends across multiple benchmarks
python enhanced_report_viewer.py --trends

# Use custom report directory
python enhanced_report_viewer.py --dir ./my-reports --summary
```

**Features:**
- 📄 Complete file references (reports, metrics, process logs)
- 📊 Detailed performance metrics
- 💾 Resource usage tracking
- 📈 Trend analysis across runs
- 🏆 Best/worst performance identification

### 2. Real-time Monitor (`realtime_monitor.py`)
Monitor benchmark execution with live metrics updates.

```bash
# Monitor a simple task
python realtime_monitor.py "Create a REST API"

# Monitor with specific strategy
python realtime_monitor.py "Build authentication system" --strategy development

# Monitor with more workers
python realtime_monitor.py "Complex analysis task" --max-workers 8

# Custom output directory
python realtime_monitor.py "Test task" --output-dir ./live-reports
```

**Features:**
- ⏱️ Live execution tracking
- 📊 Real-time metrics display
- 💻 CPU and memory monitoring
- ❌ Error tracking as they occur
- 📁 Automatic file reference updates

### 3. Benchmark Comparator (`compare_benchmarks.py`)
Run and compare multiple benchmarks with detailed analysis.

```bash
# Quick comparison (3 different tasks)
python compare_benchmarks.py --preset quick

# Thorough comparison (5 configurations)
python compare_benchmarks.py --preset thorough

# Strategy comparison (6 strategies, same task)
python compare_benchmarks.py --preset strategies

# Custom output directory
python compare_benchmarks.py --preset quick --output-dir ./comparisons
```

**Features:**
- 🔬 Side-by-side performance comparison
- 🎯 Strategy effectiveness analysis
- 🏆 Best performer identification
- 📊 Aggregated metrics per strategy
- 📄 Comparison report generation

## 📊 Report Format

Each benchmark generates multiple report files:

### Main Report (`benchmark_<id>.json`)
```json
{
  "benchmark_id": "uuid",
  "status": "success",
  "duration": 12.34,
  "metrics": {
    "wall_clock_time": 12.34,
    "tasks_per_second": 0.81,
    "success_rate": 1.0,
    "peak_memory_mb": 256.5,
    "average_cpu_percent": 45.2
  },
  "results": [...]
}
```

### Metrics Report (`metrics_<id>.json`)
```json
{
  "summary": {...},
  "performance": {...},
  "resources": {...},
  "process_executions": {...}
}
```

### Process Report (`process_report_<id>.json`)
```json
{
  "summary": {...},
  "command_statistics": {...},
  "executions": [...]
}
```

## 🎯 Usage Examples

### Complete Workflow Example
```bash
# 1. Run a monitored benchmark
python realtime_monitor.py "Build user authentication" --strategy development

# 2. View the detailed report
python enhanced_report_viewer.py --latest

# 3. Compare with other strategies
python compare_benchmarks.py --preset strategies

# 4. Analyze trends over time
python enhanced_report_viewer.py --trends
```

### Batch Analysis
```bash
# Run multiple benchmarks
for task in "Create API" "Add tests" "Optimize code"; do
  swarm-benchmark real swarm "$task" --output-dir ./batch-reports
done

# Analyze all results
python enhanced_report_viewer.py --dir ./batch-reports --summary
python enhanced_report_viewer.py --dir ./batch-reports --trends
```

## 📈 Metrics Explained

### Performance Metrics
- **Wall Clock Time**: Total real-world execution time
- **Tasks/Second**: Throughput measure
- **Success Rate**: Percentage of successful task completions

### Resource Metrics
- **Peak Memory**: Maximum memory usage during execution
- **Average CPU**: Mean CPU utilization
- **Total Tokens**: LLM tokens consumed (if available)

### Process Metrics
- **Command Statistics**: Breakdown by command type
- **Execution Count**: Number of subprocess calls
- **Average Duration**: Mean time per command

## 🔍 Troubleshooting

### No Reports Found
```bash
# Check report directory exists
ls -la reports/

# Ensure benchmarks are saving to correct location
swarm-benchmark real swarm "test" --output-dir ./reports
```

### Incomplete Metrics
- Some metrics require longer-running benchmarks (>5s)
- Memory metrics need appropriate permissions
- Token metrics only available with LLM integrations

### Permission Issues
```bash
# Make scripts executable
chmod +x *.py

# Ensure write permissions for reports
chmod 755 reports/
```

## 🚀 Advanced Features

### Custom Report Processing
```python
from enhanced_report_viewer import BenchmarkReport, EnhancedReportViewer

# Load and process reports programmatically
viewer = EnhancedReportViewer()
viewer.load_reports()

for report in viewer.reports:
    print(f"ID: {report.benchmark_id}")
    print(f"Success Rate: {report.success_rate:.1%}")
    print(f"Tokens: {report.total_tokens}")
```

### Integration with CI/CD
```yaml
# GitHub Actions example
- name: Run Benchmarks
  run: |
    python compare_benchmarks.py --preset quick
    python enhanced_report_viewer.py --trends
```

## 📝 Notes

- Reports are saved with UUIDs for unique identification
- All timestamps are in ISO format for consistency
- Metrics are aggregated at multiple levels for flexibility
- File references use absolute paths when possible