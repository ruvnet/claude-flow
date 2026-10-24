# Multi-stage build for optimized LiteLLM proxy
FROM python:3.11-slim as builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    make \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY requirements.txt /tmp/
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r /tmp/requirements.txt

# Production stage
FROM python:3.11-slim

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    postgresql-client \
    redis-tools \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Create app user
RUN useradd -m -u 1000 litellm && \
    mkdir -p /app/logs /app/cache /app/tenants && \
    chown -R litellm:litellm /app

WORKDIR /app

# Copy application files
COPY --chown=litellm:litellm entrypoint.sh /app/
COPY --chown=litellm:litellm healthcheck.py /app/

# Make scripts executable
RUN chmod +x /app/entrypoint.sh

# Switch to non-root user
USER litellm

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python /app/healthcheck.py || exit 1

# Expose ports
EXPOSE 4000 9090

# Set environment variables
ENV LITELLM_MODE=production \
    LITELLM_PORT=4000 \
    LITELLM_HOST=0.0.0.0 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Entry point
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["--config", "/app/config.yaml"]