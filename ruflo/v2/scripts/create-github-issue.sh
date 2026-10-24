#!/bin/bash
# Create GitHub Issue for Automatic Error Recovery
# Run this after confirming fix works in Docker/CLI

set -e

echo "📝 Creating GitHub Issue for Automatic Error Recovery"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed"
    echo "   Install: https://cli.github.com/"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub CLI"
    echo "   Run: gh auth login"
    exit 1
fi

echo "✅ GitHub CLI ready"
echo ""

# Issue title
TITLE="✅ Fixed: Automatic recovery for WSL better-sqlite3 ENOTEMPTY error during init"

# Issue body (from template)
BODY=$(cat docs/github-issues/wsl-enotempty-automatic-recovery.md)

# Labels
LABELS="enhancement,bug-fix,wsl,user-experience,v2.7.35"

# Milestone
MILESTONE="v2.7.35"

echo "Creating issue..."
echo "Title: $TITLE"
echo "Labels: $LABELS"
echo "Milestone: $MILESTONE"
echo ""

# Create the issue
gh issue create \
    --title "$TITLE" \
    --body "$BODY" \
    --label "$LABELS" \
    --milestone "$MILESTONE"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ GitHub issue created successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Add test results to the issue"
    echo "2. Attach screenshots if available"
    echo "3. Request review from maintainers"
else
    echo ""
    echo "❌ Failed to create issue"
    exit 1
fi
