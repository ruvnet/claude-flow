/**
 * V3 Event Bus System
 * Event-driven communication for the 15-agent swarm
 *
 * Based on ADR-007 (Event Sourcing for State Changes)
 */

import {
  EventType,
  EventHandler,
  SwarmEvent,
  AgentId
} from './types.js';

// =============================================================================
// Event Bus Interface
// =============================================================================

export interface IEventBus {
  subscribe<T>(eventType: EventType, handler: EventHandler<T>): () => void;
  subscribeAll(handler: EventHandler): () => void;
  emit<T>(event: SwarmEvent<T>): Promise<void>;
  emitSync<T>(event: SwarmEvent<T>): void;
  getHistory(filter?: EventFilter): SwarmEvent[];
  clear(): void;
}

export interface EventFilter {
  types?: EventType[];
  sources?: (AgentId | 'swarm')[];
  since?: number;
  until?: number;
  limit?: number;
}

// =============================================================================
// Event Store Interface (Event Sourcing)
// =============================================================================

export interface IEventStore {
  append(event: SwarmEvent): Promise<void>;
  getEvents(aggregateId: string, fromVersion?: number): Promise<SwarmEvent[]>;
  getAllEvents(filter?: EventFilter): Promise<SwarmEvent[]>;
  getSnapshot(aggregateId: string): Promise<EventStoreSnapshot | null>;
  saveSnapshot(snapshot: EventStoreSnapshot): Promise<void>;
}

export interface EventStoreSnapshot {
  aggregateId: string;
  version: number;
  state: unknown;
  timestamp: number;
}

// =============================================================================
// Event Bus Implementation
// =============================================================================

export class EventBus implements IEventBus {
  private handlers: Map<EventType | '*', Set<EventHandler>> = new Map();
  private history: SwarmEvent[] = [];
  private maxHistorySize: number;

  constructor(options: { maxHistorySize?: number } = {}) {
    this.maxHistorySize = options.maxHistorySize ?? 10000;
  }

  subscribe<T>(eventType: EventType, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    const handlers = this.handlers.get(eventType)!;
    handlers.add(handler as EventHandler);

    return () => {
      handlers.delete(handler as EventHandler);
    };
  }

  subscribeAll(handler: EventHandler): () => void {
    if (!this.handlers.has('*')) {
      this.handlers.set('*', new Set());
    }

    const handlers = this.handlers.get('*')!;
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
    };
  }

  async emit<T>(event: SwarmEvent<T>): Promise<void> {
    this.addToHistory(event);

    const typeHandlers = this.handlers.get(event.type) ?? new Set();
    const allHandlers = this.handlers.get('*') ?? new Set();

    const allPromises: Promise<void>[] = [];

    for (const handler of typeHandlers) {
      allPromises.push(this.safeExecute(handler, event));
    }

    for (const handler of allHandlers) {
      allPromises.push(this.safeExecute(handler, event));
    }

    await Promise.all(allPromises);
  }

  emitSync<T>(event: SwarmEvent<T>): void {
    this.addToHistory(event);

    const typeHandlers = this.handlers.get(event.type) ?? new Set();
    const allHandlers = this.handlers.get('*') ?? new Set();

    for (const handler of typeHandlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch(err => console.error(`Event handler error: ${err}`));
        }
      } catch (err) {
        console.error(`Event handler error: ${err}`);
      }
    }

    for (const handler of allHandlers) {
      try {
        const result = handler(event);
        if (result instanceof Promise) {
          result.catch(err => console.error(`Event handler error: ${err}`));
        }
      } catch (err) {
        console.error(`Event handler error: ${err}`);
      }
    }
  }

  getHistory(filter?: EventFilter): SwarmEvent[] {
    let events = [...this.history];

    if (filter?.types?.length) {
      events = events.filter(e => filter.types!.includes(e.type));
    }

    if (filter?.sources?.length) {
      events = events.filter(e => filter.sources!.includes(e.source));
    }

    if (filter?.since) {
      events = events.filter(e => e.timestamp >= filter.since!);
    }

    if (filter?.until) {
      events = events.filter(e => e.timestamp <= filter.until!);
    }

    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }

    return events;
  }

  clear(): void {
    this.history = [];
  }

  private addToHistory(event: SwarmEvent): void {
    this.history.push(event);

    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-Math.floor(this.maxHistorySize / 2));
    }
  }

  private async safeExecute(handler: EventHandler, event: SwarmEvent): Promise<void> {
    try {
      await handler(event);
    } catch (err) {
      console.error(`Event handler error for ${event.type}: ${err}`);
    }
  }
}

// =============================================================================
// In-Memory Event Store
// =============================================================================

export class InMemoryEventStore implements IEventStore {
  private events: Map<string, SwarmEvent[]> = new Map();
  private allEvents: SwarmEvent[] = [];
  private snapshots: Map<string, EventStoreSnapshot> = new Map();

