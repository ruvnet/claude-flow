#!/bin/bash

# Progress Monitor Script for Swarm Development Hierarchical Operation
# Agent 2: Real-time tracking of TypeScript errors, build status, test results

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
MEMORY_NAMESPACE="swarm-development-hierarchical-1751206792481/monitor-2"

echo "🔍 Progress Monitor - $TIMESTAMP"
echo "=================================="

# Check TypeScript errors
echo "📊 Checking TypeScript errors..."
TS_ERRORS=$(npm run typecheck 2>&1 | grep -c "error TS" || echo "0")
echo "   Current TypeScript errors: $TS_ERRORS"

# Check build status
echo "🏗️  Checking build status..."
BUILD_OUTPUT=$(npm run build 2>&1 | tail -1)
if [[ $BUILD_OUTPUT == *"error"* ]]; then
    BUILD_STATUS="failing"
else
    BUILD_STATUS="success"
fi
echo "   Build status: $BUILD_STATUS"

# Check lint status
echo "🔧 Checking lint status..."
LINT_OUTPUT=$(npm run lint 2>&1 | tail -1)
LINT_WARNINGS=$(echo "$LINT_OUTPUT" | grep -o '[0-9]* warnings' | grep -o '[0-9]*' || echo "0")
LINT_ERRORS=$(echo "$LINT_OUTPUT" | grep -o '[0-9]* errors' | grep -o '[0-9]*' || echo "0")
echo "   Lint warnings: $LINT_WARNINGS"
echo "   Lint errors: $LINT_ERRORS"

# Calculate improvement
BASELINE_ERRORS=69
IMPROVEMENT_PERCENT=$(( (BASELINE_ERRORS - TS_ERRORS) * 100 / BASELINE_ERRORS ))
echo "   Improvement since baseline: $IMPROVEMENT_PERCENT%"

# Store metrics in memory
METRICS_JSON="{\"timestamp\": \"$TIMESTAMP\", \"typescript_errors\": $TS_ERRORS, \"build_status\": \"$BUILD_STATUS\", \"lint_warnings\": $LINT_WARNINGS, \"lint_errors\": $LINT_ERRORS, \"improvement_percent\": $IMPROVEMENT_PERCENT}"

echo "💾 Storing metrics in memory..."
./claude-flow memory store "$MEMORY_NAMESPACE/current-metrics" "$METRICS_JSON"

echo "✅ Monitoring complete"
echo ""