# hook session-restore

Restore a previous session's context and state.

## Usage

```bash
npx claude-flow hook session-restore [options]
```

## Options

- `--session-id, -s <id>` - Session ID to restore
- `--load-memory` - Load session memories (default: true)
- `--restore-files` - Reopen previous files
- `--resume-tasks` - Continue incomplete tasks
- `--merge-context` - Merge with current context

## Examples

### Basic session restore

```bash
npx claude-flow hook session-restore --session-id "dev-session-2024"
```

### Full restoration

```bash
npx claude-flow hook session-restore -s "feature-auth" --load-memory --restore-files --resume-tasks
```

### Selective restore

```bash
npx claude-flow hook session-restore -s "bug-fix-123" --load-memory --resume-tasks
```

### Context merging

```bash
npx claude-flow hook session-restore -s "refactor-api" --merge-context
```

## Features

### Memory Loading

- Retrieves stored decisions
- Loads implementation notes
- Restores agent configs
- Recovers context

### File Restoration

- Lists previously open files
- Suggests file reopening
- Maintains edit history
- Preserves cursor positions

### Task Resumption

- Shows incomplete tasks
- Restores task progress
- Loads task dependencies
- Continues workflows

### Context Merging

- Combines sessions
- Merges memories
- Unifies task lists
- Prevents conflicts

## Integration

This hook is automatically called by Claude Code when:

- Resuming previous work
- After unexpected shutdown
- Loading saved sessions
- Switching between projects

Manual usage in agents:

```bash
# To restore context
npx claude-flow hook session-restore --session-id "previous-session" --load-memory
```

## Output

Returns JSON with:

```json
{
  "sessionId": "dev-session-2024",
  "restored": true,
  "memories": 25,
  "files": ["src/auth/login.js", "src/api/users.js"],
  "tasks": {
    "incomplete": 3,
    "completed": 12
  },
  "context": {
    "project": "auth-system",
    "branch": "feature/oauth"
  },
  "warnings": []
}
```

## See Also

- `hook session-start` - New session setup
- `hook session-end` - Session cleanup
- `memory usage` - Memory operations
- `task status` - Task checking
