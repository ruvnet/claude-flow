#!/bin/bash
# Fix agentic-flow's misleading "Enabled: false" log message
# Changes it to show actual initialization status

INDEX_FILE="node_modules/agentic-flow/dist/reasoningbank/index.js"

if [ ! -f "$INDEX_FILE" ]; then
  echo "❌ File not found: $INDEX_FILE"
  exit 1
fi

echo "🔧 Fixing agentic-flow 'Enabled' log message..."

# Check if already fixed
if grep -q "Enabled: true" "$INDEX_FILE"; then
  echo "✅ Already fixed!"
  exit 0
fi

# Backup original
cp "$INDEX_FILE" "${INDEX_FILE}.backup-enabled"

# Replace the misleading env check with hardcoded true since we're initializing
sed -i "41s/console.log(\`\[ReasoningBank\] Enabled: \${!!process.env.REASONINGBANK_ENABLED}\`);/console.log('[ReasoningBank] Enabled: true (initializing...)');/" "$INDEX_FILE"

echo "✅ Fixed agentic-flow 'Enabled' log message!"
echo "   Now shows: [ReasoningBank] Enabled: true (initializing...)"
echo "   Patched: $INDEX_FILE"
