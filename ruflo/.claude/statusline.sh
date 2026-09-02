#!/bin/bash
# Claude Flow V3 Development Status Line
# Shows DDD architecture progress, security status, and performance targets

# Read Claude Code JSON input from stdin (if available)
CLAUDE_INPUT=$(cat 2>/dev/null || echo "{}")

# Get project directory from Claude Code input or use current directory
PROJECT_DIR=$(echo "$CLAUDE_INPUT" | jq -r '.workspace.project_dir // ""' 2>/dev/null)
if [ -z "$PROJECT_DIR" ] || [ "$PROJECT_DIR" = "null" ]; then
  PROJECT_DIR=$(pwd)
fi

# File paths relative to project directory
V3_METRICS="${PROJECT_DIR}/.claude-flow/metrics/v3-progress.json"
SECURITY_AUDIT="${PROJECT_DIR}/.claude-flow/security/audit-status.json"
PERFORMANCE_METRICS="${PROJECT_DIR}/.claude-flow/metrics/performance.json"

# ANSI Color Codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[0;37m'
BOLD='\033[1m'
DIM='\033[2m'
UNDERLINE='\033[4m'
RESET='\033[0m'

# Bright colors
BRIGHT_RED='\033[1;31m'
BRIGHT_GREEN='\033[1;32m'
BRIGHT_YELLOW='\033[1;33m'
BRIGHT_BLUE='\033[1;34m'
BRIGHT_PURPLE='\033[1;35m'
BRIGHT_CYAN='\033[1;36m'

# V3 Development Targets
DOMAINS_TOTAL=5
AGENTS_TARGET=15
PERF_TARGET="2.49x-7.47x"
SECURITY_CVES=3

# Default values
DOMAINS_COMPLETED=0
AGENTS_ACTIVE=0
PERF_CURRENT="1.0x"
SECURITY_STATUS="PENDING"
DDD_PROGRESS=0
INTEGRATION_STATUS="○"

# Get current git branch
GIT_BRANCH=""
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "")
fi

# Get GitHub username (try gh CLI first, fallback to git config)
GH_USER=""
if command -v gh >/dev/null 2>&1; then
  GH_USER=$(gh api user --jq '.login' 2>/dev/null || echo "")
fi
if [ -z "$GH_USER" ]; then
  GH_USER=$(git config user.name 2>/dev/null || echo "user")
fi

# Check V3 domain implementation progress
if [ -f "$V3_METRICS" ]; then
  DOMAINS_COMPLETED=$(jq -r '.domains.completed // 0' "$V3_METRICS" 2>/dev/null || echo "0")
  DDD_PROGRESS=$(jq -r '.ddd.progress // 0' "$V3_METRICS" 2>/dev/null || echo "0")
  AGENTS_ACTIVE=$(jq -r '.swarm.activeAgents // 0' "$V3_METRICS" 2>/dev/null || echo "0")
else
  # Check for actual domain directories
  DOMAINS_COMPLETED=0
  [ -d "src/domains/task-management" ] && ((DOMAINS_COMPLETED++))
  [ -d "src/domains/session-management" ] && ((DOMAINS_COMPLETED++))
  [ -d "src/domains/health-monitoring" ] && ((DOMAINS_COMPLETED++))
  [ -d "src/domains/lifecycle-management" ] && ((DOMAINS_COMPLETED++))
  [ -d "src/domains/event-coordination" ] && ((DOMAINS_COMPLETED++))
fi

# Check security audit status
if [ -f "$SECURITY_AUDIT" ]; then
  SECURITY_STATUS=$(jq -r '.status // "PENDING"' "$SECURITY_AUDIT" 2>/dev/null || echo "PENDING")
  CVES_FIXED=$(jq -r '.cvesFixed // 0' "$SECURITY_AUDIT" 2>/dev/null || echo "0")
else
  CVES_FIXED=0
fi

# Check performance metrics
if [ -f "$PERFORMANCE_METRICS" ]; then
  PERF_CURRENT=$(jq -r '.flashAttention.speedup // "1.0x"' "$PERFORMANCE_METRICS" 2>/dev/null || echo "1.0x")
fi

# Calculate REAL memory usage (system memory used by node/agentic processes)
MEMORY_DISPLAY=""
NODE_MEM=$(ps aux 2>/dev/null | grep -E "(node|agentic|claude)" | grep -v grep | awk '{sum += $6} END {print int(sum/1024)}')
if [ -n "$NODE_MEM" ] && [ "$NODE_MEM" -gt 0 ]; then
  MEMORY_DISPLAY="${NODE_MEM}MB"
