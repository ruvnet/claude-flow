/**
 * V3 Event Interfaces
 * Domain-Driven Design - Event Sourcing Pattern (ADR-007)
 */

/**
 * Event priority levels
 */
export type EventPriority = 'critical' | 'high' | 'normal' | 'low';

/**
 * Core event structure
 */
export interface IEvent<T = unknown> {
  readonly id: string;
  readonly type: string;
  readonly timestamp: Date;
  readonly source: string;

  payload: T;
  priority?: EventPriority;
  correlationId?: string;
  causationId?: string;

  metadata?: {
    version?: number;
    userId?: string;
    sessionId?: string;
    [key: string]: unknown;
  };
}

/**
 * Event creation parameters
 */
export interface IEventCreate<T = unknown> {
  type: string;
  payload: T;
  source?: string;
  priority?: EventPriority;
  correlationId?: string;
  causationId?: string;
  metadata?: IEvent['metadata'];
}

/**
 * Event handler function type
 */
export type IEventHandler<T = unknown> = (event: IEvent<T>) => void | Promise<void>;

/**
 * Event filter for subscriptions
 */
export interface IEventFilter {
  types?: string[];
  sources?: string[];
  priority?: EventPriority[];
  correlationId?: string;
}

/**
 * Event subscription handle
 */
export interface IEventSubscription {
  readonly id: string;
  readonly filter: IEventFilter;

  /**
   * Unsubscribe from events
   */
  unsubscribe(): void;

  /**
   * Pause subscription
   */
  pause(): void;

  /**
   * Resume subscription
   */
  resume(): void;

  /**
   * Check if subscription is active
   */
  isActive(): boolean;
}

/**
 * Event bus interface for pub/sub communication
 */
export interface IEventBus {
  /**
   * Emit an event to all subscribers
   */
  emit<T = unknown>(type: string, payload: T, options?: Partial<IEventCreate<T>>): void;

  /**
   * Emit an event and wait for all handlers
   */
  emitAsync<T = unknown>(type: string, payload: T, options?: Partial<IEventCreate<T>>): Promise<void>;

  /**
   * Subscribe to events matching a type pattern
   */
  on<T = unknown>(type: string, handler: IEventHandler<T>): IEventSubscription;

  /**
   * Subscribe to events with filter
   */
  subscribe<T = unknown>(filter: IEventFilter, handler: IEventHandler<T>): IEventSubscription;

  /**
   * Subscribe to a single event occurrence
   */
  once<T = unknown>(type: string, handler: IEventHandler<T>): IEventSubscription;

  /**
   * Remove a specific handler
   */
  off(type: string, handler: IEventHandler): void;

  /**
   * Remove all handlers for a type
   */
  removeAllListeners(type?: string): void;

  /**
   * Get count of listeners for a type
   */
  listenerCount(type: string): number;

  /**
   * Get all event types with active listeners
   */
  eventNames(): string[];
}

/**
 * System event types enumeration
 */
export const SystemEventTypes = {
  // System lifecycle
  SYSTEM_READY: 'system:ready',
  SYSTEM_SHUTDOWN: 'system:shutdown',
  SYSTEM_ERROR: 'system:error',
  SYSTEM_HEALTHCHECK: 'system:healthcheck',

  // Agent lifecycle
  AGENT_SPAWNED: 'agent:spawned',
  AGENT_TERMINATED: 'agent:terminated',
  AGENT_ERROR: 'agent:error',
  AGENT_IDLE: 'agent:idle',
  AGENT_BUSY: 'agent:busy',
  AGENT_HEALTH_CHANGED: 'agent:health:changed',

  // Task lifecycle
  TASK_CREATED: 'task:created',
  TASK_ASSIGNED: 'task:assigned',
  TASK_STARTED: 'task:started',
  TASK_COMPLETED: 'task:completed',
  TASK_FAILED: 'task:failed',
  TASK_CANCELLED: 'task:cancelled',
  TASK_TIMEOUT: 'task:timeout',
  TASK_RETRY: 'task:retry',

  // Session lifecycle
  SESSION_CREATED: 'session:created',
  SESSION_RESTORED: 'session:restored',
  SESSION_TERMINATED: 'session:terminated',
  SESSION_PERSISTED: 'session:persisted',

  // Memory events
  MEMORY_STORED: 'memory:stored',
  MEMORY_RETRIEVED: 'memory:retrieved',
  MEMORY_CLEARED: 'memory:cleared',

  // Coordination events
  COORDINATION_STARTED: 'coordination:started',
  COORDINATION_COMPLETED: 'coordination:completed',
  DEADLOCK_DETECTED: 'coordination:deadlock',

  // Metrics events
  METRICS_COLLECTED: 'metrics:collected',
} as const;

export type SystemEventType = typeof SystemEventTypes[keyof typeof SystemEventTypes];

/**
 * Event store interface for event sourcing
 */
export interface IEventStore {
  /**
   * Append an event to the store
   */
  append(event: IEvent): Promise<void>;

  /**
   * Get events by aggregate ID
   */
  getByAggregateId(aggregateId: string, fromVersion?: number): Promise<IEvent[]>;

  /**
   * Get events by type
   */
  getByType(type: string, options?: { limit?: number; offset?: number }): Promise<IEvent[]>;

  /**
   * Get events in time range
   */
  getByTimeRange(start: Date, end: Date): Promise<IEvent[]>;

  /**
   * Get events by correlation ID
   */
  getByCorrelationId(correlationId: string): Promise<IEvent[]>;

  /**
   * Get all events (paginated)
   */
  getAll(options?: { limit?: number; offset?: number }): Promise<IEvent[]>;

  /**
   * Get event count
   */
  count(filter?: IEventFilter): Promise<number>;

  /**
   * Clear old events
   */
  prune(olderThan: Date): Promise<number>;
}

/**
 * Event coordinator for routing and orchestration
 */
export interface IEventCoordinator {
  /**
   * Initialize the coordinator
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the coordinator
   */
  shutdown(): Promise<void>;

  /**
   * Route an event to appropriate handlers
   */
  route(event: IEvent): Promise<void>;

  /**
   * Register a handler for event routing
   */
  registerHandler(type: string, handler: IEventHandler): void;

  /**
   * Unregister a handler
   */
  unregisterHandler(type: string, handler: IEventHandler): void;

  /**
   * Get event bus instance
   */
  getEventBus(): IEventBus;
}
