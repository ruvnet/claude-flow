# Claude-Flow Deep Regression Test Suite
# Makefile for easy test execution

.PHONY: all build test clean unit integration security benchmark help

# Default target
all: test

# Build Docker image
build:
	docker-compose build

# Run all tests
test: build
	docker-compose up --exit-code-from test-runner test-runner

# Run unit tests only
unit: build
	docker-compose run --rm unit-tests

# Run integration tests only
integration: build
	docker-compose run --rm integration-tests

# Run security tests only
security: build
	docker-compose run --rm security-tests

# Run benchmark tests only
benchmark: build
	docker-compose run --rm benchmark-tests

# Start MCP server for manual testing
mcp-server: build
	docker-compose up mcp-server

# Run tests locally (without Docker)
local:
	bash scripts/run-all-tests.sh

# Run individual test categories locally
local-cli:
	bash scripts/test-cli-commands.sh

local-mcp:
	bash scripts/test-mcp-server.sh

local-agents:
	bash scripts/test-agents.sh

local-swarm:
	bash scripts/test-swarm.sh

local-hooks:
	bash scripts/test-hooks.sh

local-plugins:
	bash scripts/test-plugins.sh

local-security:
	bash scripts/test-security.sh

local-memory:
	bash scripts/test-memory.sh

local-workers:
	bash scripts/test-workers.sh

local-performance:
	bash scripts/test-performance.sh

# Clean up Docker resources
clean:
	docker-compose down -v --rmi local
	rm -rf reports/*

# View reports
reports:
	@ls -la reports/ 2>/dev/null || echo "No reports generated yet"

# View logs
logs:
	docker-compose logs -f

# Help
help:
	@echo "Claude-Flow Deep Regression Test Suite"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Docker Targets:"
	@echo "  all         - Run all tests (default)"
	@echo "  build       - Build Docker images"
	@echo "  test        - Run full test suite"
	@echo "  unit        - Run unit tests only"
	@echo "  integration - Run integration tests only"
	@echo "  security    - Run security tests only"
	@echo "  benchmark   - Run benchmark tests only"
	@echo "  mcp-server  - Start MCP server"
	@echo "  clean       - Clean up Docker resources"
	@echo "  logs        - View Docker logs"
	@echo ""
	@echo "Local Targets (no Docker):"
	@echo "  local           - Run all tests locally"
	@echo "  local-cli       - Run CLI tests"
	@echo "  local-mcp       - Run MCP tests"
	@echo "  local-agents    - Run agent tests"
	@echo "  local-swarm     - Run swarm tests"
	@echo "  local-hooks     - Run hooks tests"
	@echo "  local-plugins   - Run plugin tests"
	@echo "  local-security  - Run security tests"
	@echo "  local-memory    - Run memory tests"
	@echo "  local-workers   - Run worker tests"
	@echo "  local-performance - Run performance tests"
	@echo ""
	@echo "Other:"
	@echo "  reports     - List generated reports"
	@echo "  help        - Show this help message"
