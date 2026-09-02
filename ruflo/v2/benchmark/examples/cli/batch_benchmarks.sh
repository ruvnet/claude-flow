#!/bin/bash
# Batch Benchmark Execution Script
#
# This script runs multiple benchmarks in sequence or parallel,
# collects comprehensive metrics, and generates analysis reports.

set -e

echo "🔄 Claude Flow Batch Benchmark Execution"
echo "=========================================="
echo ""

# Configuration
BENCHMARK_DIR="/workspaces/claude-code-flow/benchmark"
OUTPUT_DIR="$BENCHMARK_DIR/examples/output/batch_results"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BATCH_OUTPUT="$OUTPUT_DIR/batch_$TIMESTAMP"

mkdir -p "$BATCH_OUTPUT"

echo "📁 Batch output directory: $BATCH_OUTPUT"
echo "⏰ Batch started: $(date)"
echo ""

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$BATCH_OUTPUT/batch.log"
}

# Function to run benchmark with comprehensive logging
run_batch_benchmark() {
    local name="$1"
    local type="$2"
    local task="$3"
    local strategy="$4"
    local coordination="$5"
    local agents="$6"
    local additional_args="$7"
    
    local benchmark_id="${name}_${TIMESTAMP}"
    local output_file="$BATCH_OUTPUT/${name}.json"
    local metrics_file="$BATCH_OUTPUT/${name}_metrics.json"
    
    log "🚀 Starting benchmark: $name"
    log "   Type: $type"
    log "   Strategy: $strategy"
    log "   Coordination: $coordination"
    log "   Agents: $agents"
    
    local start_time=$(date +%s)
    
    # Build command based on type
    local cmd
    case "$type" in
        "swarm")
            cmd="swarm-benchmark real swarm '$task' --strategy $strategy --coordination $coordination --max-agents $agents"
            ;;
        "hive-mind")
            cmd="swarm-benchmark real hive-mind '$task' --thinking-pattern $strategy --coordination $coordination --agents $agents"
            ;;
        "sparc")
            cmd="swarm-benchmark real sparc '$task' --mode $strategy --coordination $coordination --agents $agents"
            ;;
        *)
            log "❌ Unknown benchmark type: $type"
            return 1
            ;;
    esac
    
    # Add additional arguments and output specification
    cmd="$cmd $additional_args --output-file $output_file --enable-metrics --benchmark-id $benchmark_id"
    
    log "   Command: $cmd"
    
    # Execute benchmark
    if eval "$cmd" > "$BATCH_OUTPUT/${name}_output.log" 2>&1; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        log "   ✅ Success (${duration}s)"
        
        # Extract metrics if available
        if [ -f "$output_file" ]; then
            log "   📊 Metrics saved to: $output_file"
        fi
        
        # Record benchmark result
        cat > "$metrics_file" << EOF
{
  "benchmark_id": "$benchmark_id",
  "name": "$name",
  "type": "$type", 
  "task": "$task",
  "strategy": "$strategy",
  "coordination": "$coordination",
  "agents": $agents,
  "start_time": $start_time,
  "end_time": $end_time,
  "duration": $duration,
  "success": true,
  "output_file": "$output_file"
}
EOF
        
        return 0
    else
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        
        log "   ❌ Failed (${duration}s)"
        
        # Record failure
        cat > "$metrics_file" << EOF
{
  "benchmark_id": "$benchmark_id",
  "name": "$name",
  "type": "$type",
  "task": "$task", 
  "strategy": "$strategy",
  "coordination": "$coordination",
  "agents": $agents,
  "start_time": $start_time,
  "end_time": $end_time,
  "duration": $duration,
  "success": false,
  "error_log": "$BATCH_OUTPUT/${name}_output.log"
}
EOF
        
        return 1
    fi
}

# Parallel execution function
run_parallel_batch() {
    local pids=()
    local benchmark_names=()
    
    log "🔀 Starting parallel benchmark execution"
    
    # Start all benchmarks in background
    run_batch_benchmark "parallel_swarm_dev" "swarm" "Create REST API with authentication" "development" "hierarchical" 4 "--timeout 180" &
    pids+=($!)
    benchmark_names+=("parallel_swarm_dev")
    
    run_batch_benchmark "parallel_hive_research" "hive-mind" "Research microservices patterns" "collective" "distributed" 5 "--timeout 180" &
    pids+=($!)
    benchmark_names+=("parallel_hive_research")
    
    run_batch_benchmark "parallel_sparc_tdd" "sparc" "Implement user service with tests" "tdd" "hierarchical" 3 "--timeout 180" &
    pids+=($!)
    benchmark_names+=("parallel_sparc_tdd")
    
    # Wait for all to complete
    local failed_count=0
    for i in "${!pids[@]}"; do
        local pid=${pids[i]}
        local name=${benchmark_names[i]}
        
        if wait $pid; then
            log "✅ Parallel benchmark completed: $name"
        else
            log "❌ Parallel benchmark failed: $name"
            ((failed_count++))
        fi
    done
    
    log "🔀 Parallel execution complete. Failures: $failed_count"
    return $failed_count
}