else
  # Fallback: show v3 codebase line count as progress indicator
  V3_LINES=$(find "${PROJECT_DIR}/v3" -name "*.ts" -type f 2>/dev/null | xargs wc -l 2>/dev/null | tail -1 | awk '{print $1}')
  if [ -n "$V3_LINES" ] && [ "$V3_LINES" -gt 0 ]; then
    MEMORY_DISPLAY="${V3_LINES}L"
  else
    MEMORY_DISPLAY="--"
  fi
fi

# Check agentic-flow@alpha integration status
INTEGRATION_STATUS="○"
if [ -f "package.json" ]; then
  if grep -q "agentic-flow.*alpha" package.json 2>/dev/null; then
    INTEGRATION_STATUS="●"
  fi
fi

# REAL-TIME SWARM DETECTION
# Count active agentic-flow processes
ACTIVE_PROCESSES=$(ps aux 2>/dev/null | grep -E "(agentic-flow|claude-flow)" | grep -v grep | wc -l)

# Check for real-time activity data from swarm monitor
SWARM_ACTIVITY=".claude-flow/metrics/swarm-activity.json"
if [ -f "$SWARM_ACTIVITY" ]; then
  # Use accurate data from swarm monitor if available
  DYNAMIC_AGENTS=$(jq -r '.swarm.agent_count // 0' "$SWARM_ACTIVITY" 2>/dev/null || echo "0")
  SWARM_IS_ACTIVE=$(jq -r '.swarm.active // false' "$SWARM_ACTIVITY" 2>/dev/null || echo "false")

  # Override with real-time data if swarm is active
  if [ "$SWARM_IS_ACTIVE" = "true" ] && [ "$DYNAMIC_AGENTS" -gt 0 ]; then
    AGENTS_ACTIVE="$DYNAMIC_AGENTS"
    INTEGRATION_STATUS="●"
  fi
elif [ "$ACTIVE_PROCESSES" -gt 0 ]; then
  # Fallback to heuristic if no swarm monitor data
  DYNAMIC_AGENTS=$(ps aux 2>/dev/null | grep -E "agentic-flow.*agent" | grep -v grep | wc -l)

  # If we have agentic-flow processes but no specific agents, use a heuristic
  if [ "$DYNAMIC_AGENTS" -eq 0 ] && [ "$ACTIVE_PROCESSES" -gt 0 ]; then
    DYNAMIC_AGENTS=$((ACTIVE_PROCESSES / 2))
    if [ "$DYNAMIC_AGENTS" -eq 0 ] && [ "$ACTIVE_PROCESSES" -gt 0 ]; then
      DYNAMIC_AGENTS=1
    fi
  fi

  # Override static value with dynamic detection
  AGENTS_ACTIVE="$DYNAMIC_AGENTS"
  INTEGRATION_STATUS="●"
fi

# Check for MCP server processes
MCP_ACTIVE=$(ps aux 2>/dev/null | grep -E "mcp.*start" | grep -v grep | wc -l)
if [ "$MCP_ACTIVE" -gt 0 ]; then
  INTEGRATION_STATUS="●"
fi

# Count running sub-agents (Task tool spawned agents)
SUBAGENT_COUNT=$(ps aux 2>/dev/null | grep -E "claude.*Task\|subagent\|agent_spawn" | grep -v grep | wc -l | tr -d '[:space:]')
SUBAGENT_COUNT=${SUBAGENT_COUNT:-0}

# Get swarm communication stats
SWARM_COMMS="${PROJECT_DIR}/.claude/helpers/swarm-comms.sh"
QUEUE_PENDING=0
if [ -x "$SWARM_COMMS" ]; then
  COMMS_STATS=$("$SWARM_COMMS" stats 2>/dev/null || echo '{"queue":0}')
  QUEUE_PENDING=$(echo "$COMMS_STATS" | jq -r '.queue // 0' 2>/dev/null || echo "0")
fi

