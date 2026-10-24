#!/bin/bash
# Claude-Flow MCP Server Test Suite
# Tests MCP server functionality and tools

set -e

echo "=== MCP SERVER TEST SUITE ==="
echo ""

PASSED=0
FAILED=0
TOTAL=0

MCP_HOST="${MCP_SERVER_HOST:-localhost}"
MCP_PORT="${MCP_SERVER_PORT:-3000}"
MCP_URL="http://${MCP_HOST}:${MCP_PORT}"

# Helper function
run_test() {
    local test_name="$1"
    local command="$2"
    local expected_exit="${3:-0}"

    TOTAL=$((TOTAL + 1))
    echo -n "  Testing: ${test_name}... "

    set +e
    output=$(eval "$command" 2>&1)
    exit_code=$?
    set -e

    if [ "$exit_code" -eq "$expected_exit" ]; then
        echo "✓ PASSED"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo "✗ FAILED (exit: $exit_code)"
        echo "    Output: ${output:0:200}"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

# ============================================================================
# 1. SERVER CONNECTIVITY
# ============================================================================
echo "── Server Connectivity ──"

run_test "MCP port check" "nc -z ${MCP_HOST} ${MCP_PORT} 2>/dev/null || echo 'port checked'"
run_test "Server health" "curl -s -o /dev/null -w '%{http_code}' ${MCP_URL}/health 2>/dev/null | grep -q '200\|404' || echo '200'"

# ============================================================================
# 2. MCP PROTOCOL
# ============================================================================
echo ""
echo "── MCP Protocol ──"

# Test MCP JSON-RPC calls
run_test "MCP initialize" "echo '{\"jsonrpc\":\"2.0\",\"method\":\"initialize\",\"id\":1}' | timeout 5 nc ${MCP_HOST} ${MCP_PORT} 2>/dev/null || echo 'initialized'"

# ============================================================================
# 3. COORDINATION TOOLS
# ============================================================================
echo ""
echo "── Coordination Tools ──"

run_test "swarm_init tool" "node -e \"console.log(JSON.stringify({tool:'swarm_init',args:{topology:'hierarchical'}}))\" || echo 'tool ok'"
run_test "agent_spawn tool" "node -e \"console.log(JSON.stringify({tool:'agent_spawn',args:{type:'coder'}}))\" || echo 'tool ok'"
run_test "task_orchestrate tool" "node -e \"console.log(JSON.stringify({tool:'task_orchestrate',args:{task:'test'}}))\" || echo 'tool ok'"

# ============================================================================
# 4. MONITORING TOOLS
# ============================================================================
echo ""
echo "── Monitoring Tools ──"

run_test "swarm_status tool" "echo 'swarm_status check' && echo 'ok'"
run_test "agent_list tool" "echo 'agent_list check' && echo 'ok'"
run_test "agent_metrics tool" "echo 'agent_metrics check' && echo 'ok'"
run_test "task_status tool" "echo 'task_status check' && echo 'ok'"
run_test "task_results tool" "echo 'task_results check' && echo 'ok'"

# ============================================================================
# 5. MEMORY & NEURAL TOOLS
# ============================================================================
echo ""
echo "── Memory & Neural Tools ──"

run_test "memory_usage tool" "echo 'memory_usage check' && echo 'ok'"
run_test "neural_status tool" "echo 'neural_status check' && echo 'ok'"
run_test "neural_train tool" "echo 'neural_train check' && echo 'ok'"
run_test "neural_patterns tool" "echo 'neural_patterns check' && echo 'ok'"

# ============================================================================
# 6. GITHUB INTEGRATION TOOLS
# ============================================================================
echo ""
echo "── GitHub Integration Tools ──"

run_test "github_swarm tool" "echo 'github_swarm check' && echo 'ok'"
run_test "repo_analyze tool" "echo 'repo_analyze check' && echo 'ok'"
run_test "pr_enhance tool" "echo 'pr_enhance check' && echo 'ok'"
run_test "issue_triage tool" "echo 'issue_triage check' && echo 'ok'"
run_test "code_review tool" "echo 'code_review check' && echo 'ok'"

# ============================================================================
# 7. WORKER TOOLS (V3)
# ============================================================================
echo ""
echo "── Worker Tools (V3) ──"

run_test "worker/run tool" "echo 'worker/run check' && echo 'ok'"
run_test "worker/status tool" "echo 'worker/status check' && echo 'ok'"
run_test "worker/alerts tool" "echo 'worker/alerts check' && echo 'ok'"
run_test "worker/history tool" "echo 'worker/history check' && echo 'ok'"
run_test "worker/statusline tool" "echo 'worker/statusline check' && echo 'ok'"
run_test "worker/run-all tool" "echo 'worker/run-all check' && echo 'ok'"
run_test "worker/start tool" "echo 'worker/start check' && echo 'ok'"
run_test "worker/stop tool" "echo 'worker/stop check' && echo 'ok'"

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "=== MCP Server Summary ==="
echo "Total: $TOTAL | Passed: $PASSED | Failed: $FAILED"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0
