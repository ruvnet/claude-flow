#!/bin/bash
#
# AgentDB Test Suite Runner
# Runs comprehensive AgentDB tests with coverage reporting
#

set -e

echo "🧪 AgentDB Integration Test Suite"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test configuration
COVERAGE_THRESHOLD=90
VERBOSE=${VERBOSE:-false}

print_status() {
  echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check if running in CI
if [ -n "$CI" ]; then
  print_status "Running in CI environment"
  VERBOSE=true
fi

# Clean up test databases
print_status "Cleaning up old test databases..."
rm -f /tmp/test-*.db /tmp/legacy-*.db /tmp/agentdb-*.db
rm -f /tmp/*.db-shm /tmp/*.db-wal
print_success "Cleanup complete"

# Run unit tests
echo ""
print_status "Running Unit Tests..."
echo "=================================="

# Adapter tests
print_status "1. AgentDB Memory Adapter Tests (50+ tests)"
npm run test -- tests/unit/memory/agentdb/adapter.test.js --coverage --verbose=$VERBOSE
ADAPTER_EXIT=$?

# Backend tests
print_status "2. AgentDB Backend Tests (40+ tests)"
npm run test -- tests/unit/memory/agentdb/backend.test.js --coverage --verbose=$VERBOSE
BACKEND_EXIT=$?

# Migration tests
print_status "3. Legacy Data Bridge Tests (30+ tests)"
npm run test -- tests/unit/memory/agentdb/migration.test.js --coverage --verbose=$VERBOSE
MIGRATION_EXIT=$?

# Run integration tests
echo ""
print_status "Running Integration Tests..."
echo "=================================="

print_status "4. System Integration Tests (30+ tests)"
npm run test -- tests/integration/agentdb/compatibility.test.js --coverage --verbose=$VERBOSE
INTEGRATION_EXIT=$?

# Run performance benchmarks
echo ""
print_status "Running Performance Benchmarks..."
echo "=================================="

print_status "5. Performance Benchmark Suite (20+ tests)"
npm run test -- tests/performance/agentdb/benchmarks.test.js --verbose=$VERBOSE
PERFORMANCE_EXIT=$?

# Generate coverage report
echo ""
print_status "Generating Coverage Report..."
echo "=================================="

npm run test:coverage -- tests/unit/memory/agentdb/ tests/integration/agentdb/

# Check coverage threshold
COVERAGE_REPORT="coverage/coverage-summary.json"
if [ -f "$COVERAGE_REPORT" ]; then
  COVERAGE=$(node -e "
    const report = require('./$COVERAGE_REPORT');
    const total = report.total;
    const linesPct = total.lines.pct;
    const statementsPct = total.statements.pct;
    const functionsPct = total.functions.pct;
    const branchesPct = total.branches.pct;
    const avg = (linesPct + statementsPct + functionsPct + branchesPct) / 4;
    console.log(avg.toFixed(2));
  ")

  print_status "Overall Coverage: ${COVERAGE}%"

  if (( $(echo "$COVERAGE >= $COVERAGE_THRESHOLD" | bc -l) )); then
    print_success "Coverage threshold met (>= ${COVERAGE_THRESHOLD}%)"
  else
    print_error "Coverage below threshold (< ${COVERAGE_THRESHOLD}%)"
    print_warning "Coverage: ${COVERAGE}% (Required: ${COVERAGE_THRESHOLD}%)"
  fi
fi

# Summary
echo ""
echo "=================================="
echo "Test Suite Summary"
echo "=================================="

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

check_exit_code() {
  local name=$1
  local code=$2

  if [ $code -eq 0 ]; then
    print_success "$name: PASSED"
    PASSED_TESTS=$((PASSED_TESTS + 1))
  else
    print_error "$name: FAILED (exit code: $code)"
    FAILED_TESTS=$((FAILED_TESTS + 1))
  fi
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
}

check_exit_code "Adapter Tests" $ADAPTER_EXIT
check_exit_code "Backend Tests" $BACKEND_EXIT
check_exit_code "Migration Tests" $MIGRATION_EXIT
check_exit_code "Integration Tests" $INTEGRATION_EXIT
check_exit_code "Performance Tests" $PERFORMANCE_EXIT

echo ""
echo "Total Test Suites: $TOTAL_TESTS"
echo "Passed: $PASSED_TESTS"
echo "Failed: $FAILED_TESTS"

# Performance summary
if [ -f "tests/performance/agentdb/benchmark-results.json" ]; then
  echo ""
  print_status "Performance Benchmarks:"
  cat tests/performance/agentdb/benchmark-results.json | jq '.'
fi

# Cleanup
print_status "Cleaning up test artifacts..."
rm -f /tmp/test-*.db /tmp/legacy-*.db /tmp/agentdb-*.db
rm -f /tmp/*.db-shm /tmp/*.db-wal

# Exit with appropriate code
if [ $FAILED_TESTS -gt 0 ]; then
  echo ""
  print_error "Test suite FAILED - $FAILED_TESTS suites failed"
  exit 1
else
  echo ""
  print_success "All test suites PASSED! 🎉"
  exit 0
fi
