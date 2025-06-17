#!/bin/bash
# Integration Test - Complete Workflow Execution

echo "🔄 Claude Flow Workflow Integration Test"
echo "======================================="
echo ""

cd "$(dirname "$0")/../.."

# Test setup
TEST_ID="integration_$(date +%s)"
OUTPUT_DIR="./output/test_$TEST_ID"
WORKFLOW_FILE="./02-workflows/simple/hello-world-workflow.json"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Test results
declare -A TEST_RESULTS

# Test function
test_step() {
    local step_name=$1
    local condition=$2
    
    echo -n "🧪 $step_name... "
    
    if eval "$condition"; then
        echo -e "${GREEN}✓${NC}"
        TEST_RESULTS["$step_name"]="PASSED"
        return 0
    else
        echo -e "${RED}✗${NC}"
        TEST_RESULTS["$step_name"]="FAILED"
        return 1
    fi
}

echo "📋 Test Plan: Execute workflow and verify outputs"
echo ""

# Test 1: Verify workflow file exists
test_step "Workflow file exists" "[[ -f '$WORKFLOW_FILE' ]]"

# Test 2: Execute workflow
echo ""
echo "🚀 Executing workflow..."
if ../claude-flow orchestrate "$WORKFLOW_FILE" --output "$OUTPUT_DIR" --quiet; then
    test_step "Workflow execution" "true"
else
    test_step "Workflow execution" "false"
    echo "❌ Workflow execution failed. Aborting tests."
    exit 1
fi

# Test 3: Check output directory
test_step "Output directory created" "[[ -d '$OUTPUT_DIR' ]]"

# Test 4: Check for expected files
test_step "Output files exist" "[[ -n '$(ls -A $OUTPUT_DIR 2>/dev/null)' ]]"

# Test 5: Verify workflow metadata
test_step "Metadata file exists" "[[ -f '$OUTPUT_DIR/workflow-metadata.json' ]]"

# Test 6: Check agent logs
test_step "Agent logs created" "[[ -d '$OUTPUT_DIR/logs' ]] || [[ -f '$OUTPUT_DIR/execution.log' ]]"

# Test 7: Memory persistence test
echo ""
echo "🧠 Testing memory persistence..."
MEMORY_KEY="workflow_test_$TEST_ID"
../claude-flow memory store "$MEMORY_KEY" "Workflow test data" >/dev/null 2>&1
test_step "Memory storage during workflow" "../claude-flow memory query '$MEMORY_KEY' >/dev/null 2>&1"

# Test 8: Parallel workflow test
echo ""
echo "⚡ Testing parallel execution..."
PARALLEL_WORKFLOW="./02-workflows/parallel/data-processing-workflow.json"
if [[ -f "$PARALLEL_WORKFLOW" ]]; then
    PARALLEL_OUTPUT="$OUTPUT_DIR/parallel"
    ../claude-flow orchestrate "$PARALLEL_WORKFLOW" --output "$PARALLEL_OUTPUT" --monitor --quiet &
    PID=$!
    
    # Give it time to start
    sleep 3
    
    # Check if process is running
    if ps -p $PID > /dev/null; then
        test_step "Parallel workflow started" "true"
        # Clean up
        kill $PID 2>/dev/null
    else
        test_step "Parallel workflow started" "false"
    fi
else
    echo "⚠️  Parallel workflow file not found, skipping test"
fi

# Test 9: Error handling
echo ""
echo "🛡️ Testing error handling..."
INVALID_WORKFLOW="/tmp/invalid_workflow_$TEST_ID.json"
echo '{"invalid": "workflow"}' > "$INVALID_WORKFLOW"
if ! ../claude-flow orchestrate "$INVALID_WORKFLOW" --output "$OUTPUT_DIR/error" 2>/dev/null; then
    test_step "Invalid workflow rejection" "true"
else
    test_step "Invalid workflow rejection" "false"
fi
rm -f "$INVALID_WORKFLOW"

# Test 10: Resource cleanup
echo ""
echo "🧹 Testing resource cleanup..."
# Check if temporary files are cleaned up
sleep 2
TEMP_FILES=$(find /tmp -name "*claude-flow*$TEST_ID*" 2>/dev/null | wc -l)
test_step "Temporary files cleaned" "[[ $TEMP_FILES -eq 0 ]]"

# Summary
echo ""
echo "📊 Integration Test Summary"
echo "=========================="
PASSED=0
FAILED=0

for test_name in "${!TEST_RESULTS[@]}"; do
    if [[ "${TEST_RESULTS[$test_name]}" == "PASSED" ]]; then
        ((PASSED++))
    else
        ((FAILED++))
        echo "   ❌ $test_name"
    fi
done

echo ""
echo "✅ Passed: $PASSED"
echo "❌ Failed: $FAILED"
echo "📈 Success Rate: $(( PASSED * 100 / (PASSED + FAILED) ))%"

# Cleanup
echo ""
echo "🧹 Cleaning up test artifacts..."
rm -rf "$OUTPUT_DIR"
../claude-flow memory delete "$MEMORY_KEY" >/dev/null 2>&1

# Exit code
[[ $FAILED -eq 0 ]] && exit 0 || exit 1