#!/bin/bash
# Test automatic error recovery in Docker (simulates WSL)
# Run this before creating GitHub issue

set -e

echo "🐳 Testing Automatic Error Recovery in Docker"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test configurations
DISTROS=("ubuntu:22.04" "ubuntu:20.04" "debian:11" "debian:12")
TEST_RESULTS=()

# Function to test on a distro
test_distro() {
    local distro=$1
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing on: $distro"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Run test in Docker
    docker run --rm -i $distro bash -c "
        set -e

        echo '📦 Installing dependencies...'
        apt-get update -qq
        apt-get install -y -qq curl build-essential python3 git > /dev/null 2>&1

        echo '📥 Installing Node.js...'
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        apt-get install -y -qq nodejs > /dev/null 2>&1

        echo '🔍 Node version:'
        node --version
        npm --version

        echo ''
        echo '🚀 Running claude-flow init --force...'
        echo ''

        # Run the actual test
        npx claude-flow@alpha init --force

        echo ''
        echo '✅ Test completed successfully on $distro'
    " && {
        echo -e "${GREEN}✅ PASS: $distro${NC}"
        TEST_RESULTS+=("PASS: $distro")
    } || {
        echo -e "${RED}❌ FAIL: $distro${NC}"
        TEST_RESULTS+=("FAIL: $distro")
    }
}

# Function to test with corrupted cache simulation
test_corrupted_cache() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing with corrupted npm cache simulation"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    docker run --rm -i ubuntu:22.04 bash -c "
        set -e

        apt-get update -qq
        apt-get install -y -qq curl build-essential python3 git > /dev/null 2>&1
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        apt-get install -y -qq nodejs > /dev/null 2>&1

        echo '💥 Simulating corrupted npm cache...'
        mkdir -p ~/.npm/_npx/test-corrupt/node_modules/better-sqlite3
        touch ~/.npm/_npx/test-corrupt/node_modules/better-sqlite3/.lock

        echo ''
        echo '🚀 Running claude-flow init --force with corrupted cache...'
        echo ''

        npx claude-flow@alpha init --force

        echo ''
        echo '✅ Recovery from corrupted cache successful'
    " && {
        echo -e "${GREEN}✅ PASS: Corrupted cache recovery${NC}"
        TEST_RESULTS+=("PASS: Corrupted cache recovery")
    } || {
        echo -e "${RED}❌ FAIL: Corrupted cache recovery${NC}"
        TEST_RESULTS+=("FAIL: Corrupted cache recovery")
    }
}

# Function to test without --force flag
test_without_force() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Testing without --force flag (3 retries max)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    docker run --rm -i ubuntu:22.04 bash -c "
        set -e

        apt-get update -qq
        apt-get install -y -qq curl build-essential python3 git > /dev/null 2>&1
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash - > /dev/null 2>&1
        apt-get install -y -qq nodejs > /dev/null 2>&1

        echo '🚀 Running claude-flow init (no --force)...'
        echo ''

        npx claude-flow@alpha init

        echo ''
        echo '✅ Init without --force successful'
    " && {
        echo -e "${GREEN}✅ PASS: Init without --force${NC}"
        TEST_RESULTS+=("PASS: Init without --force")
    } || {
        echo -e "${RED}❌ FAIL: Init without --force${NC}"
        TEST_RESULTS+=("FAIL: Init without --force")
    }
}

# Main test execution
echo "Starting comprehensive Docker tests..."
echo ""
echo "This will test:"
echo "  - Multiple Linux distributions"
echo "  - Corrupted cache recovery"
echo "  - With and without --force flag"
echo ""

read -p "Continue? (y/n) " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted"
    exit 1
fi

# Run tests
for distro in "${DISTROS[@]}"; do
    test_distro "$distro"
done

test_corrupted_cache
test_without_force

# Print summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TEST SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

PASS_COUNT=0
FAIL_COUNT=0

for result in "${TEST_RESULTS[@]}"; do
    if [[ $result == PASS* ]]; then
        echo -e "${GREEN}✅ $result${NC}"
        ((PASS_COUNT++))
    else
        echo -e "${RED}❌ $result${NC}"
        ((FAIL_COUNT++))
    fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Total: $((PASS_COUNT + FAIL_COUNT)) tests"
echo -e "${GREEN}Passed: $PASS_COUNT${NC}"
echo -e "${RED}Failed: $FAIL_COUNT${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Review test results above"
    echo "2. Run: bash scripts/create-github-issue.sh"
    echo "3. Update issue with test results"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    echo ""
    echo "Please fix failing tests before creating GitHub issue"
    exit 1
fi
