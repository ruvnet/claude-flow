#!/bin/bash
# Claude Flow V3 Progress Manager Template (Linux/macOS)

set -e

METRICS_DIR="${PROJECT_ROOT:-.}/.claude-flow/metrics"
SECURITY_DIR="${PROJECT_ROOT:-.}/.claude-flow/security"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
RESET='\033[0m'

log_success() { echo -e "${GREEN}✅ $1${RESET}"; }
log_warning() { echo -e "${YELLOW}⚠️  $1${RESET}"; }
log_error() { echo -e "${RED}❌ $1${RESET}"; }
log_info() { echo -e "${BLUE}ℹ️  $1${RESET}"; }

# Update progress metric
update_metric() {
    local metric="$1"
    local value="$2"

    case "$metric" in
        "domain")
            if [ -f "$METRICS_DIR/v3-progress.json" ]; then
                jq --argjson val "$value" '.domains.completed = $val' \
                   "$METRICS_DIR/v3-progress.json" > /tmp/progress.json && \
                   mv /tmp/progress.json "$METRICS_DIR/v3-progress.json"
                log_success "Updated domain count to $value/5"
            fi
            ;;
        "agent")
            if [ -f "$METRICS_DIR/v3-progress.json" ]; then
                jq --argjson val "$value" '.swarm.activeAgents = $val' \
                   "$METRICS_DIR/v3-progress.json" > /tmp/progress.json && \
                   mv /tmp/progress.json "$METRICS_DIR/v3-progress.json"
                log_success "Updated active agents to $value/15"
            fi
            ;;
        "security")
            if [ -f "$SECURITY_DIR/audit-status.json" ]; then
                jq --argjson val "$value" '.cvesFixed = $val' \
                   "$SECURITY_DIR/audit-status.json" > /tmp/security.json && \
                   mv /tmp/security.json "$SECURITY_DIR/audit-status.json"
                log_success "Updated security: $value/3 CVEs fixed"
            fi
            ;;
        "performance")
            if [ -f "$METRICS_DIR/performance.json" ]; then
                jq --arg val "$value" '.flashAttention.speedup = $val' \
                   "$METRICS_DIR/performance.json" > /tmp/perf.json && \
                   mv /tmp/perf.json "$METRICS_DIR/performance.json"
                log_success "Updated Flash Attention speedup to $value"
            fi
            ;;
        "memory")
            if [ -f "$METRICS_DIR/performance.json" ]; then
                jq --arg val "$value" '.memory.reduction = $val' \
                   "$METRICS_DIR/performance.json" > /tmp/perf.json && \
                   mv /tmp/perf.json "$METRICS_DIR/performance.json"
                log_success "Updated memory reduction to $value"
            fi
            ;;
        "ddd")
            if [ -f "$METRICS_DIR/v3-progress.json" ]; then
                jq --argjson val "$value" '.ddd.progress = $val' \
                   "$METRICS_DIR/v3-progress.json" > /tmp/progress.json && \
                   mv /tmp/progress.json "$METRICS_DIR/v3-progress.json"
                log_success "Updated DDD progress to $value%"
            fi
            ;;
        *)
            log_error "Unknown metric: $metric"
            log_info "Available: domain, agent, security, performance, memory, ddd"
            exit 1
            ;;
    esac
}

# Main execution
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <metric> <value>"
    echo "Metrics: domain, agent, security, performance, memory, ddd"
    exit 1
fi

update_metric "$1" "$2"