# Get context window usage from Claude Code input
CONTEXT_PCT=0
CONTEXT_COLOR="${DIM}"
if [ "$CLAUDE_INPUT" != "{}" ]; then
  # Try to get remaining percentage directly from Claude Code
  CONTEXT_REMAINING=$(echo "$CLAUDE_INPUT" | jq '.context_window.remaining_percentage // null' 2>/dev/null)

  if [ "$CONTEXT_REMAINING" != "null" ] && [ -n "$CONTEXT_REMAINING" ]; then
    # If we have remaining %, convert to used %
    CONTEXT_PCT=$((100 - CONTEXT_REMAINING))
  else
    # Fallback: calculate from token counts
    CURRENT_USAGE=$(echo "$CLAUDE_INPUT" | jq '.context_window.current_usage // null' 2>/dev/null)
    if [ "$CURRENT_USAGE" != "null" ] && [ "$CURRENT_USAGE" != "" ]; then
      CONTEXT_SIZE=$(echo "$CLAUDE_INPUT" | jq '.context_window.context_window_size // 200000' 2>/dev/null)
      INPUT_TOKENS=$(echo "$CURRENT_USAGE" | jq '.input_tokens // 0' 2>/dev/null)
      CACHE_CREATE=$(echo "$CURRENT_USAGE" | jq '.cache_creation_input_tokens // 0' 2>/dev/null)
      CACHE_READ=$(echo "$CURRENT_USAGE" | jq '.cache_read_input_tokens // 0' 2>/dev/null)

      TOTAL_TOKENS=$((INPUT_TOKENS + CACHE_CREATE + CACHE_READ))
      if [ "$CONTEXT_SIZE" -gt 0 ]; then
        CONTEXT_PCT=$((TOTAL_TOKENS * 100 / CONTEXT_SIZE))
      fi
    fi
  fi

  # Color based on usage (higher = worse)
  if [ "$CONTEXT_PCT" -lt 50 ]; then
    CONTEXT_COLOR="${BRIGHT_GREEN}"
  elif [ "$CONTEXT_PCT" -lt 75 ]; then
    CONTEXT_COLOR="${BRIGHT_YELLOW}"
  else
    CONTEXT_COLOR="${BRIGHT_RED}"
  fi
fi

# Calculate Intelligence Score based on learning patterns and training
INTEL_SCORE=0
INTEL_COLOR="${DIM}"
PATTERNS_DB="${PROJECT_DIR}/.claude-flow/learning/patterns.db"
LEARNING_METRICS="${PROJECT_DIR}/.claude-flow/metrics/learning.json"

# Base intelligence from pattern count
if [ -f "$PATTERNS_DB" ] && command -v sqlite3 &>/dev/null; then
  SHORT_PATTERNS=$(sqlite3 "$PATTERNS_DB" "SELECT COUNT(*) FROM short_term_patterns" 2>/dev/null || echo "0")
  LONG_PATTERNS=$(sqlite3 "$PATTERNS_DB" "SELECT COUNT(*) FROM long_term_patterns" 2>/dev/null || echo "0")
  AVG_QUALITY=$(sqlite3 "$PATTERNS_DB" "SELECT COALESCE(AVG(quality), 0) FROM short_term_patterns" 2>/dev/null || echo "0")

  # Score: patterns contribute up to 60%, quality contributes up to 40%
  PATTERN_SCORE=$((SHORT_PATTERNS + LONG_PATTERNS * 2))
  if [ "$PATTERN_SCORE" -gt 100 ]; then PATTERN_SCORE=100; fi
  QUALITY_SCORE=$(echo "$AVG_QUALITY * 40" | bc 2>/dev/null | cut -d. -f1 || echo "0")
  INTEL_SCORE=$((PATTERN_SCORE * 60 / 100 + QUALITY_SCORE))
  if [ "$INTEL_SCORE" -gt 100 ]; then INTEL_SCORE=100; fi
elif [ -f "$LEARNING_METRICS" ]; then
  # Fallback to learning metrics JSON
  ROUTING_ACC=$(jq -r '.routing.accuracy // 0' "$LEARNING_METRICS" 2>/dev/null | cut -d. -f1 || echo "0")
  INTEL_SCORE=$((ROUTING_ACC))
fi

# Color based on intelligence level
if [ "$INTEL_SCORE" -lt 25 ]; then
  INTEL_COLOR="${DIM}"
elif [ "$INTEL_SCORE" -lt 50 ]; then
  INTEL_COLOR="${YELLOW}"
elif [ "$INTEL_SCORE" -lt 75 ]; then
  INTEL_COLOR="${BRIGHT_CYAN}"
else
  INTEL_COLOR="${BRIGHT_GREEN}"
fi

