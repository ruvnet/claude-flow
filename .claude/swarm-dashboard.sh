#!/bin/bash
# TypeScript Strict Compliance Mega Swarm Real-Time Dashboard
# Baseline Creation Agent #3 - Live Monitoring System

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Dashboard refresh interval (seconds)
REFRESH_INTERVAL=${1:-30}
BASELINE_KEY="typescript-strict-mega-swarm/baseline-agent-3/initial-metrics"

# Function to clear screen and show header
show_header() {
    clear
    echo -e "${WHITE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${WHITE}║              TypeScript Strict Compliance Mega Swarm Dashboard              ║${NC}"
    echo -e "${WHITE}║                        Real-Time Progress Monitor                            ║${NC}"
    echo -e "${WHITE}╠══════════════════════════════════════════════════════════════════════════════╣${NC}"
    echo -e "${WHITE}║ Agent: Baseline Creation Agent #3 | Refresh: ${REFRESH_INTERVAL}s | Time: $(date '+%H:%M:%S UTC') ║${NC}"
    echo -e "${WHITE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Function to show progress bar
show_progress_bar() {
    local percentage=$1
    local width=50
    local filled=$(( (percentage * width) / 100 ))
    local empty=$((width - filled))
    
    printf "${GREEN}"
    for ((i=0; i<filled; i++)); do printf "█"; done
    printf "${RED}"
    for ((i=0; i<empty; i++)); do printf "░"; done
    printf "${NC}"
    printf " %.1f%%" "$percentage"
}

# Function to get agent status
get_agent_status() {
    # Check if there are any active processes related to the swarm
    local active_processes=$(ps aux | grep -E "(tsc|npm|node)" | grep -v grep | wc -l)
    if [ "$active_processes" -gt 2 ]; then
        echo -e "${GREEN}🟢 ACTIVE${NC}"
    else
        echo -e "${YELLOW}🟡 MONITORING${NC}"
    fi
}

# Main dashboard loop
main_dashboard() {
    while true; do
        show_header
        
        # Get current error count
        echo -e "${CYAN}⚙️  Checking current TypeScript errors...${NC}"
        npm run typecheck 2>&1 | tee /tmp/current-errors.txt >/dev/null || true
        CURRENT_ERRORS=$(rg "error TS" /tmp/current-errors.txt 2>/dev/null | wc -l || echo "0")
        
        # Get baseline
        BASELINE_ERRORS=$(./claude-flow memory get "$BASELINE_KEY" 2>/dev/null | jq -r '.summary.totalErrors // 898' || echo "898")
        
        # Calculate metrics
        ERRORS_REDUCED=$((BASELINE_ERRORS - CURRENT_ERRORS))
        PERCENTAGE_REDUCED=$(echo "scale=1; $ERRORS_REDUCED * 100 / $BASELINE_ERRORS" | bc -l 2>/dev/null || echo "0")
        
        # Status display
        echo -e "${WHITE}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${WHITE}║                              CURRENT STATUS                                  ║${NC}"
        echo -e "${WHITE}╠═══════════════════════════════════════════════════════════════════════════════╣${NC}"
        printf "${WHITE}║${NC} Swarm Status: %-20s ${WHITE}║${NC} Baseline Errors: %-15s ${WHITE}║${NC}\n" "$(get_agent_status)" "$BASELINE_ERRORS"
        printf "${WHITE}║${NC} Current Errors: %-18s ${WHITE}║${NC} Errors Reduced: %-16s ${WHITE}║${NC}\n" "$CURRENT_ERRORS" "$ERRORS_REDUCED"
        echo -e "${WHITE}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        
        # Progress bar
        echo -e "${WHITE}Progress: ${NC}"
        show_progress_bar "$PERCENTAGE_REDUCED"
        echo ""
        echo ""
        
        # Error type breakdown
        echo -e "${WHITE}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${WHITE}║                           TOP ERROR TYPES                                    ║${NC}"
        echo -e "${WHITE}╠═══════════════════════════════════════════════════════════════════════════════╣${NC}"
        if [ -f "/tmp/current-errors.txt" ] && [ -s "/tmp/current-errors.txt" ]; then
            rg "error TS(\d+)" /tmp/current-errors.txt -o 2>/dev/null | sort | uniq -c | sort -nr | head -5 | while read count code; do
                printf "${WHITE}║${NC} %-20s %s errors %*s${WHITE}║${NC}\n" "$code" "$count" $((47 - ${#code} - ${#count})) ""
            done
        else
            echo -e "${WHITE}║${NC} No current errors detected! 🎉                                             ${WHITE}║${NC}"
        fi
        echo -e "${WHITE}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        
        # Problematic files
        echo -e "${WHITE}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${WHITE}║                         MOST PROBLEMATIC FILES                               ║${NC}"
        echo -e "${WHITE}╠═══════════════════════════════════════════════════════════════════════════════╣${NC}"
        if [ -f "/tmp/current-errors.txt" ] && [ -s "/tmp/current-errors.txt" ]; then
            rg 'src/[^:]+\.ts' /tmp/current-errors.txt -o 2>/dev/null | sort | uniq -c | sort -nr | head -5 | while read count file; do
                # Truncate long file paths
                short_file=$(echo "$file" | sed 's|src/||' | cut -c1-35)
                if [ ${#file} -gt 35 ]; then
                    short_file="${short_file}..."
                fi
                printf "${WHITE}║${NC} %-38s %s errors %*s${WHITE}║${NC}\n" "$short_file" "$count" $((35 - ${#count})) ""
            done
        else
            echo -e "${WHITE}║${NC} No problematic files detected! 🎉                                         ${WHITE}║${NC}"
        fi
        echo -e "${WHITE}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        
        # Milestones and alerts
        if (( $(echo "$PERCENTAGE_REDUCED >= 50" | bc -l) )); then
            echo -e "${GREEN}🎉 MILESTONE: 50%+ ERROR REDUCTION ACHIEVED! 🎉${NC}"
        elif (( $(echo "$PERCENTAGE_REDUCED >= 25" | bc -l) )); then
            echo -e "${GREEN}🔔 MILESTONE: 25%+ ERROR REDUCTION ACHIEVED! 👏${NC}"
        elif (( $(echo "$PERCENTAGE_REDUCED >= 10" | bc -l) )); then
            echo -e "${YELLOW}📢 PROGRESS: 10%+ ERROR REDUCTION ACHIEVED! 💪${NC}"
        else
            echo -e "${BLUE}⏳ Working towards first 10% reduction milestone...${NC}"
        fi
        echo ""
        
        # Memory usage and system info
        echo -e "${WHITE}╔═══════════════════════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${WHITE}║                              SYSTEM INFO                                     ║${NC}"
        echo -e "${WHITE}╠═══════════════════════════════════════════════════════════════════════════════╣${NC}"
        MEMORY_ENTRIES=$(./claude-flow memory list 2>/dev/null | grep -c "typescript-strict-mega-swarm" || echo "0")
        UPTIME=$(uptime | awk '{print $3 $4}' | sed 's/,//')
        printf "${WHITE}║${NC} Memory Entries: %-15s ${WHITE}║${NC} System Uptime: %-18s ${WHITE}║${NC}\n" "$MEMORY_ENTRIES" "$UPTIME"
        echo -e "${WHITE}╚═══════════════════════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        
        echo -e "${CYAN}Next refresh in ${REFRESH_INTERVAL} seconds... (Press Ctrl+C to exit)${NC}"
        sleep "$REFRESH_INTERVAL"
    done
}

# Check if running in monitoring mode
if [ "$1" = "--monitor" ] || [ "$1" = "-m" ]; then
    echo -e "${GREEN}🚀 Starting real-time monitoring dashboard...${NC}"
    main_dashboard
else
    echo -e "${BLUE}TypeScript Strict Compliance Swarm Dashboard${NC}"
    echo -e "${BLUE}===========================================${NC}"
    echo ""
    echo "Usage:"
    echo "  $0 [refresh_interval]  - Run dashboard with custom refresh interval (default: 30s)"
    echo "  $0 --monitor           - Start continuous monitoring mode"
    echo "  $0 -m                  - Start continuous monitoring mode (short form)"
    echo ""
    echo "Examples:"
    echo "  $0 10                  - Refresh every 10 seconds"
    echo "  $0 --monitor           - Start monitoring with default 30s refresh"
    echo ""
fi