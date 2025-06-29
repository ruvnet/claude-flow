#!/bin/bash

# Git Conflict Monitor for Agent 2
# Continuously monitors for merge conflicts and file access conflicts

AGENT_ID="agent-2"
MEMORY_PREFIX="typescript-strict-final-push/agent-2"
LOCK_REGISTRY="/workspaces/claude-code-flow/.git-lock-manager/lock-registry.json"
LOG_FILE="/workspaces/claude-code-flow/.git-lock-manager/conflict-monitor.log"

# Initialize log
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - Conflict Monitor started by $AGENT_ID" >> "$LOG_FILE"

# Function to check for git conflicts
check_git_conflicts() {
    local conflicts_found=false
    
    # Check for merge conflicts in working directory
    if git status --porcelain | grep -q "^UU\|^AA\|^DD"; then
        conflicts_found=true
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - CONFLICT DETECTED: Merge conflicts in working directory" >> "$LOG_FILE"
        git status --porcelain | grep "^UU\|^AA\|^DD" >> "$LOG_FILE"
    fi
    
    # Check for conflicting branches
    local current_branch=$(git branch --show-current)
    if git merge-tree $(git merge-base HEAD origin/$current_branch) HEAD origin/$current_branch | grep -q "^<<<<<<< "; then
        conflicts_found=true
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - CONFLICT DETECTED: Potential merge conflicts with origin/$current_branch" >> "$LOG_FILE"
    fi
    
    if [ "$conflicts_found" = true ]; then
        # Store conflict alert in Memory
        ./claude-flow memory store "$MEMORY_PREFIX/conflict-alert" "{
            \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
            \"type\": \"git_conflict\",
            \"severity\": \"high\",
            \"branch\": \"$current_branch\",
            \"status\": \"active\",
            \"requires_resolution\": true
        }"
        
        return 1
    fi
    
    return 0
}

# Function to check file locks
check_file_locks() {
    if [ ! -f "$LOCK_REGISTRY" ]; then
        return 0
    fi
    
    # Check for expired locks
    local current_time=$(date +%s)
    local expired_locks=$(jq -r --arg current_time "$current_time" '
        .locks | to_entries[] | 
        select((.value.timestamp + .value.duration) < ($current_time | tonumber)) | 
        .key
    ' "$LOCK_REGISTRY" 2>/dev/null)
    
    if [ ! -z "$expired_locks" ]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - EXPIRED LOCKS DETECTED: $expired_locks" >> "$LOG_FILE"
        
        # Clean up expired locks
        jq --arg current_time "$current_time" '
            .locks |= with_entries(
                select((.value.timestamp + .value.duration) >= ($current_time | tonumber))
            )
        ' "$LOCK_REGISTRY" > "$LOCK_REGISTRY.tmp" && mv "$LOCK_REGISTRY.tmp" "$LOCK_REGISTRY"
    fi
    
    # Check for lock queue bottlenecks
    local queue_length=$(jq '.queue | length' "$LOCK_REGISTRY" 2>/dev/null || echo 0)
    if [ "$queue_length" -gt 5 ]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - BOTTLENECK DETECTED: Lock queue length: $queue_length" >> "$LOG_FILE"
        
        # Store bottleneck alert in Memory
        ./claude-flow memory store "$MEMORY_PREFIX/bottleneck-alert" "{
            \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
            \"type\": \"lock_queue_bottleneck\",
            \"queue_length\": $queue_length,
            \"severity\": \"medium\",
            \"requires_intervention\": true
        }"
    fi
}

# Function to check workstream conflicts
check_workstream_conflicts() {
    # Check for agents from different workstreams modifying the same files
    local staged_files=$(git diff --cached --name-only 2>/dev/null)
    local unstaged_files=$(git diff --name-only 2>/dev/null)
    
    if [ ! -z "$staged_files" ] || [ ! -z "$unstaged_files" ]; then
        echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) - WORKSTREAM CHECK: Files modified" >> "$LOG_FILE"
        echo "Staged: $staged_files" >> "$LOG_FILE"
        echo "Unstaged: $unstaged_files" >> "$LOG_FILE"
    fi
}

# Main monitoring loop
while true; do
    # Update heartbeat
    ./claude-flow memory store "$MEMORY_PREFIX/heartbeat" "{
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"status\": \"monitoring\",
        \"checks_completed\": $(cat "$LOG_FILE" | wc -l),
        \"last_conflict\": \"none\"
    }"
    
    # Perform checks
    check_git_conflicts
    check_file_locks
    check_workstream_conflicts
    
    # Wait before next check
    sleep 30
done