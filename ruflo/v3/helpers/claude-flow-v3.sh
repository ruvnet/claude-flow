#!/bin/bash
# Claude Flow V3 Master Helper (Linux/macOS)
# Cross-platform development automation for claude-flow v3

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CLAUDE_DIR="${PROJECT_ROOT}/.claude"
HELPERS_DIR="${CLAUDE_DIR}/helpers"
METRICS_DIR="${PROJECT_ROOT}/.claude-flow/metrics"
SECURITY_DIR="${PROJECT_ROOT}/.claude-flow/security"

# Colors (ANSI)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# Platform detection
detect_platform() {
  case "$(uname -s)" in
    Linux*)     echo "linux" ;;
    Darwin*)    echo "macos" ;;
    CYGWIN*|MINGW*|MSYS*) echo "windows" ;;
    *)          echo "unknown" ;;
  esac
}

PLATFORM=$(detect_platform)

# Logging functions
log_info() {
  echo -e "${BLUE}ℹ️  $1${RESET}" >&2
}

log_success() {
  echo -e "${GREEN}✅ $1${RESET}" >&2
}

log_warning() {
  echo -e "${YELLOW}⚠️  $1${RESET}" >&2
}

log_error() {
  echo -e "${RED}❌ $1${RESET}" >&2
}

log_header() {
  echo -e "${BOLD}${PURPLE}$1${RESET}" >&2
}

# Ensure required directories exist
setup_directories() {
  mkdir -p "$CLAUDE_DIR" "$HELPERS_DIR" "$METRICS_DIR" "$SECURITY_DIR"
}

