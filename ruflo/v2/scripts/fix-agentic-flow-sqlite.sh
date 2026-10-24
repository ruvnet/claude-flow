#!/bin/bash
# Fix agentic-flow's broken better-sqlite3 import
# The dist/reasoningbank/db/queries.js file has BetterSqlite3 = null
# This script patches it to properly import better-sqlite3

QUERIES_FILE="node_modules/agentic-flow/dist/reasoningbank/db/queries.js"

if [ ! -f "$QUERIES_FILE" ]; then
  echo "❌ File not found: $QUERIES_FILE"
  exit 1
fi

echo "🔧 Fixing agentic-flow better-sqlite3 import..."

# Check if already fixed
if grep -q "import Database from 'better-sqlite3'" "$QUERIES_FILE"; then
  echo "✅ Already fixed!"
  exit 0
fi

# Backup original
cp "$QUERIES_FILE" "${QUERIES_FILE}.backup"

# Replace the broken import
sed -i '5s/const BetterSqlite3 = null; \/\/ Not used/import Database from '\''better-sqlite3'\'';/' "$QUERIES_FILE"
sed -i 's/new BetterSqlite3(/new Database(/g' "$QUERIES_FILE"

echo "✅ Fixed agentic-flow better-sqlite3 import!"
echo "   Patched: $QUERIES_FILE"
echo "   Backup: ${QUERIES_FILE}.backup"
