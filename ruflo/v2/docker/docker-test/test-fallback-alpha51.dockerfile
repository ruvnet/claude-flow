FROM node:20-alpine

WORKDIR /app

# Install required packages
RUN apk add --no-cache bash

# Run test directly in RUN command to see output during build
RUN echo "=== Testing Claude Flow alpha.51 SQLite Fallback ===" && \
    echo "Node version: $(node --version)" && \
    echo "Platform: $(uname -a)" && \
    echo "" && \
    echo "1. Testing npx init command:" && \
    npx -y claude-flow@alpha init --force --project-name test-fallback && \
    echo "" && \
    echo "2. Checking if .swarm directory was created:" && \
    (ls -la .swarm/ || echo "No .swarm directory (indicates in-memory mode)") && \
    echo "" && \
    echo "3. Testing memory operations:" && \
    npx -y claude-flow@alpha memory store test-key "test-value" --namespace test && \
    npx -y claude-flow@alpha memory retrieve test-key --namespace test && \
    echo "" && \
    echo "4. Testing hive-mind commands:" && \
    npx -y claude-flow@alpha hive-mind init && \
    echo "" && \
    echo "=== Test Complete ==="

CMD ["echo", "Docker test passed"]