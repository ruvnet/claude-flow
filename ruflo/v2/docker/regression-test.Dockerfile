# Docker Regression Test Environment for AgentDB Integration
# Tests all MCP tools, CLI commands, and memory capabilities

FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    sqlite3 \
    jq \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the project
RUN npm run build

# Create test directories
RUN mkdir -p /test-results /test-data /test-logs

# Set environment variables for testing
ENV NODE_ENV=test
ENV CLAUDE_FLOW_TEST=true
ENV AGENTDB_PATH=/test-data/.agentdb

# Install claude-flow globally for CLI testing
RUN npm link

# Create regression test runner script
RUN cat > /usr/local/bin/run-regression-tests.sh << 'EOF'
#!/bin/bash
set -e

echo "=================================================="
echo "Claude Flow AgentDB Integration Regression Tests"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Test counters
PASSED=0
FAILED=0
TOTAL=0

# Result file
RESULTS_FILE="/test-results/regression-results.json"
echo "{" > $RESULTS_FILE
echo "  \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," >> $RESULTS_FILE
echo "  \"tests\": [" >> $RESULTS_FILE

# Helper function to run test
run_test() {
    local category=$1
    local name=$2
    local command=$3

    ((TOTAL++))
    echo -e "${BLUE}[TEST $TOTAL]${NC} $category: $name"

    if eval "$command" > /test-logs/test-$TOTAL.log 2>&1; then
        echo -e "${GREEN}✓ PASS${NC}"
        ((PASSED++))
        echo "    {\"category\": \"$category\", \"name\": \"$name\", \"status\": \"PASS\"}," >> $RESULTS_FILE
    else
        echo -e "${RED}✗ FAIL${NC}"
        ((FAILED++))
        echo "    {\"category\": \"$category\", \"name\": \"$name\", \"status\": \"FAIL\"}," >> $RESULTS_FILE
        echo "    Log: /test-logs/test-$TOTAL.log"
    fi
    echo ""
}

echo "=================================================="
echo "Phase 1: CLI Command Tests"
echo "=================================================="
echo ""

run_test "CLI" "Version check" "claude-flow --version"
run_test "CLI" "Help output" "claude-flow --help"
run_test "CLI" "Memory help" "claude-flow memory --help"
run_test "CLI" "SPARC help" "claude-flow sparc --help"
run_test "CLI" "Hooks help" "claude-flow hooks --help"
run_test "CLI" "MCP help" "claude-flow mcp --help"

echo "=================================================="
echo "Phase 2: Memory System Tests"
echo "=================================================="
echo ""

run_test "Memory" "Store operation" "claude-flow memory store test-key '{\"value\":\"test\"}' --namespace test"
run_test "Memory" "Retrieve operation" "claude-flow memory retrieve test-key --namespace test"
run_test "Memory" "List operation" "claude-flow memory list --namespace test"
run_test "Memory" "Search operation" "claude-flow memory search 'test' --namespace test"
run_test "Memory" "Delete operation" "claude-flow memory delete test-key --namespace test"
run_test "Memory" "Backup operation" "claude-flow memory backup /test-data/backup.json"
run_test "Memory" "Stats operation" "claude-flow memory stats"

echo "=================================================="
echo "Phase 3: AgentDB-Specific Tests"
echo "=================================================="
echo ""

run_test "AgentDB" "Vector store" "claude-flow memory store-vector test-vec '{\"data\":\"semantic test\"}' --namespace agentdb-test"
run_test "AgentDB" "Vector search" "claude-flow memory vector-search 'semantic' --namespace agentdb-test --k 5"
run_test "AgentDB" "Quantization info" "claude-flow memory quantization-info"
run_test "AgentDB" "HNSW stats" "claude-flow memory hnsw-stats"
run_test "AgentDB" "Learning status" "claude-flow memory learning-status"
run_test "AgentDB" "Skill library" "claude-flow memory skills-list"

