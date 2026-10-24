# Agent Swarm Benchmarking Tool - Deployment Guide

## 🚀 Deployment Overview

This guide covers the deployment, distribution, and maintenance of the Agent Swarm Benchmarking Tool across different environments and platforms.

## 📦 Packaging Strategy

### Python Package Structure
```
swarm-benchmark/
├── setup.py                    # Package configuration
├── setup.cfg                   # Additional metadata
├── pyproject.toml              # Modern Python packaging
├── MANIFEST.in                 # Include additional files
├── requirements.txt            # Runtime dependencies
├── requirements-dev.txt        # Development dependencies
├── README.md                   # Package documentation
├── LICENSE                     # License information
└── swarm_benchmark/            # Package source
    ├── __init__.py
    ├── __main__.py            # CLI entry point
    └── ...                    # Source modules
```

### Setup Configuration
```python
# setup.py
from setuptools import setup, find_packages

setup(
    name="swarm-benchmark",
    version="1.0.0",
    description="Agent swarm benchmarking tool for Claude Flow",
    long_description=open("README.md").read(),
    long_description_content_type="text/markdown",
    author="Claude Flow Team",
    author_email="support@claude-flow.dev",
    url="https://github.com/claude-flow/swarm-benchmark",
    packages=find_packages(),
    classifiers=[
        "Development Status :: 5 - Production/Stable",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    python_requires=">=3.8",
    install_requires=[
        "click>=8.0",
        "aiohttp>=3.8",
        "psutil>=5.9",
        "sqlite3",  # Built-in
        "pydantic>=1.10",
        "matplotlib>=3.5",
        "plotly>=5.0",
        "pandas>=1.4",
        "numpy>=1.21",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0",
            "pytest-cov>=4.0",
            "pytest-asyncio>=0.21",
            "pytest-benchmark>=4.0",
            "black>=22.0",
            "flake8>=5.0",
            "mypy>=1.0",
            "pre-commit>=2.20",
        ],
        "docs": [
            "sphinx>=5.0",
            "sphinx-rtd-theme>=1.0",
            "myst-parser>=0.18",
        ],
        "viz": [
            "seaborn>=0.11",
            "jupyter>=1.0",
            "ipywidgets>=8.0",
        ]
    },
    entry_points={
        "console_scripts": [
            "swarm-benchmark=swarm_benchmark.__main__:main",
            "swarm-bench=swarm_benchmark.__main__:main",
        ],
    },
    include_package_data=True,
    zip_safe=False,
)
```

### Modern Packaging (pyproject.toml)
```toml
[build-system]
requires = ["setuptools>=45", "wheel", "setuptools_scm[toml]>=6.2"]
build-backend = "setuptools.build_meta"

[project]
name = "swarm-benchmark"
dynamic = ["version"]
description = "Agent swarm benchmarking tool for Claude Flow"
readme = "README.md"
requires-python = ">=3.8"
license = {text = "MIT"}
authors = [
    {name = "Claude Flow Team", email = "support@claude-flow.dev"},
]
keywords = ["benchmark", "swarm", "agents", "performance", "testing"]
classifiers = [
    "Development Status :: 5 - Production/Stable",
    "Intended Audience :: Developers",
    "License :: OSI Approved :: MIT License",
    "Programming Language :: Python :: 3",
    "Programming Language :: Python :: 3.8",
    "Programming Language :: Python :: 3.9",
    "Programming Language :: Python :: 3.10",
    "Programming Language :: Python :: 3.11",
]

dependencies = [
    "click>=8.0",
    "aiohttp>=3.8",
    "psutil>=5.9",
    "pydantic>=1.10",
    "matplotlib>=3.5",
    "plotly>=5.0",
    "pandas>=1.4",
    "numpy>=1.21",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.0",
    "pytest-cov>=4.0",
    "pytest-asyncio>=0.21",
    "pytest-benchmark>=4.0",
    "black>=22.0",
    "flake8>=5.0",
    "mypy>=1.0",
    "pre-commit>=2.20",
]

[project.scripts]
swarm-benchmark = "swarm_benchmark.__main__:main"
swarm-bench = "swarm_benchmark.__main__:main"

[project.urls]
Homepage = "https://github.com/claude-flow/swarm-benchmark"
Documentation = "https://swarm-benchmark.readthedocs.io"
Repository = "https://github.com/claude-flow/swarm-benchmark"
Issues = "https://github.com/claude-flow/swarm-benchmark/issues"
```

## 🐳 Docker Deployment

