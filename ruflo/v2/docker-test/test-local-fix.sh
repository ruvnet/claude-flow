#!/bin/bash
# Test script for LOCAL claude-flow (skills-copier fix validation)

set -e  # Exit on error

echo "=========================================="
echo "🔧 Testing LOCAL claude-flow Skills Fix"
echo "=========================================="
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
    echo "=========================================="
    echo "🔍 $1"
    echo "=========================================="
}

# Test 1: Version Check
section "Test 1: Version Check"
VERSION=$(claude-flow --version 2>&1)
info "Version: $VERSION"
if [[ "$VERSION" == *"2.7.0-alpha.11"* ]]; then
    pass "Version detected"
else
    fail "Unexpected version: $VERSION"
fi

# Test 2: Init Command
section "Test 2: Init Command with Skills System"
cd /test

# Run init with verbose output
info "Running: npx claude-flow init --skip-open --project-name test-project"
npx claude-flow init --skip-open --project-name "test-project" 2>&1 | tee /tmp/init-output.log

echo ""
info "Init output saved to /tmp/init-output.log"
echo ""

# Test 3: Directory Structure
section "Test 3: Directory Structure Created"

# Check .claude directory created
if [ -d ".claude" ]; then
    pass ".claude directory created"
else
    fail ".claude directory not created"
    exit 1
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

# Test 4: Skills Files (CRITICAL TEST)
section "Test 4: Skills Files Created (CRITICAL)"

# Count skills directories
SKILL_DIR_COUNT=$(find .claude/skills -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
info "Found $SKILL_DIR_COUNT skill directories"

# Count SKILL.md files
SKILL_COUNT=$(find .claude/skills -name "SKILL.md" 2>/dev/null | wc -l)
if [ "$SKILL_COUNT" -gt 0 ]; then
    pass "✨ Found $SKILL_COUNT skill files (fix is working!)"
else
    fail "❌ CRITICAL: No skill files found - fix failed!"
    info "Init output:"
    cat /tmp/init-output.log
    exit 1
fi

# Expected minimum skills (should be 21)
if [ "$SKILL_COUNT" -ge 21 ]; then
    pass "All 21+ skills present"
else
    fail "Only $SKILL_COUNT skills found (expected 21+)"
fi

# Test 5: Critical Skills Verification
section "Test 5: Critical Skills Verification"

CRITICAL_SKILLS=(
    "agentdb-vector-search/SKILL.md"
    "agentdb-memory-patterns/SKILL.md"
    "swarm-orchestration/SKILL.md"
    "sparc-methodology/SKILL.md"
    "skill-builder/SKILL.md"
    "flow-nexus-platform/SKILL.md"
    "github-code-review/SKILL.md"
    "pair-programming/SKILL.md"
    "hive-mind-advanced/SKILL.md"
    "reasoningbank-intelligence/SKILL.md"
)

for skill in "${CRITICAL_SKILLS[@]}"; do
    if [ -f ".claude/skills/$skill" ]; then
        pass "Critical skill exists: $skill"
    else
        fail "Missing critical skill: $skill"
    fi
done

# Test 6: YAML Frontmatter Validation
section "Test 6: YAML Frontmatter Validation"

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

# Test 7: Skills Content Validation
section "Test 7: Skills Content Validation"

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

# Test 8: Skills Discoverability
section "Test 8: Skills Discoverability"

# List all skill directories
info "Discovered skills:"
for skill_dir in .claude/skills/*/; do
    if [ -d "$skill_dir" ]; then
        skill_name=$(basename "$skill_dir")
        if [ -f "$skill_dir/SKILL.md" ]; then
            echo "  ✓ $skill_name"
        fi
    fi
done

# Test 9: File Paths Debug
section "Test 9: Skills Source Path Validation"

info "Checking skills-copier source paths..."
if grep -q "Using packaged skill files" /tmp/init-output.log; then
    pass "Skills copied from npm package location"
elif grep -q "Using local development skill files" /tmp/init-output.log; then
    pass "Skills copied from local development location"
elif grep -q "Using global npm skill files" /tmp/init-output.log; then
    pass "Skills copied from global npm location"
else
    info "Source path detection:"
    grep "📁 Using" /tmp/init-output.log || echo "No source path logged"
fi

# Test Summary
section "Test Summary"
echo ""
echo "Total Tests Run: $((PASSED + FAILED))"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed! Skills-copier fix is working!${NC}"
    echo ""
    echo "✅ READY TO PUBLISH alpha.12"
    exit 0
else
    echo -e "${RED}❌ Some tests failed - fix needs more work${NC}"
    exit 1
fi