# Main batch execution
log "🚀 Starting batch benchmark execution"

# Sequential benchmarks - Basic functionality
log "📋 Sequential Benchmarks - Basic Functionality"
echo "================================================"

run_batch_benchmark "basic_hello_world" "swarm" "Create a hello world function with error handling" "development" "hierarchical" 3 "--timeout 120"

run_batch_benchmark "basic_api_crud" "swarm" "Build a simple CRUD API for users" "development" "hierarchical" 4 "--timeout 180"

run_batch_benchmark "basic_optimization" "swarm" "Analyze and optimize code performance" "optimization" "mesh" 4 "--timeout 150"

# Sequential benchmarks - Hive-mind
log "🧠 Sequential Benchmarks - Hive-Mind"
echo "======================================"

run_batch_benchmark "hive_collective_analysis" "hive-mind" "Analyze codebase for security vulnerabilities" "collective" "mesh" 5 "--timeout 200"

run_batch_benchmark "hive_consensus_architecture" "hive-mind" "Design optimal microservices architecture" "consensus" "distributed" 6 "--timeout 240"

# Sequential benchmarks - SPARC
log "⚡ Sequential Benchmarks - SPARC"
echo "=================================="

run_batch_benchmark "sparc_tdd_service" "sparc" "Develop payment processing service" "tdd" "hierarchical" 4 "--refinement-cycles 2 --timeout 200"

run_batch_benchmark "sparc_architecture_design" "sparc" "Design scalable chat application" "architecture" "hierarchical" 5 "--refinement-cycles 3 --timeout 180"

# Comparative benchmarks - Same task, different approaches
log "📊 Comparative Benchmarks - Same Task, Different Approaches"
echo "============================================================="

COMPARISON_TASK="Create a complete e-commerce product catalog API with search functionality"

run_batch_benchmark "compare_swarm_dev" "swarm" "$COMPARISON_TASK" "development" "hierarchical" 5 "--timeout 300"

run_batch_benchmark "compare_hive_collective" "hive-mind" "$COMPARISON_TASK" "collective" "mesh" 5 "--timeout 300"

run_batch_benchmark "compare_sparc_tdd" "sparc" "$COMPARISON_TASK" "tdd" "hierarchical" 5 "--refinement-cycles 2 --timeout 300"

# Scaling benchmarks - Different agent counts
log "📈 Scaling Benchmarks - Different Agent Counts"
echo "==============================================="

SCALING_TASK="Implement distributed caching system"

run_batch_benchmark "scale_3_agents" "swarm" "$SCALING_TASK" "optimization" "mesh" 3 "--timeout 180"

run_batch_benchmark "scale_5_agents" "swarm" "$SCALING_TASK" "optimization" "mesh" 5 "--timeout 200"

run_batch_benchmark "scale_7_agents" "swarm" "$SCALING_TASK" "optimization" "mesh" 7 "--timeout 220"

# Coordination mode comparison
log "🔗 Coordination Mode Comparison"
echo "================================="

COORDINATION_TASK="Build monitoring and alerting system"

run_batch_benchmark "coord_hierarchical" "swarm" "$COORDINATION_TASK" "development" "hierarchical" 4 "--timeout 180"

run_batch_benchmark "coord_mesh" "swarm" "$COORDINATION_TASK" "development" "mesh" 4 "--timeout 180"

run_batch_benchmark "coord_ring" "swarm" "$COORDINATION_TASK" "development" "ring" 4 "--timeout 180"

# Parallel execution demonstration
log "🔀 Running parallel benchmarks"
run_parallel_batch

# Generate comprehensive analysis
log "📊 Generating batch analysis report"

python3 << EOF
import json
import glob
import os
from datetime import datetime

# Collect all metrics files
metrics_files = glob.glob("$BATCH_OUTPUT/*_metrics.json")
all_metrics = []

for file_path in metrics_files:
    try:
        with open(file_path, 'r') as f:
            metrics = json.load(f)
            all_metrics.append(metrics)
    except Exception as e:
        print(f"Error reading {file_path}: {e}")

