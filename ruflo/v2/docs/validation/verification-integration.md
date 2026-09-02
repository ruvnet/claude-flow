# Verification System Integration Guide

## Overview

The verification system provides real-time validation of agent work and task execution. It integrates with swarm commands, non-interactive mode, and the training system.

## How It Actually Works

### 1. **Pre-Task Verification**
Before any task executes, the system checks:
- Git repository state (clean/dirty)
- Dependencies installed
- Environment ready

### 2. **Post-Task Verification**
After task completion, it verifies:
- Code compiles (TypeScript/JavaScript)
- Tests pass
- Linting succeeds
- Documentation exists (for architect agents)

### 3. **Automatic Rollback**
If verification fails and rollback is enabled:
- Resets to last git commit
- Preserves verification history
- Feeds failure data to training system

## Integration with Commands

### Swarm Command with Verification

```bash
# Enable verification for swarm execution
export VERIFICATION_MODE=strict
export VERIFICATION_ROLLBACK=true

# Run swarm with verification hooks
claude-flow swarm "Build REST API" --verify

# The swarm will:
# 1. Run pre-task verification
# 2. Execute the objective
# 3. Run post-task verification
# 4. Rollback if verification fails
```

### Non-Interactive Mode with Verification

```bash
# Non-interactive with verification
claude-flow swarm "Build feature" \
  -p \
  --output-format stream-json \
  --verify \
  --threshold 0.95

# Verification results appear in JSON output
```

### Manual Verification

```bash
# Pre-task check
node src/cli/simple-commands/verification-hooks.js pre task-123 coder

# Post-task check
node src/cli/simple-commands/verification-hooks.js post task-123 coder

# Feed to training
node src/cli/simple-commands/verification-hooks.js train task-123 coder

# Check status
node src/cli/simple-commands/verification-hooks.js status
```

## Integration with Training System

Verification results automatically feed into the training system:

```bash
# View training data
cat .claude-flow/training/verification-data.jsonl

# Sample output:
{"taskId":"task-123","agentType":"coder","preScore":1,"postScore":0.75,"success":false,"timestamp":"2025-01-12T15:00:00Z"}
```

## Verification Scores

| Agent Type | Checks Performed | Threshold |
|------------|-----------------|-----------|
| coder | typecheck, tests, lint | 0.85 |
| researcher | output completeness | 0.85 |
| tester | coverage threshold | 0.85 |
| architect | documentation exists | 0.85 |

## Environment Variables

```bash
# Set verification mode (strict/moderate/development)
export VERIFICATION_MODE=strict

# Enable automatic rollback on failure
export VERIFICATION_ROLLBACK=true

# Custom threshold (0.0-1.0)
export VERIFICATION_THRESHOLD=0.95
```

## Real Example: Verifying a Coder Agent

```bash
# 1. Initialize verification
./claude-flow verify init strict

# 2. Run a coder task with verification
./claude-flow swarm "Implement user authentication" --verify

# Output:
🔍 Pre-task verification: swarm-123 (coder)
  ✅ git-status: 1.00
  ✅ npm-deps: 1.00
✅ Pre-task verification passed (1.00)

[... task execution ...]

🔍 Post-task verification: swarm-123 (coder)
  ✅ typecheck: 1.00
  ❌ tests: 0.40
  ✅ lint: 0.80
❌ Post-task verification failed (0.73 < 0.95)
🔄 Attempting rollback...
✅ Rollback completed
```

## Verification Memory

Verification results are stored in `.swarm/verification-memory.json`:

```json
{
  "history": [
    {
      "taskId": "swarm-123",
      "phase": "post",
      "passed": false,
      "score": 0.73,
      "checks": [
        {"name": "typecheck", "passed": true, "score": 1.0},
        {"name": "tests", "passed": false, "score": 0.4},
        {"name": "lint", "passed": true, "score": 0.8}
      ],
      "agentType": "coder",
      "timestamp": "2025-01-12T15:30:00Z"
    }
  ],
  "tasks": {
    "swarm-123": {
      "pre": {"passed": true, "score": 1.0},
      "post": {"passed": false, "score": 0.73}
    }
  }
}
```

## Current Limitations

1. **Not Yet Fully Integrated**: The verification hooks exist but aren't automatically called by all commands yet
2. **Basic Checks**: Currently runs simple npm scripts, not deep code analysis
3. **Manual Setup**: Requires environment variables to be set manually
4. **Limited Agent Types**: Only 4 agent types have specific verification logic

## Future Improvements

1. **Deep Integration**: Automatic verification for all agent operations
2. **Smart Rollback**: Selective rollback of only failed changes
3. **Learning System**: Use verification history to improve agent selection
4. **Custom Checks**: Allow project-specific verification rules
5. **Real-time Monitoring**: Dashboard showing verification metrics

## Using Verification Today

While not fully integrated, you can use verification today by:

1. Running verification hooks manually before/after tasks
2. Setting environment variables for automatic checks
3. Using the `--verify` flag with swarm commands (when implemented)
4. Checking verification history with `truth` command

The verification system provides the foundation for ensuring quality in AI-generated code, even if it's not yet fully automated.