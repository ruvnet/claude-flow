#!/bin/bash
#
# Claude-Flow MCP Server V3 Startup Script
#
# Usage:
#   ./start-mcp.sh [options]
#
# Options:
#   --transport, -t <type>   Transport: stdio, http, websocket (default: stdio)
#   --host <host>            Server host (default: localhost)
#   --port, -p <port>        Server port (default: 3000)
#   --log-level, -l <level>  Log level: debug, info, warn, error (default: info)
#   --daemon, -d             Run as daemon
#   --help                   Show help
#
# Examples:
#   ./start-mcp.sh                          # Start with defaults
#   ./start-mcp.sh -t http -p 8080          # Start HTTP on port 8080
#   ./start-mcp.sh --daemon                 # Run as background daemon
#

set -e

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
V3_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$V3_DIR")"

# Default configuration
TRANSPORT="stdio"
HOST="localhost"
PORT="3000"
LOG_LEVEL="info"
DAEMON=false

# PID file location
PID_FILE="${TMPDIR:-/tmp}/claude-flow-mcp.pid"
LOG_FILE="${TMPDIR:-/tmp}/claude-flow-mcp.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print functions
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Show help
show_help() {
    cat << EOF
Claude-Flow MCP Server V3 Startup Script

Usage:
  ./start-mcp.sh [options]

Options:
  --transport, -t <type>   Transport type: stdio, http, websocket (default: stdio)
  --host <host>            Server host (default: localhost)
  --port, -p <port>        Server port (default: 3000)
  --log-level, -l <level>  Log level: debug, info, warn, error (default: info)
  --daemon, -d             Run as background daemon
  --stop                   Stop running server
  --status                 Show server status
  --help                   Show this help message

Examples:
  ./start-mcp.sh                          # Start with defaults (stdio)
  ./start-mcp.sh -t http -p 8080          # Start HTTP server on port 8080
  ./start-mcp.sh --daemon                 # Run as background daemon
  ./start-mcp.sh --stop                   # Stop the daemon
  ./start-mcp.sh --status                 # Check if server is running

Environment Variables:
  MCP_TRANSPORT       Override transport type
  MCP_HOST            Override host
  MCP_PORT            Override port
  MCP_LOG_LEVEL       Override log level

EOF
}

# Check if server is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        local pid
        pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Get server PID
get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE"
    fi
}

# Stop server
stop_server() {
    if ! is_running; then
        print_info "MCP Server is not running"
        return 0
    fi

    local pid
    pid=$(get_pid)
    print_info "Stopping MCP Server (PID: $pid)..."

    # Send SIGTERM for graceful shutdown
    kill -TERM "$pid" 2>/dev/null || true

    # Wait for process to exit
    local timeout=30
    while [ $timeout -gt 0 ] && kill -0 "$pid" 2>/dev/null; do
        sleep 1
        ((timeout--))
    done

    # Force kill if still running
    if kill -0 "$pid" 2>/dev/null; then
        print_warning "Forcing shutdown..."
        kill -KILL "$pid" 2>/dev/null || true
    fi

    # Remove PID file
    rm -f "$PID_FILE"

    print_success "MCP Server stopped"
}

# Show status
show_status() {
    if is_running; then
        local pid
        pid=$(get_pid)
        print_success "MCP Server is running (PID: $pid)"

        # Show additional info if HTTP transport
        if [ -f "$LOG_FILE" ]; then
            echo ""
            echo "Recent logs:"
            tail -n 5 "$LOG_FILE" 2>/dev/null || true
        fi
    else
        print_info "MCP Server is not running"
        return 1
    fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --transport|-t)
            TRANSPORT="$2"
            shift 2
            ;;
        --host)
            HOST="$2"
            shift 2
            ;;
        --port|-p)
            PORT="$2"
            shift 2
            ;;
        --log-level|-l)
            LOG_LEVEL="$2"
            shift 2
            ;;
        --daemon|-d)
            DAEMON=true
            shift
            ;;
        --stop)
            stop_server
            exit 0
            ;;
        --status)
            show_status
            exit $?
            ;;
        --help)
            show_help
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Override from environment variables
TRANSPORT="${MCP_TRANSPORT:-$TRANSPORT}"
HOST="${MCP_HOST:-$HOST}"
PORT="${MCP_PORT:-$PORT}"
LOG_LEVEL="${MCP_LOG_LEVEL:-$LOG_LEVEL}"

# Check if already running
if is_running; then
    local pid
    pid=$(get_pid)
    print_warning "MCP Server already running (PID: $pid)"
    print_info "Use --stop to stop the server first"
    exit 1
fi

# Check for Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed"
    exit 1
fi

# Check for npx
if ! command -v npx &> /dev/null; then
    print_error "npx is not available"
    exit 1
fi

# Server entry point
SERVER_ENTRY="$V3_DIR/mcp/server-entry.ts"

if [ ! -f "$SERVER_ENTRY" ]; then
    print_error "Server entry point not found: $SERVER_ENTRY"
    exit 1
fi

# Build command
CMD="npx tsx $SERVER_ENTRY \
    --transport $TRANSPORT \
    --host $HOST \
    --port $PORT \
    --log-level $LOG_LEVEL"

# Start server
print_info "Starting Claude-Flow MCP Server V3..."
print_info "  Transport: $TRANSPORT"
print_info "  Host: $HOST"
print_info "  Port: $PORT"
print_info "  Log level: $LOG_LEVEL"

if [ "$DAEMON" = true ]; then
    print_info "  Mode: daemon"

    # Start in background
    nohup $CMD >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"

    # Wait a moment for startup
    sleep 2

    if is_running; then
        local pid
        pid=$(get_pid)
        print_success "MCP Server started (PID: $pid)"
        print_info "Logs: $LOG_FILE"

        if [ "$TRANSPORT" = "http" ]; then
            print_info "Health check: http://$HOST:$PORT/health"
            print_info "RPC endpoint: http://$HOST:$PORT/rpc"
        elif [ "$TRANSPORT" = "websocket" ]; then
            print_info "WebSocket: ws://$HOST:$PORT/ws"
        fi
    else
        print_error "Failed to start MCP Server"
        print_info "Check logs: $LOG_FILE"
        exit 1
    fi
else
    print_info "  Mode: foreground (Ctrl+C to stop)"
    echo ""

    # Run in foreground
    exec $CMD
fi
