#!/bin/bash

# Phase 4 Continuous Monitoring Script
# Monitors for phase completions and alerts on changes

echo "=== Phase 4 Validation Monitor ==="
echo "Starting continuous monitoring..."
echo "Press Ctrl+C to stop"
echo ""

# Initialize previous error counts
PREV_BUILD_ERRORS=551
PREV_TYPECHECK_ERRORS=-1
PHASE1_ALERTED=false
PHASE2_ALERTED=false
PHASE3_ALERTED=false

# Function to check build status
check_build_status() {
    local BUILD_OUTPUT=$(npm run build 2>&1)
    local ERROR_COUNT=$(echo "$BUILD_OUTPUT" | grep -c "error TS")
    echo $ERROR_COUNT
}

# Function to check typecheck status
check_typecheck_status() {
    local TYPECHECK_OUTPUT=$(npm run typecheck 2>&1)
    local EXIT_CODE=$?
    echo $EXIT_CODE
}

# Function to check test discovery
check_test_discovery() {
    local TEST_OUTPUT=$(npm test -- --listTests 2>&1)
    local TEST_COUNT=$(echo "$TEST_OUTPUT" | grep -c "\.test\.\|\.spec\.")
    echo $TEST_COUNT
}

# Main monitoring loop
while true; do
    echo -n "$(date '+%H:%M:%S') - Checking build status... "
    
    # Check Phase 1: Build errors
    CURRENT_BUILD_ERRORS=$(check_build_status)
    
    if [ $CURRENT_BUILD_ERRORS -ne $PREV_BUILD_ERRORS ]; then
        echo ""
        echo "🔔 BUILD ERROR COUNT CHANGED: $PREV_BUILD_ERRORS → $CURRENT_BUILD_ERRORS"
        
        if [ $CURRENT_BUILD_ERRORS -eq 0 ] && [ "$PHASE1_ALERTED" = false ]; then
            echo "✅ PHASE 1 COMPLETE! Build has 0 errors!"
            echo "Running full validation..."
            ./phase4-validation.sh
            PHASE1_ALERTED=true
        fi
        
        PREV_BUILD_ERRORS=$CURRENT_BUILD_ERRORS
    else
        echo "Errors: $CURRENT_BUILD_ERRORS"
    fi
    
    # If Phase 1 is complete, check Phase 2
    if [ $CURRENT_BUILD_ERRORS -eq 0 ]; then
        echo -n "$(date '+%H:%M:%S') - Checking typecheck status... "
        TYPECHECK_STATUS=$(check_typecheck_status)
        
        if [ $TYPECHECK_STATUS -eq 0 ] && [ "$PHASE2_ALERTED" = false ]; then
            echo ""
            echo "✅ PHASE 2 COMPLETE! TypeScript compilation successful!"
            PHASE2_ALERTED=true
            
            # Check Phase 3: Test discovery
            echo -n "$(date '+%H:%M:%S') - Checking test discovery... "
            TEST_COUNT=$(check_test_discovery)
            echo "Tests found: $TEST_COUNT"
            
            if [ $TEST_COUNT -gt 0 ] && [ "$PHASE3_ALERTED" = false ]; then
                echo "✅ PHASE 3 COMPLETE! Test discovery successful!"
                echo "Running final validation..."
                ./phase4-validation.sh
                PHASE3_ALERTED=true
            fi
        else
            echo "Exit code: $TYPECHECK_STATUS"
        fi
    fi
    
    # Sleep for 30 seconds before next check
    sleep 30
done