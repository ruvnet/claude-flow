# Claude Flow Hooks Overview

## What Are Hooks?

Claude Flow hooks are automated commands that execute at specific points in Claude Code's lifecycle. They provide deterministic control over Claude Code's behavior, enabling automated workflows for validation, formatting, memory management, and performance optimization.

## Quick Start

Hooks are already configured in `.claude/settings.json`. To enable them:

```bash
# Enable hooks globally
export CLAUDE_FLOW_HOOKS_ENABLED=true

# Or update settings.json
"env": {
  "CLAUDE_FLOW_HOOKS_ENABLED": "true"
}
```

## Available Hook Types

### 1. PreToolUse Hooks
Execute **before** Claude Code runs a tool:

- **Edit/MultiEdit**: Validates syntax, assigns agents
- **Write**: Creates directories, checks permissions
- **Bash**: Validates command safety
- **Task**: Optimizes topology, spawns agents

### 2. PostToolUse Hooks
Execute **after** tool completion:

- **File Operations**: Formats code, updates memory
- **Commands**: Tracks metrics, stores results
- **Tasks**: Analyzes performance, updates telemetry
- **Searches**: Caches results, optimizes patterns

### 3. Notification Hooks
Handle system notifications:
- Broadcasts to agents
- Updates swarm status
- Logs important events

### 4. Stop Hooks
Execute when session ends:
- Generates summary
- Persists state
- Exports metrics
- Cleans up temp files

### 5. SubagentStop Hooks
Execute when agents complete:
- Saves agent knowledge
- Updates swarm status
- Transfers learnings

## Hook Configuration

### Basic Structure
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|MultiEdit",
        "hooks": [{
          "type": "command",
          "command": "npx claude-flow hooks pre-edit --file \"${CLAUDE_FLOW_FILE}\"",
          "blocking": false
        }]
      }
    ]
  }
}
```

### Environment Variables
- `${CLAUDE_FLOW_FILE}` - Current file path
- `${CLAUDE_FLOW_COMMAND}` - Bash command being executed
- `${CLAUDE_FLOW_TASK}` - Task description
- `${CLAUDE_FLOW_TASK_ID}` - Unique task ID
- `${CLAUDE_FLOW_PATTERN}` - Search pattern
- `${CLAUDE_FLOW_MESSAGE}` - Notification message
- `${CLAUDE_FLOW_AGENT_ID}` - Agent identifier

## Common Use Cases

### 1. Auto-Format on Save
```json
{
  "matcher": "Edit|MultiEdit|Write",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks post-edit --file \"${CLAUDE_FLOW_FILE}\" --format-code"
  }]
}
```

### 2. Command Safety Validation
```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks pre-command --command \"${CLAUDE_FLOW_COMMAND}\" --validate-safety",
    "blocking": true
  }]
}
```

### 3. Auto-Spawn Agents for Tasks
```json
{
  "matcher": "Task",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks pre-task --description \"${CLAUDE_FLOW_TASK}\" --auto-spawn-agents"
  }]
}
```

### 4. Performance Tracking
```json
{
  "matcher": ".*",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks post-command --track-metrics"
  }]
}
```

## Best Practices

### 1. Use Non-Blocking for Performance
```json
{
  "blocking": false  // Runs in background
}
```

### 2. Block Critical Operations
```json
{
  "matcher": "Bash",
  "blocking": true  // Prevents dangerous commands
}
```

### 3. Cache Frequently Used Data
```json
{
  "command": "npx claude-flow hooks post-search --cache-results"
}
```

### 4. Keep Hooks Lightweight
- Avoid heavy processing in blocking hooks
- Use async operations where possible
- Cache results to avoid repeated work

## Troubleshooting

### Disable Hooks Temporarily
```bash
export CLAUDE_FLOW_HOOKS_ENABLED=false
```

### Check Hook Logs
```bash
npx claude-flow logs hooks --tail 50
```

### Test Individual Hooks
```bash
npx claude-flow hooks pre-edit --file test.js
```

### Reset to Defaults
```bash
npx claude-flow init --force
```

## Security Considerations

1. **Full Permissions**: Hooks run with user permissions
2. **Command Validation**: Pre-command hooks validate safety
3. **Blocking Behavior**: Can prevent tool execution
4. **Review Commands**: Always review hook commands

## Performance Impact

- **Non-blocking hooks**: Minimal impact (run in parallel)
- **Blocking hooks**: Add latency to operations
- **Caching hooks**: Improve performance over time
- **Neural training**: Happens asynchronously

## Advanced Configuration

### Custom Hook Commands
```json
{
  "hooks": [{
    "type": "command",
    "command": "/path/to/custom/script.sh",
    "args": ["--file", "${CLAUDE_FLOW_FILE}"]
  }]
}
```

### Conditional Hooks
```json
{
  "matcher": ".*\\.py$",  // Python files only
  "hooks": [{
    "command": "npx claude-flow hooks python-lint --file \"${CLAUDE_FLOW_FILE}\""
  }]
}
```

### Chain Multiple Hooks
```json
{
  "hooks": [
    {
      "command": "npx claude-flow hooks validate --file \"${CLAUDE_FLOW_FILE}\""
    },
    {
      "command": "npx claude-flow hooks format --file \"${CLAUDE_FLOW_FILE}\""
    }
  ]
}
```

## Integration with Claude Flow Features

Hooks integrate seamlessly with:
- **Memory System**: Auto-saves context
- **Neural Training**: Learns from patterns
- **Swarm Coordination**: Auto-assigns agents
- **GitHub Integration**: Tracks changes
- **Performance Monitoring**: Collects metrics

For detailed hook documentation, see the individual command docs in this directory.