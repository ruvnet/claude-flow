#!/bin/bash
# Claude-Flow Deep Regression Test Suite - Main Runner
# Executes all capability tests for comprehensive regression testing

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Test configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_DIR="${TEST_REPORT_PATH:-/app/reports}"
LOG_DIR="${CLAUDE_FLOW_LOG_DIR:-/app/logs}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="${REPORT_DIR}/regression_report_${TIMESTAMP}.json"
SUMMARY_FILE="${REPORT_DIR}/summary_${TIMESTAMP}.txt"

# Initialize counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0
SKIPPED_TESTS=0

# Initialize report
mkdir -p "$REPORT_DIR" "$LOG_DIR"

echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     CLAUDE-FLOW DEEP REGRESSION TEST SUITE                     ║${NC}"
echo -e "${CYAN}║     Comprehensive Capability Testing                           ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Test Started: $(date)${NC}"
echo -e "${BLUE}Report Directory: ${REPORT_DIR}${NC}"
echo ""

# Initialize JSON report
cat > "$REPORT_FILE" << EOF
{
  "testSuite": "claude-flow-deep-regression",
  "version": "3.0.0",
  "timestamp": "$(date -Iseconds)",
  "environment": {
    "nodeVersion": "$(node --version)",
    "npmVersion": "$(npm --version)",
    "platform": "$(uname -s)",
    "arch": "$(uname -m)"
  },
  "categories": [],
  "summary": {}
}
EOF

# Function to run a test category
run_test_category() {
    local category="$1"
    local script="$2"
    local description="$3"

    echo ""
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}Testing: ${description}${NC}"
    echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    local start_time=$(date +%s.%N)
    local log_file="${LOG_DIR}/${category}_${TIMESTAMP}.log"
    local result=0

    if [ -f "$script" ]; then
        bash "$script" 2>&1 | tee "$log_file" || result=$?
    else
        echo -e "${RED}Script not found: $script${NC}"
        result=1
    fi

    local end_time=$(date +%s.%N)
    local duration=$(echo "$end_time - $start_time" | bc)

    if [ $result -eq 0 ]; then
        echo -e "${GREEN}✓ ${description} - PASSED (${duration}s)${NC}"
    else
        echo -e "${RED}✗ ${description} - FAILED (${duration}s)${NC}"
    fi

    return $result
}

# Function to record test result
record_result() {
    local test_name="$1"
    local status="$2"
    local duration="$3"
    local details="$4"

    TOTAL_TESTS=$((TOTAL_TESTS + 1))

    case "$status" in
        "passed") PASSED_TESTS=$((PASSED_TESTS + 1)) ;;
        "failed") FAILED_TESTS=$((FAILED_TESTS + 1)) ;;
        "skipped") SKIPPED_TESTS=$((SKIPPED_TESTS + 1)) ;;
    esac
}

# ============================================================================
# TEST CATEGORY 1: CLI COMMANDS
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 1: CLI COMMANDS${NC}"

if bash "${SCRIPT_DIR}/test-cli-commands.sh"; then
    record_result "CLI Commands" "passed" "0" ""
else
    record_result "CLI Commands" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 2: MCP SERVER
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 2: MCP SERVER${NC}"

if bash "${SCRIPT_DIR}/test-mcp-server.sh"; then
    record_result "MCP Server" "passed" "0" ""
else
    record_result "MCP Server" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 3: AGENT CAPABILITIES (54+ AGENTS)
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 3: AGENT CAPABILITIES${NC}"

if bash "${SCRIPT_DIR}/test-agents.sh"; then
    record_result "Agent Capabilities" "passed" "0" ""
else
    record_result "Agent Capabilities" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 4: SWARM COORDINATION
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 4: SWARM COORDINATION${NC}"

if bash "${SCRIPT_DIR}/test-swarm.sh"; then
    record_result "Swarm Coordination" "passed" "0" ""
else
    record_result "Swarm Coordination" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 5: SELF-LEARNING HOOKS
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 5: SELF-LEARNING HOOKS${NC}"

if bash "${SCRIPT_DIR}/test-hooks.sh"; then
    record_result "Self-Learning Hooks" "passed" "0" ""
