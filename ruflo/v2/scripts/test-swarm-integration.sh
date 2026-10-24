#!/bin/bash
# Integration test for Claude-Flow Swarm Mode

echo "Claude-Flow Swarm Mode Integration Test"
echo "======================================="
echo

# Test 1: Binary exists
echo "Test 1: Checking binary files..."
if [ -f "./bin/claude-flow" ]; then
    echo "✅ claude-flow binary found"
else
    echo "❌ claude-flow binary not found"
    exit 1
fi

if [ -f "./bin/claude-flow-swarm" ]; then
    echo "✅ claude-flow-swarm wrapper found"
else
    echo "❌ claude-flow-swarm wrapper not found"
    exit 1
fi

# Test 2: Help command
echo -e "\nTest 2: Testing help command..."
if ./bin/claude-flow help swarm | grep -q "Claude Swarm Mode"; then
    echo "✅ Swarm help command works"
else
    echo "❌ Swarm help command failed"
    exit 1
fi

# Test 3: Swarm listed in main help
echo -e "\nTest 3: Checking swarm in main help..."
if ./bin/claude-flow --help | grep -q "swarm"; then
    echo "✅ Swarm command listed in main help"
else
    echo "❌ Swarm command not listed in main help"
    exit 1
fi

# Test 4: Standalone swarm dry-run
echo -e "\nTest 4: Testing standalone swarm dry-run..."
if ./bin/claude-flow-swarm "Test objective" --dry-run | grep -q "DRY RUN"; then
    echo "✅ Standalone swarm dry-run works"
else
    echo "❌ Standalone swarm dry-run failed"
    exit 1
fi

# Test 5: Complex swarm configuration
echo -e "\nTest 5: Testing complex swarm configuration..."
OUTPUT=$(./bin/claude-flow-swarm "Complex test" --strategy research --max-agents 10 --coordinator --review --parallel --dry-run)
if echo "$OUTPUT" | grep -q "Strategy: research" && \
   echo "$OUTPUT" | grep -q "Max Agents: 10" && \
   echo "$OUTPUT" | grep -q "Coordinator: true" && \
   echo "$OUTPUT" | grep -q "Review Mode: true" && \
   echo "$OUTPUT" | grep -q "Parallel: true"; then
    echo "✅ Complex swarm configuration works"
else
    echo "❌ Complex swarm configuration failed"
    echo "Output: $OUTPUT"
    exit 1
fi

# Test 6: Check documentation files
echo -e "\nTest 6: Checking documentation..."
if [ -f "./docs/12-swarm.md" ]; then
    echo "✅ Swarm documentation found"
else
    echo "❌ Swarm documentation not found"
    exit 1
fi

# Test 7: Check swarm demo script
echo -e "\nTest 7: Checking swarm demo script..."
if [ -f "./swarm-demo.ts" ]; then
    echo "✅ swarm-demo.ts found"
else
    echo "❌ swarm-demo.ts not found"
    exit 1
fi

echo -e "\n======================================="
echo "✅ All integration tests passed!"
echo
echo "Swarm mode is ready to use:"
echo "  1. ./bin/claude-flow swarm \"Your objective\" [options]"
echo "  2. ./bin/claude-flow-swarm \"Your objective\" [options]"
echo "  3. npx claude-flow swarm \"Your objective\" [options]"
echo
echo "For more info: ./bin/claude-flow help swarm"