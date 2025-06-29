#!/bin/bash

# Simple monitoring script for Agent 2
MEMORY_PREFIX="typescript-strict-final-push/agent-2"

# Check for conflicts and update heartbeat
check_and_update() {
    local current_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    
    # Check for merge conflicts
    local conflicts=$(git status --porcelain | grep -c "^UU\|^AA\|^DD" || echo 0)
    
    # Check lock queue length
    local queue_length=0
    if [ -f "/workspaces/claude-code-flow/.git-lock-manager/lock-registry.json" ]; then
        queue_length=$(jq '.queue | length' /workspaces/claude-code-flow/.git-lock-manager/lock-registry.json 2>/dev/null || echo 0)
    fi
    
    # Update heartbeat
    ./claude-flow memory store "$MEMORY_PREFIX/heartbeat" "{
        \"timestamp\": \"$current_time\",
        \"status\": \"monitoring\",
        \"conflicts_detected\": $conflicts,
        \"lock_queue_length\": $queue_length,
        \"monitoring_active\": true
    }"
    
    echo "$current_time - Conflicts: $conflicts, Queue: $queue_length"
}

# Run a single check
check_and_update