#!/bin/bash
# Run various benchmark scenarios

echo "🚀 Claude Flow Benchmark Suite"
echo "================================"

# Create output directory
mkdir -p ./benchmark-results

# 1. Simple swarm benchmark
echo -e "\n📊 Running Swarm Benchmark..."
swarm-benchmark real swarm "Create a simple function" \
    --strategy development \
    --max-agents 3 \
    --timeout 2 \
    --output-dir ./benchmark-results

# 2. Hive-mind benchmark
echo -e "\n🐝 Running Hive-Mind Benchmark..."
swarm-benchmark real hive-mind "Design a REST API" \
    --max-workers 4 \
    --queen-type strategic \
    --timeout 2 \
    --output-dir ./benchmark-results

# 3. SPARC coder benchmark
echo -e "\n💻 Running SPARC Coder Benchmark..."
swarm-benchmark real sparc coder "Implement hello world" \
    --timeout 2 \
    --output-dir ./benchmark-results

# 4. SPARC architect benchmark  
echo -e "\n🏗️ Running SPARC Architect Benchmark..."
swarm-benchmark real sparc architect "Design microservices" \
    --timeout 2 \
    --output-dir ./benchmark-results

echo -e "\n✅ All benchmarks completed!"
echo "Results saved in ./benchmark-results/"