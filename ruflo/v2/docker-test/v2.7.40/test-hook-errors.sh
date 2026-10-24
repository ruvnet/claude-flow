#!/bin/bash

echo "========================================="
echo "Test 3: Hook Error Message Detection"
echo "========================================="

echo ""
echo "🔍 Testing for hook error messages in stderr..."

# Capture stderr from hook execution
STDERR_OUTPUT=$(npx claude-flow@2.7.40 hooks pre-command --command 'ls -la' --validate-safety true 2>&1 >/dev/null)

# Check for error patterns
ERROR_PATTERNS=(
    "PreToolUse:Bash hook error"
    "PostToolUse:Bash hook error"
    "Failed with non-blocking status code"
    "No stderr output"
    "Stop hook error"
)

ERRORS_FOUND=0

for pattern in "${ERROR_PATTERNS[@]}"; do
    if echo "$STDERR_OUTPUT" | grep -q "$pattern"; then
        echo "❌ FOUND ERROR: '$pattern'"
        ERRORS_FOUND=$((ERRORS_FOUND + 1))
    fi
done

echo ""
if [ $ERRORS_FOUND -eq 0 ]; then
    echo "✅ PASS: No hook error messages detected"
    echo "========================================="
    exit 0
else
    echo "❌ FAIL: Found $ERRORS_FOUND hook error message(s)"
    echo ""
    echo "Full stderr output:"
    echo "$STDERR_OUTPUT"
    echo "========================================="
    exit 1
fi
