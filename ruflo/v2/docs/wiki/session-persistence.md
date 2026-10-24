# Session Persistence in Claude Code

## Overview

Claude Code provides sophisticated session persistence that goes beyond simple conversation history. It maintains complete development environment state including background processes, file contexts, permissions, and working directories.

## Session Commands

### Core Commands

| Command | Description | Example |
|---------|-------------|---------|
| `claude --continue` | Continue the most recent conversation | `claude --continue` |
| `claude --resume` | Resume a specific session (interactive selection) | `claude --resume` |
| `claude --resume <id>` | Resume a specific session by ID | `claude --resume abc123-def456` |
| `claude --session-id <uuid>` | Start with a specific session ID | `claude --session-id my-custom-id` |

## What Gets Persisted

### 1. Conversation History
- **Full message history** between user and Claude
- **Tool call records** with parameters and responses
- **Context from previous interactions**
- **File references and modifications**

### 2. Background Processes

Background tasks started with `run_in_background: true` persist across sessions:

```bash
# Example: Server started in one session
python3 -m http.server 8080  # bash_3

# After --continue or --resume:
# - Process still running
# - Shell ID preserved (bash_3)
# - Can check output with BashOutput tool
# - Can kill with KillBash tool
```

**Verified Test Results:**
- Background processes continue running after session ends
- Shell IDs (bash_1, bash_2, etc.) are preserved
- Output buffers maintained for incremental reading
- Process state tracked (running/completed/killed)

### 3. File Context

Claude remembers which files have been accessed:

```bash
# Files read with Read tool
# Files edited with Edit tool
# Files created with Write tool
# All remembered across sessions
```

**Test Example:**
```bash
# Session 1: Create a marker file
claude> Write test-session-marker.txt

# Session 2: Claude knows about the file without re-reading
claude --continue
claude> "What's in test-session-marker.txt?"
# Claude can reference it from memory
```

### 4. Working Directory Context

```bash
# Current working directory preserved
# Environment state maintained
# Path contexts remembered
```

### 5. Tool Permissions

Permissions granted in one session carry over:

```bash
# First session: Approve Bash tool for git commands
# Subsequent sessions: No re-approval needed for same patterns
```

## Incremental Output Tracking

The `BashOutput` tool maintains read positions:

```bash
# First check of bash_6
BashOutput(bash_6) → Shows lines 1-10

# Second check (even after session resume)
BashOutput(bash_6) → Shows only NEW lines 11-20

# Prevents duplicate output display
```

## Session Storage

### Location
Sessions are stored locally on the machine (exact path varies by OS):
- Likely in `~/.config/claude/` or similar
- Each session has a unique identifier
- Automatic cleanup of old sessions

### Session Structure
```javascript
{
  "sessionId": "abc123-def456",
  "startTime": "2025-08-11T22:00:00Z",
  "lastActive": "2025-08-11T22:27:00Z",
  "messages": [...],
  "backgroundTasks": {
    "bash_3": {
      "command": "python3 -m http.server 8080",
      "status": "running",
      "pid": 295416,
      "outputPosition": 1234
    }
  },
  "fileContext": {
    "read": ["file1.txt", "file2.js"],
    "modified": ["config.json"],
    "created": ["test-marker.txt"]
  },
  "permissions": {
    "approvedTools": ["Bash(git:*)", "Edit"],
    "directories": ["/workspaces/project"]
  }
}
```

## Practical Examples

### Example 1: Development Server Management

```bash
# Monday: Start development
claude
> Start npm run dev in background
> Start docker-compose up in background
> Work on features...
> Exit (servers keep running)

# Tuesday: Continue work
claude --continue
> Check status of npm run dev  # Still running!
> Show docker logs  # Can see all output
> Continue development...
```

### Example 2: Long-Running Build

```bash
# Start a long build
claude
> Run build script in background
> Exit for lunch

# Return and check progress
claude --continue
> Check build output  # See what happened while away
> Build completed? Check exit code
```

### Example 3: Debug Session

```bash
# Complex debugging session
claude
> Set up monitoring in background
> Create test files
> Run diagnostics
> [System crash/need to leave]

# Resume exactly where left off
claude --resume
> All background monitors still running
> Test files still in context
> Continue debugging from exact point
```

## Best Practices

### 1. Session Management

**DO:**
- Use `--continue` for same-day work continuity
- Use `--resume` when you need a specific past session
- Name sessions meaningfully with `--session-id`
- Clean up background tasks before extended breaks

**DON'T:**
- Leave unnecessary background tasks running for days
- Rely on sessions older than a week (may be cleaned up)
- Assume background processes survive system reboots

### 2. Background Task Management

```bash
# Before ending a session, check background tasks
/bashes  # List all background tasks

# Clean up if needed
"Kill all background tasks except the dev server"

# Or selectively
"Kill bash_1 and bash_2 but keep bash_3"
```

### 3. Context Preservation

```bash
# Create a session marker for complex work
"Create SESSION_NOTES.md with current context"

# Helps both you and Claude remember the context
"Update SESSION_NOTES.md with progress"
```

## Limitations

### 1. System Boundaries
- Sessions are **local to the machine**
- Don't survive system reboots
- Can't transfer between machines

### 2. Process Limitations
- Background processes may be killed by OS for resources
- Very long-idle processes may timeout
- Output buffers have size limits

### 3. Security Boundaries
- File permissions re-checked on resume
- New sensitive operations require re-approval
- Directory access validated each session

## Advanced Features

### Session Branching

You can resume the same session multiple times:

```bash
# Original work
claude --session-id project-main

# Branch 1: Try approach A
claude --resume project-main
# Work on approach A

# Branch 2: Try approach B  
claude --resume project-main
# Work on approach B
# Both branches have the same starting context
```

### Partial Recovery

Even if a session is partially corrupted:
- Conversation history usually recoverable
- File context often intact
- Background tasks may need restart

### Auto-Cleanup

Claude Code automatically manages sessions:
- Old sessions pruned after time limit
- Configurable retention period
- Automatic compression for large sessions

## Troubleshooting

### Issue: Background task not found after resume

```bash
# Check if process still exists
ps aux | grep <command>

# If process died, restart it
"Restart the dev server that was in bash_3"
```

### Issue: Session won't resume

```bash
# Try continue instead
claude --continue

# List recent sessions
claude --resume  # Interactive selection

# Start fresh if needed
claude  # New session
```

### Issue: Permissions not remembered

```bash
# Permissions may expire for security
# Simply re-approve when prompted
# Or use --dangerously-skip-permissions for development
```

## Verification Tests

The following features have been tested and verified:

✅ **Background Task Persistence**
- Started `python3 -m http.server 8080` as bash_3
- Session continued, server still running
- Process verified with `ps aux`

✅ **Shell ID Preservation**
- Background task IDs (bash_1, bash_2, etc.) maintained
- Can reference same IDs after resume

✅ **Incremental Output**
- BashOutput only returns new output since last check
- Position markers maintained across sessions

✅ **File Context Memory**
- Files created/edited in session remembered
- No need to re-read files after resume

✅ **Multiple Background Tasks**
- Can run multiple background processes
- All tracked independently
- Each maintains its own state

## Related Documentation

- [Background Commands Guide](./background-commands.md)
- [Claude Code CLI Reference](https://docs.anthropic.com/claude-code/cli)
- [MCP Tools Documentation](./mcp-tools.md)

---

*Last updated: August 2025*
*Verified with Claude Code latest version*