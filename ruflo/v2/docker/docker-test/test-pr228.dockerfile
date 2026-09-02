# Multi-stage Dockerfile for testing PR #228 migration across Node.js versions
ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-alpine

LABEL description="Test environment for PR #228 - Test Suite Migration from Deno to Jest"
LABEL pr_number="228"
LABEL test_scope="jest-migration"

# Install system dependencies
RUN apk add --no-cache \
    git \
    bash \
    python3 \
    make \
    g++ \
    sqlite \
    curl

# Set working directory
WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./
COPY jest.config.js ./
COPY jest.setup.js ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --no-audit --no-fund

# Copy source code and tests
COPY src/ ./src/
COPY tests/ ./tests/
COPY .claude/ ./.claude/

# Copy other necessary files
COPY *.md ./
COPY *.json ./

# Create test directories
RUN mkdir -p /app/test-results /app/coverage

# Health check script
RUN echo '#!/bin/bash\nnode --version\nnpm --version\nnpm list jest ts-jest typescript --depth=0\necho "Container ready for testing"' > /app/healthcheck.sh && chmod +x /app/healthcheck.sh

# Set environment variables for testing
ENV NODE_ENV=test
ENV CI=true
ENV JEST_WORKERS=2

# Default command to run tests
CMD ["npm", "test"]