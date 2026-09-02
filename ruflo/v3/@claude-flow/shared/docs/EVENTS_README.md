# Event Store Persistence (ADR-007)

Complete event sourcing implementation for V3 Claude Flow with persistent storage, projections, and event replay.

## Overview

The Event Store provides a robust foundation for tracking all state changes in the V3 system through domain events. This enables:

- **Complete Audit Trail**: Every state change is recorded
- **Time Travel**: Replay events to reconstruct state at any point
- **Projections**: Build multiple read models from the same events
- **Debugging**: Understand exactly what happened and when
- **Event-Driven Architecture**: Decouple components through events

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Event Store                            │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  SQLite Database (sql.js for cross-platform)          │  │
│  │  - events table (append-only log)                     │  │
│  │  - snapshots table (performance optimization)         │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │   Agent      │   │    Task      │   │   Memory     │
    │ Projection   │   │  Projection  │   │ Projection   │
    └──────────────┘   └──────────────┘   └──────────────┘
```

## Features

### 1. Event Store
- **Persistent Storage**: SQLite with sql.js fallback for Windows compatibility
- **Versioning**: Automatic version tracking per aggregate
- **Filtering**: Query events by type, aggregate, timestamp
- **Replay**: Iterate through all events for rebuilding state
- **Snapshots**: Performance optimization for large event streams
- **Auto-Persist**: Configurable auto-save to disk

### 2. Domain Events
Comprehensive event types for all aggregates:

**Agent Events**:
- `agent:spawned` - Agent created
- `agent:started` - Agent began working
- `agent:stopped` - Agent finished
- `agent:failed` - Agent encountered error
- `agent:status-changed` - Agent status updated
- `agent:task-assigned` - Task assigned to agent
- `agent:task-completed` - Agent completed task

**Task Events**:
- `task:created` - New task created
- `task:started` - Task execution began
- `task:completed` - Task finished successfully
- `task:failed` - Task failed
- `task:blocked` - Task blocked by dependencies
- `task:queued` - Task added to queue

**Memory Events**:
- `memory:stored` - Memory entry saved
- `memory:retrieved` - Memory entry accessed
- `memory:deleted` - Memory entry removed
- `memory:expired` - Memory entry expired

**Swarm Events**:
- `swarm:initialized` - Swarm started
- `swarm:scaled` - Agent count changed
- `swarm:terminated` - Swarm shut down
- `swarm:phase-changed` - Execution phase changed
- `swarm:milestone-reached` - Milestone achieved
- `swarm:error` - Swarm-level error

### 3. Projections
Build queryable read models from events:

**AgentStateProjection**:
- Current state of all agents
- Filter by status, domain, role
- Track task completion metrics
- Monitor agent health

**TaskHistoryProjection**:
- Complete task execution history
- Filter by status, agent, type
- Calculate average durations
- Track success/failure rates

**MemoryIndexProjection**:
- Memory access patterns
- Track usage by namespace
- Identify hot/cold data
- Monitor memory consumption

## Usage

### Basic Event Storage

```typescript
import { EventStore, createAgentSpawnedEvent } from '@claude-flow/shared/events';

// Initialize
const eventStore = new EventStore({
  databasePath: './events.db',
  verbose: true,
});
await eventStore.initialize();

// Record events
const event = createAgentSpawnedEvent(
  'agent-1',
  'coder',
  'core',
  ['coding', 'testing']
);
await eventStore.append(event);

// Query events
const agentEvents = await eventStore.getEvents('agent-1');
const allTaskEvents = await eventStore.query({
  aggregateTypes: ['task']
});

// Cleanup
await eventStore.shutdown();
```

### Using Projections

```typescript
import {
  EventStore,
  AgentStateProjection,
  TaskHistoryProjection
} from '@claude-flow/shared/events';

const eventStore = new EventStore({ databasePath: './events.db' });
await eventStore.initialize();

// Build agent state projection
const agentProjection = new AgentStateProjection(eventStore);
await agentProjection.initialize();

// Query agent state
const activeAgents = agentProjection.getAgentsByStatus('active');
const agent1 = agentProjection.getAgent('agent-1');

console.log(`Active agents: ${activeAgents.length}`);
console.log(`Agent 1 completed ${agent1.completedTasks.length} tasks`);

// Build task history projection
const taskProjection = new TaskHistoryProjection(eventStore);
await taskProjection.initialize();

// Query task history
const completedTasks = taskProjection.getTasksByStatus('completed');
const avgDuration = taskProjection.getAverageTaskDuration();

