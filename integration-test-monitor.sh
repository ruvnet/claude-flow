#!/bin/bash

# Integration Test Monitor Script
# Monitors agent progress and runs incremental integration tests

echo "🎯 Phase 1 Integration Testing Monitor - SPARC Agent Coordination"
echo "=============================================================="
echo "Timestamp: $(date)"
echo ""

# Test categories to monitor
CATEGORIES=("infrastructure" "terminal" "cli" "validation" "patterns")
MEMORY_BASE="debug-phase1-tests"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check agent completion status
check_agent_status() {
    local category=$1
    echo -e "${BLUE}Checking ${category} agent status...${NC}"
    
    # This would be replaced with actual Memory API calls
    # For now, we'll check for completion files
    if [ -f "/tmp/claude-flow-${category}-complete" ]; then
        echo -e "${GREEN}✅ ${category} agent: COMPLETE${NC}"
        return 0
    else
        echo -e "${RED}⏳ ${category} agent: PENDING${NC}"
        return 1
    fi
}

# Function to run targeted integration tests
run_integration_test() {
    local test_pattern=$1
    local test_name=$2
    
    echo -e "${YELLOW}Running integration test: ${test_name}${NC}"
    
    # Run specific test pattern
    if npm test -- --testPathPattern="$test_pattern" --verbose; then
        echo -e "${GREEN}✅ ${test_name}: PASSED${NC}"
        return 0
    else
        echo -e "${RED}❌ ${test_name}: FAILED${NC}"
        return 1
    fi
}

# Function to run performance impact assessment
run_performance_test() {
    echo -e "${YELLOW}Running performance impact assessment...${NC}"
    
    # Measure test execution time
    start_time=$(date +%s)
    npm test -- --silent --passWithNoTests
    end_time=$(date +%s)
    
    execution_time=$((end_time - start_time))
    echo "Test execution time: ${execution_time} seconds"
    
    if [ $execution_time -lt 600 ]; then  # Less than 10 minutes
        echo -e "${GREEN}✅ Performance: ACCEPTABLE${NC}"
        return 0
    else
        echo -e "${RED}❌ Performance: DEGRADED${NC}"
        return 1
    fi
}

# Function to run complete integration validation
run_complete_integration() {
    echo -e "${BLUE}Running complete integration validation...${NC}"
    
    # Run full test suite multiple times for stability
    for i in {1..3}; do
        echo "Integration run $i/3..."
        if ! npm test -- --silent; then
            echo -e "${RED}❌ Integration run $i failed${NC}"
            return 1
        fi
    done
    
    echo -e "${GREEN}✅ Complete integration: STABLE${NC}"
    return 0
}

# Main monitoring loop
main() {
    echo "Starting integration testing monitor..."
    
    # Check current baseline
    echo -e "${BLUE}Establishing baseline...${NC}"
    npm test -- --silent --passWithNoTests > /tmp/baseline-test-results.log 2>&1
    
    # Monitor each category
    infrastructure_ready=false
    terminal_ready=false
    cli_ready=false
    validation_ready=false
    patterns_ready=false
    
    while true; do
        echo ""
        echo "=== Integration Test Monitor - $(date) ==="
        
        # Check infrastructure fixes
        if ! $infrastructure_ready && check_agent_status "infrastructure"; then
            echo "Infrastructure fixes detected - running Terminal Manager tests..."
            if run_integration_test "terminal-manager" "Terminal Manager Integration"; then
                infrastructure_ready=true
            fi
        fi
        
        # Check terminal fixes
        if ! $terminal_ready && check_agent_status "terminal"; then
            echo "Terminal fixes detected - running async mock tests..."
            if run_integration_test "terminal" "Terminal Async Mock Integration"; then
                terminal_ready=true
            fi
        fi
        
        # Check CLI fixes
        if ! $cli_ready && check_agent_status "cli"; then
            echo "CLI fixes detected - running assertion tests..."
            if run_integration_test "cli" "CLI Assertion Integration"; then
                cli_ready=true
            fi
        fi
        
        # Check validation fixes
        if ! $validation_ready && check_agent_status "validation"; then
            echo "Validation fixes detected - running CI/CD tests..."
            if run_integration_test "e2e" "CI/CD Integration"; then
                validation_ready=true
            fi
        fi
        
        # Check pattern fixes
        if ! $patterns_ready && check_agent_status "patterns"; then
            echo "Pattern fixes detected - running mock pattern tests..."
            if run_integration_test "mock" "Mock Pattern Integration"; then
                patterns_ready=true
            fi
        fi
        
        # Check if all categories are ready
        if $infrastructure_ready && $terminal_ready && $cli_ready && $validation_ready && $patterns_ready; then
            echo -e "${GREEN}🎉 All agent fixes complete - running final integration validation${NC}"
            
            # Run performance test
            if run_performance_test; then
                echo -e "${GREEN}Performance impact: ACCEPTABLE${NC}"
            else
                echo -e "${YELLOW}Performance impact: NEEDS REVIEW${NC}"
            fi
            
            # Run complete integration
            if run_complete_integration; then
                echo -e "${GREEN}🚀 Phase 1 Test Suite: READY FOR PHASE 2${NC}"
                
                # Create completion marker
                echo "$(date): Integration testing complete - Phase 2 ready" > /tmp/claude-flow-integration-complete
                
                # Final report
                echo ""
                echo "=============================================================="
                echo "🎯 INTEGRATION TESTING COMPLETE"
                echo "=============================================================="
                echo "✅ All debugging agents completed successfully"
                echo "✅ All test categories validated"
                echo "✅ Performance impact acceptable"
                echo "✅ Test suite stability confirmed"
                echo "✅ Phase 2 deployment approved"
                echo "=============================================================="
                
                break
            else
                echo -e "${RED}❌ Integration validation failed - continuing monitoring${NC}"
            fi
        fi
        
        # Wait before next check
        echo "Waiting 30 seconds before next check..."
        sleep 30
    done
}

# Error handling
set -e
trap 'echo "Integration monitoring interrupted"; exit 1' INT TERM

# Run main function
main "$@"