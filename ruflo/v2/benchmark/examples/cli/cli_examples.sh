#!/bin/bash
# CLI Examples for Claude Flow Swarm Benchmarks
# 
# This script demonstrates various CLI commands for running benchmarks
# with different strategies, coordination modes, and configurations.

set -e  # Exit on any error

echo "🚀 Claude Flow Swarm Benchmark CLI Examples"
echo "============================================="
echo ""

# Configuration
BENCHMARK_DIR="/workspaces/claude-code-flow/benchmark"
OUTPUT_DIR="$BENCHMARK_DIR/examples/output/cli_results"
mkdir -p "$OUTPUT_DIR"

echo "📁 Output directory: $OUTPUT_DIR"
echo ""

# Function to run a benchmark with error handling
run_benchmark() {
    local name="$1"
    local cmd="$2"
    
    echo "🔧 Running: $name"
    echo "   Command: $cmd"
    echo "   Started: $(date)"
    
    if eval "$cmd"; then
        echo "   ✅ Success"
    else
        echo "   ❌ Failed (exit code: $?)"
    fi
    echo "   Completed: $(date)"
    echo ""
}

# Basic Swarm Examples
echo "📋 Basic Swarm Examples"
echo "------------------------"

run_benchmark "Simple Development Task" \
    "swarm-benchmark real swarm 'Create a hello world function' --strategy development --max-agents 3"

run_benchmark "API Development with Hierarchical Coordination" \
    "swarm-benchmark real swarm 'Build a REST API with authentication' --strategy development --coordination hierarchical --max-agents 5"

run_benchmark "Code Optimization with Mesh Coordination" \
    "swarm-benchmark real swarm 'Optimize database queries for performance' --strategy optimization --coordination mesh --max-agents 4"

# Hive-Mind Examples
echo "🧠 Hive-Mind Examples"
echo "----------------------"

run_benchmark "Collective Intelligence Analysis" \
    "swarm-benchmark real hive-mind 'Analyze code patterns and suggest improvements' --agents 5 --thinking-pattern collective"

run_benchmark "Consensus-Based Decision Making" \
    "swarm-benchmark real hive-mind 'Choose best architecture for microservices' --agents 6 --coordination consensus --thinking-pattern convergent"

run_benchmark "Distributed Research Task" \
    "swarm-benchmark real hive-mind 'Research machine learning best practices' --agents 4 --coordination distributed --thinking-pattern divergent"

# SPARC Examples
echo "⚡ SPARC Examples"
echo "-----------------"

run_benchmark "TDD Development Process" \
    "swarm-benchmark real sparc 'Implement user management system' --mode tdd --agents 4 --refinement-cycles 2"

run_benchmark "Architecture-First Approach" \
    "swarm-benchmark real sparc 'Design payment processing system' --mode architecture --agents 5 --refinement-cycles 3"

run_benchmark "Specification-Driven Development" \
    "swarm-benchmark real sparc 'Create notification service' --mode specification --agents 3 --refinement-cycles 2"

# Advanced Configuration Examples
echo "🔧 Advanced Configuration Examples"
echo "-----------------------------------"

run_benchmark "High-Performance Parallel Execution" \
    "swarm-benchmark real swarm 'Process large dataset efficiently' --strategy optimization --coordination mesh --max-agents 8 --parallel true --cache enabled"

run_benchmark "Quality-Focused with Validation" \
    "swarm-benchmark real swarm 'Build secure authentication system' --strategy development --coordination hierarchical --max-agents 6 --validation enabled --review-depth deep"

run_benchmark "Token-Optimized Execution" \
    "swarm-benchmark real swarm 'Generate API documentation' --strategy research --coordination ring --max-agents 3 --token-optimization true --compression enabled"

# Comparative Benchmarks
echo "📊 Comparative Benchmarks"
echo "--------------------------"

TASK="Create a complete CRUD API with tests"

run_benchmark "Swarm Development Strategy" \
    "swarm-benchmark real swarm '$TASK' --strategy development --coordination hierarchical --max-agents 5 --output-file '$OUTPUT_DIR/swarm_dev.json'"

run_benchmark "Hive-Mind Collective Approach" \
    "swarm-benchmark real hive-mind '$TASK' --thinking-pattern collective --coordination mesh --agents 5 --output-file '$OUTPUT_DIR/hive_collective.json'"

run_benchmark "SPARC TDD Methodology" \
    "swarm-benchmark real sparc '$TASK' --mode tdd --coordination hierarchical --agents 5 --output-file '$OUTPUT_DIR/sparc_tdd.json'"

# Batch Processing Examples
echo "🔄 Batch Processing Examples"
echo "-----------------------------"

