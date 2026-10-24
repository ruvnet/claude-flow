#!/bin/bash
#
# V3 Repository Cleanup Script
# Removes build artifacts, backup files, and cleans up .gitignore
# Part of claude-flow v3 migration cleanup (Master Plan Section 5)
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track cleanup stats
TOTAL_SAVED=0
FILES_REMOVED=0

echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Claude Flow V3 Repository Cleanup Script             ║${NC}"
echo -e "${BLUE}║  Master Plan Section 5: Repository Cleanup            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to calculate size
get_size() {
    if [ -e "$1" ]; then
        du -sh "$1" 2>/dev/null | awk '{print $1}'
    else
        echo "0"
    fi
}

# Function to remove tracked files from git
remove_from_git() {
    local path="$1"
    local description="$2"

    echo -e "${YELLOW}Processing: ${description}${NC}"

    if git ls-files --error-unmatch "$path" > /dev/null 2>&1; then
        local size=$(get_size "$path")
        echo "  Found tracked: $path (Size: $size)"

        if [ "$DRY_RUN" = true ]; then
            echo "  [DRY RUN] Would remove from git: $path"
        else
            git rm -r --cached "$path" 2>/dev/null || true
            echo -e "  ${GREEN}✓ Removed from git tracking${NC}"
            FILES_REMOVED=$((FILES_REMOVED + 1))
        fi
    else
        echo "  Not tracked in git (will be ignored by .gitignore)"
    fi
}

# Function to delete files
delete_files() {
    local pattern="$1"
    local description="$2"

    echo -e "${YELLOW}Deleting: ${description}${NC}"

    local files=$(find . -type f -path "$pattern" ! -path "*/node_modules/*" ! -path "*/.git/*" 2>/dev/null)

    if [ -z "$files" ]; then
        echo "  No files found matching pattern"
        return
    fi

    while IFS= read -r file; do
        if [ -f "$file" ]; then
            local size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0")
            TOTAL_SAVED=$((TOTAL_SAVED + size))

            if [ "$DRY_RUN" = true ]; then
                echo "  [DRY RUN] Would delete: $file"
            else
                rm -f "$file"
                echo "  ${GREEN}✓ Deleted: $file${NC}"
                FILES_REMOVED=$((FILES_REMOVED + 1))
            fi
        fi
    done <<< "$files"
}

# Parse arguments
DRY_RUN=false
if [ "$1" = "--dry-run" ]; then
    DRY_RUN=true
    echo -e "${YELLOW}Running in DRY RUN mode - no changes will be made${NC}"
    echo ""
fi

echo -e "${BLUE}Step 1: Remove tracked build artifacts (dist-cjs/)${NC}"
echo "----------------------------------------"
if [ -d "v2/dist-cjs" ]; then
    remove_from_git "v2/dist-cjs" "CommonJS build artifacts (v2/dist-cjs/)"

    if [ "$DRY_RUN" = false ]; then
        echo "  Ensuring dist-cjs is in .gitignore..."
        if ! grep -q "^dist-cjs/" .gitignore; then
            echo "dist-cjs/" >> .gitignore
            echo -e "  ${GREEN}✓ Added dist-cjs/ to .gitignore${NC}"
        fi
    fi
else
    echo "  No dist-cjs directory found"
fi
echo ""

echo -e "${BLUE}Step 2: Delete backup files in bin/${NC}"
echo "----------------------------------------"
delete_files "*/bin/*-old.js" "Old JavaScript files (*-old.js)"
delete_files "*/bin/*.backup.js" "Backup JavaScript files (*.backup.js)"
delete_files "*/bin/*.bak" "Backup files (*.bak)"
echo ""

echo -e "${BLUE}Step 3: Delete backup files in docs/reasoningbank/models/${NC}"
echo "----------------------------------------"
delete_files "*/docs/reasoningbank/models/*.backup" "Model backup files (*.backup)"
echo ""

echo -e "${BLUE}Step 4: Delete other backup files${NC}"
echo "----------------------------------------"
delete_files "*/src/**/*-old.*" "Old source files (*-old.*)"
delete_files "*/src/**/*.backup" "Source backup files (*.backup)"
delete_files "*/dist-cjs/**/*-old.*" "Old build files in dist-cjs"
echo ""

