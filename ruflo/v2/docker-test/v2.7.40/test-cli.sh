#!/bin/bash
set -e

echo "========================================="
echo "Test 1: CLI Basic Functionality"
echo "========================================="

echo "📦 Testing npx claude-flow@2.7.40..."

# Test version command
echo ""
echo "🔍 Testing --version command..."
VERSION_OUTPUT=$(npx claude-flow@2.7.40 --version 2>&1)
echo "$VERSION_OUTPUT"

if echo "$VERSION_OUTPUT" | grep -q "v2.7.40"; then
    echo "✅ Version command works (2.7.40)"
else
    echo "❌ FAIL: Version command failed or wrong version"
    exit 1
fi

# Test help command
echo ""
echo "📖 Testing --help command..."
HELP_OUTPUT=$(npx claude-flow@2.7.40 --help 2>&1)

if echo "$HELP_OUTPUT" | grep -qE "Usage:|Commands:|Options:"; then
    echo "✅ Help command works"
else
    echo "❌ FAIL: Help command not working"
    exit 1
fi

# Test hooks list
echo ""
echo "🪝 Testing hooks command..."
HOOKS_OUTPUT=$(npx claude-flow@2.7.40 hooks 2>&1)

if echo "$HOOKS_OUTPUT" | grep -qE "pre-task|post-task|pre-edit|post-edit"; then
    echo "✅ Hooks command works"
else
    echo "❌ FAIL: Hooks command not working"
    exit 1
fi

echo ""
echo "✅ PASS: CLI basic functionality test completed"
echo "========================================="