### Dockerfile
```dockerfile
# Multi-stage build for optimization
FROM python:3.11-slim as builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir --user -r requirements.txt

# Production stage
FROM python:3.11-slim as production

# Create non-root user
RUN groupadd -r swarm && useradd -r -g swarm swarm

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Python packages from builder
COPY --from=builder /root/.local /home/swarm/.local

# Set up application
WORKDIR /app
COPY . .

# Change ownership to swarm user
RUN chown -R swarm:swarm /app
USER swarm

# Set environment variables
ENV PATH="/home/swarm/.local/bin:$PATH"
ENV PYTHONPATH="/app"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD swarm-benchmark --version || exit 1

# Default command
ENTRYPOINT ["swarm-benchmark"]
CMD ["--help"]
```

### Docker Compose
```yaml
version: '3.8'

services:
  swarm-benchmark:
    build: .
    container_name: swarm-benchmark
    environment:
      - BENCHMARK_CONFIG=/app/config/production.json
      - BENCHMARK_OUTPUT_DIR=/app/reports
    volumes:
      - ./config:/app/config:ro
      - ./reports:/app/reports
      - ./data:/app/data
    ports:
      - "8080:8080"  # If web interface is added
    networks:
      - swarm-network
    restart: unless-stopped
    
  database:
    image: postgres:14-alpine
    container_name: swarm-db
    environment:
      POSTGRES_DB: swarm_benchmark
      POSTGRES_USER: swarm
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - swarm-network
    restart: unless-stopped

volumes:
  postgres_data:

networks:
  swarm-network:
    driver: bridge
```

## ☁️ Cloud Deployment

### AWS Deployment
```yaml
# docker-compose.aws.yml
version: '3.8'

services:
  swarm-benchmark:
    image: ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/swarm-benchmark:latest
    environment:
      - AWS_DEFAULT_REGION=${AWS_REGION}
      - BENCHMARK_CONFIG=s3://swarm-benchmark-config/production.json
      - BENCHMARK_OUTPUT_DIR=s3://swarm-benchmark-reports/
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 4G
        reservations:
          cpus: '1.0'
          memory: 2G
```

### Kubernetes Deployment
```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: swarm-benchmark
  labels:
    app: swarm-benchmark
spec:
  replicas: 3
  selector:
    matchLabels:
      app: swarm-benchmark
  template:
    metadata:
      labels:
        app: swarm-benchmark
    spec:
      containers:
      - name: swarm-benchmark
        image: swarm-benchmark:latest
        ports:
        - containerPort: 8080
        env:
        - name: BENCHMARK_CONFIG
          valueFrom:
            configMapKeyRef:
              name: swarm-config
              key: config.json
        resources:
          limits:
            cpu: 2000m
            memory: 4Gi
          requests:
            cpu: 1000m
            memory: 2Gi
        livenessProbe:
          exec:
            command:
            - swarm-benchmark
            - --version
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - swarm-benchmark
            - status
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: swarm-benchmark-service
spec:
  selector:
    app: swarm-benchmark
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8080
  type: LoadBalancer
```

## 🔄 CI/CD Pipeline

### GitHub Actions
```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: [3.8, 3.9, 3.10, 3.11]
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Python ${{ matrix.python-version }}
      uses: actions/setup-python@v4
      with:
        python-version: ${{ matrix.python-version }}
    
    - name: Install dependencies
      run: |
        python -m pip install --upgrade pip
        pip install -r requirements.txt
        pip install -r requirements-dev.txt
    
    - name: Run tests
      run: |
        pytest --cov=swarm_benchmark --cov-report=xml
    
    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v3

  build:
    needs: test
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: 3.11
    
    - name: Build package
      run: |
        python -m pip install --upgrade pip build
        python -m build
    
    - name: Store package artifacts
      uses: actions/upload-artifact@v3
      with:
        name: python-package
        path: dist/

  publish-pypi:
    needs: build
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/')
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Download package artifacts
      uses: actions/download-artifact@v3
      with:
        name: python-package
        path: dist/
    
    - name: Publish to PyPI
      uses: pypa/gh-action-pypi-publish@release/v1
      with:
        password: ${{ secrets.PYPI_API_TOKEN }}

  build-docker:
    needs: test
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Set up Docker Buildx
      uses: docker/setup-buildx-action@v2
    
    - name: Login to DockerHub
      uses: docker/login-action@v2
      with:
        username: ${{ secrets.DOCKERHUB_USERNAME }}
        password: ${{ secrets.DOCKERHUB_TOKEN }}
    
    - name: Build and push
      uses: docker/build-push-action@v4
      with:
        context: .
        push: true
        tags: |
          swarmteam/swarm-benchmark:latest
          swarmteam/swarm-benchmark:${{ github.ref_name }}
        cache-from: type=gha
        cache-to: type=gha,mode=max
```

## 📋 Installation Methods