# Create a batch configuration file
cat > "$OUTPUT_DIR/batch_config.json" << EOF
{
  "benchmarks": [
    {
      "name": "api_development",
      "type": "swarm",
      "task": "Create REST API with authentication",
      "strategy": "development",
      "coordination": "hierarchical",
      "agents": 5
    },
    {
      "name": "optimization_analysis", 
      "type": "swarm",
      "task": "Analyze and optimize code performance",
      "strategy": "optimization",
      "coordination": "mesh",
      "agents": 4
    },
    {
      "name": "collective_research",
      "type": "hive-mind", 
      "task": "Research best practices for testing",
      "thinking_pattern": "collective",
      "coordination": "distributed",
      "agents": 6
    }
  ]
}
EOF

run_benchmark "Batch Processing from Config" \
    "swarm-benchmark batch --config '$OUTPUT_DIR/batch_config.json' --output-dir '$OUTPUT_DIR/batch_results'"

# Performance Testing Examples
echo "⚡ Performance Testing Examples"
echo "-------------------------------"

run_benchmark "Load Testing with Multiple Agents" \
    "swarm-benchmark performance load --agents 3,5,7 --iterations 3 --task 'Simple function creation' --output-dir '$OUTPUT_DIR/load_test'"

run_benchmark "Stress Testing Coordination Modes" \
    "swarm-benchmark performance stress --coordination hierarchical,mesh,ring --agents 5 --task 'Complex API development' --output-dir '$OUTPUT_DIR/stress_test'"

run_benchmark "Benchmark Comparison Suite" \
    "swarm-benchmark performance compare --methodologies swarm,hive-mind,sparc --task 'Build microservice' --agents 4 --output-dir '$OUTPUT_DIR/comparison'"

# Monitoring and Analysis Examples
echo "📊 Monitoring and Analysis Examples"
echo "------------------------------------"

run_benchmark "Real-time Metrics Collection" \
    "swarm-benchmark real swarm 'Develop chat application' --strategy development --coordination hierarchical --max-agents 5 --enable-metrics --monitor-resources --output-format detailed"

run_benchmark "Token Usage Analysis" \
    "swarm-benchmark analyze tokens --benchmark-id 'recent' --output-file '$OUTPUT_DIR/token_analysis.json'"

run_benchmark "Performance Report Generation" \
    "swarm-benchmark report generate --timeframe 24h --format html --output-file '$OUTPUT_DIR/performance_report.html'"

# Integration Examples
echo "🔗 Integration Examples"
echo "------------------------"

run_benchmark "GitHub Integration Benchmark" \
    "swarm-benchmark real swarm 'Setup CI/CD pipeline' --strategy development --coordination hierarchical --max-agents 4 --github-integration --repo-context enabled"

run_benchmark "Docker Container Benchmark" \
    "swarm-benchmark real swarm 'Containerize application' --strategy optimization --coordination mesh --max-agents 3 --docker-context enabled"

# Utility Examples
echo "🛠️  Utility Examples"
echo "---------------------"

echo "🔍 List Available Strategies:"
swarm-benchmark list strategies

echo ""
echo "🔗 List Coordination Modes:"
swarm-benchmark list coordination-modes

echo ""
echo "📊 Show Recent Benchmarks:"
swarm-benchmark list recent --limit 5

echo ""
echo "💾 Export Benchmark Data:"
swarm-benchmark export --format csv --output-file "$OUTPUT_DIR/all_benchmarks.csv"

echo ""
echo "🧹 Cleanup Old Results:"
swarm-benchmark cleanup --older-than 7d --dry-run

# Summary
echo "📋 CLI Examples Summary"
echo "========================"
echo ""
echo "✅ Completed CLI examples demonstration"
echo "📁 Results saved to: $OUTPUT_DIR"
echo "🔧 Commands demonstrated:"
echo "   - Basic swarm, hive-mind, and SPARC benchmarks"
echo "   - Advanced configuration options"
echo "   - Comparative analysis"
echo "   - Batch processing"
echo "   - Performance testing"
echo "   - Monitoring and analysis"
echo "   - Integration scenarios"
echo "   - Utility functions"
echo ""
echo "💡 Next steps:"
echo "   - Review output files for detailed results"
echo "   - Customize commands for your specific use cases"
echo "   - Integrate with CI/CD pipelines"
echo "   - Set up automated benchmarking schedules"
echo ""
echo "📖 For more information:"
echo "   swarm-benchmark --help"
echo "   swarm-benchmark <command> --help"
echo ""

# Make the script executable
chmod +x "$0"

echo "🎉 CLI Examples Complete!"