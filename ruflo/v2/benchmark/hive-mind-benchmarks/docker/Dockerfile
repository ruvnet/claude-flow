# Hive Mind Benchmark Testing Container
FROM node:18-bullseye-slim

# Install Python and system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    build-essential \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Create application directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
COPY requirements.txt ./

# Install Node.js dependencies
RUN npm ci --only=production

# Create Python virtual environment and install dependencies
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p /app/benchmark-results /app/logs /app/tmp

# Set permissions
RUN chmod +x /app/scripts/*.py
RUN chmod +x /app/benchmark_runner.py

# Environment variables
ENV NODE_ENV=test
ENV PYTHON_ENV=test
ENV LOG_LEVEL=INFO
ENV BENCHMARK_OUTPUT_DIR=/app/benchmark-results
ENV BENCHMARK_TIMEOUT_MINUTES=60

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python3 -c "import sys; import subprocess; subprocess.check_call([sys.executable, '-c', 'import psutil, json'])"

# Default command
CMD ["python3", "scripts/automated_test_runner.py", "--profile", "quick"]

# Labels
LABEL maintainer="Hive Mind Team"
LABEL version="2.0.0"
LABEL description="Automated benchmark testing container for Hive Mind system"