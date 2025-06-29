#!/bin/bash

# TypeScript Strict Mode Mega Swarm Monitoring Script
# Real-time monitoring of 20-agent swarm progress

SWARM_NAMESPACE="typescript-strict-mega-swarm"
LOG_FILE=".claude/swarm-progress/monitor-$(date +%Y%m%d-%H%M%S).log"

echo "🚀 TypeScript Strict Mode Mega Swarm Monitor Started" | tee "$LOG_FILE"
echo "Timestamp: $(date)" | tee -a "$LOG_FILE"
echo "=========================================" | tee -a "$LOG_FILE"

# Function to get error count
get_error_count() {
    npm run check:strict 2>&1 | grep -c "error TS" || echo "0"
}

# Function to check build status
check_build_status() {
    if npm run typecheck >/dev/null 2>&1; then
        echo "PASSING"
    else
        echo "FAILING"
    fi
}

# Function to get memory stats
get_memory_stats() {
    ./claude-flow memory list | grep "$SWARM_NAMESPACE" | wc -l 2>/dev/null || echo "0"
}

# Main monitoring loop
monitor_swarm() {
    local start_time=$(date +%s)
    local baseline_errors=$(cat .claude/baselines/typescript-strict-baseline.json 2>/dev/null | grep -o '"totalErrors": [0-9]*' | cut -d' ' -f2 || echo "1518")
    
    echo "Baseline Errors: $baseline_errors" | tee -a "$LOG_FILE"
    echo "Target: 0 errors" | tee -a "$LOG_FILE"
    echo "=========================================" | tee -a "$LOG_FILE"
    
    while true; do
        local current_time=$(date +%s)
        local elapsed=$((current_time - start_time))
        local current_errors=$(get_error_count)
        local build_status=$(check_build_status)
        local memory_entries=$(get_memory_stats)
        local progress=$(( (baseline_errors - current_errors) * 100 / baseline_errors ))
        
        printf "\n[%02d:%02d:%02d] " $((elapsed/3600)) $(((elapsed%3600)/60)) $((elapsed%60)) | tee -a "$LOG_FILE"
        printf "Errors: %4d/%d (%3d%%) | Build: %s | Memory: %3d entries\n" \
            "$current_errors" "$baseline_errors" "$progress" "$build_status" "$memory_entries" | tee -a "$LOG_FILE"
        
        # Check for completion
        if [ "$current_errors" -eq 0 ] && [ "$build_status" = "PASSING" ]; then
            echo "🎉 SUCCESS! TypeScript strict mode compliance achieved!" | tee -a "$LOG_FILE"
            echo "Total time: $(printf "%02d:%02d:%02d" $((elapsed/3600)) $(((elapsed%3600)/60)) $((elapsed%60)))" | tee -a "$LOG_FILE"
            break
        fi
        
        # Quality gate checkpoints
        if [ $((elapsed % 1800)) -eq 0 ] && [ $elapsed -gt 0 ]; then
            echo "⏰ 30-minute checkpoint reached" | tee -a "$LOG_FILE"
            echo "   Progress analysis: $progress% complete" | tee -a "$LOG_FILE"
        fi
        
        sleep 10
    done
}

# Emergency stop function
emergency_stop() {
    echo "🛑 Emergency stop triggered" | tee -a "$LOG_FILE"
    echo "Saving current state to memory..." | tee -a "$LOG_FILE"
    ./claude-flow memory store "$SWARM_NAMESPACE/emergency-stop" "$(date): Emergency stop at $(get_error_count) errors"
    exit 1
}

# Set up signal handlers
trap emergency_stop SIGINT SIGTERM

# Start monitoring
echo "Starting continuous monitoring (Ctrl+C to stop)..."
monitor_swarm