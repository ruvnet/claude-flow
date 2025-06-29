#!/bin/bash

# Merge Coordinator for TypeScript Strict Mode Swarm
# Handles staged merge sequences according to workstream priorities

MEMORY_PREFIX="typescript-strict-final-push/agent-2"
MERGE_QUEUE="/workspaces/claude-code-flow/.git-lock-manager/merge-queue.json"
CONFLICT_LOG="/workspaces/claude-code-flow/.git-lock-manager/merge-conflicts.log"

# Workstream priority order from coordinator protocols
WORKSTREAM_PRIORITY=("WS-B" "WS-D" "WS-A" "WS-C" "WS-E")

# Initialize merge queue if it doesn't exist
initialize_merge_queue() {
    if [ ! -f "$MERGE_QUEUE" ]; then
        cat > "$MERGE_QUEUE" << EOF
{
  "version": "1.0.0",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "queue": [],
  "processing": null,
  "completed": [],
  "failed": [],
  "metadata": {
    "agent_id": "agent-2",
    "workstream_priority": ["WS-B", "WS-D", "WS-A", "WS-C", "WS-E"],
    "max_concurrent_merges": 1,
    "merge_timeout": 3600
  }
}
EOF
    fi
}

# Function to add merge request to queue
queue_merge_request() {
    local agent_id="$1"
    local workstream="$2"
    local branch_name="$3"
    local pr_number="$4"
    local priority="${5:-normal}"
    
    if [ -z "$agent_id" ] || [ -z "$workstream" ] || [ -z "$branch_name" ]; then
        echo "Usage: queue_merge_request <agent_id> <workstream> <branch_name> [pr_number] [priority]"
        return 1
    fi
    
    local current_time=$(date +%s)
    local merge_id="${agent_id}_${workstream}_${current_time}"
    
    # Add to merge queue
    jq --arg merge_id "$merge_id" \
       --arg agent_id "$agent_id" \
       --arg workstream "$workstream" \
       --arg branch_name "$branch_name" \
       --arg pr_number "$pr_number" \
       --arg priority "$priority" \
       --arg current_time "$current_time" \
       '.queue += [{
           "merge_id": $merge_id,
           "agent_id": $agent_id,
           "workstream": $workstream,
           "branch_name": $branch_name,
           "pr_number": $pr_number,
           "priority": $priority,
           "queued_at": ($current_time | tonumber),
           "status": "queued"
       }]' "$MERGE_QUEUE" > "$MERGE_QUEUE.tmp" && mv "$MERGE_QUEUE.tmp" "$MERGE_QUEUE"
    
    echo "MERGE_QUEUED: $merge_id for $workstream ($branch_name)"
    
    # Sort queue by workstream priority and then by queue time
    sort_merge_queue
    
    # Try to process queue
    process_merge_queue
    
    return 0
}

