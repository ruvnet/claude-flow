FROM node:20

WORKDIR /app

# Test in Ubuntu where npx should work
RUN echo "=== Testing Claude Flow SQLite Fallback in Ubuntu ===" && \
    echo "Node version: $(node --version)" && \
    echo "NPM version: $(npm --version)" && \
    echo "" && \
    echo "1. Testing with alpha.51:" && \
    npx -y claude-flow@2.0.0-alpha.51 --version && \
    echo "" && \
    echo "2. Testing init command:" && \
    npx -y claude-flow@2.0.0-alpha.51 init --force --project-name test && \
    echo "" && \
    echo "3. Checking created files:" && \
    ls -la && \
    echo "" && \
    echo "4. Testing memory operations:" && \
    npx -y claude-flow@2.0.0-alpha.51 memory store test-key "test-value" && \
    npx -y claude-flow@2.0.0-alpha.51 memory retrieve test-key && \
    echo "" && \
    echo "=== Test Complete ==="

CMD ["echo", "Ubuntu test passed"]