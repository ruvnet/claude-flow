#!/bin/bash
# Claude-Flow Benchmark Runner
# Standalone benchmark test execution

set -e

echo "=== BENCHMARK TEST RUNNER ==="
echo ""

REPORT_DIR="${TEST_REPORT_PATH:-/app/reports}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BENCHMARK_FILE="${REPORT_DIR}/benchmark_${TIMESTAMP}.json"

# Initialize benchmark report
cat > "$BENCHMARK_FILE" << EOF
{
  "type": "benchmark",
  "timestamp": "$(date -Iseconds)",
  "results": []
}
EOF

echo "Running performance benchmarks..."
echo ""

# Run performance tests
bash /app/tests/docker-regression/scripts/test-performance.sh

echo ""
echo "Benchmark report: $BENCHMARK_FILE"