console.log(`Completed: ${completedTasks.length} tasks`);
console.log(`Average duration: ${avgDuration}ms`);
```

### Event Replay

```typescript
// Replay all events
for await (const event of eventStore.replay()) {
  console.log(`${event.type} at ${new Date(event.timestamp)}`);
}

// Replay from specific version
for await (const event of eventStore.replay(100)) {
  // Process events starting from version 100
}
```

### Snapshots

```typescript
// Save snapshot for performance
await eventStore.saveSnapshot({
  aggregateId: 'agent-1',
  aggregateType: 'agent',
  version: 500,
  state: { status: 'active', tasks: ['task-1', 'task-2'] },
  timestamp: Date.now(),
});

// Load snapshot
const snapshot = await eventStore.getSnapshot('agent-1');
if (snapshot) {
  // Resume from snapshot version
  const events = await eventStore.getEvents('agent-1', snapshot.version);
}
```

## Configuration

```typescript
const eventStore = new EventStore({
  // Database path (:memory: for in-memory only)
  databasePath: './v3-events.db',

  // Enable verbose logging
  verbose: true,

  // Auto-persist interval (0 = manual only)
  autoPersistInterval: 5000, // 5 seconds

  // Recommend snapshots every N events
  snapshotThreshold: 100,

  // Custom sql.js WASM path (optional)
  wasmPath: './sql-wasm.wasm',
});
```

## Performance

### Indexing
The Event Store automatically creates indexes for:
- Aggregate ID + Version (unique)
- Aggregate Type
- Event Type
- Timestamp
- Version

### Snapshots
Recommended usage:
- Save snapshot every 100-500 events
- Use snapshots for long-running aggregates
- Snapshots reduce replay time from O(n) to O(1)

### Auto-Persist
- Default: 5 seconds
- In-memory mode: No persistence
- Disk mode: Periodic writes to SQLite file

## Testing

Run comprehensive tests:

```bash
# Run all event store tests
npm test -- event-store.test.ts

# Run specific test suite
npm test -- event-store.test.ts -t "Event Appending"
```

## Example

See `example-usage.ts` for a complete demonstration:

```bash
npx tsx v3/@claude-flow/shared/src/events/example-usage.ts
```

Output includes:
- Event recording
- Query examples
- Projection building
- Event replay
- Snapshots
- Statistics

## Integration with V3

### Agent Lifecycle
```typescript
// Queen coordinator spawns agents
await eventStore.append(
  createAgentSpawnedEvent('agent-2', 'security-architect', 'security', ['auditing'])
);

// Track agent execution
await eventStore.append(createAgentStartedEvent('agent-2'));
await eventStore.append(createAgentTaskAssignedEvent('agent-2', 'task-1', Date.now()));
```

### Task Execution
```typescript
// Create task
await eventStore.append(
  createTaskCreatedEvent('task-1', 'security-audit', 'CVE-1 Fix', 'Fix injection', 'critical', [])
);

// Track progress
await eventStore.append(createTaskStartedEvent('task-1', 'agent-2'));
await eventStore.append(createTaskCompletedEvent('task-1', { fixed: true }, 5000));
```

### Memory Operations
```typescript
// Track memory usage
await eventStore.append(
  createMemoryStoredEvent('mem-1', 'agent-context', 'agent-2-state', 'episodic', 2048)
);

await eventStore.append(
  createMemoryRetrievedEvent('mem-1', 'agent-context', 'agent-2-state', 1)
);
```

## Cross-Platform Compatibility

The Event Store uses **sql.js** for cross-platform SQLite support:

- **Windows**: Pure JavaScript/WASM (no native compilation)
- **macOS**: Works with standard Node.js
- **Linux**: Full compatibility

Database files are portable across platforms.

## Migration Path

To integrate Event Store into existing V3 code:

1. **Initialize Event Store**: Add to swarm initialization
2. **Record Events**: Emit events on state changes
3. **Build Projections**: Replace direct state queries
4. **Event Replay**: Use for debugging and analytics
5. **Snapshots**: Add for performance optimization

## ADR Compliance

This implementation fulfills **ADR-007** requirements:

✅ Event Store with `append()`, `getEvents()`, `getEventsByType()`, `replay()`
✅ Domain events for agent, task, memory, swarm
✅ Projections for AgentState, TaskHistory, MemoryIndex
✅ SQLite persistence with cross-platform support
✅ Event versioning and snapshots
✅ Comprehensive test coverage

## Contributing

When adding new domain events:

1. Define event interface in `domain-events.ts`
2. Add factory function
3. Update projections to handle new event
4. Add tests
5. Update this README

## License

Part of claude-flow V3 - See root LICENSE file.
