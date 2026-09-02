#!/bin/bash
# Claude Flow V3 Status Display Template (Linux/macOS)

METRICS_DIR="${PROJECT_ROOT:-.}/.claude-flow/metrics"
SECURITY_DIR="${PROJECT_ROOT:-.}/.claude-flow/security"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# Get current metrics
get_metrics() {
    DOMAINS=0
    AGENTS=0
    DDD_PROGRESS=0
    CVES_FIXED=0
    SPEEDUP="1.0x"
    MEMORY="0%"

    if [ -f "$METRICS_DIR/v3-progress.json" ]; then
        DOMAINS=$(jq -r '.domains.completed // 0' "$METRICS_DIR/v3-progress.json" 2>/dev/null || echo "0")
        AGENTS=$(jq -r '.swarm.activeAgents // 0' "$METRICS_DIR/v3-progress.json" 2>/dev/null || echo "0")
        DDD_PROGRESS=$(jq -r '.ddd.progress // 0' "$METRICS_DIR/v3-progress.json" 2>/dev/null || echo "0")
    fi

    if [ -f "$SECURITY_DIR/audit-status.json" ]; then
        CVES_FIXED=$(jq -r '.cvesFixed // 0' "$SECURITY_DIR/audit-status.json" 2>/dev/null || echo "0")
    fi

    if [ -f "$METRICS_DIR/performance.json" ]; then
        SPEEDUP=$(jq -r '.flashAttention.speedup // "1.0x"' "$METRICS_DIR/performance.json" 2>/dev/null || echo "1.0x")
        MEMORY=$(jq -r '.memory.reduction // "0%"' "$METRICS_DIR/performance.json" 2>/dev/null || echo "0%")
    fi
}

# Color code progress
get_color() {
    local current=$1
    local total=$2
    local percentage=$((current * 100 / total))

    if [ $percentage -ge 75 ]; then echo "$GREEN"
    elif [ $percentage -ge 50 ]; then echo "$YELLOW"
    else echo "$RED"
    fi
}

# Main display
display_status() {
    get_metrics

    echo -e "${BOLD}${PURPLE}⚡ Claude Flow V3 Development Status${RESET}"
    echo -e "${BLUE}============================================${RESET}"
    echo ""

    # Domain progress
    domain_color=$(get_color $DOMAINS 5)
    echo -e "${CYAN}🏗️  DDD Domains:${RESET} ${domain_color}${DOMAINS}/5${RESET} ($(($DOMAINS * 20))%)"

    # Agent progress
    agent_color=$(get_color $AGENTS 15)
    echo -e "${CYAN}🤖 Swarm Agents:${RESET} ${agent_color}${AGENTS}/15${RESET} ($(($AGENTS * 100 / 15))%)"

    # DDD progress
    ddd_color=$(get_color $DDD_PROGRESS 100)
    echo -e "${CYAN}📐 DDD Progress:${RESET} ${ddd_color}${DDD_PROGRESS}%${RESET}"

    # Security status
    sec_color=$(get_color $CVES_FIXED 3)
    echo -e "${CYAN}🛡️  Security CVEs:${RESET} ${sec_color}${CVES_FIXED}/3${RESET} fixed"

    # Performance metrics
    echo -e "${CYAN}⚡ Performance:${RESET} ${YELLOW}${SPEEDUP}${RESET} speedup | ${CYAN}💾 Memory:${RESET} ${YELLOW}${MEMORY}${RESET} reduced"

    # Git branch info
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
        BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
        echo -e "${CYAN}🔀 Git Branch:${RESET} ${BLUE}${BRANCH}${RESET}"
    fi

    echo ""
    echo -e "${BLUE}Commands: claude-flow-v3.sh {status|update|validate|checkpoint}${RESET}"
}

display_status