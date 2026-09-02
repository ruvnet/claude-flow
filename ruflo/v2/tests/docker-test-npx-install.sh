#!/bin/bash
# Docker test for npx installation without build tools

set -e

echo "🐳 Testing npx claude-flow@alpha in minimal Docker environment (no build tools)..."
echo ""

# Create a minimal Dockerfile without build tools
cat > /tmp/Dockerfile.npx-test <<'EOF'
FROM node:20-alpine

# Deliberately DON'T install build tools to simulate Codespaces/remote environments
# RUN apk add --no-cache python3 make g++

# Just install basic npm
RUN npm install -g npm@latest

WORKDIR /test

# Test npx installation
CMD ["sh", "-c", "npx claude-flow@2.7.11 --version 2>&1"]
EOF

echo "Building Docker image..."
docker build -t claude-flow-npx-test -f /tmp/Dockerfile.npx-test /tmp

echo ""
echo "Running npx test..."
docker run --rm claude-flow-npx-test

echo ""
echo "✅ Docker test completed!"
