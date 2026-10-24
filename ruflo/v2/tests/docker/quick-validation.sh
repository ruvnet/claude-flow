#!/bin/bash
# Quick validation script - tests all functionality in current environment
# Can run locally or in Docker

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

PASSED=0
FAILED=0
TESTS=()

echo -e "${BLUE}🐳 Claude-Flow Quick Validation${NC}"
echo "========================================"

# Test runner
run_test() {
    local name="$1"
    local command="$2"
    local expected="$3"

    echo -n "Testing: $name... "
   
    if output=$(eval "$command" 2>&1); then
        if [[ -z "$expected" ]] || echo "$output" | grep -q "$expected"; then
            echo -e "${GREEN}✓${NC}"
            PASSED=$((PASSED + 1))
            TESTS+=("✓ $name")
            return 0
        fi
    fi
    
    echo -e "${RED}✗${NC}"
    FAILED=$((FAILED + 1))
    TESTS+=("✗ $name: $output")
    return 1
}

# Change to project root
cd "$(dirname "$0")/../.."

echo ""
echo "📦 Testing CLI & Build..."
run_test "Binary exists" "test -f ./bin/claude-flow" ""
run_test "Help command" "./bin/claude-flow --help" "claude-flow"
run_test "Version command" "./bin/claude-flow --version" ""

echo ""
echo "🧠 Testing Memory (Basic Mode)..."
run_test "Memory store" "./bin/claude-flow memory store docker_test 'validation test'" "Stored successfully"
run_test "Memory query" "./bin/claude-flow memory query docker_test" "validation test"
run_test "Memory stats" "./bin/claude-flow memory stats" "Total Entries"
run_test "Memory detect" "./bin/claude-flow memory detect" "Basic Mode"
run_test "Memory mode" "./bin/claude-flow memory mode" "Default Mode"

echo ""
echo "🤖 Testing Agent Commands..."
run_test "Agent help" "./bin/claude-flow agent --help" "agentic-flow"
run_test "Agent list" "./bin/claude-flow agent agents" "coder"

echo ""
echo "🌐 Testing Proxy Commands..."
run_test "Proxy help" "./bin/claude-flow proxy --help" "OpenRouter"

echo ""
echo "📋 Testing Help System..."
run_test "Help has ReasoningBank" "./bin/claude-flow --help | grep -i reasoningbank" "ReasoningBank"
run_test "Help has proxy" "./bin/claude-flow --help | grep -i proxy" "proxy"
run_test "Help has Agent Booster" "./bin/claude-flow agent --help | grep -i booster" "booster"

echo ""
echo "🔒 Testing Security..."
run_test "Redaction works" "./bin/claude-flow memory store secure_key 'api=sk-ant-test' --redact" "redacted"

echo ""
echo "========================================"
echo -e "${BLUE}📊 Results${NC}"
echo "========================================"
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"

if [ $FAILED -eq 0 ]; then
    echo -e "\n${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed:${NC}"
    for test in "${TESTS[@]}"; do
        if [[ $test == ✗* ]]; then
            echo -e "${RED}$test${NC}"
        fi
    done
    exit 1
fi
