/**
 * State Reconstructor - ADR-007 Implementation
 *
 * Reconstructs aggregate state from event streams.
 * Implements event sourcing patterns for V3.
 *
 * @module v3/shared/events/state-reconstructor
 */

import { EventStore, type EventSnapshot } from './event-store.js';
import type { DomainEvent } from './domain-events.js';

/**
 * Aggregate root interface
 */
export interface AggregateRoot {
  id: string;
  version: number;
  apply(event: DomainEvent): void;
  getState(): Record<string, unknown>;
}

/**
 * Reconstructor options
 */
export interface ReconstructorOptions {
  useSnapshots: boolean;
  snapshotInterval: number; // Create snapshot every N events
  maxEventsToReplay: number;
}

/**
 * State Reconstructor
 *
 * Reconstructs aggregate state from event history.
 * Supports snapshots for performance optimization.
 */
export class StateReconstructor {
  private readonly options: ReconstructorOptions;

  constructor(
    private readonly eventStore: EventStore,
    options?: Partial<ReconstructorOptions>
  ) {
    this.options = {
      useSnapshots: true,
      snapshotInterval: 100,
      maxEventsToReplay: 10000,
      ...options,
    };
  }

  /**
   * Reconstruct aggregate state from events
   */
  async reconstruct<T extends AggregateRoot>(
    aggregateId: string,
    factory: (id: string) => T
  ): Promise<T> {
    const aggregate = factory(aggregateId);

    // Try to load from snapshot first
    if (this.options.useSnapshots) {
      const snapshot = await this.eventStore.getSnapshot(aggregateId);
      if (snapshot) {
        this.applySnapshot(aggregate, snapshot);
      }
    }

    // Get events after snapshot version (or all if no snapshot)
    const events = await this.eventStore.getEvents(aggregateId, aggregate.version + 1);

    // Apply events
    for (const event of events) {
      if (events.length > this.options.maxEventsToReplay) {
        throw new Error(`Too many events to replay (${events.length}). Consider creating a snapshot.`);
      }

      aggregate.apply(event);
    }

    // Create snapshot if interval reached
    if (this.options.useSnapshots && aggregate.version % this.options.snapshotInterval === 0) {
      await this.createSnapshot(aggregate);
    }

    return aggregate;
  }

  /**
   * Reconstruct state at a specific point in time
   */
  async reconstructAtTime<T extends AggregateRoot>(
    aggregateId: string,
    factory: (id: string) => T,
    timestamp: Date
  ): Promise<T> {
    const aggregate = factory(aggregateId);

    // Get all events up to timestamp
    const allEvents = await this.eventStore.getEvents(aggregateId);
    const events = allEvents.filter((e) => e.timestamp <= timestamp.getTime());

    // Apply events
    for (const event of events) {
      aggregate.apply(event);
    }

    return aggregate;
  }

  /**
   * Reconstruct state at a specific version
   */
  async reconstructAtVersion<T extends AggregateRoot>(
    aggregateId: string,
    factory: (id: string) => T,
    targetVersion: number
  ): Promise<T> {
    const aggregate = factory(aggregateId);

    // Get events up to target version
    const events = await this.eventStore.getEvents(aggregateId);
    const limitedEvents = events.filter((e) => e.version <= targetVersion);

    // Apply events
    for (const event of limitedEvents) {
      aggregate.apply(event);
    }

    return aggregate;
  }

  /**
   * Apply snapshot to aggregate
   */
  private applySnapshot(aggregate: AggregateRoot, snapshot: EventSnapshot): void {
    // Type assertion for aggregate that has restoreFromSnapshot
    const restorable = aggregate as AggregateRoot & {
      restoreFromSnapshot?(state: unknown): void;
    };

    if (typeof restorable.restoreFromSnapshot === 'function') {
      restorable.restoreFromSnapshot(snapshot.state);
    }

    // Update version
    (aggregate as any).version = snapshot.version;
  }

  /**
   * Create snapshot for aggregate
   */
  private async createSnapshot(aggregate: AggregateRoot): Promise<void> {
    const snapshot: EventSnapshot = {
      aggregateId: aggregate.id,
      aggregateType: this.getAggregateType(aggregate),
      version: aggregate.version,
      state: aggregate.getState(),
      timestamp: Date.now(),
    };

    await this.eventStore.saveSnapshot(snapshot);
  }

  /**
   * Get aggregate type from instance
   */
  private getAggregateType(aggregate: AggregateRoot): 'agent' | 'task' | 'memory' | 'swarm' {
    const typeName = aggregate.constructor.name.toLowerCase().replace('aggregate', '');
    // Map to valid aggregate types
    if (typeName === 'agent' || typeName === 'task' || typeName === 'memory' || typeName === 'swarm') {
      return typeName;
    }
    return 'agent'; // Default fallback
  }
}

