# Dockerfile for testing published claude-flow@2.7.1 package
# Tests the npm package in a clean environment to verify no regressions

FROM node:18-alpine

# Set working directory
WORKDIR /test

# Install required system dependencies
RUN apk add --no-cache \
    git \
    bash \
    python3 \
    make \
    g++ \
    sqlite

# Install the published package from npm
RUN npm install -g claude-flow@2.7.1

# Create test directories
RUN mkdir -p /test/data /test/results

# Copy test scripts
COPY regression-tests.sh /test/
COPY verify-patterns.sh /test/

# Make scripts executable
RUN chmod +x /test/*.sh

# Set environment variables
ENV NODE_ENV=production
ENV CLAUDE_FLOW_TEST=true

# Default command runs all tests
CMD ["/bin/bash", "/test/regression-tests.sh"]
