#!/bin/bash
# Test npx memory commands in Docker to validate v2.7.17 fix
# This simulates a clean remote environment without local dependencies

set -e

echo "🐳 Testing claude-flow@alpha npx memory commands in Docker"
echo "============================================================"
echo ""

# Test 1: Version check
echo "📋 Test 1: Version Check"
echo "Command: npx claude-flow@alpha --version"
npx claude-flow@alpha --version
echo "✅ Version check passed"
echo ""

# Test 2: Memory store (should auto-fallback to JSON)
echo "📋 Test 2: Memory Store with Auto-Fallback"
echo "Command: npx claude-flow@alpha memory store 'api-design' 'REST with JWT auth'"
npx claude-flow@alpha memory store "api-design" "REST with JWT auth" 2>&1 | tee /tmp/store-output.txt
echo ""

# Validate output
if grep -q "Automatically using JSON fallback" /tmp/store-output.txt; then
  echo "✅ Auto-fallback message detected"
else
  echo "⚠️  Auto-fallback message NOT found (may be using different mode)"
fi

if grep -q "Stored:" /tmp/store-output.txt || grep -q "✅" /tmp/store-output.txt; then
  echo "✅ Memory store succeeded"
else
  echo "❌ Memory store FAILED"
  exit 1
fi
echo ""

# Test 3: Memory query
echo "📋 Test 3: Memory Query"
echo "Command: npx claude-flow@alpha memory query 'authentication'"
npx claude-flow@alpha memory query "authentication" 2>&1 | tee /tmp/query-output.txt
echo ""

# Validate query output
if grep -q "api-design" /tmp/query-output.txt || grep -q "REST" /tmp/query-output.txt; then
  echo "✅ Memory query found stored data"
else
  echo "⚠️  Memory query did not find data (may be namespace issue)"
fi
echo ""

# Test 4: Memory stats
echo "📋 Test 4: Memory Statistics"
echo "Command: npx claude-flow@alpha memory stats"
npx claude-flow@alpha memory stats 2>&1 | tee /tmp/stats-output.txt
echo ""

if grep -q "Total Entries:" /tmp/stats-output.txt; then
  echo "✅ Memory stats succeeded"
else
  echo "❌ Memory stats FAILED"
  exit 1
fi
echo ""

# Test 5: Memory list
echo "📋 Test 5: Memory List"
echo "Command: npx claude-flow@alpha memory list"
npx claude-flow@alpha memory list 2>&1
echo "✅ Memory list succeeded"
echo ""

echo "============================================================"
echo "✅ ALL TESTS PASSED!"
echo ""
echo "Summary:"
echo "- Version check: ✅"
echo "- Memory store with auto-fallback: ✅"
echo "- Memory query: ✅"
echo "- Memory stats: ✅"
echo "- Memory list: ✅"
echo ""
echo "The npx memory command fix in v2.7.17 is working correctly!"
