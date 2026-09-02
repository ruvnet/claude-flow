# ADR-007: Event Sourcing for State Changes

**Status:** Implemented
**Date:** 2026-01-03

## Context

v2 uses direct state mutation, making it hard to:
- Debug state changes
- Implement undo/redo
- Audit operations
- Replay events

## Decision

**Use event sourcing pattern for critical state changes.**

```typescript
// Domain events
class AgentSpawned extends DomainEvent {
  constructor(
    readonly agentId: AgentId,
    readonly type: AgentType,
    readonly timestamp: Date
  ) {}
}

// Event store
interface IEventStore {
  append(event: DomainEvent): Promise<void>;
  getEvents(aggregateId: string): Promise<DomainEvent[]>;
  subscribe(handler: EventHandler): void;
}

// Rebuild state from events
class Agent {
  static fromEvents(events: DomainEvent[]): Agent {
    const agent = new Agent();
    events.forEach(e => agent.apply(e));
    return agent;
  }

  private apply(event: DomainEvent): void {
    if (event instanceof AgentSpawned) {
      this.id = event.agentId;
      this.type = event.type;
    }
    // ... more events
  }
}
```

## Benefits

- Complete audit trail
- Time travel debugging
- Replay for testing
- Event-driven integration
- Temporal queries

## Scope

**Apply to:**
- Agent lifecycle events
- Task state changes
- Coordination decisions
- Critical errors

**Don't apply to:**
- High-frequency metrics
- Log messages
- Ephemeral cache

## Implementation

**Event Types:**
```typescript
// Agent events
type AgentEvent =
  | AgentSpawned
  | AgentTerminated
  | AgentStatusChanged
  | AgentTaskAssigned
  | AgentTaskCompleted;

// Task events
type TaskEvent =
  | TaskCreated
  | TaskAssigned
  | TaskStarted
  | TaskCompleted
  | TaskFailed;

// Coordination events
type CoordinationEvent =
  | LeaderElected
  | ConsensusReached
  | TopologyChanged
  | AgentJoinedSwarm
  | AgentLeftSwarm;
```

**Event Store Implementation:**
```typescript
class SQLiteEventStore implements IEventStore {
  async append(event: DomainEvent): Promise<void> {
    await this.db.run(`
      INSERT INTO events (aggregate_id, event_type, payload, timestamp)
      VALUES (?, ?, ?, ?)
    `, [
      event.aggregateId,
      event.type,
      JSON.stringify(event),
      event.timestamp.toISOString()
    ]);
  }

  async getEvents(aggregateId: string): Promise<DomainEvent[]> {
    const rows = await this.db.all(`
      SELECT * FROM events
      WHERE aggregate_id = ?
      ORDER BY timestamp ASC
    `, [aggregateId]);

    return rows.map(row => this.deserialize(row));
  }
}
```

## Success Metrics

- [x] Event store implemented
- [x] All critical state changes emit events
- [x] Can rebuild state from events
- [x] Event replay for debugging

---

**Implementation Date:** 2026-01-04
**Status:** ✅ Complete
