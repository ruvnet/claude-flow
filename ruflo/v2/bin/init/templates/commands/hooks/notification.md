# hook notification

Send coordination notifications and track important decisions.

## Usage

```bash
npx claude-flow hook notification [options]
```

## Options

- `--message, -m <text>` - Notification message
- `--level, -l <level>` - Message level (info/warning/error/success)
- `--telemetry` - Include in telemetry (default: true)
- `--broadcast` - Broadcast to all agents
- `--memory-store` - Store in memory

## Examples

### Basic notification

```bash
npx claude-flow hook notification --message "Completed authentication module"
```

### Warning notification

```bash
npx claude-flow hook notification -m "Potential security issue found" -l warning
```

### Broadcast to swarm

```bash
npx claude-flow hook notification -m "API refactoring started" --broadcast
```

### Decision tracking

```bash
npx claude-flow hook notification -m "Chose JWT over sessions for auth" --memory-store
```

## Features

### Message Levels

- **info** - General information
- **warning** - Important notices
- **error** - Error conditions
- **success** - Completion notices

### Telemetry Integration

- Tracks key events
- Records decisions
- Monitors progress
- Enables analytics

### Agent Broadcasting

- Notifies all agents
- Ensures coordination
- Shares context
- Prevents conflicts

### Memory Storage

- Persists decisions
- Creates audit trail
- Enables learning
- Maintains history

## Integration

This hook is used by agents for:

- Sharing progress updates
- Recording decisions
- Warning about issues
- Coordinating actions

Manual usage in agents:

```bash
# For coordination
npx claude-flow hook notification --message "Starting database migration" --broadcast --memory-store
```

## Output

Returns JSON with:

```json
{
  "message": "Completed authentication module",
  "level": "success",
  "timestamp": 1234567890,
  "telemetryRecorded": true,
  "broadcasted": false,
  "memoryKey": "notifications/success/auth-complete",
  "recipients": ["coordinator", "tester"],
  "acknowledged": true
}
```

## See Also

- `agent list` - View active agents
- `memory usage` - Memory storage
- `swarm monitor` - Real-time monitoring
- `telemetry` - Analytics tracking
