#!/bin/bash
set -e

echo "Starting LiteLLM Proxy Server..."

# Wait for PostgreSQL to be ready
until pg_isready -h postgres -p 5432 -U litellm; do
  echo "Waiting for PostgreSQL to be ready..."
  sleep 2
done

# Wait for Redis to be ready
until redis-cli -h redis ping; do
  echo "Waiting for Redis to be ready..."
  sleep 2
done

# Run database migrations if needed
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Running database migrations..."
  python -c "
import litellm
from litellm.proxy.db import init_db
init_db()
"
fi

# Load tenant configurations if directory exists
if [ -d "/app/tenants" ]; then
  echo "Loading tenant configurations..."
  for config in /app/tenants/*.yaml; do
    if [ -f "$config" ]; then
      echo "  - Loading: $(basename $config)"
    fi
  done
fi

# Start the LiteLLM proxy with provided arguments
echo "Starting LiteLLM proxy on port ${LITELLM_PORT:-4000}..."
exec litellm \
  --host ${LITELLM_HOST:-0.0.0.0} \
  --port ${LITELLM_PORT:-4000} \
  --num_workers ${MAX_WORKERS:-4} \
  --telemetry ${LITELLM_TELEMETRY:-false} \
  "$@"