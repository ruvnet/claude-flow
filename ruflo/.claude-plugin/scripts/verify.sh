#!/bin/bash
# Claude Flow Plugin Verification Script
# Verifies installation and configuration

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warning() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}    Claude Flow Plugin Verification${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

ERRORS=0
WARNINGS=0

# Check Claude Code
info "Checking Claude Code CLI..."
if command -v claude &> /dev/null; then
    success "Claude Code CLI installed"
else
    error "Claude Code CLI not found"
    ((ERRORS++))
fi

# Check directories
info "Checking installation directories..."
if [ -d "$HOME/.claude/commands" ]; then
    CMD_COUNT=$(find "$HOME/.claude/commands" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    success "Commands directory exists ($CMD_COUNT commands)"
else
    error "Commands directory not found"
    ((ERRORS++))
fi

if [ -d "$HOME/.claude/agents" ]; then
    AGENT_COUNT=$(find "$HOME/.claude/agents" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
    success "Agents directory exists ($AGENT_COUNT agents)"
else
    error "Agents directory not found"
    ((ERRORS++))
fi

# Check settings
info "Checking Claude Code settings..."
if [ -f "$HOME/.claude/settings.json" ]; then
    success "Settings file exists"

    if grep -q "claude-flow" "$HOME/.claude/settings.json"; then
        success "Claude Flow MCP server configured"
    else
        warning "Claude Flow MCP server not configured"
        ((WARNINGS++))
    fi
else
    warning "Settings file not found"
    ((WARNINGS++))
fi

# Check MCP packages
info "Checking MCP packages..."
if npx claude-flow@alpha --version &> /dev/null; then
    VERSION=$(npx claude-flow@alpha --version 2>/dev/null || echo "unknown")
    success "claude-flow MCP: $VERSION"
else
    warning "claude-flow MCP not installed"
    ((WARNINGS++))
fi

if npx ruv-swarm --version &> /dev/null; then
    success "ruv-swarm MCP: installed (optional)"
else
    info "ruv-swarm MCP: not installed (optional)"
fi

if npx flow-nexus@latest --version &> /dev/null; then
    success "flow-nexus MCP: installed (optional)"
else
    info "flow-nexus MCP: not installed (optional)"
fi

# Summary
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}    Verification Summary${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    success "All checks passed! Plugin is ready to use."
    exit 0
elif [ $ERRORS -eq 0 ]; then
    warning "$WARNINGS warning(s) found. Plugin should work but some features may be limited."
    exit 0
else
    error "$ERRORS error(s) and $WARNINGS warning(s) found. Please fix errors before using the plugin."
    exit 1
fi
