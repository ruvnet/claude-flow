#!/bin/bash

# File Lock Utilities for TypeScript Strict Mode Swarm
# Used by agents to coordinate file access and prevent conflicts

LOCK_REGISTRY="/workspaces/claude-code-flow/.git-lock-manager/lock-registry.json"
MEMORY_PREFIX="typescript-strict-final-push/agent-2"

# Function to request a file lock
request_lock() {
    local agent_id="$1"
    local file_path="$2"
    local operation_type="$3"
    local estimated_duration="${4:-3600}"  # Default 1 hour
    
    if [ -z "$agent_id" ] || [ -z "$file_path" ] || [ -z "$operation_type" ]; then
        echo "Usage: request_lock <agent_id> <file_path> <operation_type> [duration_seconds]"
        return 1
    fi
    
    local current_time=$(date +%s)
    local lock_id="${agent_id}_$(basename "$file_path")_${current_time}"
    
    # Check if file is already locked
    if jq -e --arg file_path "$file_path" '.locks | has($file_path)' "$LOCK_REGISTRY" >/dev/null 2>&1; then
        local existing_agent=$(jq -r --arg file_path "$file_path" '.locks[$file_path].agent_id' "$LOCK_REGISTRY")
        local lock_expiry=$(jq -r --arg file_path "$file_path" '.locks[$file_path].timestamp + .locks[$file_path].duration' "$LOCK_REGISTRY")
        
        if [ "$lock_expiry" -gt "$current_time" ]; then
            echo "LOCK_DENIED: File $file_path is locked by $existing_agent until $(date -d @$lock_expiry)"
            
            # Add to queue
            jq --arg agent_id "$agent_id" \
               --arg file_path "$file_path" \
               --arg operation_type "$operation_type" \
               --arg estimated_duration "$estimated_duration" \
               --arg current_time "$current_time" \
               '.queue += [{
                   "agent_id": $agent_id,
                   "file_path": $file_path,
                   "operation_type": $operation_type,
                   "estimated_duration": ($estimated_duration | tonumber),
                   "queued_at": ($current_time | tonumber)
               }]' "$LOCK_REGISTRY" > "$LOCK_REGISTRY.tmp" && mv "$LOCK_REGISTRY.tmp" "$LOCK_REGISTRY"
            
            return 1
        fi
    fi
    
    # Grant lock
    jq --arg agent_id "$agent_id" \
       --arg file_path "$file_path" \
       --arg operation_type "$operation_type" \
       --arg estimated_duration "$estimated_duration" \
       --arg current_time "$current_time" \
       --arg lock_id "$lock_id" \
       '.locks[$file_path] = {
           "agent_id": $agent_id,
           "operation_type": $operation_type,
           "duration": ($estimated_duration | tonumber),
           "timestamp": ($current_time | tonumber),
           "lock_id": $lock_id
       }' "$LOCK_REGISTRY" > "$LOCK_REGISTRY.tmp" && mv "$LOCK_REGISTRY.tmp" "$LOCK_REGISTRY"
    
    echo "LOCK_GRANTED: $lock_id for $file_path (expires: $(date -d @$((current_time + estimated_duration))))"
    
    # Store lock grant in Memory
    ./claude-flow memory store "$MEMORY_PREFIX/lock-grants/$lock_id" "{
        \"agent_id\": \"$agent_id\",
        \"file_path\": \"$file_path\",
        \"operation_type\": \"$operation_type\",
        \"lock_id\": \"$lock_id\",
        \"granted_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"expires_at\": \"$(date -u -d @$((current_time + estimated_duration)) +%Y-%m-%dT%H:%M:%SZ)\"
    }"
    
    return 0
}

# Function to release a file lock
release_lock() {
    local agent_id="$1"
    local file_path="$2"
    
    if [ -z "$agent_id" ] || [ -z "$file_path" ]; then
        echo "Usage: release_lock <agent_id> <file_path>"
        return 1
    fi
    
    # Check if agent owns the lock
    local lock_owner=$(jq -r --arg file_path "$file_path" '.locks[$file_path].agent_id // "none"' "$LOCK_REGISTRY" 2>/dev/null)
    
    if [ "$lock_owner" != "$agent_id" ]; then
        echo "RELEASE_DENIED: Lock on $file_path is owned by $lock_owner, not $agent_id"
        return 1
    fi
    
    # Release lock
    jq --arg file_path "$file_path" 'del(.locks[$file_path])' "$LOCK_REGISTRY" > "$LOCK_REGISTRY.tmp" && mv "$LOCK_REGISTRY.tmp" "$LOCK_REGISTRY"
    
    echo "LOCK_RELEASED: $file_path by $agent_id"
    
    # Process queue for this file
    process_queue "$file_path"
    
    return 0
}