# Initialize V3 project
init_v3_project() {
  log_header "🚀 Initializing Claude Flow V3 Project"

  setup_directories

  # Copy helper templates if they don't exist
  if [ ! -f "$HELPERS_DIR/progress-manager.sh" ]; then
    log_info "Setting up helper templates..."
    cp "$SCRIPT_DIR"/templates/*.sh "$HELPERS_DIR/" 2>/dev/null || true
    chmod +x "$HELPERS_DIR"/*.sh 2>/dev/null || true
  fi

  # Create default configuration files
  create_default_configs

  # Validate setup
  if "$SCRIPT_DIR/config-validator.sh" >/dev/null 2>&1; then
    log_success "V3 project initialized successfully"
    log_info "Platform: $PLATFORM"
    log_info "Project root: $PROJECT_ROOT"
    log_info "Run 'claude-flow-v3.sh status' to see current progress"
  else
    log_error "Initialization failed. Run 'claude-flow-v3.sh validate' for details"
    exit 1
  fi
}

# Create default configuration files
create_default_configs() {
  # Default V3 progress file
  if [ ! -f "$METRICS_DIR/v3-progress.json" ]; then
    cat > "$METRICS_DIR/v3-progress.json" <<EOF
{
  "domains": {
    "completed": 0,
    "total": 5,
    "list": [
      {"name": "task-management", "status": "pending", "progress": 0},
      {"name": "session-management", "status": "pending", "progress": 0},
      {"name": "health-monitoring", "status": "pending", "progress": 0},
      {"name": "lifecycle-management", "status": "pending", "progress": 0},
      {"name": "event-coordination", "status": "pending", "progress": 0}
    ]
  },
  "swarm": {
    "activeAgents": 0,
    "totalAgents": 15,
    "topology": "hierarchical-mesh"
  },
  "ddd": {
    "progress": 0,
    "orchestratorRefactored": false
  },
  "lastUpdated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  fi

  # Default performance metrics
  if [ ! -f "$METRICS_DIR/performance.json" ]; then
    cat > "$METRICS_DIR/performance.json" <<EOF
{
  "flashAttention": {"speedup": "1.0x", "target": "2.49x-7.47x"},
  "memory": {"reduction": "0%", "target": "50-75%"},
  "codeReduction": {"linesRemoved": 0, "target": "10,000+"},
  "startupTime": {"current": "2000ms", "target": "500ms"},
  "lastUpdated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  fi

  # Default security audit
  if [ ! -f "$SECURITY_DIR/audit-status.json" ]; then
    cat > "$SECURITY_DIR/audit-status.json" <<EOF
{
  "status": "PENDING",
  "cvesFixed": 0,
  "totalCves": 3,
  "criticalVulnerabilities": [
    {"id": "CVE-1", "description": "Input validation bypass", "status": "pending"},
    {"id": "CVE-2", "description": "Path traversal vulnerability", "status": "pending"},
    {"id": "CVE-3", "description": "Command injection vulnerability", "status": "pending"}
  ],
  "lastAudit": null
}
EOF
  fi
}

# Show current status
show_status() {
  if [ -f "$HELPERS_DIR/status-display.sh" ]; then
    "$HELPERS_DIR/status-display.sh"
  else
    log_info "Status display not available. Run 'claude-flow-v3.sh init' to set up helpers."
  fi
}

# Update progress metrics
update_progress() {
  local metric="$1"
  local value="$2"

  if [ -z "$metric" ] || [ -z "$value" ]; then
    log_error "Usage: update <metric> <value>"
    log_info "Available metrics: domain, agent, security, performance, memory, ddd"
    exit 1
  fi

  if [ -f "$HELPERS_DIR/progress-manager.sh" ]; then
    "$HELPERS_DIR/progress-manager.sh" "$metric" "$value"
  else
    log_error "Progress manager not available. Run 'claude-flow-v3.sh init' first."
    exit 1
  fi
}

# Validate configuration
validate_config() {
  if [ -f "$HELPERS_DIR/config-validator.sh" ]; then
    "$HELPERS_DIR/config-validator.sh"
  else
    log_error "Config validator not available. Run 'claude-flow-v3.sh init' first."
    exit 1
  fi
}

# Create checkpoint
create_checkpoint() {
  local message="${1:-Auto checkpoint from V3 helper}"

  if [ -f "$HELPERS_DIR/checkpoint-manager.sh" ]; then
    "$HELPERS_DIR/checkpoint-manager.sh" auto-checkpoint "$message"
  else
    log_warning "Checkpoint manager not available. Creating simple git commit..."
    if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      git add . && git commit -m "$message" || log_info "No changes to commit"
    else
      log_error "Not in a git repository"
    fi
  fi
}

# Platform-specific commands
run_platform_command() {
  local command="$1"
  shift

  case "$PLATFORM" in
    "linux"|"macos")
      "$HELPERS_DIR/$command.sh" "$@"
      ;;
    "windows")
      # Fallback for Windows (if running in WSL or Git Bash)
      if command -v powershell.exe >/dev/null 2>&1; then
        powershell.exe -File "$HELPERS_DIR\\$command.ps1" "$@"
      else
        "$HELPERS_DIR/$command.sh" "$@"
      fi
      ;;
    *)
      log_error "Unsupported platform: $PLATFORM"
      exit 1
      ;;
  esac
}

# Main command handler
case "$1" in
  "init")
    init_v3_project
    ;;

  "status"|"st")
    show_status
    ;;

  "update")
    shift
    update_progress "$@"
    ;;

  "validate"|"check")
    validate_config
    ;;

  "checkpoint"|"cp")
    shift
    create_checkpoint "$*"
    ;;

  "github")
    shift
    run_platform_command "github-integration" "$@"
    ;;

  "pr")
    shift
    run_platform_command "pr-management" "$@"
    ;;

  "issue")
    shift
    run_platform_command "issue-tracker" "$@"
    ;;

  "session")
    shift
    run_platform_command "session-manager" "$@"
    ;;

  "platform-info")
    echo "Platform: $PLATFORM"
    echo "Script directory: $SCRIPT_DIR"
    echo "Project root: $PROJECT_ROOT"
    echo "Helpers directory: $HELPERS_DIR"
    ;;

  "help"|"--help"|"-h"|"")
    cat << EOF
Claude Flow V3 Master Helper ($PLATFORM)
$(printf '=%.0s' {1..40})

Usage: $0 <command> [options]

Core Commands:
  init                     Initialize V3 project with helpers
  status, st               Show current development status
  update <metric> <value>  Update progress metrics
  validate, check          Validate project configuration
  checkpoint, cp [msg]     Create development checkpoint

Development Commands:
  github <action>          GitHub integration commands
  pr <action>              Pull request management
  issue <action>           Issue tracking commands
  session <action>         Development session management

Utility Commands:
  platform-info           Show platform and path information
  help                     Show this help message

Examples:
  $0 init                  # Set up V3 project
  $0 status                # Show current progress
  $0 update domain 3       # Mark 3 domains complete
  $0 update agent 8        # Set 8 agents active
  $0 checkpoint "Feature complete"
  $0 github status         # GitHub integration status

Platform: $PLATFORM
Claude Directory: $CLAUDE_DIR
EOF
    ;;

  *)
    log_error "Unknown command: $1"
    log_info "Run '$0 help' for usage information"
    exit 1
    ;;
esac