#!/bin/bash
# Git commands to create and push the TTY fixes branch

# Ensure we're in the right directory
cd /Users/breydentaylor/claude-flow2-contribs/harmony-sparc

# Check current status
echo "📋 Current git status:"
git status

# Create and checkout new branch
echo -e "\n🌿 Creating new branch '2.0'..."
git checkout -b 2.0

# Stage the changes
echo -e "\n📦 Staging changes..."
git add src/utils/tty-error-handler.ts
git add docs/fix-memory-tty-errors.md
git add test-fixes.js
git add PR_SUMMARY.md

# Show what will be committed
echo -e "\n📝 Files to be committed:"
git status --short

# Commit the changes
echo -e "\n💾 Committing changes..."
git commit -m "fix: Add TTY error handling for EIO crashes in non-interactive environments

- Implement comprehensive TTY error handler with graceful degradation
- Update SPARC command to use safe readline interface creation
- Add fallback to non-interactive mode when TTY is unavailable
- Prevent crashes in CI/CD, containers, and SSH sessions
- Add test suite to validate error handling

Fixes crashes discovered during stress testing in PTY environments"

# Push to origin (your fork)
echo -e "\n🚀 Pushing to origin/2.0..."
git push origin 2.0

echo -e "\n✅ Done! Your changes have been pushed to prompted365/harmony-sparc branch '2.0'"
echo -e "\n📋 Next steps:"
echo "1. Go to https://github.com/prompted365/harmony-sparc"
echo "2. You should see a prompt to create a pull request"
echo "3. Click 'Compare & pull request'"
echo "4. Change the base repository to 'ruvnet/claude-flow' and base branch to 'Alpha v2'"
echo "5. Use the content from PR_SUMMARY.md for your PR description"
echo "6. Submit the pull request!"
