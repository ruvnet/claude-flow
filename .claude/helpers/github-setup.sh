#!/bin/bash
# Security rationale: set -euo pipefail ensures that:
#   -e  — exit immediately if any command fails (no silent failures)
#   -u  — treat unset variables as errors (prevents empty-string expansion bugs)
#   -o pipefail — pipeline fails if any command in it fails (not just last)
# This matches the ADR-127 Phase 2 requirement for github-setup.sh hardening.
set -euo pipefail

# Setup GitHub integration for Claude Flow

echo "Setting up GitHub integration..."

# Check for gh CLI
if ! command -v gh &> /dev/null; then
    echo "WARNING: GitHub CLI (gh) not found"
    echo "Install from: https://cli.github.com/"
    echo "Continuing without GitHub features..."
else
    echo "OK: GitHub CLI found"

    # Check auth status and scope sufficiency.
    # `gh auth status` exits non-zero when not authenticated.
    # We additionally parse for "Token scopes" to verify we have at least
    # 'repo' scope, which is required for PR/issue operations.
    if gh auth status 2>&1 | grep -q "Logged in"; then
        echo "OK: GitHub authentication active"
        # Verify repo scope is present for PR/issue operations.
        if gh auth status 2>&1 | grep -q "repo"; then
            echo "OK: 'repo' scope available"
        else
            echo "WARNING: 'repo' scope not confirmed — PR/issue operations may fail"
            echo "Run: gh auth login --scopes repo,read:org"
        fi
    else
        echo "WARNING: Not authenticated with GitHub"
        echo "Run: gh auth login"
    fi
fi

echo ""
echo "GitHub swarm commands available:"
echo "  - npx claude-flow github swarm"
echo "  - npx claude-flow repo analyze"
echo "  - npx claude-flow pr enhance"
echo "  - npx claude-flow issue triage"
