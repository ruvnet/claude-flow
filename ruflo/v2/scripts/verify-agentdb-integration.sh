#!/bin/bash
# AgentDB v1.3.9 Integration Verification Script
# Validates the 3-agent swarm implementation

set -e

echo "🔍 AgentDB v1.3.9 Integration Verification"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Function to print status
print_status() {
    local status=$1
    local message=$2

    if [ "$status" = "PASS" ]; then
        echo -e "${GREEN}✓${NC} $message"
        ((PASSED++))
    elif [ "$status" = "FAIL" ]; then
        echo -e "${RED}✗${NC} $message"
        ((FAILED++))
    else
        echo -e "${YELLOW}⚠${NC} $message"
        ((WARNINGS++))
    fi
}

# Check 1: Verify branch
echo "📋 Step 1: Branch Verification"
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" = "feature/agentdb-integration" ]; then
    print_status "PASS" "On correct branch: $CURRENT_BRANCH"
else
    print_status "WARN" "Not on feature/agentdb-integration (current: $CURRENT_BRANCH)"
fi
echo ""

# Check 2: Verify package.json dependency
echo "📋 Step 2: Dependency Verification"
if grep -q '"agentdb": "\^1.3.9"' package.json; then
    print_status "PASS" "AgentDB v1.3.9 dependency added"
else
    print_status "FAIL" "AgentDB dependency not found in package.json"
fi
echo ""

# Check 3: Verify implementation files exist
echo "📋 Step 3: Implementation Files"
IMPL_FILES=(
    "src/memory/agentdb-adapter.js"
    "src/memory/backends/agentdb.js"
    "src/memory/migration/legacy-bridge.js"
    "src/memory/README-AGENTDB.md"
)

for file in "${IMPL_FILES[@]}"; do
    if [ -f "$file" ]; then
        LINES=$(wc -l < "$file")
        print_status "PASS" "Found $file ($LINES lines)"
    else
        print_status "FAIL" "Missing $file"
    fi
done
echo ""

# Check 4: Verify test files exist
echo "📋 Step 4: Test Files"
TEST_FILES=(
    "tests/unit/memory/agentdb/adapter.test.js"
    "tests/unit/memory/agentdb/backend.test.js"
    "tests/unit/memory/agentdb/migration.test.js"
    "tests/integration/agentdb/compatibility.test.js"
    "tests/performance/agentdb/benchmarks.test.js"
    "tests/utils/agentdb-test-helpers.js"
    "tests/run-agentdb-tests.sh"
)

for file in "${TEST_FILES[@]}"; do
    if [ -f "$file" ]; then
        if [[ "$file" == *.sh ]]; then
            if [ -x "$file" ]; then
                print_status "PASS" "Found $file (executable)"
            else
                print_status "WARN" "Found $file (not executable)"
                chmod +x "$file"
                print_status "PASS" "Made $file executable"
            fi
        else
            LINES=$(wc -l < "$file")
            print_status "PASS" "Found $file ($LINES lines)"
        fi
    else
        print_status "FAIL" "Missing $file"
    fi
done
echo ""

# Check 5: Verify performance files exist
echo "📋 Step 5: Performance & Optimization Files"
PERF_FILES=(
    "tests/performance/baseline/current-system.cjs"
    "tests/performance/agentdb/agentdb-perf.cjs"
    "tests/performance/agentdb/hnsw-optimizer.cjs"
    "tests/performance/agentdb/load-test.cjs"
    "tests/performance/agentdb/memory-profile.cjs"
)

for file in "${PERF_FILES[@]}"; do
    if [ -f "$file" ]; then
        LINES=$(wc -l < "$file")
        print_status "PASS" "Found $file ($LINES lines)"
    else
        print_status "FAIL" "Missing $file"
    fi
done
echo ""

# Check 6: Verify documentation files exist
echo "📋 Step 6: Documentation Files"
DOC_FILES=(
    "docs/agentdb/PRODUCTION_READINESS.md"
    "docs/agentdb/OPTIMIZATION_REPORT.md"
    "docs/agentdb/SWARM_COORDINATION.md"
    "docs/agentdb/SWARM_IMPLEMENTATION_COMPLETE.md"
    "docs/AGENTDB_INTEGRATION_PLAN.md"
)

for file in "${DOC_FILES[@]}"; do
    if [ -f "$file" ]; then
        LINES=$(wc -l < "$file")
        print_status "PASS" "Found $file ($LINES lines)"
    else
        print_status "FAIL" "Missing $file"
    fi
done
echo ""

# Check 7: Verify exports in index.js
echo "📋 Step 7: Export Verification"
if grep -q "AgentDBMemoryAdapter" src/memory/index.js; then
    print_status "PASS" "AgentDBMemoryAdapter export found"
else
    print_status "FAIL" "AgentDBMemoryAdapter export missing"
fi

if grep -q "AgentDBBackend" src/memory/index.js; then
    print_status "PASS" "AgentDBBackend export found"
else
    print_status "FAIL" "AgentDBBackend export missing"
fi

if grep -q "LegacyDataBridge" src/memory/index.js; then
    print_status "PASS" "LegacyDataBridge export found"
else
    print_status "FAIL" "LegacyDataBridge export missing"
fi
echo ""

# Check 8: Count total files and lines
echo "📋 Step 8: Code Metrics"
TOTAL_FILES=$(git diff --name-only origin/main...HEAD 2>/dev/null | wc -l || echo "0")
TOTAL_ADDITIONS=$(git diff --shortstat origin/main...HEAD 2>/dev/null | grep -oP '\d+(?= insertion)' || echo "0")
TOTAL_DELETIONS=$(git diff --shortstat origin/main...HEAD 2>/dev/null | grep -oP '\d+(?= deletion)' || echo "0")

if [ "$TOTAL_FILES" -gt 0 ]; then
    print_status "PASS" "Total files changed: $TOTAL_FILES"
    print_status "PASS" "Total insertions: $TOTAL_ADDITIONS lines"
    print_status "PASS" "Total deletions: $TOTAL_DELETIONS lines"
else
    print_status "WARN" "Could not calculate diff (maybe not pushed yet)"
fi
echo ""

# Check 9: Verify node_modules (optional)
echo "📋 Step 9: Installation Check"
if [ -d "node_modules/agentdb" ]; then
    VERSION=$(node -e "console.log(require('./node_modules/agentdb/package.json').version)" 2>/dev/null || echo "unknown")
    if [ "$VERSION" = "1.3.9" ]; then
        print_status "PASS" "AgentDB v1.3.9 installed"
    else
        print_status "WARN" "AgentDB installed but version is $VERSION (expected 1.3.9)"
    fi
else
    print_status "WARN" "AgentDB not installed (run 'npm install')"
fi
echo ""

# Summary
echo "=========================================="
echo "📊 Verification Summary"
echo "=========================================="
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${YELLOW}Warnings: $WARNINGS${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All critical checks passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Run tests: ./tests/run-agentdb-tests.sh"
    echo "2. Install dependencies: npm install"
    echo "3. Run performance benchmarks"
    echo "4. Review PR #830"
    exit 0
else
    echo -e "${RED}❌ Some checks failed. Please review.${NC}"
    exit 1
fi
