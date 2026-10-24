# Real Claude Flow Execution Configuration

## Overview
The benchmark system is configured to use real claude-flow commands without any simulations.

## Current Status

### ✅ Working Commands

#### SPARC Commands
All SPARC modes work correctly and produce real output:
- `sparc spec` - Specification mode
- `sparc architect` - Architecture mode  
- `sparc tdd` - Test-driven development mode
- `sparc integration` - Integration mode
- `sparc refactor` - Refactoring mode

Example:
```bash
swarm-benchmark real sparc tdd "Create a function" --timeout 1
```

### ⚠️ Commands Requiring Claude CLI

#### Swarm Command
The `swarm` command requires Claude CLI even with `--executor` flag:
```bash
# This will timeout without Claude CLI installed
swarm-benchmark real swarm "Create API" --strategy development
```

To install Claude CLI:
```bash
npm install -g @anthropic-ai/claude-code
```

#### Hive-Mind Command
Similar to swarm, requires Claude CLI for execution.

## Configuration

### Non-Interactive Defaults
All commands are configured to run non-interactively by default:

1. **SPARC**: Runs without user interaction, produces workflow information
2. **Swarm**: Uses `--executor` flag (requires Claude CLI)
3. **Hive-Mind**: Uses `--executor` flag (requires Claude CLI)

### Benchmark Configuration
```python
# In benchmark/src/swarm_benchmark/core/claude_flow_real_executor.py
class RealClaudeFlowExecutor:
    def __init__(self, force_non_interactive=True):
        # Always uses non-interactive mode
```

### Command Execution
All commands use real claude-flow binary at `/workspaces/claude-code-flow/claude-flow`

## Testing Real Execution

### Test SPARC (Works without Claude CLI)
```bash
# Test different SPARC modes
swarm-benchmark real sparc spec "Design a system"
swarm-benchmark real sparc tdd "Create a calculator"
swarm-benchmark real sparc architect "Design API structure"
```

### Test with Process Tracking
```bash
# View detailed execution metrics
swarm-benchmark real sparc tdd "Build feature" --output-dir ./my-reports
cat ./my-reports/sparc_tdd_*.json
```

## No Simulations
The system has been updated to:
- ❌ Remove all simulation/fallback code
- ✅ Always use real claude-flow commands
- ✅ Report actual command output
- ✅ Track real execution metrics

## Limitations
1. **Claude CLI Dependency**: Swarm and hive-mind commands require Claude CLI
2. **Non-Interactive Only**: Interactive mode is not supported in benchmarks
3. **Timeout Handling**: Commands that require Claude CLI will timeout if not installed

## Recommended Usage
For benchmarking without Claude CLI, use SPARC commands which provide real workflow information and execution metrics.