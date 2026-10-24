# Event Store Quick Reference

Fast reference guide for using the Event Store system.

## Installation

```bash
cd v3/@claude-flow/shared
npm install
```

## Quick Start

```typescript
import {
  EventStore,
  AgentStateProjection,
  createAgentSpawnedEvent,
  createTaskCompletedEvent,
} from '@claude-flow/shared/events';

// 1. Initialize
const store = new EventStore({ databasePath: './events.db' });
await store.initialize();

// 2. Record events
await store.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', []));

// 3. Query events
const events = await store.getEvents('agent-1');

// 4. Build projections
const projection = new AgentStateProjection(store);
await projection.initialize();

// 5. Cleanup
await store.shutdown();
```

## Common Operations

### Record Agent Events

```typescript
// Agent spawned
await store.append(
  createAgentSpawnedEvent('agent-1', 'coder', 'core', ['coding'])
);

// Agent started
await store.append(createAgentStartedEvent('agent-1'));

// Agent stopped
await store.append(createAgentStoppedEvent('agent-1', 'completed'));

// Agent failed
await store.append(createAgentFailedEvent('agent-1', new Error('Timeout')));
```

### Record Task Events

```typescript
// Task created
await store.append(
  createTaskCreatedEvent('task-1', 'implementation', 'Build Feature', 'Description', 'high', [])
);

// Task started
await store.append(createTaskStartedEvent('task-1', 'agent-1'));

// Task completed
await store.append(createTaskCompletedEvent('task-1', { success: true }, 5000));

// Task failed
await store.append(createTaskFailedEvent('task-1', new Error('Build failed'), 1));
```

### Record Memory Events

```typescript
// Memory stored
await store.append(
  createMemoryStoredEvent('mem-1', 'default', 'key1', 'semantic', 1024)
);

// Memory retrieved
await store.append(createMemoryRetrievedEvent('mem-1', 'default', 'key1', 1));

// Memory deleted
await store.append(createMemoryDeletedEvent('mem-1', 'default', 'key1'));
```

### Record Swarm Events

```typescript
// Swarm initialized
await store.append(
  createSwarmInitializedEvent('hierarchical-mesh', 15, { config: 'value' })
);

// Swarm scaled
await store.append(createSwarmScaledEvent(10, 15, 'Increased capacity'));

// Swarm terminated
await store.append(createSwarmTerminatedEvent('Shutdown', { reason: 'Complete' }));
```

## Query Events

```typescript
// By aggregate ID
const agentEvents = await store.getEvents('agent-1');

// By event type
const spawned = await store.getEventsByType('agent:spawned');

// By aggregate type
const allAgentEvents = await store.query({ aggregateTypes: ['agent'] });

// By multiple filters
const recentTasks = await store.query({
  aggregateTypes: ['task'],
  eventTypes: ['task:completed', 'task:failed'],
  afterTimestamp: Date.now() - 86400000, // Last 24 hours
  limit: 10,
});
```

## Projections

### Agent State Projection

```typescript
const agentProj = new AgentStateProjection(store);
await agentProj.initialize();

// Get single agent
const agent = agentProj.getAgent('agent-1');

// Get all agents
const allAgents = agentProj.getAllAgents();

// Filter by status
const activeAgents = agentProj.getAgentsByStatus('active');

// Filter by domain
const coreAgents = agentProj.getAgentsByDomain('core');

// Get count
const activeCount = agentProj.getActiveAgentCount();
```

### Task History Projection

```typescript
const taskProj = new TaskHistoryProjection(store);
await taskProj.initialize();

// Get single task
const task = taskProj.getTask('task-1');

// Get all tasks
const allTasks = taskProj.getAllTasks();

// Filter by status
const completed = taskProj.getTasksByStatus('completed');

// Filter by agent
const agentTasks = taskProj.getTasksByAgent('agent-1');

// Get metrics
const avgDuration = taskProj.getAverageTaskDuration();
const completedCount = taskProj.getCompletedTaskCount();
```

