#!/bin/bash

echo "========================================="
echo "Test 2: Hooks Exit Code Validation"
echo "========================================="

FAILED_TESTS=0

# Test pre-command hook
echo ""
echo "🔧 Testing pre-command hook exit code..."
npx claude-flow@2.7.40 hooks pre-command --command 'npm dist-tag ls claude-flow' --validate-safety true --prepare-resources true >/dev/null 2>&1
PRE_CMD_EXIT=$?

if [ $PRE_CMD_EXIT -eq 0 ]; then
    echo "✅ pre-command hook exits with status 0"
else
    echo "❌ FAIL: pre-command hook exited with status $PRE_CMD_EXIT"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test post-command hook
echo ""
echo "🔧 Testing post-command hook exit code..."
npx claude-flow@2.7.40 hooks post-command --command 'npm dist-tag ls claude-flow' --track-metrics true --store-results true >/dev/null 2>&1
POST_CMD_EXIT=$?

if [ $POST_CMD_EXIT -eq 0 ]; then
    echo "✅ post-command hook exits with status 0"
else
    echo "❌ FAIL: post-command hook exited with status $POST_CMD_EXIT"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test pre-edit hook
echo ""
echo "📝 Testing pre-edit hook exit code..."
npx claude-flow@2.7.40 hooks pre-edit --file '/tmp/test.js' --auto-assign-agents true >/dev/null 2>&1
PRE_EDIT_EXIT=$?

if [ $PRE_EDIT_EXIT -eq 0 ]; then
    echo "✅ pre-edit hook exits with status 0"
else
    echo "❌ FAIL: pre-edit hook exited with status $PRE_EDIT_EXIT"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

# Test post-edit hook
echo ""
echo "📝 Testing post-edit hook exit code..."
npx claude-flow@2.7.40 hooks post-edit --file '/tmp/test.js' --format true --update-memory true >/dev/null 2>&1
POST_EDIT_EXIT=$?

if [ $POST_EDIT_EXIT -eq 0 ]; then
    echo "✅ post-edit hook exits with status 0"
else
    echo "❌ FAIL: post-edit hook exited with status $POST_EDIT_EXIT"
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

echo ""
if [ $FAILED_TESTS -eq 0 ]; then
    echo "✅ PASS: All hooks exit cleanly (4/4)"
    echo "========================================="
    exit 0
else
    echo "❌ FAIL: $FAILED_TESTS hook(s) failed"
    echo "========================================="
    exit 1
fi
