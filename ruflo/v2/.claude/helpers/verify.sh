#!/bin/bash
# Claude-Flow Verification Helper
# Backward-compatible verification system

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if verification is enabled
VERIFY_CONFIG=".claude/config/verification.json"
if [ ! -f "$VERIFY_CONFIG" ]; then
    # Verification not configured - exit silently for compatibility
    exit 0
fi

# Parse verification settings
VERIFY_ENABLED=$(jq -r '.enabled // false' "$VERIFY_CONFIG")
VERIFY_MODE=$(jq -r '.mode // "passive"' "$VERIFY_CONFIG")
TRUTH_THRESHOLD=$(jq -r '.truth_threshold // 0.80' "$VERIFY_CONFIG")

if [ "$VERIFY_ENABLED" != "true" ]; then
    exit 0
fi

# Function to calculate truth score
calculate_truth_score() {
    local test_result=$1
    local lint_result=$2
    local type_result=$3
    local build_result=$4
    
    # Weight: tests=40%, lint=20%, types=20%, build=20%
    local score=0
    [ "$test_result" = "0" ] && score=$((score + 40))
    [ "$lint_result" = "0" ] && score=$((score + 20))
    [ "$type_result" = "0" ] && score=$((score + 20))
    [ "$build_result" = "0" ] && score=$((score + 20))
    
    echo "scale=2; $score / 100" | bc
}

# Function to store truth score
store_truth_score() {
    local agent_id=$1
    local task_id=$2
    local score=$3
    local evidence=$4
    
    local timestamp=$(date +%s)
    local score_file=".claude-flow/memory/truth-scores/${agent_id}_${task_id}_${timestamp}.json"
    
    mkdir -p "$(dirname "$score_file")"
    
    cat > "$score_file" << EOF
{
  "agent_id": "$agent_id",
  "task_id": "$task_id",
  "truth_score": $score,
  "threshold": $TRUTH_THRESHOLD,
  "timestamp": $timestamp,
  "evidence": $evidence,
  "mode": "$VERIFY_MODE"
}
EOF
    
    echo "$score_file"
}

# Main verification logic
main() {
    local agent_id=${1:-"unknown"}
    local task_id=${2:-"unknown"}
    local claim=${3:-"task completed"}
    
    echo -e "${YELLOW}🔍 Running verification for $agent_id...${NC}"
    
    # Create checkpoint before verification
    npx claude-flow@alpha hooks pre-task --description "verification_checkpoint_${task_id}" 2>/dev/null || true
    
    # Run verification checks
    TEST_EXIT=0
    LINT_EXIT=0
    TYPE_EXIT=0
    BUILD_EXIT=0
    
    # Run tests if available
    if [ -f "package.json" ] && grep -q '"test"' package.json; then
        echo "Running tests..."
        npm test --silent 2>/dev/null || TEST_EXIT=$?
    fi
    
    # Run lint if available
    if [ -f "package.json" ] && grep -q '"lint"' package.json; then
        echo "Running lint..."
        npm run lint --silent 2>/dev/null || LINT_EXIT=$?
    fi
    
    # Run type check if available
    if [ -f "package.json" ] && grep -q '"typecheck"' package.json; then
        echo "Running type check..."
        npm run typecheck --silent 2>/dev/null || TYPE_EXIT=$?
    fi
    
    # Run build if available
    if [ -f "package.json" ] && grep -q '"build"' package.json; then
        echo "Running build..."
        npm run build --silent 2>/dev/null || BUILD_EXIT=$?
    fi
    
    # Calculate truth score
    TRUTH_SCORE=$(calculate_truth_score $TEST_EXIT $LINT_EXIT $TYPE_EXIT $BUILD_EXIT)
    
    # Prepare evidence
    EVIDENCE=$(cat << EOF
{
  "test_result": $TEST_EXIT,
  "lint_result": $LINT_EXIT,
  "type_result": $TYPE_EXIT,
  "build_result": $BUILD_EXIT,
  "claim": "$claim"
}
EOF
)
    
    # Store truth score
    SCORE_FILE=$(store_truth_score "$agent_id" "$task_id" "$TRUTH_SCORE" "$EVIDENCE")
    
    # Display results
    if (( $(echo "$TRUTH_SCORE >= $TRUTH_THRESHOLD" | bc -l) )); then
        echo -e "${GREEN}✅ Verification passed! Truth score: $TRUTH_SCORE${NC}"
    else
        echo -e "${RED}❌ Verification failed! Truth score: $TRUTH_SCORE (threshold: $TRUTH_THRESHOLD)${NC}"
    fi
    
    # Handle based on mode
    case "$VERIFY_MODE" in
        "passive")
            # Just log, don't fail
            echo "Mode: PASSIVE - Logging only"
            exit 0
            ;;
        "active")
            # Warn but don't fail
            if (( $(echo "$TRUTH_SCORE < $TRUTH_THRESHOLD" | bc -l) )); then
                echo -e "${YELLOW}⚠️  Warning: Low truth score detected${NC}"
            fi
            exit 0
            ;;
        "strict")
            # Fail if below threshold
            if (( $(echo "$TRUTH_SCORE < $TRUTH_THRESHOLD" | bc -l) )); then
                echo -e "${RED}🛑 Strict mode: Blocking due to low truth score${NC}"
                # Trigger rollback
                npx claude-flow@alpha hooks post-task --task-id "$task_id" --rollback true 2>/dev/null || true
                exit 1
            fi
            exit 0
            ;;
        *)
            exit 0
            ;;
    esac
}

# Run main function
main "$@"