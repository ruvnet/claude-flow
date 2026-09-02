#!/usr/bin/env python3
"""
Health check script for LiteLLM proxy
"""

import sys
import os
import requests
import psycopg2
import redis
from urllib.parse import urlparse

def check_http_service():
    """Check if LiteLLM HTTP service is responding"""
    try:
        port = os.environ.get('LITELLM_PORT', '4000')
        response = requests.get(f'http://localhost:{port}/health', timeout=5)
        return response.status_code == 200
    except Exception as e:
        print(f"HTTP service check failed: {e}")
        return False

def check_database():
    """Check PostgreSQL connectivity"""
    try:
        db_url = os.environ.get('DATABASE_URL', '')
        if not db_url:
            return True  # Skip if not configured
        
        # Parse database URL
        parsed = urlparse(db_url)
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path[1:],
            user=parsed.username,
            password=parsed.password,
            connect_timeout=5
        )
        conn.close()
        return True
    except Exception as e:
        print(f"Database check failed: {e}")
        return False

def check_redis():
    """Check Redis connectivity"""
    try:
        redis_url = os.environ.get('REDIS_URL', '')
        if not redis_url:
            return True  # Skip if not configured
        
        # Parse Redis URL
        parsed = urlparse(redis_url)
        r = redis.Redis(
            host=parsed.hostname,
            port=parsed.port or 6379,
            socket_connect_timeout=5
        )
        r.ping()
        return True
    except Exception as e:
        print(f"Redis check failed: {e}")
        return False

def main():
    """Run all health checks"""
    checks = {
        'HTTP Service': check_http_service(),
        'Database': check_database(),
        'Redis': check_redis()
    }
    
    # Print status
    for name, status in checks.items():
        status_str = "✓" if status else "✗"
        print(f"{name}: {status_str}")
    
    # Exit with appropriate code
    if all(checks.values()):
        print("\nAll health checks passed!")
        sys.exit(0)
    else:
        print("\nSome health checks failed!")
        sys.exit(1)

if __name__ == "__main__":
    main()