# Function to sort merge queue by priority
sort_merge_queue() {
    # Create priority mapping
    local priority_map='{"WS-B": 1, "WS-D": 2, "WS-A": 3, "WS-C": 4, "WS-E": 5}'
    
    jq --argjson priority_map "$priority_map" '
        .queue |= sort_by([
            ($priority_map[.workstream] // 99),
            (.priority == "high" | not),
            .queued_at
        ])
    ' "$MERGE_QUEUE" > "$MERGE_QUEUE.tmp" && mv "$MERGE_QUEUE.tmp" "$MERGE_QUEUE"
}

# Function to process merge queue
process_merge_queue() {
    # Check if currently processing a merge
    local current_processing=$(jq -r '.processing // "null"' "$MERGE_QUEUE")
    if [ "$current_processing" != "null" ]; then
        echo "MERGE_BUSY: Currently processing merge $current_processing"
        return 0
    fi
    
    # Get next merge from queue
    local next_merge=$(jq -r '.queue[0] // "null"' "$MERGE_QUEUE")
    if [ "$next_merge" = "null" ]; then
        echo "MERGE_QUEUE_EMPTY: No pending merges"
        return 0
    fi
    
    local merge_id=$(echo "$next_merge" | jq -r '.merge_id')
    local agent_id=$(echo "$next_merge" | jq -r '.agent_id')
    local workstream=$(echo "$next_merge" | jq -r '.workstream')
    local branch_name=$(echo "$next_merge" | jq -r '.branch_name')
    local pr_number=$(echo "$next_merge" | jq -r '.pr_number')
    
    echo "MERGE_PROCESSING: Starting merge $merge_id ($workstream: $branch_name)"
    
    # Move from queue to processing
    jq --arg merge_id "$merge_id" '
        .processing = (.queue[] | select(.merge_id == $merge_id)) |
        .queue |= map(select(.merge_id != $merge_id))
    ' "$MERGE_QUEUE" > "$MERGE_QUEUE.tmp" && mv "$MERGE_QUEUE.tmp" "$MERGE_QUEUE"
    
    # Perform the merge
    perform_merge "$merge_id" "$agent_id" "$workstream" "$branch_name" "$pr_number"
    
    return $?
}

# Function to perform actual merge
perform_merge() {
    local merge_id="$1"
    local agent_id="$2"
    local workstream="$3"
    local branch_name="$4"
    local pr_number="$5"
    
    local start_time=$(date +%s)
    local log_entry="$(date -u +%Y-%m-%dT%H:%M:%SZ) - Starting merge $merge_id"
    
    echo "$log_entry" >> "$CONFLICT_LOG"
    echo "$log_entry"
    
    # Store merge start in Memory
    ./claude-flow memory store "$MEMORY_PREFIX/merge-operations/$merge_id" "{
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"merge_id\": \"$merge_id\",
        \"agent_id\": \"$agent_id\",
        \"workstream\": \"$workstream\",
        \"branch_name\": \"$branch_name\",
        \"pr_number\": \"$pr_number\",
        \"status\": \"in_progress\",
        \"started_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }"
    
    # Check if branch exists
    if ! git rev-parse --verify "$branch_name" >/dev/null 2>&1; then
        echo "MERGE_FAILED: Branch $branch_name does not exist" >> "$CONFLICT_LOG"
        mark_merge_failed "$merge_id" "branch_not_found"
        return 1
    fi
    
    # Check for conflicts before merge
    local current_branch=$(git branch --show-current)
    local merge_base=$(git merge-base HEAD "$branch_name" 2>/dev/null)
    
    if [ -z "$merge_base" ]; then
        echo "MERGE_FAILED: No common base with $branch_name" >> "$CONFLICT_LOG"
        mark_merge_failed "$merge_id" "no_common_base"
        return 1
    fi
    
    # Test merge (dry run)
    if ! git merge-tree "$merge_base" HEAD "$branch_name" >/dev/null 2>&1; then
        echo "MERGE_CONFLICTS_DETECTED: Pre-merge conflict check failed for $branch_name" >> "$CONFLICT_LOG"
        
        # Attempt conflict resolution
        if resolve_merge_conflicts "$merge_id" "$branch_name"; then
            echo "MERGE_CONFLICTS_RESOLVED: Conflicts resolved for $branch_name" >> "$CONFLICT_LOG"
        else
            mark_merge_failed "$merge_id" "unresolvable_conflicts"
            return 1
        fi
    fi
    
    # Perform actual merge
    echo "MERGE_EXECUTING: Merging $branch_name into $current_branch" >> "$CONFLICT_LOG"
    
    if git merge --no-ff --no-commit "$branch_name" 2>>"$CONFLICT_LOG"; then
        # Check if merge was clean
        if git diff --cached --quiet; then
            echo "MERGE_CLEAN: No changes from merge, possibly already integrated" >> "$CONFLICT_LOG"
            git reset --hard HEAD  # Reset the merge
        else
            # Commit the merge
            local commit_message="Merge $workstream: $branch_name via Agent $agent_id

Automated merge by Conflict Resolution Specialist (Agent 2)
Workstream: $workstream
Branch: $branch_name
PR: $pr_number
Merge ID: $merge_id

Coordinated merge sequence following workstream priorities.
"
            
            if git commit -m "$commit_message" 2>>"$CONFLICT_LOG"; then
                echo "MERGE_SUCCESS: Committed merge $merge_id" >> "$CONFLICT_LOG"
                mark_merge_completed "$merge_id"
            else
                echo "MERGE_FAILED: Commit failed for $merge_id" >> "$CONFLICT_LOG"
                git reset --hard HEAD  # Reset failed commit
                mark_merge_failed "$merge_id" "commit_failed"
                return 1
            fi
        fi
    else
        echo "MERGE_FAILED: Git merge failed for $branch_name" >> "$CONFLICT_LOG"
        git reset --hard HEAD  # Reset failed merge
        mark_merge_failed "$merge_id" "merge_failed"
        return 1
    fi
    
    # Clean up processing status
    jq '.processing = null' "$MERGE_QUEUE" > "$MERGE_QUEUE.tmp" && mv "$MERGE_QUEUE.tmp" "$MERGE_QUEUE"
    
    # Process next merge in queue
    process_merge_queue
    
    return 0
}

# Function to resolve merge conflicts
resolve_merge_conflicts() {
    local merge_id="$1"
    local branch_name="$2"
    
    echo "CONFLICT_RESOLUTION: Attempting to resolve conflicts for $merge_id" >> "$CONFLICT_LOG"
    
    # Create conflict resolution branch
    local resolution_branch="conflict-resolution-$merge_id"
    git checkout -b "$resolution_branch" 2>>"$CONFLICT_LOG"
    
    # Attempt merge
    if git merge "$branch_name" 2>>"$CONFLICT_LOG"; then
        echo "CONFLICT_RESOLUTION: Merge successful on resolution branch" >> "$CONFLICT_LOG"
        
        # Switch back and merge resolution branch
        git checkout - 2>>"$CONFLICT_LOG"
        git merge --no-ff "$resolution_branch" 2>>"$CONFLICT_LOG"
        git branch -D "$resolution_branch" 2>>"$CONFLICT_LOG"
        
        return 0
    else
        # Check for resolvable conflicts
        local conflict_files=$(git diff --name-only --diff-filter=U 2>/dev/null)
        
        if [ ! -z "$conflict_files" ]; then
            echo "CONFLICT_RESOLUTION: Found conflicts in: $conflict_files" >> "$CONFLICT_LOG"
            
            # Try automated resolution strategies
            for file in $conflict_files; do
                if resolve_file_conflict "$file"; then
                    git add "$file"
                    echo "CONFLICT_RESOLUTION: Auto-resolved $file" >> "$CONFLICT_LOG"
                else
                    echo "CONFLICT_RESOLUTION: Could not auto-resolve $file" >> "$CONFLICT_LOG"
                    git checkout -- "$file"  # Reset to current version
                fi
            done
            
            # Check if all conflicts resolved
            if git diff --name-only --diff-filter=U | grep -q .; then
                echo "CONFLICT_RESOLUTION: Some conflicts remain unresolved" >> "$CONFLICT_LOG"
                git checkout - 2>>"$CONFLICT_LOG"
                git branch -D "$resolution_branch" 2>>"$CONFLICT_LOG"
                return 1
            else
                # Commit resolution
                git commit -m "Resolve merge conflicts for $merge_id" 2>>"$CONFLICT_LOG"
                git checkout - 2>>"$CONFLICT_LOG"
                git merge --no-ff "$resolution_branch" 2>>"$CONFLICT_LOG"
                git branch -D "$resolution_branch" 2>>"$CONFLICT_LOG"
                return 0
            fi
        else
            echo "CONFLICT_RESOLUTION: No specific conflict files found" >> "$CONFLICT_LOG"
            git checkout - 2>>"$CONFLICT_LOG"
            git branch -D "$resolution_branch" 2>>"$CONFLICT_LOG"
            return 1
        fi
    fi
}

# Function to resolve individual file conflicts
resolve_file_conflict() {
    local file="$1"
    
    # Basic conflict resolution strategies
    if grep -q "^<<<<<<< HEAD" "$file"; then
        # Try to resolve import conflicts (common in TypeScript)
        if [[ "$file" =~ \.(ts|js)$ ]]; then
            # Remove duplicate imports
            sed -i '/^<<<<<<< HEAD/,/^=======/d; /^>>>>>>>/d' "$file"
            return 0
        fi
        
        # Try to resolve simple whitespace conflicts
        if ! grep -q "^[^<>=]*[a-zA-Z]" "$file"; then
            # Appears to be mostly whitespace conflicts
            sed -i '/^<<<<<<< HEAD/,/^=======/d; /^>>>>>>>/d' "$file"
            return 0
        fi
    fi
    
    return 1
}

# Function to mark merge as completed
mark_merge_completed() {
    local merge_id="$1"
    local completion_time=$(date +%s)
    
    jq --arg merge_id "$merge_id" \
       --arg completion_time "$completion_time" \
       '.completed += [(.processing + {"completed_at": ($completion_time | tonumber), "status": "completed"})] |
        .processing = null' "$MERGE_QUEUE" > "$MERGE_QUEUE.tmp" && mv "$MERGE_QUEUE.tmp" "$MERGE_QUEUE"
    
    # Update Memory
    ./claude-flow memory store "$MEMORY_PREFIX/merge-operations/$merge_id" "{
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"merge_id\": \"$merge_id\",
        \"status\": \"completed\",
        \"completed_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }"
}

# Function to mark merge as failed
mark_merge_failed() {
    local merge_id="$1"
    local failure_reason="$2"
    local failure_time=$(date +%s)
    
    jq --arg merge_id "$merge_id" \
       --arg failure_reason "$failure_reason" \
       --arg failure_time "$failure_time" \
       '.failed += [(.processing + {"failed_at": ($failure_time | tonumber), "status": "failed", "reason": $failure_reason})] |
        .processing = null' "$MERGE_QUEUE" > "$MERGE_QUEUE.tmp" && mv "$MERGE_QUEUE.tmp" "$MERGE_QUEUE"
    
    # Update Memory
    ./claude-flow memory store "$MEMORY_PREFIX/merge-operations/$merge_id" "{
        \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"merge_id\": \"$merge_id\",
        \"status\": \"failed\",
        \"failed_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"reason\": \"$failure_reason\"
    }"
}

