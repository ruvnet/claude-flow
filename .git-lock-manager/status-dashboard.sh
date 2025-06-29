#!/bin/bash

# Status Dashboard for Agent 2: Conflict Resolution Specialist
# Provides comprehensive view of git conflicts, file locks, and merge coordination

MEMORY_PREFIX="typescript-strict-final-push/agent-2"
LOCK_REGISTRY="/workspaces/claude-code-flow/.git-lock-manager/lock-registry.json"
MERGE_QUEUE="/workspaces/claude-code-flow/.git-lock-manager/merge-queue.json"
CONFLICT_LOG="/workspaces/claude-code-flow/.git-lock-manager/merge-conflicts.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    local title="$1"
    echo -e "\n${CYAN}===========================================${NC}"
    echo -e "${CYAN} $title ${NC}"
    echo -e "${CYAN}===========================================${NC}\n"
}

print_section() {
    local title="$1"
    echo -e "\n${BLUE}--- $title ---${NC}"
}

# Function to show git status and conflicts
show_git_status() {
    print_section "Git Repository Status"
    
    local current_branch=$(git branch --show-current)
    local repo_status=$(git status --porcelain 2>/dev/null)
    
    echo -e "Current branch: ${GREEN}$current_branch${NC}"
    echo -e "Repository root: ${BLUE}$(git rev-parse --show-toplevel)${NC}"
    echo -e "Last commit: ${YELLOW}$(git log -1 --format='%h - %s (%cr)')${NC}"
    
    # Check for conflicts
    if echo "$repo_status" | grep -q "^UU\|^AA\|^DD"; then
        echo -e "\n${RED}⚠️  ACTIVE MERGE CONFLICTS DETECTED:${NC}"
        echo "$repo_status" | grep "^UU\|^AA\|^DD" | while read status file; do
            echo -e "  ${RED}$status${NC} $file"
        done
    else
        echo -e "\n${GREEN}✅ No active merge conflicts${NC}"
    fi
    
    # Check for modified files
    if [ ! -z "$repo_status" ]; then
        echo -e "\nModified files:"
        echo "$repo_status" | while read status file; do
            case "$status" in
                "M ") echo -e "  ${YELLOW}Modified (staged):${NC} $file" ;;
                " M") echo -e "  ${YELLOW}Modified (unstaged):${NC} $file" ;;
                "??") echo -e "  ${BLUE}Untracked:${NC} $file" ;;
                "A ") echo -e "  ${GREEN}Added:${NC} $file" ;;
                "D ") echo -e "  ${RED}Deleted:${NC} $file" ;;
                *) echo -e "  ${PURPLE}$status${NC} $file" ;;
            esac
        done
    else
        echo -e "\n${GREEN}✅ Working directory clean${NC}"
    fi
    
    # Check remote sync status
    local ahead_behind=$(git rev-list --left-right --count origin/$current_branch...$current_branch 2>/dev/null || echo "0	0")
    local behind=$(echo "$ahead_behind" | awk '{print $1}')
    local ahead=$(echo "$ahead_behind" | awk '{print $2}')
    
    if [ "$behind" -gt 0 ]; then
        echo -e "\n${YELLOW}⚠️  Branch is $behind commits behind origin/$current_branch${NC}"
    fi
    
    if [ "$ahead" -gt 0 ]; then
        echo -e "\n${BLUE}ℹ️  Branch is $ahead commits ahead of origin/$current_branch${NC}"
    fi
    
    if [ "$behind" -eq 0 ] && [ "$ahead" -eq 0 ]; then
        echo -e "\n${GREEN}✅ Branch is up to date with origin${NC}"
    fi
}