# Generate analysis
successful_benchmarks = [m for m in all_metrics if m.get('success', False)]
failed_benchmarks = [m for m in all_metrics if not m.get('success', False)]

analysis = {
    "batch_timestamp": "$TIMESTAMP",
    "total_benchmarks": len(all_metrics),
    "successful_benchmarks": len(successful_benchmarks),
    "failed_benchmarks": len(failed_benchmarks),
    "success_rate": len(successful_benchmarks) / len(all_metrics) if all_metrics else 0,
    "total_duration": sum(m.get('duration', 0) for m in all_metrics),
    "average_duration": sum(m.get('duration', 0) for m in successful_benchmarks) / len(successful_benchmarks) if successful_benchmarks else 0,
    "benchmarks_by_type": {},
    "benchmarks_by_strategy": {},
    "benchmarks_by_coordination": {},
    "agent_scaling_analysis": {},
    "fastest_benchmark": None,
    "slowest_benchmark": None
}

# Analyze by type
for metrics in all_metrics:
    benchmark_type = metrics.get('type', 'unknown')
    if benchmark_type not in analysis['benchmarks_by_type']:
        analysis['benchmarks_by_type'][benchmark_type] = {'count': 0, 'successful': 0, 'avg_duration': 0}
    
    analysis['benchmarks_by_type'][benchmark_type]['count'] += 1
    if metrics.get('success'):
        analysis['benchmarks_by_type'][benchmark_type]['successful'] += 1

# Find fastest and slowest
if successful_benchmarks:
    analysis['fastest_benchmark'] = min(successful_benchmarks, key=lambda x: x.get('duration', float('inf')))
    analysis['slowest_benchmark'] = max(successful_benchmarks, key=lambda x: x.get('duration', 0))

# Save analysis
with open("$BATCH_OUTPUT/batch_analysis.json", 'w') as f:
    json.dump(analysis, f, indent=2)

# Generate CSV summary
with open("$BATCH_OUTPUT/batch_summary.csv", 'w') as f:
    f.write("name,type,strategy,coordination,agents,success,duration\n")
    for metrics in all_metrics:
        f.write(f"{metrics.get('name', '')},{metrics.get('type', '')},{metrics.get('strategy', '')},"
                f"{metrics.get('coordination', '')},{metrics.get('agents', 0)},{metrics.get('success', False)},"
                f"{metrics.get('duration', 0)}\n")

print(f"📊 Analysis complete. Results saved to $BATCH_OUTPUT/")
EOF

# Final summary
log "📋 Batch Execution Summary"
echo "============================="

if [ -f "$BATCH_OUTPUT/batch_analysis.json" ]; then
    python3 << EOF
import json

with open("$BATCH_OUTPUT/batch_analysis.json", 'r') as f:
    analysis = json.load(f)

print(f"Total benchmarks: {analysis['total_benchmarks']}")
print(f"Success rate: {analysis['success_rate']:.1%}")
print(f"Total execution time: {analysis['total_duration']}s")
print(f"Average duration: {analysis['average_duration']:.1f}s")

if analysis.get('fastest_benchmark'):
    fastest = analysis['fastest_benchmark']
    print(f"Fastest: {fastest['name']} ({fastest['duration']}s)")

if analysis.get('slowest_benchmark'):
    slowest = analysis['slowest_benchmark']
    print(f"Slowest: {slowest['name']} ({slowest['duration']}s)")

print(f"\nBenchmarks by type:")
for bench_type, stats in analysis['benchmarks_by_type'].items():
    success_rate = stats['successful'] / stats['count'] if stats['count'] > 0 else 0
    print(f"  {bench_type}: {stats['count']} total, {success_rate:.1%} success rate")
EOF
fi

log "⏰ Batch completed: $(date)"
log "📁 All results saved to: $BATCH_OUTPUT"

echo ""
echo "🎉 Batch Benchmark Execution Complete!"
echo ""
echo "📁 Results Location: $BATCH_OUTPUT"
echo "📊 Key Files:"
echo "   - batch_analysis.json: Comprehensive analysis"
echo "   - batch_summary.csv: Summary data for spreadsheets"
echo "   - batch.log: Execution log"
echo "   - *_metrics.json: Individual benchmark metrics"
echo "   - *_output.log: Individual benchmark outputs"
echo ""
echo "💡 Next Steps:"
echo "   - Review analysis results"
echo "   - Import CSV data into analysis tools"
echo "   - Compare performance across different configurations"
echo "   - Use insights to optimize future benchmarks"