### Memory Index Projection

```typescript
const memProj = new MemoryIndexProjection(store);
await memProj.initialize();

// Get single memory
const memory = memProj.getMemory('mem-1');

// Get active memories
const active = memProj.getActiveMemories();

// Filter by namespace
const nsMemories = memProj.getMemoriesByNamespace('default');

// Get most accessed
const hot = memProj.getMostAccessedMemories(10);

// Get total size
const size = memProj.getTotalSizeByNamespace('default');
```

## Event Replay

```typescript
// Replay all events
for await (const event of store.replay()) {
  console.log(event.type, event.timestamp);
}

// Replay from version
for await (const event of store.replay(100)) {
  // Process events starting from version 100
}
```

## Snapshots

```typescript
// Save snapshot
await store.saveSnapshot({
  aggregateId: 'agent-1',
  aggregateType: 'agent',
  version: 500,
  state: { status: 'active', tasks: [] },
  timestamp: Date.now(),
});

// Load snapshot
const snapshot = await store.getSnapshot('agent-1');
if (snapshot) {
  // Resume from snapshot
  const recentEvents = await store.getEvents('agent-1', snapshot.version);
}
```

## Statistics

```typescript
const stats = await store.getStats();

console.log('Total events:', stats.totalEvents);
console.log('Events by type:', stats.eventsByType);
console.log('Events by aggregate:', stats.eventsByAggregate);
console.log('Time range:', stats.oldestEvent, '-', stats.newestEvent);
console.log('Snapshots:', stats.snapshotCount);
```

## Configuration

```typescript
const store = new EventStore({
  // Database path
  databasePath: './events.db', // or ':memory:' for in-memory

  // Logging
  verbose: true,

  // Auto-persist (milliseconds, 0 = disabled)
  autoPersistInterval: 5000,

  // Snapshot recommendation threshold
  snapshotThreshold: 100,

  // Custom WASM path (optional)
  wasmPath: './sql-wasm.wasm',
});
```

## Event Types Reference

| Category | Event Type | Factory Function |
|----------|-----------|------------------|
| **Agent** | `agent:spawned` | `createAgentSpawnedEvent()` |
| | `agent:started` | `createAgentStartedEvent()` |
| | `agent:stopped` | `createAgentStoppedEvent()` |
| | `agent:failed` | `createAgentFailedEvent()` |
| **Task** | `task:created` | `createTaskCreatedEvent()` |
| | `task:started` | `createTaskStartedEvent()` |
| | `task:completed` | `createTaskCompletedEvent()` |
| | `task:failed` | `createTaskFailedEvent()` |
| **Memory** | `memory:stored` | `createMemoryStoredEvent()` |
| | `memory:retrieved` | `createMemoryRetrievedEvent()` |
| | `memory:deleted` | `createMemoryDeletedEvent()` |
| **Swarm** | `swarm:initialized` | `createSwarmInitializedEvent()` |
| | `swarm:scaled` | `createSwarmScaledEvent()` |
| | `swarm:terminated` | `createSwarmTerminatedEvent()` |

## Projection Properties

### AgentProjectionState
```typescript
{
  id: AgentId;
  role: string;
  domain: string;
  status: AgentStatus;
  currentTask: TaskId | null;
  completedTasks: TaskId[];
  failedTasks: TaskId[];
  totalTaskDuration: number;
  taskCount: number;
  errorCount: number;
  spawnedAt: number;
  startedAt: number | null;
  stoppedAt: number | null;
  lastActivityAt: number;
}
```

### TaskProjectionState
```typescript
{
  id: TaskId;
  type: string;
  title: string;
  status: TaskStatus;
  priority: string;
  assignedAgent: AgentId | null;
  dependencies: TaskId[];
  blockedBy: TaskId[];
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  failedAt: number | null;
  duration: number | null;
  result: unknown;
  error: string | null;
  retryCount: number;
}
```

