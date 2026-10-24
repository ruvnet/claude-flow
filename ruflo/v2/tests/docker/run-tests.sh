#!/bin/bash

# ReasoningBank Integration Test Runner
# Uses Docker to test all new features in isolated environment

set -e

echo "🐳 Claude-Flow ReasoningBank Integration Test Suite"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo -e "${BLUE}📁 Project root: ${PROJECT_ROOT}${NC}"
echo ""

# Check if .env exists
if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo -e "${YELLOW}⚠️  Warning: .env file not found at project root${NC}"
    echo "Creating minimal .env for testing..."
    cat > "$PROJECT_ROOT/.env" << EOF
# Test environment variables
NODE_ENV=test
REASONINGBANK_ENABLED=true
EOF
fi

# Clean up previous test artifacts
echo -e "${BLUE}🧹 Cleaning up previous test runs...${NC}"
rm -rf "$PROJECT_ROOT/.swarm/test-*" 2>/dev/null || true
docker-compose -f "$SCRIPT_DIR/docker-compose.test.yml" down -v 2>/dev/null || true

echo ""
echo -e "${GREEN}🏗️  Building Docker test environment...${NC}"
cd "$SCRIPT_DIR"
docker-compose -f docker-compose.test.yml build --no-cache

echo ""
echo -e "${GREEN}🚀 Running ReasoningBank integration tests...${NC}"
echo ""

# Run main integration test
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Test Suite 1: ReasoningBank Core Functionality${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
docker-compose -f docker-compose.test.yml run --rm reasoningbank-test

echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}Test Suite 2: Agent Execution with Memory${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════${NC}"
docker-compose -f docker-compose.test.yml run --rm agent-memory-test

# Cleanup
echo ""
echo -e "${BLUE}🧹 Cleaning up Docker containers...${NC}"
docker-compose -f docker-compose.test.yml down -v

echo ""
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅ All ReasoningBank Integration Tests Passed!${NC}"
echo -e "${GREEN}════════════════════════════════════════════════════${NC}"
echo ""
echo "Summary:"
echo "  ✅ ReasoningBank CLI commands working"
echo "  ✅ Database initialization successful"
echo "  ✅ Memory system operational"
echo "  ✅ Agent execution flags recognized"
echo "  ✅ Docker environment validated"
echo ""
echo -e "${GREEN}🚀 Integration is production-ready!${NC}"
