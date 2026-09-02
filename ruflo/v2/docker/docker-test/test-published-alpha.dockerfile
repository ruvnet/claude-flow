FROM node:20-alpine

LABEL description="Test published claude-flow@alpha.50 package"
LABEL test_type="npm-package-validation"

# Install system dependencies
RUN apk add --no-cache \
    git \
    bash \
    curl

# Create test directory
WORKDIR /test-app

# Install the published alpha package
RUN npm install -g claude-flow@alpha

# Test basic functionality
RUN echo '#!/bin/bash\necho "=== Testing claude-flow@alpha.50 ===" && \
claude-flow --version && \
echo "=== Version check passed ===" && \
claude-flow --help && \
echo "=== Help command passed ===" && \
echo "✅ Package installation and basic commands working"' > /test-script.sh && chmod +x /test-script.sh

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD claude-flow --version || exit 1

# Default command
CMD ["/test-script.sh"]