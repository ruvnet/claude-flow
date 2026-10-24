#!/bin/bash
# Claude Flow Plugin Uninstallation Script

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}ℹ${NC} $1"; }
warning() { echo -e "${YELLOW}⚠${NC} $1"; }

echo -e "${RED}═══════════════════════════════════════════════════${NC}"
echo -e "${RED}    Claude Flow Plugin Uninstaller${NC}"
echo -e "${RED}═══════════════════════════════════════════════════${NC}"
echo ""

warning "This will remove Claude Flow commands, agents, and configuration."
read -p "Continue? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ]; then
    echo "Uninstallation cancelled."
    exit 0
fi

info "Removing commands..."
find ~/.claude/commands -name "*coordination*" -o -name "*sparc*" -o -name "*github*" -o -name "*hive-mind*" 2>/dev/null | xargs rm -f

info "Removing agents..."
find ~/.claude/agents -name "*coordinator*" -o -name "*swarm*" 2>/dev/null | xargs rm -f

warning "MCP servers NOT removed from settings.json"
echo "Please manually remove from ~/.claude/settings.json if desired"

echo -e "${GREEN}✓ Uninstallation complete${NC}"
