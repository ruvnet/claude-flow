# hook session-start

Initialize a new work session with context loading and environment setup.

## Usage

```bash
npx claude-flow hook session-start [options]
```

## Options

- `--session-id, -s <id>` - Unique session identifier
- `--restore-context` - Restore previous session context (default: true)
- `--load-preferences` - Load user preferences
- `--init-swarm` - Initialize swarm automatically
- `--telemetry` - Enable session telemetry

## Examples

### Basic session start

```bash
npx claude-flow hook session-start --session-id "dev-session-2024"
```

### With full restoration

```bash
npx claude-flow hook session-start -s "feature-auth" --restore-context --load-preferences
```

### Auto swarm initialization

```bash
npx claude-flow hook session-start -s "bug-fix-789" --init-swarm
```

### Telemetry enabled

```bash
npx claude-flow hook session-start -s "performance-opt" --telemetry
```

## Features

### Context Restoration

- Loads previous session state
- Restores open files
- Recovers task progress
- Maintains continuity

### Preference Loading

- User configuration
- Editor settings
- Tool preferences
- Custom shortcuts

### Swarm Initialization

- Auto-detects project type
- Spawns relevant agents
- Configures topology
- Prepares coordination

### Telemetry Setup

- Tracks session metrics
- Monitors performance
- Records patterns
- Enables analytics

## Integration

This hook is automatically called by Claude Code when:

- Starting a new conversation
- Beginning work session
- After Claude Code restart
- Switching projects

Manual usage in agents:

```bash
# At session start
npx claude-flow hook session-start --session-id "your-session" --restore-context
```

## Output

Returns JSON with:

```json
{
  "sessionId": "dev-session-2024",
  "restored": true,
  "previousSession": "dev-session-2023",
  "contextLoaded": {
    "files": 5,
    "tasks": 3,
    "memories": 12
  },
  "swarmInitialized": true,
  "topology": "hierarchical",
  "agentsReady": 6,
  "telemetryEnabled": true
}
```

## See Also

- `hook session-end` - Session cleanup
- `hook session-restore` - Manual restoration
- `swarm init` - Swarm initialization
- `memory usage` - Memory management
