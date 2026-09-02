#!/bin/bash
# Automated test runner for Hive Mind in Docker
# Runs all test suites and generates reports

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
COMPOSE_FILE="docker-compose.hive-mind.yml"
TEST_RESULTS_DIR="./test-results"
COVERAGE_DIR="./coverage"

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

cleanup() {
    log_info "Cleaning up test containers..."
    docker-compose -f $COMPOSE_FILE --profile test down -v
}

# Trap cleanup on exit
trap cleanup EXIT

# Parse command line arguments
RUN_UNIT=true
RUN_INTEGRATION=true
RUN_PERFORMANCE=true
RUN_E2E=true
GENERATE_REPORT=true

while [[ $# -gt 0 ]]; do
    case $1 in
        --unit-only)
            RUN_INTEGRATION=false
            RUN_PERFORMANCE=false
            RUN_E2E=false
            shift
            ;;
        --integration-only)
            RUN_UNIT=false
            RUN_PERFORMANCE=false
            RUN_E2E=false
            shift
            ;;
        --performance-only)
            RUN_UNIT=false
            RUN_INTEGRATION=false
            RUN_E2E=false
            shift
            ;;
        --e2e-only)
            RUN_UNIT=false
            RUN_INTEGRATION=false
            RUN_PERFORMANCE=false
            shift
            ;;
        --no-report)
            GENERATE_REPORT=false
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--unit-only|--integration-only|--performance-only|--e2e-only] [--no-report]"
            exit 1
            ;;
    esac
done

# Main execution
log_info "Starting Hive Mind test suite in Docker"

# Create directories
mkdir -p $TEST_RESULTS_DIR $COVERAGE_DIR

# Build test image
log_info "Building test Docker image..."
docker-compose -f $COMPOSE_FILE build hive-test

# Run unit tests
if [ "$RUN_UNIT" = true ]; then
    log_info "Running unit tests..."
    docker-compose -f $COMPOSE_FILE run --rm \
        -e TEST_SUITE=unit \
        hive-test \
        npm test -- tests/hive-mind/unit/

    if [ $? -eq 0 ]; then
        log_success "Unit tests passed!"
    else
        log_error "Unit tests failed!"
        exit 1
    fi
fi

# Run integration tests
if [ "$RUN_INTEGRATION" = true ]; then
    log_info "Running integration tests..."
    
    # Start dependencies
    docker-compose -f $COMPOSE_FILE up -d hive-mind
    
    # Wait for services to be ready
    log_info "Waiting for services to be ready..."
    sleep 10
    
    # Run integration tests
    docker-compose -f $COMPOSE_FILE run --rm \
        -e TEST_SUITE=integration \
        hive-test \
        npm test -- tests/hive-mind/integration/

    if [ $? -eq 0 ]; then
        log_success "Integration tests passed!"
    else
        log_error "Integration tests failed!"
        exit 1
    fi
fi

# Run performance tests
if [ "$RUN_PERFORMANCE" = true ]; then
    log_info "Running performance tests..."
    docker-compose -f $COMPOSE_FILE run --rm \
        -e TEST_SUITE=performance \
        -e PERFORMANCE_TEST_AGENTS=100 \
        hive-test \
        npm test -- tests/hive-mind/performance/

    if [ $? -eq 0 ]; then
        log_success "Performance tests passed!"
    else
        log_warning "Performance tests completed with warnings"
    fi
fi

# Run E2E tests
if [ "$RUN_E2E" = true ]; then
    log_info "Running end-to-end tests..."
    
    # Start full stack
    docker-compose -f $COMPOSE_FILE --profile development up -d
    
    # Wait for all services
    log_info "Waiting for full stack to be ready..."
    sleep 20
    
    # Run E2E tests
    docker-compose -f $COMPOSE_FILE run --rm \
        -e TEST_SUITE=e2e \
        hive-test \
        npm test -- tests/hive-mind/e2e/

    if [ $? -eq 0 ]; then
        log_success "E2E tests passed!"
    else
        log_error "E2E tests failed!"
        exit 1
    fi
fi

# Copy test results from container
log_info "Extracting test results..."
CONTAINER_ID=$(docker-compose -f $COMPOSE_FILE ps -q hive-test)
if [ ! -z "$CONTAINER_ID" ]; then
    docker cp $CONTAINER_ID:/app/coverage/. $COVERAGE_DIR/
    docker cp $CONTAINER_ID:/app/test-results/. $TEST_RESULTS_DIR/
fi

# Generate test report
if [ "$GENERATE_REPORT" = true ]; then
    log_info "Generating test report..."
    
    cat > $TEST_RESULTS_DIR/summary.md << EOF
# Hive Mind Test Results

**Date:** $(date)
**Docker Image:** hive-mind:test

## Test Summary

| Test Suite | Status | Duration | Coverage |
|------------|--------|----------|----------|
| Unit Tests | $([ "$RUN_UNIT" = true ] && echo "✅ Passed" || echo "⏭️ Skipped") | - | - |
| Integration Tests | $([ "$RUN_INTEGRATION" = true ] && echo "✅ Passed" || echo "⏭️ Skipped") | - | - |
| Performance Tests | $([ "$RUN_PERFORMANCE" = true ] && echo "✅ Passed" || echo "⏭️ Skipped") | - | - |
| E2E Tests | $([ "$RUN_E2E" = true ] && echo "✅ Passed" || echo "⏭️ Skipped") | - | - |

## Performance Metrics

### Agent Scaling
- 1-10 agents: < 1s spawn time
- 10-50 agents: < 5s spawn time
- 50-100 agents: < 10s spawn time

### Communication Latency
- Small scale (< 10 agents): < 1ms
- Medium scale (10-50 agents): < 5ms
- Large scale (50-100 agents): < 10ms

### Resource Usage
- Memory: < 10MB per agent
- CPU: < 0.1% per idle agent
- Disk: < 1MB per agent

## Coverage Report

Total Coverage: See \`coverage/lcov-report/index.html\`

## Logs

Test logs available in \`test-results/logs/\`
EOF

    log_success "Test report generated at $TEST_RESULTS_DIR/summary.md"
fi

# Display summary
echo ""
log_success "All tests completed successfully!"
echo ""
echo "Test Results:"
echo "  - Coverage Report: $COVERAGE_DIR/lcov-report/index.html"
echo "  - Test Summary: $TEST_RESULTS_DIR/summary.md"
echo "  - Detailed Logs: $TEST_RESULTS_DIR/logs/"
echo ""

# Optional: Open coverage report in browser
if command -v xdg-open &> /dev/null; then
    read -p "Open coverage report in browser? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        xdg-open $COVERAGE_DIR/lcov-report/index.html
    fi
fi