#!/bin/bash
# TypeScript Strict Compliance Mega Swarm Progress Tracker
# Baseline Creation Agent #3 - Monitoring System

set -e

BASELINE_KEY="typescript-strict-mega-swarm/baseline-agent-3/initial-metrics"
PROGRESS_KEY="typescript-strict-mega-swarm/baseline-agent-3/progress-history"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 TypeScript Strict Compliance Progress Tracker${NC}"
echo -e "${BLUE}=================================================${NC}"

# Run TypeScript check and capture errors
echo -e "${YELLOW}⚙️  Running TypeScript compilation check...${NC}"
npm run typecheck 2>&1 | tee typescript-current-errors.txt || true

# Count current errors
CURRENT_ERRORS=$(rg "error TS" typescript-current-errors.txt | wc -l || echo "0")
echo -e "${BLUE}📊 Current error count: ${CURRENT_ERRORS}${NC}"

# Get baseline from memory
BASELINE_ERRORS=$(./claude-flow memory get "$BASELINE_KEY" 2>/dev/null | jq -r '.summary.totalErrors // 898' || echo "898")
echo -e "${BLUE}🎯 Baseline error count: ${BASELINE_ERRORS}${NC}"

# Calculate progress
ERRORS_REDUCED=$((BASELINE_ERRORS - CURRENT_ERRORS))
PERCENTAGE_REDUCED=$(echo "scale=2; $ERRORS_REDUCED * 100 / $BASELINE_ERRORS" | bc -l 2>/dev/null || echo "0")

echo -e "${BLUE}📈 Progress Analysis:${NC}"
echo -e "   Errors reduced: ${ERRORS_REDUCED}"
echo -e "   Percentage reduced: ${PERCENTAGE_REDUCED}%"

# Color code the progress
if (( $(echo "$PERCENTAGE_REDUCED >= 25" | bc -l) )); then
    echo -e "${GREEN}🎉 Excellent progress! 25%+ reduction achieved!${NC}"
elif (( $(echo "$PERCENTAGE_REDUCED >= 10" | bc -l) )); then
    echo -e "${YELLOW}👍 Good progress! 10%+ reduction achieved!${NC}"
elif (( $(echo "$PERCENTAGE_REDUCED >= 5" | bc -l) )); then
    echo -e "${YELLOW}📋 Moderate progress - 5%+ reduction${NC}"
else
    echo -e "${RED}⚠️  Early stages - less than 5% reduction${NC}"
fi

# Analyze current error types
echo -e "${BLUE}🔍 Current Error Type Analysis:${NC}"
if [ -f "typescript-current-errors.txt" ] && [ -s "typescript-current-errors.txt" ]; then
    echo "Top error types:"
    rg "error TS(\d+)" typescript-current-errors.txt -o | sort | uniq -c | sort -nr | head -10 | while read count code; do
        echo "   $code: $count errors"
    done
    
    echo ""
    echo "Files with most errors:"
    rg 'src/[^:]+\.ts' typescript-current-errors.txt -o | sort | uniq -c | sort -nr | head -10 | while read count file; do
        echo "   $file: $count errors"
    done
fi

# Store progress snapshot in memory
PROGRESS_SNAPSHOT="{
    \"timestamp\": \"$TIMESTAMP\",
    \"totalErrors\": $CURRENT_ERRORS,
    \"baselineErrors\": $BASELINE_ERRORS,
    \"errorsReduced\": $ERRORS_REDUCED,
    \"percentageReduced\": $PERCENTAGE_REDUCED,
    \"swarmAgent\": \"baseline-agent-3\",
    \"notes\": \"Automated progress check\"
}"

echo -e "${BLUE}💾 Storing progress snapshot in memory...${NC}"
./claude-flow memory store "${PROGRESS_KEY}-${TIMESTAMP}" "$PROGRESS_SNAPSHOT" >/dev/null 2>&1 || true

# Generate summary report
echo -e "${BLUE}📋 Summary Report:${NC}"
echo "=========================="
echo "Timestamp: $TIMESTAMP"
echo "Current Errors: $CURRENT_ERRORS"
echo "Baseline Errors: $BASELINE_ERRORS"  
echo "Errors Reduced: $ERRORS_REDUCED"
echo "Progress: ${PERCENTAGE_REDUCED}%"
echo "=========================="

# Alert thresholds
if (( $(echo "$PERCENTAGE_REDUCED >= 50" | bc -l) )); then
    echo -e "${GREEN}🚨 MILESTONE ALERT: 50%+ error reduction achieved! Consider celebration! 🎉${NC}"
elif (( $(echo "$PERCENTAGE_REDUCED >= 25" | bc -l) )); then
    echo -e "${GREEN}🔔 MILESTONE ALERT: 25%+ error reduction achieved! Great work! 👏${NC}"
elif (( $(echo "$PERCENTAGE_REDUCED >= 10" | bc -l) )); then
    echo -e "${YELLOW}📢 PROGRESS ALERT: 10%+ error reduction achieved! Keep it up! 💪${NC}"
fi

echo -e "${BLUE}✅ Progress tracking complete!${NC}"