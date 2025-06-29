#!/bin/bash

# Coordination Script for Agent 10: Incremental Validation Specialist
# 
# This script allows other swarm agents to trigger validation after completing their work.
# Usage: ./coordinate-with-agent10.sh <agentId> <role> <description> [priority] [impact]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_ID="${1:-unknown}"
ROLE="${2:-unknown}"
DESCRIPTION="${3:-Work completed}"
PRIORITY="${4:-medium}"
IMPACT="${5:-unknown}"

echo "🔗 Coordinating with Agent 10: Incremental Validation Specialist"
echo "   Agent: $AGENT_ID ($ROLE)"
echo "   Work: $DESCRIPTION"
echo "   Priority: $PRIORITY"
echo "   Expected Impact: $IMPACT"

# Check if validation framework is available
if [ ! -f "$SCRIPT_DIR/incremental-validator.js" ]; then
    echo "❌ Validation framework not found. Agent 10 may not be active."
    exit 1
fi

# Trigger agent completion hook
echo "🚀 Triggering validation..."
if node "$SCRIPT_DIR/agent-completion-hook.js" complete "$AGENT_ID" "$ROLE" "$DESCRIPTION" "$PRIORITY" "$IMPACT"; then
    echo "✅ Validation completed successfully"
    
    # Show recent validation results
    echo "📊 Recent validation summary:"
    if [ -d "$SCRIPT_DIR/reports" ]; then
        LATEST_REPORT=$(ls -t "$SCRIPT_DIR/reports"/validation-*.json 2>/dev/null | head -1)
        if [ -n "$LATEST_REPORT" ]; then
            echo "   Latest report: $(basename "$LATEST_REPORT")"
            # Extract key metrics using jq if available
            if command -v jq >/dev/null 2>&1; then
                TS_ERRORS=$(jq -r '.validations.typescript.errorCount // "unknown"' "$LATEST_REPORT")
                BUILD_STATUS=$(jq -r '.validations.build.status // "unknown"' "$LATEST_REPORT")
                TEST_STATUS=$(jq -r '.validations.tests.status // "unknown"' "$LATEST_REPORT")
                echo "   TypeScript errors: $TS_ERRORS"
                echo "   Build status: $BUILD_STATUS"
                echo "   Test status: $TEST_STATUS"
            fi
        fi
    fi
    
    echo ""
    echo "💡 Validation framework features:"
    echo "   - Real-time TypeScript error tracking"
    echo "   - Build and test regression detection"
    echo "   - Agent coordination monitoring"
    echo "   - Automated baseline comparison"
    echo "   - Comprehensive reporting"
    echo ""
    echo "📊 Access dashboard: validation/dashboard/dashboard.html"
    echo "📝 View reports: validation/reports/"
    echo "🔍 Monitor: node validation/swarm-monitor.js start"
    
else
    echo "❌ Validation failed. Check logs for details."
    exit 1
fi