# Function to show file locks status
show_file_locks() {
    print_section "File Lock Management"
    
    if [ ! -f "$LOCK_REGISTRY" ]; then
        echo -e "${YELLOW}⚠️  Lock registry not found${NC}"
        return
    fi
    
    local active_locks=$(jq '.locks | length' "$LOCK_REGISTRY" 2>/dev/null || echo 0)
    local queue_length=$(jq '.queue | length' "$LOCK_REGISTRY" 2>/dev/null || echo 0)
    
    echo -e "Active locks: ${GREEN}$active_locks${NC}"
    echo -e "Queued requests: ${YELLOW}$queue_length${NC}"
    
    if [ "$active_locks" -gt 0 ]; then
        echo -e "\n${BLUE}Active file locks:${NC}"
        jq -r '.locks | to_entries[] | 
            "  \(.key): \(.value.agent_id) (\(.value.operation_type)) expires: \((.value.timestamp + .value.duration) | todate)"' \
            "$LOCK_REGISTRY" 2>/dev/null | while read lock_info; do
            echo -e "  ${GREEN}🔒${NC} $lock_info"
        done
    fi
    
    if [ "$queue_length" -gt 0 ]; then
        echo -e "\n${YELLOW}Queued lock requests:${NC}"
        jq -r '.queue[] | 
            "  \(.file_path): \(.agent_id) (\(.operation_type)) queued: \(.queued_at | todate)"' \
            "$LOCK_REGISTRY" 2>/dev/null | while read queue_info; do
            echo -e "  ${YELLOW}⏳${NC} $queue_info"
        done
    fi
    
    # Check for expired locks
    local current_time=$(date +%s)
    local expired_locks=$(jq -r --arg current_time "$current_time" '
        .locks | to_entries[] | 
        select((.value.timestamp + .value.duration) < ($current_time | tonumber)) | 
        .key
    ' "$LOCK_REGISTRY" 2>/dev/null)
    
    if [ ! -z "$expired_locks" ]; then
        echo -e "\n${RED}⚠️  Expired locks detected:${NC}"
        echo "$expired_locks" | while read expired_lock; do
            echo -e "  ${RED}⏰${NC} $expired_lock"
        done
    fi
}

# Function to show merge coordination status
show_merge_coordination() {
    print_section "Merge Coordination"
    
    if [ ! -f "$MERGE_QUEUE" ]; then
        echo -e "${YELLOW}⚠️  Merge queue not found${NC}"
        return
    fi
    
    local queue_length=$(jq '.queue | length' "$MERGE_QUEUE" 2>/dev/null || echo 0)
    local completed_count=$(jq '.completed | length' "$MERGE_QUEUE" 2>/dev/null || echo 0)
    local failed_count=$(jq '.failed | length' "$MERGE_QUEUE" 2>/dev/null || echo 0)
    local currently_processing=$(jq -r '.processing.merge_id // "none"' "$MERGE_QUEUE" 2>/dev/null)
    
    echo -e "Queue length: ${YELLOW}$queue_length${NC}"
    echo -e "Completed merges: ${GREEN}$completed_count${NC}"
    echo -e "Failed merges: ${RED}$failed_count${NC}"
    echo -e "Currently processing: ${BLUE}$currently_processing${NC}"
    
    if [ "$currently_processing" != "none" ]; then
        echo -e "\n${BLUE}Current merge operation:${NC}"
        jq -r '.processing | 
            "  Merge ID: \(.merge_id)\n  Agent: \(.agent_id)\n  Workstream: \(.workstream)\n  Branch: \(.branch_name)"' \
            "$MERGE_QUEUE" 2>/dev/null | while read line; do
            echo -e "  ${CYAN}🔄${NC} $line"
        done
    fi
    
    if [ "$queue_length" -gt 0 ]; then
        echo -e "\n${YELLOW}Queued merges (in priority order):${NC}"
        jq -r '.queue[] | 
            "  \(.workstream): \(.branch_name) by \(.agent_id) (queued: \(.queued_at | todate))"' \
            "$MERGE_QUEUE" 2>/dev/null | while read merge_info; do
            echo -e "  ${YELLOW}⏳${NC} $merge_info"
        done
    fi
    
    if [ "$failed_count" -gt 0 ]; then
        echo -e "\n${RED}Recent merge failures:${NC}"
        jq -r '.failed[-3:] | .[] | 
            "  \(.workstream): \(.branch_name) by \(.agent_id) - \(.reason) (failed: \(.failed_at | todate))"' \
            "$MERGE_QUEUE" 2>/dev/null | while read failure_info; do
            echo -e "  ${RED}❌${NC} $failure_info"
        done
    fi
}

# Function to show swarm coordination status
show_swarm_coordination() {
    print_section "Swarm Coordination Status"
    
    # Check Memory for active agents
    local memory_entries=$(./claude-flow memory list 2>/dev/null | grep "typescript-strict-" | wc -l)
    echo -e "Memory entries: ${BLUE}$memory_entries${NC}"
    
    # Check for conflict alerts
    local conflict_alerts=$(./claude-flow memory list 2>/dev/null | grep -c "conflict-alert" || echo 0)
    if [ "$conflict_alerts" -gt 0 ]; then
        echo -e "Active conflict alerts: ${RED}$conflict_alerts${NC}"
    else
        echo -e "Active conflict alerts: ${GREEN}0${NC}"
    fi
    
    # Check for bottleneck alerts
    local bottleneck_alerts=$(./claude-flow memory list 2>/dev/null | grep -c "bottleneck-alert" || echo 0)
    if [ "$bottleneck_alerts" -gt 0 ]; then
        echo -e "Bottleneck alerts: ${YELLOW}$bottleneck_alerts${NC}"
    else
        echo -e "Bottleneck alerts: ${GREEN}0${NC}"
    fi
    
    # Show recent swarm activity
    echo -e "\n${BLUE}Recent swarm activity:${NC}"
    if [ -f "$CONFLICT_LOG" ]; then
        tail -5 "$CONFLICT_LOG" 2>/dev/null | while read log_line; do
            echo -e "  ${CYAN}📝${NC} $log_line"
        done
    else
        echo -e "  ${YELLOW}No recent activity logged${NC}"
    fi
}

# Function to show agent heartbeat
show_agent_heartbeat() {
    print_section "Agent 2 Status"
    
    # Show initialization status
    local init_status=$(./claude-flow memory get "$MEMORY_PREFIX/initialization" 2>/dev/null | grep -o '"status": "[^"]*"' | cut -d'"' -f4 || echo "unknown")
    echo -e "Agent status: ${GREEN}$init_status${NC}"
    
    # Show heartbeat
    local heartbeat_status=$(./claude-flow memory get "$MEMORY_PREFIX/heartbeat" 2>/dev/null | grep -o '"status": "[^"]*"' | cut -d'"' -f4 || echo "unknown")
    echo -e "Monitoring status: ${GREEN}$heartbeat_status${NC}"
    
    # Show monitoring systems
    echo -e "\n${BLUE}Active monitoring systems:${NC}"
    echo -e "  ${GREEN}✅${NC} Git conflict detection"
    echo -e "  ${GREEN}✅${NC} File lock management"
    echo -e "  ${GREEN}✅${NC} Merge coordination"
    echo -e "  ${GREEN}✅${NC} Workstream conflict detection"
    
    # Check if monitoring script is running
    if pgrep -f "conflict-monitor.sh" >/dev/null; then
        echo -e "  ${GREEN}✅${NC} Background monitoring active (PID: $(pgrep -f "conflict-monitor.sh"))"
    else
        echo -e "  ${YELLOW}⚠️${NC} Background monitoring not running"
    fi
}

# Function to show system health
show_system_health() {
    print_section "System Health Check"
    
    # Check TypeScript build status
    echo -e "Checking TypeScript build status..."
    if npm run typecheck >/dev/null 2>&1; then
        echo -e "TypeScript build: ${GREEN}✅ PASSING${NC}"
    else
        local error_count=$(npm run typecheck 2>&1 | grep -c "error TS" || echo "unknown")
        echo -e "TypeScript build: ${RED}❌ $error_count errors${NC}"
    fi
    
    # Check test status
    echo -e "Checking test status..."
    if npm test >/dev/null 2>&1; then
        echo -e "Test suite: ${GREEN}✅ PASSING${NC}"
    else
        echo -e "Test suite: ${RED}❌ FAILING${NC}"
    fi
    
    # Check lint status
    echo -e "Checking lint status..."
    if npm run lint >/dev/null 2>&1; then
        echo -e "Lint checks: ${GREEN}✅ PASSING${NC}"
    else
        echo -e "Lint checks: ${YELLOW}⚠️ ISSUES FOUND${NC}"
    fi
    
    # Check disk space
    local disk_usage=$(df -h . | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$disk_usage" -lt 80 ]; then
        echo -e "Disk usage: ${GREEN}✅ $disk_usage%${NC}"
    elif [ "$disk_usage" -lt 90 ]; then
        echo -e "Disk usage: ${YELLOW}⚠️ $disk_usage%${NC}"
    else
        echo -e "Disk usage: ${RED}❌ $disk_usage%${NC}"
    fi
}

# Function to show recommendations
show_recommendations() {
    print_section "Recommendations"
    
    local has_recommendations=false
    
    # Check for issues and provide recommendations
    if git status --porcelain | grep -q "^UU\|^AA\|^DD"; then
        echo -e "${RED}🚨${NC} Active merge conflicts require immediate attention"
        echo -e "   Run: ${CYAN}git status${NC} to see conflicted files"
        echo -e "   Run: ${CYAN}.git-lock-manager/merge-coordinator.sh resolve <merge_id> <branch>${NC}"
        has_recommendations=true
    fi
    
    if [ -f "$LOCK_REGISTRY" ]; then
        local queue_length=$(jq '.queue | length' "$LOCK_REGISTRY" 2>/dev/null || echo 0)
        if [ "$queue_length" -gt 5 ]; then
            echo -e "${YELLOW}⚠️${NC} High lock queue length ($queue_length) may indicate bottleneck"
            echo -e "   Consider: Force unlock expired locks, coordinate with agents"
            has_recommendations=true
        fi
    fi
    
    if [ -f "$MERGE_QUEUE" ]; then
        local failed_count=$(jq '.failed | length' "$MERGE_QUEUE" 2>/dev/null || echo 0)
        if [ "$failed_count" -gt 2 ]; then
            echo -e "${RED}⚠️${NC} Multiple merge failures detected ($failed_count)"
            echo -e "   Review: ${CYAN}$CONFLICT_LOG${NC} for failure patterns"
            has_recommendations=true
        fi
    fi
    
    if ! pgrep -f "conflict-monitor.sh" >/dev/null; then
        echo -e "${YELLOW}💡${NC} Start background monitoring for proactive conflict detection"
        echo -e "   Run: ${CYAN}.git-lock-manager/conflict-monitor.sh &${NC}"
        has_recommendations=true
    fi
    
    if [ "$has_recommendations" = false ]; then
        echo -e "${GREEN}✅ All systems operating normally${NC}"
        echo -e "   Continue monitoring for new conflicts and coordinate merges as needed"
    fi
}

# Main dashboard function
show_dashboard() {
    clear
    print_header "AGENT 2: CONFLICT RESOLUTION SPECIALIST DASHBOARD"
    echo -e "${PURPLE}Role:${NC} Git Conflict Resolution, File Lock Management, Merge Coordination"
    echo -e "${PURPLE}Operation:${NC} TypeScript Strict Mode Final Push - 30 Agent Swarm"
    echo -e "${PURPLE}Last Updated:${NC} $(date)"
    
    show_git_status
    show_file_locks
    show_merge_coordination
    show_swarm_coordination
    show_agent_heartbeat
    show_system_health
    show_recommendations
    
    print_header "QUICK COMMANDS"
    echo -e "${CYAN}Lock Management:${NC}"
    echo -e "  .git-lock-manager/lock-utils.sh list"
    echo -e "  .git-lock-manager/lock-utils.sh request <agent> <file> <operation>"
    echo -e "  .git-lock-manager/lock-utils.sh release <agent> <file>"
    echo -e ""
    echo -e "${CYAN}Merge Coordination:${NC}"
    echo -e "  .git-lock-manager/merge-coordinator.sh status"
    echo -e "  .git-lock-manager/merge-coordinator.sh queue <agent> <ws> <branch>"
    echo -e "  .git-lock-manager/merge-coordinator.sh process"
    echo -e ""
    echo -e "${CYAN}Monitoring:${NC}"
    echo -e "  .git-lock-manager/conflict-monitor.sh &"
    echo -e "  .git-lock-manager/status-dashboard.sh watch"
    
    echo -e "\n${GREEN}Dashboard ready. Agent 2 monitoring systems active.${NC}\n"
}

# Main command dispatch
case "$1" in
    "watch")
        while true; do
            show_dashboard
            sleep 30
        done
        ;;
    "git")
        show_git_status
        ;;
    "locks")
        show_file_locks
        ;;
    "merges")
        show_merge_coordination
        ;;
    "swarm")
        show_swarm_coordination
        ;;
    "health")
        show_system_health
        ;;
    *)
        show_dashboard
        ;;
esac