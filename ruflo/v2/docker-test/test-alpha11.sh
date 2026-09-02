#!/bin/bash
# Test script for claude-flow@2.7.0-alpha.11

set -e  # Exit on error

echo "=================================================="
echo "🐳 Testing claude-flow@2.7.0-alpha.11 in Docker"
echo "=================================================="
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Helper functions
pass() {
    echo -e "${GREEN}✅ PASS:${NC} $1"
    ((PASSED++))
}

fail() {
    echo -e "${RED}❌ FAIL:${NC} $1"
    ((FAILED++))
}

info() {
    echo -e "${YELLOW}ℹ️  INFO:${NC} $1"
}

section() {
    echo ""
    echo "=================================================="
    echo "🔍 $1"
    echo "=================================================="
}

# Test 1: Version Check
section "Test 1: Version Check"
VERSION=$(claude-flow --version 2>&1 | grep -oP '\d+\.\d+\.\d+-alpha\.\d+' || echo "unknown")
if [ "$VERSION" = "2.7.0-alpha.11" ]; then
    pass "Version is 2.7.0-alpha.11"
else
    fail "Version is $VERSION, expected 2.7.0-alpha.11"
fi

# Test 2: Init Command
section "Test 2: Init Command Creates Directory Structure"
cd /test
npx claude-flow init --skip-open --project-name "test-project" 2>&1 || true

# Check .claude directory created
if [ -d ".claude" ]; then
    pass ".claude directory created"
else
    fail ".claude directory not created"
fi

# Check subdirectories
EXPECTED_DIRS=("agents" "commands" "skills" "checkpoints" "cache")
for dir in "${EXPECTED_DIRS[@]}"; do
    if [ -d ".claude/$dir" ]; then
        pass ".claude/$dir directory created"
    else
        fail ".claude/$dir directory not created"
    fi
done

# Test 3: Skills Files
section "Test 3: Skills System Files"

# Count skills files
SKILL_COUNT=$(find .claude/skills -name "SKILL.md" 2>/dev/null | wc -l)
if [ "$SKILL_COUNT" -gt 0 ]; then
    pass "Found $SKILL_COUNT skill files"
else
    fail "No skill files found in .claude/skills/"
fi

# Check for specific important skills
CRITICAL_SKILLS=(
    "agentdb-vector-search/SKILL.md"
    "swarm-orchestration/SKILL.md"
    "sparc-methodology/SKILL.md"
    "skill-builder/SKILL.md"
)

for skill in "${CRITICAL_SKILLS[@]}"; do
    if [ -f ".claude/skills/$skill" ]; then
        pass "Critical skill exists: $skill"
    else
        fail "Missing critical skill: $skill"
    fi
done

# Test 4: SKILL.md YAML Frontmatter Validation
section "Test 4: YAML Frontmatter Validation"

VALID_SKILLS=0
INVALID_SKILLS=0

for skill_file in .claude/skills/*/SKILL.md; do
    if [ -f "$skill_file" ]; then
        # Check for YAML frontmatter
        if head -n 5 "$skill_file" | grep -q "^---$"; then
            # Check for name field
            if head -n 20 "$skill_file" | grep -q "^name:"; then
                # Check for description field
                if head -n 20 "$skill_file" | grep -q "^description:"; then
                    ((VALID_SKILLS++))
                else
                    info "Missing description in: $skill_file"
                    ((INVALID_SKILLS++))
                fi
            else
                info "Missing name in: $skill_file"
                ((INVALID_SKILLS++))
            fi
        else
            info "Missing YAML frontmatter in: $skill_file"
            ((INVALID_SKILLS++))
        fi
    fi
done

if [ $INVALID_SKILLS -eq 0 ]; then
    pass "All $VALID_SKILLS skills have valid YAML frontmatter"
else
    fail "$INVALID_SKILLS skills have invalid YAML frontmatter"
fi

# Test 5: Memory Commands
section "Test 5: Memory System (Regression Test)"

# Test memory store
npx claude-flow memory store test-key "test value" --namespace test 2>&1 > /tmp/memory-test.log || true
if grep -q "Stored" /tmp/memory-test.log || grep -q "stored" /tmp/memory-test.log || grep -q "success" /tmp/memory-test.log; then
    pass "Memory store command works"
else
    info "Memory store output: $(cat /tmp/memory-test.log)"
    fail "Memory store command failed"
fi

# Test 6: Help Command
section "Test 6: Help Command (Regression Test)"
npx claude-flow --help > /tmp/help.txt 2>&1
if grep -q "claude-flow" /tmp/help.txt; then
    pass "Help command works"
else
    fail "Help command failed"
fi

# Test 7: Init Help
section "Test 7: Init Help (Regression Test)"
npx claude-flow init --help > /tmp/init-help.txt 2>&1
if grep -q "init" /tmp/init-help.txt; then
    pass "Init help command works"
else
    fail "Init help command failed"
fi

# Test 8: File Structure Validation
section "Test 8: File Structure Validation"

# Check that important files exist
IMPORTANT_FILES=(
    ".claude/settings.json"
)

for file in "${IMPORTANT_FILES[@]}"; do
    if [ -f "$file" ]; then
        pass "Important file exists: $file"
    else
        info "Optional file not found: $file (may be created on first use)"
    fi
done

# Test 9: Agents Directory
section "Test 9: Agents Directory Structure"
AGENT_COUNT=$(find .claude/agents -name "*.md" 2>/dev/null | wc -l)
if [ "$AGENT_COUNT" -gt 0 ]; then
    pass "Found $AGENT_COUNT agent files"
else
    fail "No agent files found"
fi

# Test 10: Package Integrity
section "Test 10: Package Integrity"
if npm list -g claude-flow 2>&1 | grep -q "claude-flow@2.7.0-alpha.11"; then
    pass "Package installed correctly"
else
    fail "Package not installed correctly"
fi

# Test 11: Skills Content Validation
section "Test 11: Skills Content Validation"

# Check that skills have content (not just frontmatter)
SKILLS_WITH_CONTENT=0
for skill_file in .claude/skills/*/SKILL.md; do
    if [ -f "$skill_file" ]; then
        LINE_COUNT=$(wc -l < "$skill_file")
        if [ "$LINE_COUNT" -gt 20 ]; then
            ((SKILLS_WITH_CONTENT++))
        fi
    fi
done

if [ $SKILLS_WITH_CONTENT -gt 15 ]; then
    pass "$SKILLS_WITH_CONTENT skills have substantial content"
else
    fail "Only $SKILLS_WITH_CONTENT skills have substantial content (expected 15+)"
fi

# Test 12: ReasoningBank Integration
section "Test 12: ReasoningBank Integration (Regression Test)"
npx claude-flow memory query "test" --reasoningbank 2>&1 > /tmp/rb-test.log || true
if grep -q "No results" /tmp/rb-test.log || grep -q "Found" /tmp/rb-test.log || grep -q "Querying" /tmp/rb-test.log; then
    pass "ReasoningBank integration works"
else
    info "ReasoningBank output: $(cat /tmp/rb-test.log)"
    fail "ReasoningBank integration failed"
fi

# Test Summary
section "Test Summary"
echo ""
echo "Total Tests Run: $((PASSED + FAILED))"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed${NC}"
    exit 1
fi
