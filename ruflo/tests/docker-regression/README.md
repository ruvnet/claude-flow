# Claude-Flow Deep Regression Test Suite

Comprehensive Docker-based test suite for verifying all Claude-Flow capabilities.

## Quick Start

```bash
# Run all tests
docker-compose up --build test-runner

# Run specific test categories
docker-compose up --build unit-tests
docker-compose up --build integration-tests
docker-compose up --build benchmark-tests
docker-compose up --build security-tests
```

## Test Categories

| Category | Tests | Description |
|----------|-------|-------------|
| CLI Commands | 30+ | All CLI commands and options |
| MCP Server | 35+ | MCP tools and protocol |
| Agents (54+) | 60+ | All agent types and spawn |
| Swarm | 45+ | Topologies and coordination |
| Hooks | 50+ | Self-learning and routing |
| Plugins | 70+ | RuVector WASM plugins |
| Security | 55+ | Security features and CVE |
| Memory | 50+ | AgentDB and HNSW |
| Workers | 60+ | Background workers |
| Performance | 45+ | Benchmarks and targets |
| Unit Tests | 424+ | V3 package tests |
| Integration | 65+ | E2E workflows |

**Total: 1000+ test cases**

## Directory Structure

```
tests/docker-regression/
├── Dockerfile              # Test environment
├── docker-compose.yml      # Orchestration
├── README.md               # This file
├── scripts/
│   ├── run-all-tests.sh    # Main runner
│   ├── test-cli-commands.sh
│   ├── test-mcp-server.sh
│   ├── test-agents.sh
│   ├── test-swarm.sh
│   ├── test-hooks.sh
│   ├── test-plugins.sh
│   ├── test-security.sh
│   ├── test-memory.sh
│   ├── test-workers.sh
│   ├── test-performance.sh
│   ├── run-unit-tests.sh
│   ├── run-integration-tests.sh
│   ├── run-benchmark-tests.sh
│   ├── run-security-tests.sh
│   └── test-utils.sh
├── fixtures/
│   ├── sample-code.ts
│   └── sample-patterns.json
└── reports/                # Generated reports
```

## Running Tests

### Full Suite

```bash
# Build and run all tests
docker-compose up --build

# Run with logs
docker-compose up --build 2>&1 | tee test-output.log

# Run in background
docker-compose up -d --build
docker-compose logs -f test-runner
```

### Individual Categories

```bash
# Unit tests only
docker-compose run --rm unit-tests

# Integration tests only
docker-compose run --rm integration-tests

# Security tests only
docker-compose run --rm security-tests

# Benchmark tests only
docker-compose run --rm benchmark-tests
```

### Without Docker

```bash
# Run locally (requires Node.js 18+)
cd tests/docker-regression
bash scripts/run-all-tests.sh
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEST_REPORT_PATH` | `/app/reports` | Report output directory |
| `CLAUDE_FLOW_MODE` | `test` | Operating mode |
| `CLAUDE_FLOW_MEMORY_PATH` | `/app/data` | Memory storage path |
| `CLAUDE_FLOW_LOG_LEVEL` | `debug` | Log verbosity |
| `CLAUDE_FLOW_MAX_AGENTS` | `15` | Max concurrent agents |
| `MCP_SERVER_HOST` | `mcp-server` | MCP server hostname |
| `MCP_SERVER_PORT` | `3000` | MCP server port |

## Reports

Reports are generated in `/app/reports` (or `./reports` locally):

- `regression_report_TIMESTAMP.json` - Full JSON report
- `summary_TIMESTAMP.txt` - Human-readable summary
- `benchmark_TIMESTAMP.json` - Performance metrics
- `security_TIMESTAMP.json` - Security scan results

## CI/CD Integration

### GitHub Actions

```yaml
jobs:
  regression-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Regression Tests
        run: |
          cd tests/docker-regression
          docker-compose up --build --exit-code-from test-runner
      - name: Upload Reports
        uses: actions/upload-artifact@v4
        with:
          name: test-reports
          path: tests/docker-regression/reports/
```

### GitLab CI

```yaml
regression-tests:
  stage: test
  script:
    - cd tests/docker-regression
    - docker-compose up --build --exit-code-from test-runner
  artifacts:
    paths:
      - tests/docker-regression/reports/
```

## Test Coverage

### V3 Packages

| Package | Tests | Pass Rate |
|---------|-------|-----------|
| @claude-flow/hooks | 112 | 100% |
| @claude-flow/plugins | 142 | 100% |
| @claude-flow/security | 47 | 100% |
| @claude-flow/swarm | 89 | 100% |
| @claude-flow/cli | 34 | 100% |

### Feature Coverage

- ✅ All 54+ agents
- ✅ All 7 swarm topologies
- ✅ All MCP tools (27+)
- ✅ All hooks commands
- ✅ All security features
- ✅ All memory operations
- ✅ All background workers (10)
- ✅ All performance targets

## Troubleshooting

### Docker Build Fails

```bash
# Clear Docker cache
docker-compose build --no-cache

# Check Docker resources
docker system df
docker system prune
```

### Tests Timeout

```bash
# Increase timeout
COMPOSE_HTTP_TIMEOUT=300 docker-compose up --build
```

### MCP Server Not Starting

```bash
# Check port availability
lsof -i :3000

# Run MCP server separately
docker-compose up mcp-server
```

### Memory Issues

```bash
# Reduce parallel tests
docker-compose up unit-tests
# Then run other categories separately
```

## Adding New Tests

1. Create test script in `scripts/test-<category>.sh`
2. Follow existing pattern with `run_test` function
3. Add to `run-all-tests.sh`
4. Update docker-compose.yml if needed
5. Document in this README

## License

MIT - Part of Claude-Flow