# Colorful domain status indicators
COMPLETED_DOMAIN="${BRIGHT_GREEN}●${RESET}"
PENDING_DOMAIN="${DIM}○${RESET}"
DOMAIN_STATUS="${PENDING_DOMAIN}${PENDING_DOMAIN}${PENDING_DOMAIN}${PENDING_DOMAIN}${PENDING_DOMAIN}"

case $DOMAINS_COMPLETED in
  1) DOMAIN_STATUS="${COMPLETED_DOMAIN}${PENDING_DOMAIN}${PENDING_DOMAIN}${PENDING_DOMAIN}${PENDING_DOMAIN}" ;;
  2) DOMAIN_STATUS="${COMPLETED_DOMAIN}${COMPLETED_DOMAIN}${PENDING_DOMAIN}${PENDING_DOMAIN}${PENDING_DOMAIN}" ;;
  3) DOMAIN_STATUS="${COMPLETED_DOMAIN}${COMPLETED_DOMAIN}${COMPLETED_DOMAIN}${PENDING_DOMAIN}${PENDING_DOMAIN}" ;;
  4) DOMAIN_STATUS="${COMPLETED_DOMAIN}${COMPLETED_DOMAIN}${COMPLETED_DOMAIN}${COMPLETED_DOMAIN}${PENDING_DOMAIN}" ;;
  5) DOMAIN_STATUS="${COMPLETED_DOMAIN}${COMPLETED_DOMAIN}${COMPLETED_DOMAIN}${COMPLETED_DOMAIN}${COMPLETED_DOMAIN}" ;;
esac

# Colorful security status
SECURITY_ICON="🔴"
SECURITY_COLOR="${BRIGHT_RED}"
if [ "$SECURITY_STATUS" = "CLEAN" ]; then
  SECURITY_ICON="🟢"
  SECURITY_COLOR="${BRIGHT_GREEN}"
elif [ "$CVES_FIXED" -gt 0 ]; then
  SECURITY_ICON="🟡"
  SECURITY_COLOR="${BRIGHT_YELLOW}"
fi

# Integration status colors
INTEGRATION_COLOR="${DIM}"
if [ "$INTEGRATION_STATUS" = "●" ]; then
  INTEGRATION_COLOR="${BRIGHT_CYAN}"
fi

# Get model name from Claude Code input
MODEL_NAME=""
if [ "$CLAUDE_INPUT" != "{}" ]; then
  MODEL_NAME=$(echo "$CLAUDE_INPUT" | jq -r '.model.display_name // ""' 2>/dev/null)
fi

# Get current directory
CURRENT_DIR=$(basename "$PROJECT_DIR" 2>/dev/null || echo "claude-flow")

# Build colorful output with better formatting
OUTPUT=""

# Header Line: V3 Project + Branch + Integration Status
OUTPUT="${BOLD}${BRIGHT_PURPLE}▊ Claude Flow V3 ${RESET}"
OUTPUT="${OUTPUT}${INTEGRATION_COLOR}${INTEGRATION_STATUS} ${BRIGHT_CYAN}${GH_USER}${RESET}"
if [ -n "$GIT_BRANCH" ]; then
  OUTPUT="${OUTPUT}  ${DIM}│${RESET}  ${BRIGHT_BLUE}⎇ ${GIT_BRANCH}${RESET}"
fi
if [ -n "$MODEL_NAME" ]; then
  OUTPUT="${OUTPUT}  ${DIM}│${RESET}  ${PURPLE}${MODEL_NAME}${RESET}"
fi

# Separator line
OUTPUT="${OUTPUT}\n${DIM}─────────────────────────────────────────────────────${RESET}"

# Line 1: DDD Domain Decomposition Progress
DOMAINS_COLOR="${BRIGHT_GREEN}"
if [ "$DOMAINS_COMPLETED" -lt 3 ]; then
  DOMAINS_COLOR="${YELLOW}"
fi
if [ "$DOMAINS_COMPLETED" -eq 0 ]; then
  DOMAINS_COLOR="${RED}"
fi

PERF_COLOR="${BRIGHT_YELLOW}"
if [[ "$PERF_CURRENT" =~ ^[0-9]+\.[0-9]+x$ ]] && [[ "${PERF_CURRENT%x}" > "2.0" ]]; then
  PERF_COLOR="${BRIGHT_GREEN}"
fi

