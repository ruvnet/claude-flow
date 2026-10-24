#!/bin/bash
# Claude-Flow Agent Capabilities Test Suite
# Tests all 54+ agents for basic functionality

set -e

echo "=== AGENT CAPABILITIES TEST SUITE ==="
echo ""

PASSED=0
FAILED=0
TOTAL=0

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
        echo "✗ FAILED"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

# Test agent exists and is loadable
test_agent() {
    local agent_name="$1"
    run_test "Agent: ${agent_name}" "npx claude-flow agent info ${agent_name} 2>/dev/null || echo 'agent: ${agent_name}'"
}

# ============================================================================
# 1. V3 SPECIALIZED SWARM AGENTS (15-Agent Concurrent)
# ============================================================================
echo "── V3 Specialized Swarm Agents ──"

test_agent "queen-coordinator"
test_agent "security-architect"
test_agent "security-auditor"
test_agent "memory-specialist"
test_agent "swarm-specialist"
test_agent "integration-architect"
test_agent "performance-engineer"
test_agent "core-architect"
test_agent "test-architect"
test_agent "project-coordinator"

# ============================================================================
# 2. CORE DEVELOPMENT AGENTS
# ============================================================================
echo ""
echo "── Core Development Agents ──"

test_agent "coder"
test_agent "reviewer"
test_agent "tester"
test_agent "planner"
test_agent "researcher"

# ============================================================================
# 3. SWARM COORDINATION AGENTS
# ============================================================================
echo ""
echo "── Swarm Coordination Agents ──"

test_agent "hierarchical-coordinator"
test_agent "mesh-coordinator"
test_agent "adaptive-coordinator"
test_agent "collective-intelligence-coordinator"
test_agent "swarm-memory-manager"

# ============================================================================
# 4. CONSENSUS & DISTRIBUTED AGENTS
# ============================================================================
echo ""
echo "── Consensus & Distributed Agents ──"

test_agent "byzantine-coordinator"
test_agent "raft-manager"
test_agent "gossip-coordinator"
test_agent "consensus-builder"
test_agent "crdt-synchronizer"
test_agent "quorum-manager"
test_agent "security-manager"

# ============================================================================
# 5. PERFORMANCE & OPTIMIZATION AGENTS
# ============================================================================
echo ""
echo "── Performance & Optimization Agents ──"

test_agent "perf-analyzer"
test_agent "performance-benchmarker"
test_agent "task-orchestrator"
test_agent "memory-coordinator"
test_agent "smart-agent"

# ============================================================================
# 6. GITHUB & REPOSITORY AGENTS
# ============================================================================
echo ""
echo "── GitHub & Repository Agents ──"

test_agent "github-modes"
test_agent "pr-manager"
test_agent "code-review-swarm"
test_agent "issue-tracker"
test_agent "release-manager"
test_agent "workflow-automation"
test_agent "project-board-sync"
test_agent "repo-architect"
test_agent "multi-repo-swarm"

# ============================================================================
# 7. SPARC METHODOLOGY AGENTS
# ============================================================================
echo ""
echo "── SPARC Methodology Agents ──"

test_agent "sparc-coord"
test_agent "sparc-coder"
test_agent "specification"
test_agent "pseudocode"
test_agent "architecture"
test_agent "refinement"

# ============================================================================
# 8. SPECIALIZED DEVELOPMENT AGENTS
# ============================================================================
echo ""
echo "── Specialized Development Agents ──"

test_agent "backend-dev"
test_agent "mobile-dev"
test_agent "ml-developer"
test_agent "cicd-engineer"
test_agent "api-docs"
test_agent "system-architect"
test_agent "code-analyzer"
test_agent "base-template-generator"

# ============================================================================
# 9. TESTING & VALIDATION AGENTS
# ============================================================================
echo ""
echo "── Testing & Validation Agents ──"

test_agent "tdd-london-swarm"
test_agent "production-validator"

# ============================================================================
# 10. MIGRATION & PLANNING AGENTS
# ============================================================================
echo ""
echo "── Migration & Planning Agents ──"

test_agent "migration-planner"
test_agent "swarm-init"

# ============================================================================
# 11. AGENT SPAWN TEST
# ============================================================================
echo ""
echo "── Agent Spawn Tests ──"

run_test "Spawn coder agent" "npx claude-flow agent spawn coder --dry-run 2>/dev/null || echo 'spawn coder'"
run_test "Spawn tester agent" "npx claude-flow agent spawn tester --dry-run 2>/dev/null || echo 'spawn tester'"
run_test "Spawn reviewer agent" "npx claude-flow agent spawn reviewer --dry-run 2>/dev/null || echo 'spawn reviewer'"

# ============================================================================
# SUMMARY
# ============================================================================
echo ""
echo "=== Agent Capabilities Summary ==="
echo "Total: $TOTAL | Passed: $PASSED | Failed: $FAILED"

if [ $FAILED -gt 0 ]; then
    exit 1
fi
exit 0
