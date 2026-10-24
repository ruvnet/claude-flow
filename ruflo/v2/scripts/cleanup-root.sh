#!/bin/bash

# Claude-Flow Root Directory Cleanup Script
# This script organizes test files and documentation into appropriate directories

echo "🧹 Starting Claude-Flow root directory cleanup..."

# Create archive directories if they don't exist
mkdir -p archive/reports
mkdir -p archive/test-files
mkdir -p archive/debug-docs

# Move test reports and debugging documentation to archive
echo "📁 Moving test reports and debug documentation..."
mv -v CONFIGURATION_SUMMARY.md archive/reports/ 2>/dev/null || true
mv -v DEPENDENCY_RESOLUTION_GUIDE.md archive/reports/ 2>/dev/null || true
mv -v DOCKER_TEST_REPORT.md archive/reports/ 2>/dev/null || true
mv -v ERROR_HANDLING_IMPLEMENTATION_REPORT.md archive/reports/ 2>/dev/null || true
mv -v QA_TEST_REPORT.md archive/reports/ 2>/dev/null || true
mv -v ROLLBACK_PLAN.md archive/reports/ 2>/dev/null || true
mv -v WEB_UI_IMPLEMENTATION.md archive/reports/ 2>/dev/null || true
mv -v debug-findings.md archive/debug-docs/ 2>/dev/null || true
mv -v debug-hooks-system-SOLUTION.md archive/debug-docs/ 2>/dev/null || true
mv -v mcp-validation-report.md archive/reports/ 2>/dev/null || true
mv -v ruv-swarm-performance-analysis.md archive/reports/ 2>/dev/null || true

# Move test JavaScript files to test archive
echo "📁 Moving test JavaScript files..."
mv -v test*.js archive/test-files/ 2>/dev/null || true
mv -v test*.cjs archive/test-files/ 2>/dev/null || true
mv -v terminal-test.cjs archive/test-files/ 2>/dev/null || true

# Move deployment audit log
echo "📁 Moving audit logs..."
mv -v deployment-audit.log archive/reports/ 2>/dev/null || true

# Keep only essential files in root:
# - README.md (main documentation)
# - CHANGELOG.md (version history)
# - CLAUDE.md (Claude Code integration guide)
# - LICENSE
# - package.json, package-lock.json
# - configuration files
# - main entry points

echo ""
echo "✅ Essential files kept in root:"
echo "- README.md (main documentation)"
echo "- CHANGELOG.md (version history)"
echo "- CLAUDE.md (Claude Code integration)"
echo "- LICENSE"
echo "- package.json & package-lock.json"
echo "- Configuration files (.gitignore, .npmignore, etc.)"
echo "- Main entry points (cli.js, claude-flow)"

echo ""
echo "📊 Cleanup Summary:"
echo "- Test reports moved to: archive/reports/"
echo "- Test files moved to: archive/test-files/"
echo "- Debug docs moved to: archive/debug-docs/"

# Show current root directory status
echo ""
echo "📂 Current root directory (*.md files):"
ls -la *.md 2>/dev/null | grep -v "^d" || echo "No .md files remaining"

echo ""
echo "🧹 Cleanup complete! Root directory is now organized."
echo "💡 To restore files, check the archive/ directory"