# Claude Flow Hooks Documentation

## Overview

Claude Flow integrates with Claude Code's hook system to provide automated coordination, memory management, and performance optimization. These hooks execute at various points in Claude Code's lifecycle to enhance your development workflow.

## Hook Types

### PreToolUse Hooks

These hooks run **before** Claude Code executes specific tools:

#### 1. **Edit/MultiEdit Hook**
```json
{
  "matcher": "Edit|MultiEdit",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks pre-edit --file \"${CLAUDE_FLOW_FILE}\" --validate-syntax --auto-assign-agents",
    "blocking": false
  }]
}
```
- **Purpose**: Validates syntax and automatically assigns appropriate agents based on file type
- **Blocking**: No (runs in background)
- **Features**:
  - Syntax validation before edits
  - Auto-assigns specialized agents (e.g., Python agent for .py files)
  - Loads relevant context from memory

#### 2. **Write Hook**
```json
{
  "matcher": "Write",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks pre-write --file \"${CLAUDE_FLOW_FILE}\" --prepare-directory",
    "blocking": true
  }]
}
```
- **Purpose**: Ensures directory structure exists before writing files
- **Blocking**: Yes (prevents write failures)
- **Features**:
  - Creates parent directories if needed
  - Checks permissions
  - Validates file paths

#### 3. **Bash Hook**
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
- **Purpose**: Validates command safety before execution
- **Blocking**: Yes (prevents dangerous commands)
- **Features**:
  - Checks against deny list
  - Validates command syntax
  - Prepares execution environment

#### 4. **Task Hook**
```json
{
  "matcher": "Task",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks pre-task --description \"${CLAUDE_FLOW_TASK}\" --auto-spawn-agents --optimize-topology",
    "blocking": false
  }]
}
```
- **Purpose**: Optimizes swarm topology and spawns agents for complex tasks
- **Blocking**: No (optimization runs in parallel)
- **Features**:
  - Analyzes task complexity
  - Auto-spawns required agents
  - Selects optimal swarm topology

### PostToolUse Hooks

These hooks run **after** Claude Code completes tool execution:

#### 1. **File Operation Hooks**
```json
{
  "matcher": "Edit|MultiEdit|Write",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks post-edit --file \"${CLAUDE_FLOW_FILE}\" --format-code --update-memory --train-neural"
  }]
}
```
- **Features**:
  - Auto-formats code based on file type
  - Updates memory with changes
  - Trains neural patterns from edits
  - Tracks file modification history

#### 2. **Command Execution Hooks**
```json
{
  "matcher": "Bash",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks post-command --command \"${CLAUDE_FLOW_COMMAND}\" --track-metrics --store-results"
  }]
}
```
- **Features**:
  - Tracks command execution time
  - Stores command output
  - Updates performance metrics
  - Logs for audit trail

#### 3. **Task Completion Hooks**
```json
{
  "matcher": "Task",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks post-task --task-id \"${CLAUDE_FLOW_TASK_ID}\" --analyze-performance --update-telemetry"
  }]
}
```
- **Features**:
  - Analyzes task performance
  - Updates telemetry data
  - Identifies bottlenecks
  - Stores task results

#### 4. **Search Operation Hooks**
```json
{
  "matcher": "Read|Grep|Glob",
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks post-search --pattern \"${CLAUDE_FLOW_PATTERN}\" --cache-results --optimize-future"
  }]
}
```
- **Features**:
  - Caches search results
  - Optimizes future searches
  - Tracks search patterns
  - Improves performance

### Notification Hook

Handles system notifications and broadcasts to agents:

```json
{
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks notification --message \"${CLAUDE_FLOW_MESSAGE}\" --update-status --broadcast-agents"
  }]
}
```
- **Features**:
  - Updates swarm status
  - Broadcasts to all agents
  - Logs important events
  - Triggers reactive behaviors

### Stop Hook

Executes when the main Claude Code session ends:

```json
{
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks session-end --generate-summary --persist-state --export-metrics --cleanup-temp"
  }]
}
```
- **Features**:
  - Generates session summary
  - Persists session state
  - Exports performance metrics
  - Cleans up temporary files

### SubagentStop Hook

Executes when a spawned agent completes its task:

```json
{
  "hooks": [{
    "type": "command",
    "command": "npx claude-flow hooks agent-stop --agent-id \"${CLAUDE_FLOW_AGENT_ID}\" --save-knowledge --update-swarm-status"
  }]
}
```
- **Features**:
  - Saves agent knowledge
  - Updates swarm status
  - Releases resources
  - Transfers learnings

## Environment Variables

Hooks have access to context-specific environment variables:

- `${CLAUDE_FLOW_FILE}` - The file being operated on
- `${CLAUDE_FLOW_COMMAND}` - The bash command being executed
- `${CLAUDE_FLOW_TASK}` - The task description
- `${CLAUDE_FLOW_TASK_ID}` - Unique task identifier
- `${CLAUDE_FLOW_PATTERN}` - Search pattern used
- `${CLAUDE_FLOW_MESSAGE}` - Notification message
- `${CLAUDE_FLOW_AGENT_ID}` - Agent identifier

## Customization

You can customize hooks by editing `.claude/settings.json`:

1. **Disable specific hooks**: Remove or comment out hook entries
2. **Add custom hooks**: Add new matchers and commands
3. **Change blocking behavior**: Set `"blocking": true/false`
4. **Modify commands**: Update command parameters

## Security Considerations

- Hooks run with full user permissions
- Commands are validated against allow/deny lists
- Blocking hooks can prevent tool execution
- Always review hook commands before enabling

## Troubleshooting

If hooks are causing issues:

1. **Disable all hooks temporarily**:
   ```bash
   export CLAUDE_FLOW_HOOKS_ENABLED=false
   ```

2. **Check hook logs**:
   ```bash
   npx claude-flow logs hooks --tail 50
   ```

3. **Test individual hooks**:
   ```bash
   npx claude-flow hooks test pre-edit --file test.js
   ```

4. **Reset to defaults**:
   ```bash
   npx claude-flow init --force
   ```

## Performance Impact

- Non-blocking hooks run in parallel (minimal impact)
- Blocking hooks add latency to tool execution
- Caching hooks improve performance over time
- Neural training happens asynchronously

## Best Practices

1. **Keep hooks lightweight** - Heavy processing should be non-blocking
2. **Use caching** - Leverage cache hooks for repeated operations
3. **Monitor performance** - Check metrics regularly
4. **Test changes** - Validate hook modifications before deployment
5. **Document custom hooks** - Add comments explaining custom behaviors