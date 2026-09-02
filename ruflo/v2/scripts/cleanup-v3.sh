#!/bin/bash
# Claude-Flow v3 Repository Cleanup Script
# Run from repository root: ./scripts/cleanup-v3.sh

set -e

echo "=== Claude-Flow v3 Repository Cleanup ==="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: Must run from repository root${NC}"
    exit 1
fi

# Dry run by default
DRY_RUN=true
if [ "$1" == "--execute" ]; then
    DRY_RUN=false
    echo -e "${YELLOW}WARNING: Executing cleanup (not a dry run)${NC}"
    echo "Press Ctrl+C within 5 seconds to cancel..."
    sleep 5
fi

# Function to remove files
remove_file() {
    if [ -f "$1" ]; then
        if [ "$DRY_RUN" = true ]; then
            echo -e "${YELLOW}[DRY RUN] Would remove:${NC} $1"
        else
            rm -f "$1"
            echo -e "${GREEN}Removed:${NC} $1"
        fi
    fi
}

# Function to remove directories
remove_dir() {
    if [ -d "$1" ]; then
        if [ "$DRY_RUN" = true ]; then
            echo -e "${YELLOW}[DRY RUN] Would remove:${NC} $1"
        else
            rm -rf "$1"
            echo -e "${GREEN}Removed:${NC} $1"
        fi
    fi
}

# Function to git rm
git_remove() {
    if [ -e "$1" ]; then
        if [ "$DRY_RUN" = true ]; then
            echo -e "${YELLOW}[DRY RUN] Would git rm:${NC} $1"
        else
            git rm -r --cached "$1" 2>/dev/null || true
            echo -e "${GREEN}Git removed:${NC} $1"
        fi
    fi
}

echo ""
echo "=== Phase 1: Remove Build Artifacts from Git ==="
git_remove "dist-cjs/"

echo ""
echo "=== Phase 2: Remove Backup Files ==="
remove_file "bin/pair-old.js"
remove_file "bin/pair-enhanced.backup.js"
remove_file "bin/pair-basic.js"
remove_file "bin/pair-working.js"
remove_file "bin/stream-chain.js.backup"
remove_file "bin/stream-chain-clean.js"
remove_file "bin/stream-chain-fixed.js"
remove_file "bin/stream-chain-working.js"
remove_file "bin/stream-chain-real.js"
remove_file "bin/training-pipeline-old.js.bak"

echo ""
echo "=== Phase 3: Remove ReasoningBank Backup Databases ==="
find docs/reasoningbank/models -name "*.backup" -type f 2>/dev/null | while read file; do
    remove_file "$file"
done

echo ""
echo "=== Phase 4: Remove Deprecated Settings Files ==="
remove_file ".claude/settings-complete.json"
remove_file ".claude/settings-checkpoint-example.json"
remove_file ".claude/settings-checkpoint-simple.json"
remove_file ".claude/settings.reasoningbank-example.json"
remove_file ".claude/settings.reasoningbank-minimal.json"
remove_file ".claude/settings-npx-hooks.json"
remove_file ".claude/test-reasoningbank-hooks.sh"

echo ""
echo "=== Phase 5: Remove Empty Directories ==="
if [ -d "claude-flow-wiki" ] && [ -z "$(ls -A claude-flow-wiki 2>/dev/null)" ]; then
    remove_dir "claude-flow-wiki"
fi

echo ""
echo "=== Phase 6: Archive Old Checkpoints ==="
if [ -d ".claude/checkpoints" ]; then
    CHECKPOINT_COUNT=$(find .claude/checkpoints -maxdepth 1 -name "*.json" -type f 2>/dev/null | wc -l)
    if [ "$CHECKPOINT_COUNT" -gt 20 ]; then
        echo "Found $CHECKPOINT_COUNT checkpoints (keeping newest 20)"
        if [ "$DRY_RUN" = true ]; then
            echo -e "${YELLOW}[DRY RUN] Would archive old checkpoints${NC}"
        else
            mkdir -p .claude/checkpoints/archive
            # Keep newest 20, move rest to archive
            find .claude/checkpoints -maxdepth 1 -name "*.json" -type f -printf '%T@ %p\n' | \
                sort -n | head -n -20 | cut -d' ' -f2- | \
                xargs -I {} mv {} .claude/checkpoints/archive/ 2>/dev/null || true

            # Compress archive
            if [ "$(ls -A .claude/checkpoints/archive 2>/dev/null)" ]; then
                tar -czf .claude/checkpoints/archive.tar.gz -C .claude/checkpoints archive
                rm -rf .claude/checkpoints/archive
                echo -e "${GREEN}Archived old checkpoints to archive.tar.gz${NC}"
            fi
        fi
    else
        echo "Checkpoint count ($CHECKPOINT_COUNT) is within limit"
    fi
fi

echo ""
echo "=== Phase 7: Clean .gitignore Duplicates ==="
if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY RUN] Would clean duplicate entries in .gitignore${NC}"
else
    # Remove duplicate hive-mind-prompt entries
    if [ -f ".gitignore" ]; then
        # Count duplicates
        DUPES=$(grep -c "hive-mind-prompt" .gitignore 2>/dev/null || echo "0")
        if [ "$DUPES" -gt 1 ]; then
            # Keep only first occurrence
            awk '!seen[$0]++' .gitignore > .gitignore.tmp && mv .gitignore.tmp .gitignore
            echo -e "${GREEN}Cleaned .gitignore duplicates${NC}"
        fi
    fi
fi

echo ""
echo "=== Phase 8: Update .gitignore ==="
if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}[DRY RUN] Would add entries to .gitignore${NC}"
else
    # Add new entries if not present
    ENTRIES=(
        "dist-cjs/"
        "*.backup"
        "*-old.js"
        "*.bak"
        ".swarm/memory.db"
        ".hive-mind/memory.db"
    )

    for entry in "${ENTRIES[@]}"; do
        if ! grep -q "^${entry}$" .gitignore 2>/dev/null; then
            echo "$entry" >> .gitignore
            echo -e "${GREEN}Added to .gitignore:${NC} $entry"
        fi
    done
fi

echo ""
echo "=== Phase 9: Remove Stale Research Files ==="
remove_dir ".research/what_is_node_js_"

echo ""
echo "=== Summary ==="
if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}This was a DRY RUN. No files were modified.${NC}"
    echo "To execute cleanup, run: $0 --execute"
else
    echo -e "${GREEN}Cleanup complete!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Review changes: git status"
    echo "2. Commit: git add . && git commit -m 'chore: v3 repository cleanup'"
    echo "3. Push: git push"
fi

echo ""
echo "=== Estimated Space Savings ==="
echo "- Build artifacts (dist-cjs): ~22MB"
echo "- Backup files: ~0.2MB"
echo "- ReasoningBank backups: ~25MB"
echo "- Old checkpoints: ~8MB"
echo "- Settings duplicates: ~0.04MB"
echo "----------------------------"
echo "Total: ~55MB potential savings"
