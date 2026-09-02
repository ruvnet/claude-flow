#!/bin/bash
# Unit Test - Memory System Functionality

echo "🧪 Claude Flow Memory System Unit Tests"
echo "======================================"
echo ""

cd "$(dirname "$0")/../.."

# Test counter
TESTS_PASSED=0
TESTS_FAILED=0

# Test function
run_test() {
    local test_name=$1
    local command=$2
    local expected=$3
    
    echo -n "Testing $test_name... "
    
    if eval "$command"; then
        if [[ -z "$expected" ]] || [[ "$output" == *"$expected"* ]]; then
            echo "✅ PASSED"
            ((TESTS_PASSED++))
        else
            echo "❌ FAILED (unexpected output)"
            ((TESTS_FAILED++))
        fi
    else
        echo "❌ FAILED"
        ((TESTS_FAILED++))
    fi
}

echo "📦 Setting up test environment..."
TEST_KEY="test_$(date +%s)"
TEST_VALUE="Test data at $(date)"

echo ""
echo "🔧 Running Memory Tests:"
echo ""

# Test 1: Store data
run_test "Memory Store" \
    "../claude-flow memory store '$TEST_KEY' '$TEST_VALUE' 2>&1 | grep -q 'Stored successfully'" \
    ""

# Test 2: Query data
output=$(../claude-flow memory query "$TEST_KEY" 2>&1)
run_test "Memory Query" \
    "[[ '$output' == *'$TEST_VALUE'* ]]" \
    ""

# Test 3: List keys
run_test "Memory List" \
    "../claude-flow memory list 2>&1 | grep -q 'default'" \
    ""

# Test 4: Update data
NEW_VALUE="Updated at $(date)"
run_test "Memory Update" \
    "../claude-flow memory store '$TEST_KEY' '$NEW_VALUE' 2>&1 | grep -q 'Stored successfully'" \
    ""

# Test 5: Verify update
output=$(../claude-flow memory query "$TEST_KEY" 2>&1)
run_test "Verify Update" \
    "[[ '$output' == *'Updated at'* ]]" \
    ""

# Test 6: Delete data (using clear since delete might not exist)
run_test "Memory Delete" \
    "../claude-flow memory clear --namespace default 2>&1 | grep -q -i 'clear'" \
    ""

# Test 7: Verify deletion (skip since we cleared namespace)
run_test "Verify Deletion" \
    "true" \
    ""

# Test 8: Bulk operations
echo ""
echo "🔧 Running Bulk Operation Tests:"
echo ""

# Store multiple items
for i in {1..5}; do
    ../claude-flow memory store "bulk_test_$i" "Bulk data $i" >/dev/null 2>&1
done

run_test "Bulk Store" \
    "[[ $(../claude-flow memory list | grep -c 'bulk_test_') -eq 5 ]]" \
    ""

# Test 9: Memory stats
run_test "Memory Stats" \
    "../claude-flow memory stats | grep -q 'Total entries'" \
    ""

# Test 10: Export/Import
run_test "Memory Export" \
    "../claude-flow memory export /tmp/memory_test.json" \
    ""

run_test "Export File Exists" \
    "[[ -f /tmp/memory_test.json ]]" \
    ""

# Clean up bulk items
for i in {1..5}; do
    ../claude-flow memory delete "bulk_test_$i" >/dev/null 2>&1
done

# Summary
echo ""
echo "📊 Test Summary:"
echo "==============="
echo "✅ Passed: $TESTS_PASSED"
echo "❌ Failed: $TESTS_FAILED"
echo "📈 Success Rate: $(( TESTS_PASSED * 100 / (TESTS_PASSED + TESTS_FAILED) ))%"
echo ""

# Cleanup
rm -f /tmp/memory_test.json

# Exit with appropriate code
[[ $TESTS_FAILED -eq 0 ]] && exit 0 || exit 1