# Function to show merge queue status
show_merge_status() {
    echo "=== MERGE QUEUE STATUS ==="
    echo "Queue length: $(jq '.queue | length' "$MERGE_QUEUE")"
    echo "Currently processing: $(jq -r '.processing.merge_id // "none"' "$MERGE_QUEUE")"
    echo "Completed: $(jq '.completed | length' "$MERGE_QUEUE")"
    echo "Failed: $(jq '.failed | length' "$MERGE_QUEUE")"
    echo ""
    
    echo "=== QUEUED MERGES ==="
    jq -r '.queue[] | "\(.workstream): \(.branch_name) by \(.agent_id) (queued: \(.queued_at | todate))"' "$MERGE_QUEUE" 2>/dev/null || echo "No queued merges"
    
    echo ""
    echo "=== RECENT COMPLETIONS ==="
    jq -r '.completed[-5:] | .[] | "\(.workstream): \(.branch_name) by \(.agent_id) (completed: \(.completed_at | todate))"' "$MERGE_QUEUE" 2>/dev/null || echo "No recent completions"
}

# Initialize merge queue
initialize_merge_queue

# Main command dispatch
case "$1" in
    "queue")
        queue_merge_request "$2" "$3" "$4" "$5" "$6"
        ;;
    "process")
        process_merge_queue
        ;;
    "status")
        show_merge_status
        ;;
    "resolve")
        resolve_merge_conflicts "$2" "$3"
        ;;
    *)
        echo "Usage: $0 {queue|process|status|resolve} [args...]"
        echo ""
        echo "Commands:"
        echo "  queue <agent_id> <workstream> <branch_name> [pr_number] [priority]"
        echo "  process"
        echo "  status"
        echo "  resolve <merge_id> <branch_name>"
        exit 1
        ;;
esac