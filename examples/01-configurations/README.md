# Configuration Examples

This directory contains configuration files for Claude Flow system settings and orchestration, organized by complexity and use case.

## Directory Structure

```
01-configurations/
├── basic/              # Simple configurations for getting started
├── minimal/            # Bare minimum configs
├── advanced/           # Production-ready configurations
├── specialized/        # Task-specific configurations
└── development-config.json  # Original comprehensive example
```

## Configuration Categories

### Basic Configurations (`basic/`)
- **simple-config.json**: Getting started configuration with essential settings
  ```bash
  cd examples
  ../claude-flow orchestrate --config ./01-configurations/basic/simple-config.json workflow.json
  ```

### Minimal Configurations (`minimal/`)
- **minimal-config.json**: Absolute minimum required - uses defaults for everything else
  ```bash
  ../claude-flow sparc run tdd "create feature" --config ./01-configurations/minimal/minimal-config.json
  ```

### Advanced Configurations (`advanced/`)
- **production-config.json**: Enterprise-ready with Redis, monitoring, security, and load balancing
  ```bash
  ../claude-flow orchestrate --config ./01-configurations/advanced/production-config.json workflow.json
  ```

### Specialized Configurations (`specialized/`)
- **research-config.json**: Optimized for research tasks with custom tools and memory schemas
- **testing-config.json**: Test generation and execution with coverage requirements
  ```bash
  ../claude-flow test generate --config ./01-configurations/specialized/testing-config.json src/
  ```

## Legacy File

### development-config.json
The original comprehensive configuration example showing all available options:
```bash
../claude-flow orchestrate --config ./01-configurations/development-config.json workflow.json
```

## Configuration Sections

### Orchestrator
- `model`: Claude model to use (e.g., "claude-sonnet-4-20250514")
- `temperature`: Creativity level (0.0-1.0)
- `maxTokens`: Maximum response length
- `timeout`: Operation timeout in milliseconds

### Memory
- `backend`: Storage type ("json", "sqlite", "redis")
- `location`: Where to store memory data
- `maxEntries`: Maximum number of entries
- `compressionLevel`: Data compression (0-9)

### Coordination
- `mode`: How agents coordinate ("direct", "hub-spoke", "mesh")
- `maxRetries`: Failed task retry attempts
- `retryDelay`: Wait time between retries

### Logging
- `level`: Detail level ("debug", "info", "warn", "error")
- `format`: Output format ("json", "text", "pretty")
- `destination`: Where logs go ("console", "file", "both")