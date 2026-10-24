#!/bin/bash
# Quick setup script for Git checkpoint hooks

echo "🔧 Setting up Git checkpoint hooks for Claude..."

# Check if git is initialized
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo "📦 Initializing Git repository..."
    git init
    git add .
    git commit -m "Initial commit before Claude checkpoints" || echo "⚠️  No files to commit"
fi

# Check if jq is installed
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is required but not installed"
    echo "Install with: apt-get install jq (Linux) or brew install jq (macOS)"
    exit 1
fi

# Create directories
mkdir -p .claude/checkpoints
mkdir -p .claude/helpers

# Copy settings
if [ -f ".claude/settings.json" ]; then
    echo "⚠️  Backing up existing settings.json to settings.json.backup"
    cp .claude/settings.json .claude/settings.json.backup
fi

# Ask which version to use
echo ""
echo "Which checkpoint configuration would you like to use?"
echo "1) Simple (basic checkpoints only)"
echo "2) Advanced (with GitHub integration and detailed tracking)"
read -p "Enter choice (1 or 2): " choice

case $choice in
    1)
        cp .claude/settings-checkpoint-simple.json .claude/settings.json
        echo "✅ Installed simple checkpoint configuration"
        ;;
    2)
        cp .claude/settings-checkpoint-example.json .claude/settings.json
        echo "✅ Installed advanced checkpoint configuration"
        echo ""
        echo "Optional: To enable GitHub releases, run:"
        echo "  export CREATE_GH_RELEASE=true"
        ;;
    *)
        echo "❌ Invalid choice. Using simple configuration."
        cp .claude/settings-checkpoint-simple.json .claude/settings.json
        ;;
esac

# Make scripts executable
chmod +x .claude/helpers/checkpoint-manager.sh 2>/dev/null || true
chmod +x .claude/helpers/setup-checkpoints.sh

# Create initial checkpoint
git add -A
git commit -m "🎯 Initial checkpoint: Claude Git hooks configured" || true
git tag "checkpoint-initial-$(date +%Y%m%d-%H%M%S)"

echo ""
echo "✅ Git checkpoint hooks are now configured!"
echo ""
echo "📚 Quick reference:"
echo "  - List checkpoints:  git tag -l 'checkpoint-*'"
echo "  - Rollback:         git reset --hard <checkpoint-tag>"
echo "  - View changes:     git diff <checkpoint-tag>"
echo ""
echo "🛠️  Advanced management: ./.claude/helpers/checkpoint-manager.sh help"
echo ""
echo "📖 Full documentation: docs/GIT_CHECKPOINT_HOOKS.md"