### MemoryProjectionState
```typescript
{
  id: string;
  namespace: string;
  key: string;
  type: string;
  size: number;
  accessCount: number;
  storedAt: number;
  lastAccessedAt: number;
  deletedAt: number | null;
  isDeleted: boolean;
}
```

## Error Handling

```typescript
try {
  await store.append(event);
} catch (error) {
  console.error('Failed to append event:', error);
  // Handle error
}

// Listen for errors
store.on('error', (error) => {
  console.error('Event store error:', error);
});
```

## Event Listeners

```typescript
// Event appended
store.on('event:appended', (event) => {
  console.log('Event recorded:', event.type);
});

// Snapshot recommended
store.on('snapshot:recommended', ({ aggregateId, version }) => {
  console.log(`Consider snapshot for ${aggregateId} at v${version}`);
});

// Persisted to disk
store.on('persisted', ({ size, path }) => {
  console.log(`Persisted ${size} bytes to ${path}`);
});
```

## Testing

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('My Event Store Tests', () => {
  let store: EventStore;

  beforeEach(async () => {
    store = new EventStore({ databasePath: ':memory:' });
    await store.initialize();
  });

  afterEach(async () => {
    await store.shutdown();
  });

  it('should record events', async () => {
    await store.append(createAgentSpawnedEvent('agent-1', 'coder', 'core', []));
    const events = await store.getEvents('agent-1');
    expect(events).toHaveLength(1);
  });
});
```

## Performance Tips

1. **Use Snapshots**: Save snapshots every 100-500 events for large aggregates
2. **Filter Early**: Use specific filters to reduce result sets
3. **Pagination**: Use `limit` and `offset` for large queries
4. **Indexes**: All common queries are indexed automatically
5. **Batch Writes**: Group related events together when possible
6. **In-Memory Mode**: Use `:memory:` for testing (faster)
7. **Auto-Persist**: Adjust interval based on write frequency

## Common Patterns

### Agent Lifecycle Tracking
```typescript
// Spawn → Start → Assign → Complete → Stop
await store.append(createAgentSpawnedEvent(id, role, domain, caps));
await store.append(createAgentStartedEvent(id));
await store.append(createAgentTaskAssignedEvent(id, taskId, Date.now()));
await store.append(createAgentTaskCompletedEvent(id, taskId, result, now, duration));
await store.append(createAgentStoppedEvent(id, 'completed'));
```

### Task Execution Flow
```typescript
// Create → Start → Complete
await store.append(createTaskCreatedEvent(id, type, title, desc, priority, deps));
await store.append(createTaskStartedEvent(id, agentId));
await store.append(createTaskCompletedEvent(id, result, duration));
```

### Memory Lifecycle
```typescript
// Store → Retrieve (multiple times) → Delete
await store.append(createMemoryStoredEvent(id, ns, key, type, size));
await store.append(createMemoryRetrievedEvent(id, ns, key, 1));
await store.append(createMemoryRetrievedEvent(id, ns, key, 2));
await store.append(createMemoryDeletedEvent(id, ns, key));
```

## Troubleshooting

**Problem**: "EventStore not initialized"
**Solution**: Call `await eventStore.initialize()` before use

**Problem**: Events not persisting
**Solution**: Check `databasePath` is not `:memory:` and call `persist()`

**Problem**: Slow queries
**Solution**: Use filters, pagination, and snapshots

**Problem**: Version conflicts
**Solution**: Events are append-only, versions auto-increment per aggregate

## Resources

- Full Documentation: `README.md`
- Implementation Details: `IMPLEMENTATION_SUMMARY.md`
- Working Example: `example-usage.ts`
- Test Suite: `event-store.test.ts`

---

**Quick Links**:
- [README](./README.md) - Complete documentation
- [Example](./example-usage.ts) - Working code example
- [Tests](./event-store.test.ts) - Test suite
- [Summary](./IMPLEMENTATION_SUMMARY.md) - Implementation overview
