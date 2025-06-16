# TaskMaster VS Code Extension Sync Protocol

## Overview

The TaskMaster sync protocol enables real-time bidirectional communication between the Claude-Flow CLI and the VS Code extension. It uses WebSocket for real-time updates and HTTP for RESTful operations.

## Connection

### WebSocket Endpoint
```
ws://localhost:8765
```

### HTTP Endpoints
```
GET  /status     - Get sync service status
POST /sync       - Trigger manual sync
POST /tasks      - Batch task operations
GET  /tasks/:id  - Get specific task
```

## Authentication

Optional authentication using bearer token:
```json
{
  "Authorization": "Bearer <token>"
}
```

## Message Format

All messages follow this structure:
```typescript
{
  "id": "unique-message-id",
  "type": "message-type",
  "timestamp": 1234567890,
  "payload": { /* type-specific data */ },
  "source": "cli" | "vscode",
  "version": "1.0.0"
}
```

## Message Types

### Connection Management

#### CONNECT
Sent by VS Code extension upon connection.
```json
{
  "type": "connect",
  "payload": {
    "version": "1.0.0",
    "capabilities": ["prd-parsing", "ai-generation", "real-time-sync"]
  }
}
```

Response from CLI:
```json
{
  "type": "connect",
  "payload": {
    "clientId": "vscode-123456",
    "syncVersion": 42,
    "taskCount": 150
  }
}
```

#### DISCONNECT
Graceful disconnect.
```json
{
  "type": "disconnect",
  "payload": {}
}
```

#### PING/PONG
Keep-alive mechanism.
```json
{
  "type": "ping",
  "payload": {}
}
```

### Task Operations

#### TASK_CREATE
Create a new task.
```json
{
  "type": "task:create",
  "payload": {
    "task": {
      "id": "task-123",
      "title": "Implement feature X",
      "description": "Detailed description",
      "status": "todo",
      "priority": 2,
      "tags": ["feature", "frontend"],
      "dependencies": ["task-122"],
      "estimate": 4,
      "assignee": "developer@example.com",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "metadata": {
        "prd_section": "3.2.1",
        "complexity": 3,
        "ai_generated": true,
        "model_used": "claude-3"
      }
    }
  }
}
```

#### TASK_UPDATE
Update existing task.
```json
{
  "type": "task:update",
  "payload": {
    "task": {
      "id": "task-123",
      "status": "in_progress",
      "updatedAt": "2024-01-01T01:00:00Z"
    }
  }
}
```

#### TASK_DELETE
Delete a task.
```json
{
  "type": "task:delete",
  "payload": {
    "taskId": "task-123"
  }
}
```

#### TASK_BATCH_UPDATE
Update multiple tasks at once.
```json
{
  "type": "task:batch_update",
  "payload": {
    "tasks": [
      { "id": "task-123", "status": "done" },
      { "id": "task-124", "status": "in_progress" }
    ]
  }
}
```

### PRD Operations

#### PRD_PARSE
Request PRD parsing.
```json
{
  "type": "prd:parse",
  "payload": {
    "content": "# Product Requirements Document...",
    "options": {
      "generateTasks": true,
      "estimateComplexity": true,
      "useAI": true,
      "model": "claude-3"
    }
  }
}
```

#### PRD_PARSE_RESULT
PRD parsing result.
```json
{
  "type": "prd:parse_result",
  "payload": {
    "sections": [...],
    "tasks": [...],
    "totalEstimate": 120,
    "complexity": "high"
  }
}
```

### Sync Operations

#### SYNC_REQUEST
Request full sync.
```json
{
  "type": "sync:request",
  "payload": {
    "syncVersion": 42,
    "taskCount": 150
  }
}
```

#### SYNC_RESPONSE
Sync response with all tasks.
```json
{
  "type": "sync:response",
  "payload": {
    "tasks": [...],
    "syncVersion": 43,
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

#### SYNC_CONFLICT
Conflict detected during sync.
```json
{
  "type": "sync:conflict",
  "payload": {
    "conflict": {
      "taskId": "task-123",
      "field": "status",
      "taskMasterValue": "in_progress",
      "claudeFlowValue": "todo",
      "source": "taskmaster"
    }
  }
}
```

#### SYNC_RESOLUTION
Conflict resolution.
```json
{
  "type": "sync:resolution",
  "payload": {
    "resolution": {
      "taskId": "task-123",
      "field": "status",
      "resolvedValue": "in_progress",
      "strategy": "newest_wins"
    }
  }
}
```

### Status Operations

#### STATUS_UPDATE
Update task status.
```json
{
  "type": "status:update",
  "payload": {
    "taskId": "task-123",
    "status": "done"
  }
}
```

### Events

#### EVENT_TASK_CHANGED
Task changed notification.
```json
{
  "type": "event:task_changed",
  "payload": {
    "taskId": "task-123",
    "changes": {
      "status": { "old": "todo", "new": "in_progress" }
    }
  }
}
```

#### EVENT_ERROR
Error notification.
```json
{
  "type": "event:error",
  "payload": {
    "error": "Failed to parse PRD",
    "details": "Invalid format at line 10"
  }
}
```

## Sync Strategies

### Conflict Resolution

1. **CLI Wins**: CLI changes take precedence
2. **VS Code Wins**: VS Code changes take precedence
3. **Newest Wins**: Most recent update wins
4. **Manual**: User must resolve conflicts

### Offline Support

The sync service maintains a queue of pending changes when offline:
- Maximum queue size: 1000 operations
- Operations are retried with exponential backoff
- Failed operations after max retries are logged

## Implementation Example

### VS Code Extension (TypeScript)
```typescript
const ws = new WebSocket('ws://localhost:8765');

ws.on('open', () => {
  ws.send(JSON.stringify({
    id: generateId(),
    type: 'connect',
    timestamp: Date.now(),
    payload: {
      version: '1.0.0',
      capabilities: ['prd-parsing', 'ai-generation']
    },
    source: 'vscode',
    version: '1.0.0'
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  
  switch (message.type) {
    case 'task:create':
      handleTaskCreate(message.payload.task);
      break;
    case 'sync:conflict':
      handleConflict(message.payload.conflict);
      break;
    // ... handle other message types
  }
});
```

### CLI (TypeScript/Deno)
```typescript
const syncService = new VSCodeSyncService({
  port: 8765,
  conflictResolutionStrategy: 'newest_wins'
});

await syncService.start();

// Send task update
await syncService.notifyTaskUpdate(task, 'update');

// Request sync
const result = await syncService.requestSync();
```

## Best Practices

1. **Message IDs**: Always include unique message IDs for tracking
2. **Versioning**: Include version in all messages for compatibility
3. **Timestamps**: Use ISO 8601 format for all timestamps
4. **Error Handling**: Always respond with error events for failed operations
5. **Batching**: Use batch operations when updating multiple tasks
6. **Heartbeat**: Implement ping/pong for connection health monitoring

## Security Considerations

1. **Authentication**: Use bearer tokens for production environments
2. **Encryption**: Use WSS (WebSocket Secure) for encrypted connections
3. **Validation**: Validate all incoming messages against schema
4. **Rate Limiting**: Implement rate limiting to prevent abuse
5. **Sanitization**: Sanitize all user input, especially in PRD content