/**
 * Agent Aggregate - Example implementation
 */
export class AgentAggregate implements AggregateRoot {
  id: string;
  version = 0;

  private state = {
    name: '',
    role: '',
    status: 'idle' as string,
    currentTask: null as string | null,
    completedTasks: [] as string[],
    capabilities: [] as string[],
    createdAt: null as Date | null,
    lastActiveAt: null as Date | null,
  };

  constructor(id: string) {
    this.id = id;
  }

  apply(event: DomainEvent): void {
    this.version = event.version;

    switch (event.type) {
      case 'agent:spawned':
        this.state.name = event.payload.name as string;
        this.state.role = event.payload.role as string;
        this.state.capabilities = (event.payload.capabilities as string[]) ?? [];
        this.state.status = 'idle';
        this.state.createdAt = new Date(event.timestamp);
        break;

      case 'agent:started':
        this.state.status = 'active';
        this.state.lastActiveAt = new Date(event.timestamp);
        break;

      case 'agent:task-assigned':
        this.state.currentTask = event.payload.taskId as string;
        this.state.status = 'busy';
        this.state.lastActiveAt = new Date(event.timestamp);
        break;

      case 'agent:task-completed':
        this.state.completedTasks.push(event.payload.taskId as string);
        this.state.currentTask = null;
        this.state.status = 'active';
        this.state.lastActiveAt = new Date(event.timestamp);
        break;

      case 'agent:terminated':
        this.state.status = 'terminated';
        break;
    }
  }

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  restoreFromSnapshot(snapshotState: unknown): void {
    const state = snapshotState as typeof this.state;
    this.state = {
      ...state,
      createdAt: state.createdAt ? new Date(state.createdAt) : null,
      lastActiveAt: state.lastActiveAt ? new Date(state.lastActiveAt) : null,
    };
  }

  // Getters for type safety
  get name(): string { return this.state.name; }
  get role(): string { return this.state.role; }
  get status(): string { return this.state.status; }
  get currentTask(): string | null { return this.state.currentTask; }
  get completedTasks(): string[] { return [...this.state.completedTasks]; }
  get capabilities(): string[] { return [...this.state.capabilities]; }
}

/**
 * Task Aggregate - Example implementation
 */
export class TaskAggregate implements AggregateRoot {
  id: string;
  version = 0;

  private state = {
    title: '',
    description: '',
    type: '',
    priority: 'normal' as string,
    status: 'pending' as string,
    assignedAgent: null as string | null,
    result: null as unknown,
    createdAt: null as Date | null,
    startedAt: null as Date | null,
    completedAt: null as Date | null,
  };

  constructor(id: string) {
    this.id = id;
  }

  apply(event: DomainEvent): void {
    this.version = event.version;

    switch (event.type) {
      case 'task:created':
        this.state.title = event.payload.title as string;
        this.state.description = event.payload.description as string;
        this.state.type = event.payload.taskType as string;
        this.state.priority = (event.payload.priority as string) ?? 'normal';
        this.state.status = 'pending';
        this.state.createdAt = new Date(event.timestamp);
        break;

      case 'task:started':
        this.state.assignedAgent = event.payload.agentId as string;
        this.state.status = 'running';
        this.state.startedAt = new Date(event.timestamp);
        break;

      case 'task:completed':
        this.state.result = event.payload.result;
        this.state.status = 'completed';
        this.state.completedAt = new Date(event.timestamp);
        break;

      case 'task:failed':
        this.state.status = 'failed';
        this.state.completedAt = new Date(event.timestamp);
        break;

      case 'task:cancelled':
        this.state.status = 'cancelled';
        this.state.completedAt = new Date(event.timestamp);
        break;
    }
  }

  getState(): Record<string, unknown> {
    return { ...this.state };
  }

  restoreFromSnapshot(snapshotState: unknown): void {
    const state = snapshotState as typeof this.state;
    this.state = {
      ...state,
      createdAt: state.createdAt ? new Date(state.createdAt) : null,
      startedAt: state.startedAt ? new Date(state.startedAt) : null,
      completedAt: state.completedAt ? new Date(state.completedAt) : null,
    };
  }

  // Getters
  get title(): string { return this.state.title; }
  get status(): string { return this.state.status; }
  get assignedAgent(): string | null { return this.state.assignedAgent; }
  get result(): unknown { return this.state.result; }
}

/**
 * Factory function
 */
export function createStateReconstructor(
  eventStore: EventStore,
  options?: Partial<ReconstructorOptions>
): StateReconstructor {
  return new StateReconstructor(eventStore, options);
}