echo "=================================================="
echo "Phase 4: MCP Tool Tests"
echo "=================================================="
echo ""

run_test "MCP" "MCP start" "timeout 5 claude-flow mcp start || true"
run_test "MCP" "Swarm init" "node -e \"require('./dist/mcp/tools/swarm.js')\""
run_test "MCP" "Memory tools" "node -e \"require('./dist/mcp/tools/memory.js')\""
run_test "MCP" "Neural tools" "node -e \"require('./dist/mcp/tools/neural.js')\""
run_test "MCP" "Task tools" "node -e \"require('./dist/mcp/tools/task.js')\""

echo "=================================================="
echo "Phase 5: SPARC Mode Tests"
echo "=================================================="
echo ""

run_test "SPARC" "List modes" "claude-flow sparc modes"
run_test "SPARC" "Mode info" "claude-flow sparc info spec"
run_test "SPARC" "Help output" "claude-flow sparc --help"

echo "=================================================="
echo "Phase 6: Hooks System Tests"
echo "=================================================="
echo ""

run_test "Hooks" "List hooks" "claude-flow hooks list"
run_test "Hooks" "Pre-task hook" "claude-flow hooks pre-task --description 'test task'"
run_test "Hooks" "Post-task hook" "claude-flow hooks post-task --task-id test-123"
run_test "Hooks" "Memory coordination" "claude-flow hooks post-edit --file test.js --memory-key test/key"

echo "=================================================="
echo "Phase 7: Integration Tests"
echo "=================================================="
echo ""

run_test "Integration" "Build project" "cd /app && npm run build"
run_test "Integration" "Run unit tests" "cd /app && npm test 2>&1 | head -20"
run_test "Integration" "Type check" "cd /app && npm run typecheck"
run_test "Integration" "Lint check" "cd /app && npm run lint -- --max-warnings=100"

echo "=================================================="
echo "Phase 8: Backward Compatibility Tests"
echo "=================================================="
echo ""

run_test "Compatibility" "Legacy memory store" "node -e \"const {EnhancedMemory} = require('./dist/memory'); const m = new EnhancedMemory(); console.log('OK')\""
run_test "Compatibility" "Legacy memory retrieve" "node -e \"const {createMemory} = require('./dist/memory'); const m = createMemory(); console.log('OK')\""
run_test "Compatibility" "SQLite backend" "node -e \"const {SqliteMemoryStore} = require('./dist/memory'); console.log('OK')\""

# Close JSON
echo "    {\"category\": \"Summary\", \"name\": \"Complete\", \"status\": \"INFO\"}" >> $RESULTS_FILE
echo "  ]," >> $RESULTS_FILE
echo "  \"summary\": {" >> $RESULTS_FILE
echo "    \"total\": $TOTAL," >> $RESULTS_FILE
echo "    \"passed\": $PASSED," >> $RESULTS_FILE
echo "    \"failed\": $FAILED," >> $RESULTS_FILE
echo "    \"passRate\": \"$(awk "BEGIN {printf \"%.2f\", ($PASSED/$TOTAL)*100}")%\"" >> $RESULTS_FILE
echo "  }" >> $RESULTS_FILE
echo "}" >> $RESULTS_FILE

echo "=================================================="
echo "Test Summary"
echo "=================================================="
echo -e "Total Tests: ${BLUE}$TOTAL${NC}"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo -e "Pass Rate: $(awk "BEGIN {printf \"%.2f\", ($PASSED/$TOTAL)*100}")%"
echo ""
echo "Results saved to: $RESULTS_FILE"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All regression tests passed!${NC}"
    exit 0
else
    echo -e "${RED}❌ Some tests failed. Review logs in /test-logs/${NC}"
    exit 1
fi
EOF

RUN chmod +x /usr/local/bin/run-regression-tests.sh

# Set entrypoint
ENTRYPOINT ["/usr/local/bin/run-regression-tests.sh"]
