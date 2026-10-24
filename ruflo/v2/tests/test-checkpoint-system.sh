#!/bin/bash
# Test script for Git checkpoint system

echo "🧪 Testing Git Checkpoint System"
echo "================================"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test results
PASSED=0
FAILED=0

# Test function
test_checkpoint() {
    local test_name="$1"
    local command="$2"
    local expected="$3"
    
    echo -n "Testing: $test_name... "
    
    if eval "$command"; then
        if [ -z "$expected" ] || eval "$expected"; then
            echo -e "${GREEN}✓ PASSED${NC}"
            ((PASSED++))
        else
            echo -e "${RED}✗ FAILED${NC} (condition not met)"
            ((FAILED++))
        fi
    else
        echo -e "${RED}✗ FAILED${NC} (command failed)"
        ((FAILED++))
    fi
}

# Setup test environment
echo "Setting up test environment..."
TEST_DIR="/tmp/claude-checkpoint-test-$$"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Copy checkpoint files
cp -r /workspaces/claude-code-flow/.claude .
chmod +x .claude/helpers/*.sh

# Initialize git
git init --quiet
git config user.email "test@example.com"
git config user.name "Test User"

# Create initial commit
echo "test content" > test.txt
git add .
git commit -m "Initial commit" --quiet

echo -e "\n${YELLOW}Running Tests:${NC}"
echo "----------------------------------------"

# Test 1: Validate JSON files
test_checkpoint "JSON validation (simple)" \
    "jq '.' .claude/settings-checkpoint-simple.json > /dev/null 2>&1" \
    ""

test_checkpoint "JSON validation (example)" \
    "jq '.' .claude/settings-checkpoint-example.json > /dev/null 2>&1" \
    ""

# Test 2: Checkpoint hooks script
test_checkpoint "Checkpoint hooks executable" \
    "[ -x .claude/helpers/checkpoint-hooks.sh ]" \
    ""

# Test 3: Pre-edit checkpoint
test_checkpoint "Pre-edit checkpoint" \
    ".claude/helpers/checkpoint-hooks.sh pre-edit '{\"file_path\": \"test.txt\"}' 2>&1 | grep -q 'Created checkpoint'" \
    ""

# Test 4: Verify checkpoint branch created
test_checkpoint "Checkpoint branch exists" \
    "git branch | grep -q 'checkpoint/pre-edit'" \
    ""

# Test 5: Post-edit checkpoint
echo "modified content" > test.txt
test_checkpoint "Post-edit checkpoint" \
    ".claude/helpers/checkpoint-hooks.sh post-edit '{\"file_path\": \"test.txt\"}' 2>&1 | grep -q 'Created checkpoint'" \
    ""

# Test 6: Verify checkpoint tag created
# Debug: Show git status and tags before testing
if [ "${DEBUG:-false}" = "true" ]; then
    echo "Git status before tag check:"
    git status --short
    echo "Git tags:"
    git tag -l
fi
test_checkpoint "Checkpoint tag exists" \
    "git tag -l 'checkpoint-*' | grep -q 'checkpoint-'" \
    ""

# Test 7: Task checkpoint
test_checkpoint "Task checkpoint" \
    ".claude/helpers/checkpoint-hooks.sh task 'Test task description' 2>&1 | grep -q 'Created task checkpoint'" \
    ""

# Test 8: Session end checkpoint
test_checkpoint "Session end checkpoint" \
    ".claude/helpers/checkpoint-hooks.sh session-end 2>&1 | grep -q 'Session summary saved'" \
    ""

# Test 9: Checkpoint metadata files
test_checkpoint "Checkpoint metadata created" \
    "[ -d .claude/checkpoints ] && [ -n \"\$(ls .claude/checkpoints/*.json 2>/dev/null)\" ]" \
    ""

# Test 10: Checkpoint manager script
test_checkpoint "Checkpoint manager executable" \
    "[ -x .claude/helpers/checkpoint-manager.sh ]" \
    ""

# Test 11: List checkpoints
test_checkpoint "List checkpoints" \
    ".claude/helpers/checkpoint-manager.sh list 2>&1 | grep -q 'checkpoint-'" \
    ""

# Test 12: Show checkpoint details
CHECKPOINT=$(git tag -l 'checkpoint-*' | head -1)
if [ -n "$CHECKPOINT" ]; then
    test_checkpoint "Show checkpoint details" \
        ".claude/helpers/checkpoint-manager.sh show $CHECKPOINT 2>&1 | grep -q 'Checkpoint:'" \
        ""
fi

# Cleanup
echo -e "\n${YELLOW}Cleaning up...${NC}"
cd /
rm -rf "$TEST_DIR"

# Summary
echo -e "\n${YELLOW}Test Summary:${NC}"
echo "----------------------------------------"
echo -e "Tests passed: ${GREEN}$PASSED${NC}"
echo -e "Tests failed: ${RED}$FAILED${NC}"
echo "----------------------------------------"

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi