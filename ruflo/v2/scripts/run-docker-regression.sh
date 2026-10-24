#!/bin/bash
# Run comprehensive Docker-based regression tests for AgentDB integration

set -e

echo "🐳 Claude Flow AgentDB Integration - Docker Regression Testing"
echo "=============================================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Navigate to project root
cd "$(dirname "$0")/.."

echo -e "${BLUE}Step 1: Building Docker regression test environment...${NC}"
docker-compose -f docker/docker-compose.regression.yml build

echo ""
echo -e "${BLUE}Step 2: Running regression tests in Docker...${NC}"
echo ""

# Run tests and capture exit code
if docker-compose -f docker/docker-compose.regression.yml run --rm regression-tests; then
    TESTS_PASSED=true
else
    TESTS_PASSED=false
fi

echo ""
echo -e "${BLUE}Step 3: Copying test results from Docker...${NC}"

# Create local results directory
mkdir -p test-results/regression

# Copy results from Docker volume
docker cp claude-flow-regression:/test-results/regression-results.json test-results/regression/ 2>/dev/null || echo "No results file found"
docker cp claude-flow-regression:/test-logs test-results/regression/ 2>/dev/null || echo "No log files found"

echo ""
echo -e "${BLUE}Step 4: Generating regression report...${NC}"

# Generate human-readable report
if [ -f "test-results/regression/regression-results.json" ]; then
    node -e "
    const fs = require('fs');
    const results = JSON.parse(fs.readFileSync('test-results/regression/regression-results.json', 'utf8'));

    console.log('\\n📊 Regression Test Report');
    console.log('==========================');
    console.log('Timestamp:', results.timestamp);
    console.log('Total Tests:', results.summary.total);
    console.log('Passed:', results.summary.passed);
    console.log('Failed:', results.summary.failed);
    console.log('Pass Rate:', results.summary.passRate);
    console.log('\\n📋 Test Details:');

    const categories = {};
    results.tests.forEach(test => {
        if (!categories[test.category]) {
            categories[test.category] = { passed: 0, failed: 0 };
        }
        if (test.status === 'PASS') categories[test.category].passed++;
        if (test.status === 'FAIL') categories[test.category].failed++;
    });

    Object.keys(categories).forEach(cat => {
        console.log(\`\\n  \${cat}:\`);
        console.log(\`    Passed: \${categories[cat].passed}\`);
        console.log(\`    Failed: \${categories[cat].failed}\`);
    });
    "
fi

echo ""
echo -e "${BLUE}Step 5: Cleanup...${NC}"
docker-compose -f docker/docker-compose.regression.yml down

echo ""
echo "=============================================================="

if [ "$TESTS_PASSED" = true ]; then
    echo -e "${GREEN}✅ All regression tests passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Review test results: test-results/regression/regression-results.json"
    echo "  2. Update documentation if needed"
    echo "  3. Ready for publishing!"
    exit 0
else
    echo -e "${RED}❌ Some regression tests failed${NC}"
    echo ""
    echo "Review failures:"
    echo "  - Results: test-results/regression/regression-results.json"
    echo "  - Logs: test-results/regression/test-logs/"
    exit 1
fi