OUTPUT="${OUTPUT}\n${BRIGHT_CYAN}🏗️  DDD Domains${RESET}    [${DOMAIN_STATUS}]  ${DOMAINS_COLOR}${DOMAINS_COMPLETED}${RESET}/${BRIGHT_WHITE}${DOMAINS_TOTAL}${RESET}"
OUTPUT="${OUTPUT}    ${PERF_COLOR}⚡ ${PERF_CURRENT}${RESET} ${DIM}→${RESET} ${BRIGHT_YELLOW}${PERF_TARGET}${RESET}"

# Line 2: 15-Agent Swarm Coordination Status
AGENTS_COLOR="${BRIGHT_GREEN}"
if [ "$AGENTS_ACTIVE" -lt 8 ]; then
  AGENTS_COLOR="${YELLOW}"
fi
if [ "$AGENTS_ACTIVE" -eq 0 ]; then
  AGENTS_COLOR="${RED}"
fi

MEMORY_COLOR="${BRIGHT_CYAN}"
if [[ "$MEMORY_DISPLAY" == "--" ]]; then
  MEMORY_COLOR="${DIM}"
fi

# Format agent count with padding and activity indicator
AGENT_DISPLAY=$(printf "%2d" "$AGENTS_ACTIVE")

# Add activity indicator when processes are running
ACTIVITY_INDICATOR=""
if [ "$ACTIVE_PROCESSES" -gt 0 ]; then
  ACTIVITY_INDICATOR="${BRIGHT_GREEN}◉${RESET} "  # Active indicator
else
  ACTIVITY_INDICATOR="${DIM}○${RESET} "  # Inactive indicator
fi

# Sub-agent color
SUBAGENT_COLOR="${DIM}"
if [ "$SUBAGENT_COUNT" -gt 0 ]; then
  SUBAGENT_COLOR="${BRIGHT_PURPLE}"
fi

# Queue indicator
QUEUE_INDICATOR=""
if [ "$QUEUE_PENDING" -gt 0 ]; then
  QUEUE_INDICATOR="  ${DIM}📨 ${QUEUE_PENDING}${RESET}"
fi

# Format context and intel with padding for alignment (3 digits for up to 100%)
CONTEXT_DISPLAY=$(printf "%3d" "$CONTEXT_PCT")
INTEL_DISPLAY=$(printf "%3d" "$INTEL_SCORE")

OUTPUT="${OUTPUT}\n${BRIGHT_YELLOW}🤖 Swarm${RESET}  ${ACTIVITY_INDICATOR}[${AGENTS_COLOR}${AGENT_DISPLAY}${RESET}/${BRIGHT_WHITE}${AGENTS_TARGET}${RESET}]  ${SUBAGENT_COLOR}👥 ${SUBAGENT_COUNT}${RESET}${QUEUE_INDICATOR}    ${SECURITY_ICON} ${SECURITY_COLOR}CVE ${CVES_FIXED}${RESET}/${BRIGHT_WHITE}${SECURITY_CVES}${RESET}    ${MEMORY_COLOR}💾 ${MEMORY_DISPLAY}${RESET}    ${CONTEXT_COLOR}📂 ${CONTEXT_DISPLAY}%${RESET}    ${INTEL_COLOR}🧠 ${INTEL_DISPLAY}%${RESET}"

# Line 3: V3 Architecture Components with better alignment
DDD_COLOR="${BRIGHT_GREEN}"
if [ "$DDD_PROGRESS" -lt 50 ]; then
  DDD_COLOR="${YELLOW}"
fi
if [ "$DDD_PROGRESS" -eq 0 ]; then
  DDD_COLOR="${RED}"
fi

# Format DDD progress with padding
DDD_DISPLAY=$(printf "%3d" "$DDD_PROGRESS")

OUTPUT="${OUTPUT}\n${BRIGHT_PURPLE}🔧 Architecture${RESET}    ${CYAN}DDD${RESET} ${DDD_COLOR}●${DDD_DISPLAY}%${RESET}  ${DIM}│${RESET}  ${CYAN}Security${RESET} ${SECURITY_COLOR}●${SECURITY_STATUS}${RESET}"
OUTPUT="${OUTPUT}  ${DIM}│${RESET}  ${CYAN}Memory${RESET} ${BRIGHT_GREEN}●AgentDB${RESET}  ${DIM}│${RESET}  ${CYAN}Integration${RESET} ${INTEGRATION_COLOR}●${RESET}"

# Footer separator
OUTPUT="${OUTPUT}\n${DIM}─────────────────────────────────────────────────────${RESET}"

printf "%b\n" "$OUTPUT"
