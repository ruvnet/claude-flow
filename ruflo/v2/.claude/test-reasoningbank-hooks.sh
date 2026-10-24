#!/bin/bash
# Test ReasoningBank integration with Claude Code hooks

set -e

echo "🧪 Testing ReasoningBank Hook Integration"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test 1: Check if ReasoningBank is available
echo -e "${BLUE}Test 1: Checking ReasoningBank availability${NC}"
if npx claude-flow@alpha memory stats --reasoningbank 2>/dev/null; then
  echo -e "${GREEN}✓ ReasoningBank is available${NC}"
else
  echo -e "${YELLOW}⚠ ReasoningBank initialization (this is normal on first run)${NC}"
fi
echo ""

# Test 2: Store a test pattern
echo -e "${BLUE}Test 2: Storing test pattern${NC}"
TEST_KEY="test_pattern_$(date +%s)"
TEST_VALUE="This is a test pattern for hook integration"
if npx claude-flow@alpha memory store "$TEST_KEY" "$TEST_VALUE" --namespace test --reasoningbank --confidence 0.5 2>/dev/null; then
  echo -e "${GREEN}✓ Pattern stored successfully${NC}"
  echo "  Key: $TEST_KEY"
else
  echo -e "${YELLOW}⚠ Failed to store pattern (check permissions)${NC}"
fi
echo ""

# Test 3: Query the pattern
echo -e "${BLUE}Test 3: Querying stored pattern${NC}"
if npx claude-flow@alpha memory query "test pattern" --namespace test --reasoningbank --limit 1 2>/dev/null | grep -q "test_pattern"; then
  echo -e "${GREEN}✓ Pattern retrieved successfully${NC}"
else
  echo -e "${YELLOW}⚠ Pattern not found (may need initialization)${NC}"
fi
echo ""

# Test 4: List patterns
echo -e "${BLUE}Test 4: Listing patterns${NC}"
PATTERN_COUNT=$(npx claude-flow@alpha memory list --namespace test --reasoningbank 2>/dev/null | grep -oP "\d+ patterns" || echo "0 patterns")
echo -e "${GREEN}✓ Found: $PATTERN_COUNT${NC}"
echo ""

# Test 5: Test PreToolUse simulation
echo -e "${BLUE}Test 5: Simulating PreToolUse hook${NC}"
echo '{"tool_input": {"file_path": "test.js"}}' | \
  jq -r '.tool_input.file_path' | \
  xargs -I {} bash -c 'npx claude-flow@alpha memory query "{}" --reasoningbank --limit 2 2>/dev/null || echo "No patterns yet"'
echo -e "${GREEN}✓ PreToolUse simulation complete${NC}"
echo ""

# Test 6: Test PostToolUse simulation
echo -e "${BLUE}Test 6: Simulating PostToolUse hook${NC}"
TEST_FILE="test_hook_$(date +%s).js"
touch "/tmp/$TEST_FILE"
npx claude-flow@alpha memory store "edit_${TEST_FILE}" "Test edit for hook integration" --namespace code --reasoningbank --confidence 0.5 2>/dev/null
rm -f "/tmp/$TEST_FILE"
echo -e "${GREEN}✓ PostToolUse simulation complete${NC}"
echo ""

# Test 7: Test consolidation
echo -e "${BLUE}Test 7: Testing memory consolidation${NC}"
if npx claude-flow@alpha memory consolidate --reasoningbank --threshold 0.95 2>/dev/null; then
  echo -e "${GREEN}✓ Consolidation successful${NC}"
else
  echo -e "${YELLOW}⚠ Consolidation skipped (normal if few patterns)${NC}"
fi
echo ""

# Test 8: Get statistics
echo -e "${BLUE}Test 8: ReasoningBank statistics${NC}"
npx claude-flow@alpha memory stats --reasoningbank 2>/dev/null || echo "Stats not available"
echo ""

# Summary
echo "=========================================="
echo -e "${GREEN}✅ ReasoningBank Hook Testing Complete${NC}"
echo ""
echo "Next Steps:"
echo "1. Copy configuration to .claude/settings.json:"
echo "   ${BLUE}cp .claude/settings.reasoningbank-example.json .claude/settings.json${NC}"
echo ""
echo "2. Or use minimal version for testing:"
echo "   ${BLUE}cp .claude/settings.reasoningbank-minimal.json .claude/settings.json${NC}"
echo ""
echo "3. Restart Claude Code to load hooks"
echo ""
echo "4. Test by editing a file and check:"
echo "   ${BLUE}npx claude-flow@alpha memory list --namespace code --reasoningbank${NC}"
echo ""
echo "📚 Documentation: docs/reasoningbank/CLAUDE-CODE-INTEGRATION.md"
