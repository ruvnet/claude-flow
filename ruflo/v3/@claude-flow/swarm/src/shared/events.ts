/**
 * @claude-flow/swarm - Standalone Event System
 * Event-driven communication for multi-agent swarm coordination
 *
 * This file provides a complete event system for standalone operation
 * without dependency on @claude-flow/shared
 */

import type { SwarmEvent, EventType, EventHandler, AgentId } from './types.js';

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

// Helper function to generate event IDs
function generateEventId(): string {
  return `evt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Helper function to create a base SwarmEvent
function createSwarmEvent<T>(
  type: EventType,
  source: string,
  payload: T
): SwarmEvent<T> {
  return {
    id: generateEventId(),
    type,
    timestamp: Date.now(),
    source,
    payload,
  };
}

// Agent events
export function agentSpawnedEvent(agentId: string, state: unknown): SwarmEvent<{ agentId: string; state: unknown }> {
  return createSwarmEvent('agent:spawned', agentId, { agentId, state });
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
export function taskCreatedEvent(taskId: string, spec: { type: string; title: string }): SwarmEvent {
  return createEvent('task:created', 'swarm', { taskId, type: spec.type, title: spec.title });
}

export function taskQueuedEvent(taskId: string, position: number): SwarmEvent {
  return createEvent('task:queued', 'swarm', { taskId, position });
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

export function taskBlockedEvent(taskId: string, reason: string, blockingTask: string): SwarmEvent {
  return createEvent('task:blocked', 'swarm', { taskId, reason, blockingTask });
}

// Swarm Events
export function swarmInitializedEvent(source: string, config: unknown): SwarmEvent {
  return createEvent('swarm:initialized', source, { config });
}

export function swarmPhaseChangedEvent(source: string, previousPhase: string, newPhase: string): SwarmEvent {
  return createEvent('swarm:phase-changed', source, { previousPhase, newPhase });
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
