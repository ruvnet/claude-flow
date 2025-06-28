#!/bin/bash

# Phase 4 Validation Script
# Monitors for phase completions and runs appropriate validations

echo "=== Phase 4 Validation Specialist ==="
echo "Monitoring for phase completions..."
echo ""

# Initialize validation results
PHASE1_COMPLETE=false
PHASE2_COMPLETE=false
PHASE3_COMPLETE=false
FINAL_COMPLETE=false

# Function to run build validation
validate_phase1() {
    echo "Running Phase 1 validation: npm run build"
    echo "Expected: 0 errors"
    echo "-----------------------------------"
    
    # Capture build output
    BUILD_OUTPUT=$(npm run build 2>&1)
    BUILD_EXIT_CODE=$?
    
    # Count errors
    ERROR_COUNT=$(echo "$BUILD_OUTPUT" | grep -c "error TS")
    
    echo "Build Exit Code: $BUILD_EXIT_CODE"
    echo "Error Count: $ERROR_COUNT"
    
    if [ $ERROR_COUNT -eq 0 ] && [ $BUILD_EXIT_CODE -eq 0 ]; then
        echo "✅ Phase 1 PASSED: Build successful with 0 errors!"
        PHASE1_COMPLETE=true
        return 0
    else
        echo "❌ Phase 1 FAILED: Found $ERROR_COUNT errors"
        echo "$BUILD_OUTPUT" | grep "error TS" | head -10
        return 1
    fi
}

# Function to run typecheck validation
validate_phase2() {
    echo ""
    echo "Running Phase 2 validation: npm run typecheck"
    echo "Expected: Clean compilation"
    echo "-----------------------------------"
    
    TYPECHECK_OUTPUT=$(npm run typecheck 2>&1)
    TYPECHECK_EXIT_CODE=$?
    
    echo "TypeCheck Exit Code: $TYPECHECK_EXIT_CODE"
    
    if [ $TYPECHECK_EXIT_CODE -eq 0 ]; then
        echo "✅ Phase 2 PASSED: TypeScript compilation successful!"
        PHASE2_COMPLETE=true
        return 0
    else
        echo "❌ Phase 2 FAILED: TypeScript compilation errors"
        echo "$TYPECHECK_OUTPUT" | tail -20
        return 1
    fi
}

# Function to run test discovery validation
validate_phase3() {
    echo ""
    echo "Running Phase 3 validation: npm test -- --listTests"
    echo "Expected: Test files discovered"
    echo "-----------------------------------"
    
    TEST_LIST_OUTPUT=$(npm test -- --listTests 2>&1)
    TEST_LIST_EXIT_CODE=$?
    
    # Count discovered test files
    TEST_COUNT=$(echo "$TEST_LIST_OUTPUT" | grep -c "\.test\.\|\.spec\.")
    
    echo "Test Discovery Exit Code: $TEST_LIST_EXIT_CODE"
    echo "Test Files Found: $TEST_COUNT"
    
    if [ $TEST_COUNT -gt 0 ]; then
        echo "✅ Phase 3 PASSED: Found $TEST_COUNT test files!"
        PHASE3_COMPLETE=true
        return 0
    else
        echo "❌ Phase 3 FAILED: No test files discovered"
        return 1
    fi
}

# Function to run final test validation
validate_final() {
    echo ""
    echo "Running Final validation: npm test:unit -- --bail"
    echo "Expected: At least 50% tests passing"
    echo "-----------------------------------"
    
    # Run tests and capture output
    TEST_OUTPUT=$(npm run test:unit -- --bail 2>&1)
    TEST_EXIT_CODE=$?
    
    # Extract test results
    PASSED=$(echo "$TEST_OUTPUT" | grep -E "Tests:.*passed" | sed -E 's/.*([0-9]+) passed.*/\1/')
    FAILED=$(echo "$TEST_OUTPUT" | grep -E "Tests:.*failed" | sed -E 's/.*([0-9]+) failed.*/\1/')
    TOTAL=$(echo "$TEST_OUTPUT" | grep -E "Tests:.*total" | sed -E 's/.*([0-9]+) total.*/\1/')
    
    # Default values if not found
    PASSED=${PASSED:-0}
    FAILED=${FAILED:-0}
    TOTAL=${TOTAL:-0}
    
    if [ $TOTAL -gt 0 ]; then
        PASS_RATE=$((PASSED * 100 / TOTAL))
        echo "Test Results: $PASSED passed, $FAILED failed, $TOTAL total"
        echo "Pass Rate: $PASS_RATE%"
        
        if [ $PASS_RATE -ge 50 ]; then
            echo "✅ Final Validation PASSED: $PASS_RATE% tests passing!"
            FINAL_COMPLETE=true
            return 0
        else
            echo "❌ Final Validation FAILED: Only $PASS_RATE% tests passing (need 50%)"
            return 1
        fi
    else
        echo "❌ Final Validation FAILED: No test results found"
        echo "$TEST_OUTPUT" | tail -20
        return 1
    fi
}

# Function to generate metrics report
generate_metrics_report() {
    echo ""
    echo "=== Success Metrics Report ==="
    echo "Generated: $(date)"
    echo "----------------------------"
    echo "Phase 1 (Build): $([ "$PHASE1_COMPLETE" = true ] && echo "✅ PASSED" || echo "❌ FAILED")"
    echo "Phase 2 (TypeCheck): $([ "$PHASE2_COMPLETE" = true ] && echo "✅ PASSED" || echo "❌ FAILED")"
    echo "Phase 3 (Test Discovery): $([ "$PHASE3_COMPLETE" = true ] && echo "✅ PASSED" || echo "❌ FAILED")"
    echo "Final (Test Execution): $([ "$FINAL_COMPLETE" = true ] && echo "✅ PASSED" || echo "❌ FAILED")"
    echo ""
    
    # Save report to file
    cat > validation-report.json <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "phases": {
    "phase1_build": $PHASE1_COMPLETE,
    "phase2_typecheck": $PHASE2_COMPLETE,
    "phase3_test_discovery": $PHASE3_COMPLETE,
    "final_test_execution": $FINAL_COMPLETE
  },
  "overall_success": $([ "$PHASE1_COMPLETE" = true ] && [ "$PHASE2_COMPLETE" = true ] && [ "$PHASE3_COMPLETE" = true ] && [ "$FINAL_COMPLETE" = true ] && echo "true" || echo "false")
}
EOF
    
    echo "Report saved to: validation-report.json"
}

# Main validation loop
echo "Starting validation sequence..."
echo ""

# Run all validations in sequence
validate_phase1
if [ $? -eq 0 ]; then
    validate_phase2
    if [ $? -eq 0 ]; then
        validate_phase3
        if [ $? -eq 0 ]; then
            validate_final
        fi
    fi
fi

# Generate final report
generate_metrics_report

# Exit with appropriate code
if [ "$PHASE1_COMPLETE" = true ] && [ "$PHASE2_COMPLETE" = true ] && [ "$PHASE3_COMPLETE" = true ] && [ "$FINAL_COMPLETE" = true ]; then
    echo ""
    echo "🎉 ALL VALIDATIONS PASSED! 🎉"
    exit 0
else
    echo ""
    echo "⚠️  Some validations failed. Check the report for details."
    exit 1
fi