echo -e "${BLUE}Step 5: Clean up .gitignore duplicates${NC}"
echo "----------------------------------------"
if [ "$DRY_RUN" = true ]; then
    echo "[DRY RUN] Would check for duplicate entries in .gitignore"
else
    # Create temporary file with unique entries
    sort .gitignore | uniq > .gitignore.tmp

    # Count duplicates
    ORIG_LINES=$(wc -l < .gitignore)
    NEW_LINES=$(wc -l < .gitignore.tmp)
    DUPLICATES=$((ORIG_LINES - NEW_LINES))

    if [ $DUPLICATES -gt 0 ]; then
        mv .gitignore.tmp .gitignore
        echo -e "  ${GREEN}✓ Removed $DUPLICATES duplicate entries from .gitignore${NC}"
    else
        rm .gitignore.tmp
        echo "  No duplicate entries found in .gitignore"
    fi

    # Check for specific known duplicates
    DIST_COUNT=$(grep -c "^dist/$" .gitignore || echo "0")
    DS_STORE_COUNT=$(grep -c "^\.DS_Store$" .gitignore || echo "0")
    LOG_COUNT=$(grep -c "^\*\.log$\|^yarn-debug\.log\*$\|^yarn-error\.log\*$\|^lerna-debug\.log\*$" .gitignore | head -1)

    echo "  Duplicate pattern check:"
    echo "    - dist/ entries: $DIST_COUNT"
    echo "    - .DS_Store entries: $DS_STORE_COUNT"
    echo "    - Log file patterns: $LOG_COUNT"
fi
echo ""

echo -e "${BLUE}Step 6: Verify lock file status${NC}"
echo "----------------------------------------"
LOCK_FILES=$(ls -1 package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null | wc -l)
if [ "$LOCK_FILES" -eq 1 ]; then
    LOCK_FILE=$(ls -1 package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null)
    echo -e "  ${GREEN}✓ Single lock file found: $LOCK_FILE${NC}"
elif [ "$LOCK_FILES" -gt 1 ]; then
    echo -e "  ${RED}⚠ WARNING: Multiple lock files found:${NC}"
    ls -1 package-lock.json pnpm-lock.yaml yarn.lock 2>/dev/null
    echo "  Recommendation: Choose one package manager and remove other lock files"
else
    echo -e "  ${RED}⚠ WARNING: No lock file found${NC}"
fi
echo ""

# Calculate and display savings
echo -e "${BLUE}╔════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Cleanup Summary                                       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}DRY RUN COMPLETE - No changes were made${NC}"
    echo ""
fi

echo "Files processed: $FILES_REMOVED"

# Convert bytes to human readable
if [ $TOTAL_SAVED -gt 1073741824 ]; then
    SAVED_GB=$(awk "BEGIN {printf \"%.2f\", $TOTAL_SAVED/1073741824}")
    echo "Total space saved: ${SAVED_GB} GB"
elif [ $TOTAL_SAVED -gt 1048576 ]; then
    SAVED_MB=$(awk "BEGIN {printf \"%.2f\", $TOTAL_SAVED/1048576}")
    echo "Total space saved: ${SAVED_MB} MB"
elif [ $TOTAL_SAVED -gt 1024 ]; then
    SAVED_KB=$(awk "BEGIN {printf \"%.2f\", $TOTAL_SAVED/1024}")
    echo "Total space saved: ${SAVED_KB} KB"
else
    echo "Total space saved: ${TOTAL_SAVED} bytes"
fi

echo ""
echo -e "${GREEN}Repository cleanup completed!${NC}"
echo ""

if [ "$DRY_RUN" = false ]; then
    echo "Next steps:"
    echo "  1. Review changes: git status"
    echo "  2. Commit cleanup: git add .gitignore && git commit -m 'chore: v3 repository cleanup'"
    echo "  3. Verify build: npm run build (or pnpm/yarn)"
    echo "  4. Update documentation if needed"
else
    echo "To apply these changes, run:"
    echo "  bash scripts/cleanup-v3.sh"
fi
echo ""
