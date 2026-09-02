#!/bin/bash

echo "🔧 Final TypeScript fixes..."

# Fix 1: Move shebang to first line
echo "📝 Fixing shebang placement..."
for file in src/cli/cli-core.ts src/cli/index-remote.ts src/cli/index.ts src/cli/main.ts src/cli/simple-cli.ts src/swarm/prompt-cli.ts; do
  if [ -f "$file" ]; then
    # Extract shebang if it exists anywhere
    shebang=$(grep -m1 '^#!/usr/bin/env' "$file" || echo "")
    if [ -n "$shebang" ]; then
      # Remove shebang from current location
      sed -i '/^#!/d' "$file"
      # Add shebang as first line
      echo "$shebang" | cat - "$file" > temp && mv temp "$file"
    fi
  fi
done

# Fix 2: Remove duplicate imports that may have been added
echo "📝 Removing duplicate process imports..."
for file in $(find src -name "*.ts" -type f); do
  # Count process imports
  count=$(grep -c "import process from" "$file" 2>/dev/null || echo 0)
  if [ "$count" -gt 1 ]; then
    # Keep only the first import
    awk '/import process from/ && !f{f=1; print; next} !/import process from/' "$file" > temp && mv temp "$file"
  fi
done

# Fix 3: Fix incorrect waitForConnection recursion
echo "📝 Fixing waitForConnection recursion..."
sed -i 's/resolve();$/checkConnection();/g' src/swarm/strategies/research.ts

# Fix 4: Fix double method declarations
echo "📝 Fixing duplicate method declarations..."
sed -i 's/override async start(): Promise<void> {$/override async stop(): Promise<void> {/2' src/mcp/transports/http.ts
sed -i 's/override async start(): Promise<void> {$/override async connect(): Promise<void> {/3' src/mcp/transports/http.ts
sed -i 's/override async start(): Promise<void> {$/override async disconnect(): Promise<void> {/4' src/mcp/transports/http.ts

# Fix 5: Fix duplicate onSwarmEvent declarations
echo "📝 Fixing duplicate interface method declarations..."
sed -i '/onSwarmEvent(type: EventType, handler: (event: SwarmEvent) => void): this;/{N;/onSwarmEvent(type: EventType, handler: (event: SwarmEvent) => void): this;/d;}' src/swarm/types.ts

# Fix 6: Fix import type back to correct format where needed
echo "📝 Fixing import statements..."
sed -i 's/import { WebSocketServer, WebSocket }/import type { WebSocketServer, WebSocket }/g' src/mcp/transports/http.ts
sed -i 's/import { MCPTransportError }/import type { MCPTransportError }/g' src/mcp/transports/http.ts

echo "✅ Final fixes applied!"