else
    record_result "Self-Learning Hooks" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 6: RUVECTOR PLUGINS
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 6: RUVECTOR PLUGINS${NC}"

if bash "${SCRIPT_DIR}/test-plugins.sh"; then
    record_result "RuVector Plugins" "passed" "0" ""
else
    record_result "RuVector Plugins" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 7: SECURITY FEATURES
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 7: SECURITY FEATURES${NC}"

if bash "${SCRIPT_DIR}/test-security.sh"; then
    record_result "Security Features" "passed" "0" ""
else
    record_result "Security Features" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 8: MEMORY/AGENTDB
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 8: MEMORY/AGENTDB${NC}"

if bash "${SCRIPT_DIR}/test-memory.sh"; then
    record_result "Memory/AgentDB" "passed" "0" ""
else
    record_result "Memory/AgentDB" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 9: BACKGROUND WORKERS
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 9: BACKGROUND WORKERS${NC}"

if bash "${SCRIPT_DIR}/test-workers.sh"; then
    record_result "Background Workers" "passed" "0" ""
else
    record_result "Background Workers" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 10: PERFORMANCE BENCHMARKS
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 10: PERFORMANCE BENCHMARKS${NC}"

if bash "${SCRIPT_DIR}/test-performance.sh"; then
    record_result "Performance Benchmarks" "passed" "0" ""
else
    record_result "Performance Benchmarks" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 11: V3 PACKAGE UNIT TESTS
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 11: V3 PACKAGE UNIT TESTS${NC}"

if bash "${SCRIPT_DIR}/run-unit-tests.sh"; then
    record_result "V3 Unit Tests" "passed" "0" ""
else
    record_result "V3 Unit Tests" "failed" "0" ""
fi

# ============================================================================
# TEST CATEGORY 12: INTEGRATION TESTS
# ============================================================================
echo ""
echo -e "${CYAN}▶ CATEGORY 12: INTEGRATION TESTS${NC}"

if bash "${SCRIPT_DIR}/run-integration-tests.sh"; then
    record_result "Integration Tests" "passed" "0" ""
else
    record_result "Integration Tests" "failed" "0" ""
fi

# ============================================================================
# GENERATE FINAL REPORT
# ============================================================================
echo ""
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    TEST SUMMARY                                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

PASS_RATE=0
if [ $TOTAL_TESTS -gt 0 ]; then
    PASS_RATE=$(echo "scale=2; $PASSED_TESTS * 100 / $TOTAL_TESTS" | bc)
fi

echo -e "Total Tests:   ${BLUE}${TOTAL_TESTS}${NC}"
echo -e "Passed:        ${GREEN}${PASSED_TESTS}${NC}"
echo -e "Failed:        ${RED}${FAILED_TESTS}${NC}"
echo -e "Skipped:       ${YELLOW}${SKIPPED_TESTS}${NC}"
echo -e "Pass Rate:     ${CYAN}${PASS_RATE}%${NC}"
echo ""
echo -e "${BLUE}Test Completed: $(date)${NC}"
echo -e "${BLUE}Report: ${REPORT_FILE}${NC}"

# Write summary file
cat > "$SUMMARY_FILE" << EOF
CLAUDE-FLOW DEEP REGRESSION TEST SUMMARY
========================================
Date: $(date)
Version: 3.0.0

RESULTS
-------
Total Tests:  $TOTAL_TESTS
Passed:       $PASSED_TESTS
Failed:       $FAILED_TESTS
Skipped:      $SKIPPED_TESTS
Pass Rate:    ${PASS_RATE}%

ENVIRONMENT
-----------
Node Version: $(node --version)
NPM Version:  $(npm --version)
Platform:     $(uname -s)
Architecture: $(uname -m)

REPORT FILES
------------
Full Report:  $REPORT_FILE
Summary:      $SUMMARY_FILE
Logs:         $LOG_DIR
EOF

# Exit with appropriate code
if [ $FAILED_TESTS -gt 0 ]; then
    echo -e "${RED}Some tests failed. See report for details.${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
    exit 0
fi