### PyPI Installation
```bash
# Install from PyPI
pip install swarm-benchmark

# Install with extras
pip install swarm-benchmark[dev,viz]

# Install from source
pip install git+https://github.com/claude-flow/swarm-benchmark.git
```

### Conda Installation
```yaml
# conda-recipe/meta.yaml
package:
  name: swarm-benchmark
  version: "1.0.0"

source:
  url: https://pypi.io/packages/source/s/swarm-benchmark/swarm-benchmark-1.0.0.tar.gz
  sha256: <hash>

build:
  number: 0
  script: python -m pip install . -vv
  entry_points:
    - swarm-benchmark = swarm_benchmark.__main__:main

requirements:
  host:
    - python >=3.8
    - pip
  run:
    - python >=3.8
    - click >=8.0
    - aiohttp >=3.8
    - psutil >=5.9

test:
  imports:
    - swarm_benchmark
  commands:
    - swarm-benchmark --help
```

### Homebrew Formula
```ruby
# Formula/swarm-benchmark.rb
class SwarmBenchmark < Formula
  desc "Agent swarm benchmarking tool for Claude Flow"
  homepage "https://github.com/claude-flow/swarm-benchmark"
  url "https://github.com/claude-flow/swarm-benchmark/archive/v1.0.0.tar.gz"
  sha256 "<hash>"
  license "MIT"

  depends_on "python@3.11"

  def install
    virtualenv_install_with_resources
  end

  test do
    system "#{bin}/swarm-benchmark", "--version"
  end
end
```

## 🔧 Configuration Management

### Environment-Specific Configs
```bash
# Development
export BENCHMARK_ENV=development
export BENCHMARK_CONFIG=./config/development.json
export BENCHMARK_LOG_LEVEL=DEBUG

# Staging
export BENCHMARK_ENV=staging
export BENCHMARK_CONFIG=./config/staging.json
export BENCHMARK_LOG_LEVEL=INFO

# Production
export BENCHMARK_ENV=production
export BENCHMARK_CONFIG=./config/production.json
export BENCHMARK_LOG_LEVEL=WARNING
```

### Configuration Templates
```json
{
  "environment": "production",
  "benchmark": {
    "timeout": 3600,
    "max_retries": 3,
    "parallel_limit": 20
  },
  "output": {
    "directory": "/var/lib/swarm-benchmark/reports",
    "formats": ["json", "sqlite"],
    "compression": true
  },
  "logging": {
    "level": "INFO",
    "file": "/var/log/swarm-benchmark.log",
    "rotate": true,
    "max_size": "100MB"
  },
  "claude_flow": {
    "endpoint": "https://api.claude-flow.com",
    "timeout": 300,
    "max_concurrent": 10
  }
}
```

## 📊 Monitoring and Observability

### Health Checks
```python
# swarm_benchmark/health.py
async def health_check():
    """Comprehensive health check endpoint"""
    checks = {
        "database": await check_database(),
        "claude_flow": await check_claude_flow_connection(),
        "filesystem": check_filesystem_access(),
        "memory": check_memory_usage(),
        "cpu": check_cpu_usage()
    }
    
    overall_status = all(checks.values())
    return {
        "status": "healthy" if overall_status else "unhealthy",
        "checks": checks,
        "timestamp": datetime.utcnow().isoformat()
    }
```

### Metrics Collection
```python
# Prometheus metrics
from prometheus_client import Counter, Histogram, Gauge

BENCHMARK_COUNTER = Counter('benchmark_total', 'Total benchmarks run')
BENCHMARK_DURATION = Histogram('benchmark_duration_seconds', 'Benchmark duration')
ACTIVE_BENCHMARKS = Gauge('benchmark_active', 'Currently active benchmarks')
```

## 🔐 Security Hardening

### Security Checklist
- [ ] Use non-root user in containers
- [ ] Scan images for vulnerabilities
- [ ] Implement resource limits
- [ ] Use secrets management
- [ ] Enable audit logging
- [ ] Regular security updates
- [ ] Network segmentation
- [ ] Access control policies

### Vulnerability Scanning
```bash
# Scan dependencies
safety check

# Scan code
bandit -r swarm_benchmark/

# Scan Docker image
docker scan swarmteam/swarm-benchmark:latest
```

## 📈 Performance Optimization

### Production Optimizations
- Use production WSGI server (gunicorn)
- Enable connection pooling
- Implement caching strategies
- Optimize database queries
- Use CDN for static assets
- Enable compression
- Monitor and tune JVM parameters

### Scaling Strategies
- Horizontal pod autoscaling (Kubernetes)
- Load balancing
- Database read replicas
- Distributed caching
- Async processing queues

This deployment guide provides comprehensive coverage for deploying the swarm benchmarking tool across various environments and platforms.