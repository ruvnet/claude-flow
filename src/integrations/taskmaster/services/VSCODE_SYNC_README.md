# VS Code Extension Sync for TaskMaster

## Overview

The VS Code Extension Sync functionality enables real-time bidirectional synchronization between the Claude-Flow CLI and the TaskMaster VS Code extension. This allows developers to seamlessly work with tasks in both environments.

## Features

- **Real-time Sync**: Changes made in either CLI or VS Code are instantly synchronized
- **WebSocket Communication**: Low-latency, bidirectional communication protocol
- **Conflict Resolution**: Intelligent handling of concurrent edits
- **PRD Integration**: Parse PRDs directly from VS Code and generate tasks
- **Offline Support**: Queue changes when disconnected and sync when reconnected
- **Multiple Client Support**: Multiple VS Code instances can connect simultaneously

## Quick Start

### 1. Start the Sync Service

```bash
# Start sync service with default settings
claude-flow taskmaster sync start

# Start with custom configuration
claude-flow taskmaster sync start --port 8765 --strategy newest_wins
```

### 2. Connect from VS Code

The TaskMaster VS Code extension will automatically connect to the sync service when available.

### 3. Check Status

```bash
# View sync status
claude-flow taskmaster sync status

# View detailed status with pending changes
claude-flow taskmaster sync status --json
```

## CLI Commands

### Sync Service Management

```bash
# Start sync service
claude-flow taskmaster sync start [options]
  --port <port>          Port to listen on (default: 8765)
  --host <host>          Host to bind to (default: localhost)
  --no-websocket         Disable WebSocket server
  --no-http              Disable HTTP server
  --interval <ms>        Auto-sync interval (default: 5000ms)
  --strategy <strategy>  Conflict resolution strategy
  --token <token>        Authentication token

# Stop sync service
claude-flow taskmaster sync stop

# Trigger manual sync
claude-flow taskmaster sync trigger [--force]

# Configure sync settings
claude-flow taskmaster sync config
  --show                 Show current configuration
  --set-strategy <s>     Set conflict resolution strategy
  --set-interval <ms>    Set auto-sync interval
  --set-token <token>    Set authentication token
```

## Conflict Resolution Strategies

1. **cli_wins**: CLI changes take precedence
2. **vscode_wins**: VS Code changes take precedence
3. **newest_wins**: Most recent update wins (default)
4. **manual**: Require manual conflict resolution

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│   Claude-Flow   │ ◄──────────────────► │  VS Code Ext.   │
│      CLI        │                      │                  │
├─────────────────┤                      ├──────────────────┤
│  Sync Service   │                      │  Sync Client     │
│  - WebSocket    │                      │  - Auto-connect  │
│  - HTTP API     │                      │  - Event handling│
│  - Queue Mgmt   │                      │  - UI Updates    │
└─────────────────┘                      └──────────────────┘
         │                                         │
         └─────────────┬───────────────────────────┘
                       │
                ┌──────▼──────┐
                │   Shared    │
                │   Task DB   │
                └─────────────┘
```

## Event Flow

### Task Creation (VS Code → CLI)
1. User creates task in VS Code
2. Extension sends `TASK_CREATE` message
3. Sync service receives and validates
4. Task adapter converts to Claude-Flow format
5. Task stored in local database
6. Event emitted to CLI handlers
7. Other VS Code clients notified

### PRD Parsing (VS Code → CLI)
1. User pastes PRD in VS Code
2. Extension sends `PRD_PARSE` request
3. CLI parses PRD using AI
4. Tasks generated with SPARC mapping
5. Result sent back via `PRD_PARSE_RESULT`
6. Tasks displayed in VS Code UI

### Sync Cycle
1. Timer triggers sync request
2. CLI collects local changes
3. VS Code sends its changes
4. Conflicts detected and resolved
5. Updates applied to both sides
6. Sync status updated

## Integration Example

### From CLI Code

```typescript
import { getSyncIntegration } from './sync-integration.ts';

// Initialize sync integration
const sync = getSyncIntegration({
  enableAutoSync: true,
  syncInterval: 5000
});

await sync.initialize();

// Listen for VS Code events
sync.on('vscode:connected', (data) => {
  console.log('VS Code connected:', data.clientId);
});

sync.on('task:created', ({ task, claudeFlowTask }) => {
  console.log('Task created from VS Code:', task.title);
});

sync.on('prd:parsed', ({ parsedPRD, taskTree }) => {
  console.log('PRD parsed:', taskTree.totalTasks, 'tasks generated');
});
```

### From VS Code Extension

```typescript
import { VSCodeExtensionClient } from './vscode-client-example.ts';

const client = new VSCodeExtensionClient('ws://localhost:8765');

// Connect to sync service
await client.connect();

// Create a task
await client.createTask({
  id: 'task-001',
  title: 'Implement feature X',
  status: 'todo',
  priority: 2
});

// Parse PRD
const result = await client.parsePRD(prdContent, {
  generateTasks: true,
  useAI: true
});

// Listen for updates
client.on(SyncMessageType.TASK_UPDATE, (payload) => {
  updateTaskInUI(payload.task);
});
```

## Security Considerations

1. **Authentication**: Use bearer tokens in production
2. **Encryption**: Use WSS for secure connections
3. **Validation**: All messages are validated
4. **Rate Limiting**: Prevent abuse with limits
5. **Access Control**: Restrict operations by role

## Troubleshooting

### Connection Issues
- Check if sync service is running: `claude-flow taskmaster sync status`
- Verify port is not blocked by firewall
- Check VS Code extension logs

### Sync Conflicts
- Review conflict resolution strategy
- Check task timestamps
- Use manual resolution for complex conflicts

### Performance Issues
- Adjust sync interval for less frequent updates
- Check network latency
- Review task volume

## Best Practices

1. **Start sync service on startup** for seamless experience
2. **Use appropriate conflict strategy** for your workflow
3. **Monitor sync status** regularly
4. **Handle offline scenarios** gracefully
5. **Keep both tools updated** for compatibility

## Future Enhancements

- [ ] Multi-region sync support
- [ ] Advanced conflict resolution UI
- [ ] Sync history and rollback
- [ ] Performance analytics
- [ ] Plugin system for custom sync rules