  async append(event: SwarmEvent): Promise<void> {
    const aggregateId = this.extractAggregateId(event);

    if (!this.events.has(aggregateId)) {
      this.events.set(aggregateId, []);
    }

    this.events.get(aggregateId)!.push(event);
    this.allEvents.push(event);
  }

  async getEvents(aggregateId: string, fromVersion?: number): Promise<SwarmEvent[]> {
    const events = this.events.get(aggregateId) ?? [];

    if (fromVersion !== undefined) {
      return events.slice(fromVersion);
    }

    return events;
  }

  async getAllEvents(filter?: EventFilter): Promise<SwarmEvent[]> {
    let events = [...this.allEvents];

    if (filter?.types?.length) {
      events = events.filter(e => filter.types!.includes(e.type));
    }

    if (filter?.sources?.length) {
      events = events.filter(e => filter.sources!.includes(e.source));
    }

    if (filter?.since) {
      events = events.filter(e => e.timestamp >= filter.since!);
    }

    if (filter?.until) {
      events = events.filter(e => e.timestamp <= filter.until!);
    }

    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }

    return events;
  }

  async getSnapshot(aggregateId: string): Promise<EventStoreSnapshot | null> {
    return this.snapshots.get(aggregateId) ?? null;
  }

  async saveSnapshot(snapshot: EventStoreSnapshot): Promise<void> {
    this.snapshots.set(snapshot.aggregateId, snapshot);
  }

  private extractAggregateId(event: SwarmEvent): string {
    if (event.source !== 'swarm') {
      return event.source;
    }

    if (typeof event.payload === 'object' && event.payload !== null) {
      const payload = event.payload as Record<string, unknown>;
      if ('agentId' in payload) return payload.agentId as string;
      if ('taskId' in payload) return payload.taskId as string;
    }

    return 'swarm';
  }
}

// =============================================================================
// Event Factory Functions
// =============================================================================

let eventCounter = 0;

export function createEvent<T>(
  type: EventType,
  source: AgentId | 'swarm',
  payload: T
): SwarmEvent<T> {
  return {
    id: `evt-${Date.now()}-${++eventCounter}`,
    type,
    timestamp: Date.now(),
    source,
    payload
  };
}

// Agent Events
export function agentSpawnedEvent(agentId: AgentId, role: string): SwarmEvent {
  return createEvent('agent:spawned', 'swarm', { agentId, role });
}

export function agentStatusChangedEvent(
  agentId: AgentId,
  previousStatus: string,
  newStatus: string
): SwarmEvent {
  return createEvent('agent:status-changed', agentId, { previousStatus, newStatus });
}

export function agentTaskAssignedEvent(agentId: AgentId, taskId: string): SwarmEvent {
  return createEvent('agent:task-assigned', 'swarm', { agentId, taskId });
}

export function agentTaskCompletedEvent(agentId: AgentId, taskId: string, result: unknown): SwarmEvent {
  return createEvent('agent:task-completed', agentId, { taskId, result });
}

export function agentErrorEvent(agentId: AgentId, error: Error): SwarmEvent {
  return createEvent('agent:error', agentId, {
    message: error.message,
    stack: error.stack
  });
}

// Task Events
export function taskCreatedEvent(taskId: string, type: string, title: string): SwarmEvent {
  return createEvent('task:created', 'swarm', { taskId, type, title });
}

export function taskQueuedEvent(taskId: string, priority: string): SwarmEvent {
  return createEvent('task:queued', 'swarm', { taskId, priority });
}

export function taskAssignedEvent(taskId: string, agentId: AgentId): SwarmEvent {
  return createEvent('task:assigned', 'swarm', { taskId, agentId });
}

export function taskStartedEvent(taskId: string, agentId: AgentId): SwarmEvent {
  return createEvent('task:started', agentId, { taskId });
}

export function taskCompletedEvent(taskId: string, result: unknown): SwarmEvent {
  return createEvent('task:completed', 'swarm', { taskId, result });
}

export function taskFailedEvent(taskId: string, error: Error): SwarmEvent {
  return createEvent('task:failed', 'swarm', {
    taskId,
    error: error.message,
    stack: error.stack
  });
}

export function taskBlockedEvent(taskId: string, blockedBy: string[]): SwarmEvent {
  return createEvent('task:blocked', 'swarm', { taskId, blockedBy });
}

// Swarm Events
export function swarmInitializedEvent(config: unknown): SwarmEvent {
  return createEvent('swarm:initialized', 'swarm', { config });
}

export function swarmPhaseChangedEvent(previousPhase: string, newPhase: string): SwarmEvent {
  return createEvent('swarm:phase-changed', 'swarm', { previousPhase, newPhase });
}

export function swarmMilestoneReachedEvent(milestoneId: string, name: string): SwarmEvent {
  return createEvent('swarm:milestone-reached', 'swarm', { milestoneId, name });
}

export function swarmErrorEvent(error: Error): SwarmEvent {
  return createEvent('swarm:error', 'swarm', {
    message: error.message,
    stack: error.stack
  });
}
