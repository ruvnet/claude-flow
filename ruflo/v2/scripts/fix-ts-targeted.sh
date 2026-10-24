#!/bin/bash

echo "🔧 Starting targeted TypeScript fixes..."

# Fix double .js extensions
echo "📝 Fixing double .js extensions..."
find src -name "*.ts" -type f -exec sed -i 's/\.js\.js/\.js/g' {} \;

# Fix incorrect override replacements
echo "📝 Fixing incorrect override replacements..."
find src -name "*.ts" -type f -exec sed -i 's/\$1\$2override \$3(/constructor(/g' {} \;
find src -name "*.ts" -type f -exec sed -i 's/\$1\$2override \$3$/override/g' {} \;
find src -name "*.ts" -type f -exec sed -i 's/super\$1\$2override \$3/super/g' {} \;

# Fix specific method signatures that need override
echo "📝 Adding override to specific methods..."
sed -i 's/^  async executeTask(/  override async executeTask(/g' src/cli/agents/*.ts
sed -i 's/^  getAgentStatus(/  override getAgentStatus(/g' src/cli/agents/*.ts
sed -i 's/^  async decompose(/  override async decompose(/g' src/swarm/strategies/*.ts
sed -i 's/^  async refineScope(/  override async refineScope(/g' src/swarm/strategies/*.ts
sed -i 's/^  getMetrics(/  override getMetrics(/g' src/swarm/strategies/*.ts

# Fix EventEmitter method signatures
echo "📝 Fixing EventEmitter method signatures..."
sed -i 's/emitSwarmEvent(/emitSwarmEvent(/g' src/swarm/types.ts
sed -i 's/emitSwarmEvents(/emitSwarmEvents(/g' src/swarm/types.ts
sed -i 's/onSwarmEvent(/onSwarmEvent(/g' src/swarm/types.ts
sed -i 's/offSwarmEvent(/offSwarmEvent(/g' src/swarm/types.ts
sed -i 's/filterEvents(/filterEvents(/g' src/swarm/types.ts
sed -i 's/correlateEvents(/correlateEvents(/g' src/swarm/types.ts

# Fix Promise/setTimeout issues
echo "📝 Fixing Promise and setTimeout issues..."
sed -i 's/setTimeout(resolve\(.*\));/setTimeout(resolve\1);/g' src/swarm/strategies/research.ts
sed -i 's/setTimeout(checkConnection/setTimeout(checkConnection/g' src/swarm/strategies/research.ts

# Fix Transport interface methods
echo "📝 Fixing Transport interface methods..."
for method in "start" "stop" "onRequest" "onNotification" "checkHealth" "connect" "disconnect" "sendRequest" "sendNotification"; do
  sed -i "s/^  ${method}(/  override ${method}(/g" src/mcp/transports/http.ts
done

# Fix array push operations with proper type assertions
echo "📝 Fixing array push operations..."
find src -name "*.ts" -type f -exec sed -i 's/(((\([a-zA-Z0-9_]*\) as any\[\]).push(/(\1 as any[]).push(/g' {} \;

# Count remaining errors
echo "🔧 Checking remaining errors..."
npm run build:ts 2>&1 | grep -c "error TS" || echo "0 errors"