# Function to process lock queue
process_queue() {
    local file_path="$1"
    
    # Get next queued request for this file
    local next_request=$(jq -r --arg file_path "$file_path" '
        .queue[] | select(.file_path == $file_path) | 
        @base64
    ' "$LOCK_REGISTRY" 2>/dev/null | head -n1)
    
    if [ ! -z "$next_request" ]; then
        local request_data=$(echo "$next_request" | base64 -D)
        local agent_id=$(echo "$request_data" | jq -r '.agent_id')
        local operation_type=$(echo "$request_data" | jq -r '.operation_type')
        local estimated_duration=$(echo "$request_data" | jq -r '.estimated_duration')
        
        # Remove from queue
        jq --arg file_path "$file_path" --arg agent_id "$agent_id" '
            .queue |= map(select(.file_path != $file_path or .agent_id != $agent_id))
        ' "$LOCK_REGISTRY" > "$LOCK_REGISTRY.tmp" && mv "$LOCK_REGISTRY.tmp" "$LOCK_REGISTRY"
        
        # Grant lock to queued agent
        request_lock "$agent_id" "$file_path" "$operation_type" "$estimated_duration"
        
        echo "QUEUE_PROCESSED: Granted lock to $agent_id for $file_path"
    fi
}

# Function to check lock status
check_lock() {
    local file_path="$1"
    
    if [ -z "$file_path" ]; then
        echo "Usage: check_lock <file_path>"
        return 1
    fi
    
    if jq -e --arg file_path "$file_path" '.locks | has($file_path)' "$LOCK_REGISTRY" >/dev/null 2>&1; then
        local lock_info=$(jq --arg file_path "$file_path" '.locks[$file_path]' "$LOCK_REGISTRY")
        local agent_id=$(echo "$lock_info" | jq -r '.agent_id')
        local timestamp=$(echo "$lock_info" | jq -r '.timestamp')
        local duration=$(echo "$lock_info" | jq -r '.duration')
        local expiry=$((timestamp + duration))
        local current_time=$(date +%s)
        
        if [ "$expiry" -gt "$current_time" ]; then
            echo "LOCKED by $agent_id, expires: $(date -d @$expiry)"
            return 0
        else
            echo "EXPIRED lock by $agent_id, expired: $(date -d @$expiry)"
            # Clean up expired lock
            jq --arg file_path "$file_path" 'del(.locks[$file_path])' "$LOCK_REGISTRY" > "$LOCK_REGISTRY.tmp" && mv "$LOCK_REGISTRY.tmp" "$LOCK_REGISTRY"
            return 1
        fi
    else
        echo "NOT_LOCKED"
        return 1
    fi
}

# Function to force unlock (emergency use)
force_unlock() {
    local agent_id="$1"
    local file_path="$2"
    local reason="$3"
    
    if [ -z "$agent_id" ] || [ -z "$file_path" ]; then
        echo "Usage: force_unlock <agent_id> <file_path> <reason>"
        return 1
    fi
    
    # Check if agent has force unlock authority
    if [ "$agent_id" != "agent-1" ] && [ "$agent_id" != "agent-2" ]; then
        echo "FORCE_UNLOCK_DENIED: Agent $agent_id does not have force unlock authority"
        return 1
    fi
    
    # Force unlock
    jq --arg file_path "$file_path" 'del(.locks[$file_path])' "$LOCK_REGISTRY" > "$LOCK_REGISTRY.tmp" && mv "$LOCK_REGISTRY.tmp" "$LOCK_REGISTRY"
    
    echo "FORCE_UNLOCK: $file_path by $agent_id (reason: $reason)"
    
    # Log force unlock in Memory
    ./claude-flow memory store "$MEMORY_PREFIX/force-unlocks/$(date +%s)" "{
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"agent_id\": \"$agent_id\",
        \"file_path\": \"$file_path\",
        \"reason\": \"$reason\",
        \"type\": \"force_unlock\"
    }"
    
    # Process queue
    process_queue "$file_path"
    
    return 0
}

# Function to list all locks
list_locks() {
    echo "=== ACTIVE FILE LOCKS ==="
    jq -r '.locks | to_entries[] | "\(.key): \(.value.agent_id) (\(.value.operation_type)) expires: \((.value.timestamp + .value.duration) | todate)"' "$LOCK_REGISTRY" 2>/dev/null || echo "No active locks"
    
    echo ""
    echo "=== LOCK QUEUE ==="
    jq -r '.queue[] | "\(.file_path): \(.agent_id) (\(.operation_type)) queued: \(.queued_at | todate)"' "$LOCK_REGISTRY" 2>/dev/null || echo "No queued requests"
}

# Main command dispatch
case "$1" in
    "request")
        request_lock "$2" "$3" "$4" "$5"
        ;;
    "release")
        release_lock "$2" "$3"
        ;;
    "check")
        check_lock "$2"
        ;;
    "force-unlock")
        force_unlock "$2" "$3" "$4"
        ;;
    "list")
        list_locks
        ;;
    *)
        echo "Usage: $0 {request|release|check|force-unlock|list} [args...]"
        echo ""
        echo "Commands:"
        echo "  request <agent_id> <file_path> <operation_type> [duration]"
        echo "  release <agent_id> <file_path>"
        echo "  check <file_path>"
        echo "  force-unlock <agent_id> <file_path> <reason>"
        echo "  list"
        exit 1
        ;;
esac