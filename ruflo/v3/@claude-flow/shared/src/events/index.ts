/**
 * Event Sourcing System (ADR-007)
 *
 * Complete event sourcing implementation for V3 Claude Flow:
 * - Domain events for all aggregates (agent, task, memory, swarm)
 * - Persistent event store with SQLite backend
 * - Projections for building read models
 * - Event replay and snapshots
 *
 * @module v3/shared/events
 */

// Domain Event Types
export type {
  DomainEvent,
  AllDomainEvents,
  AgentSpawnedEvent,
  AgentStartedEvent,
  AgentStoppedEvent,
  AgentFailedEvent,
  AgentStatusChangedEvent,
  AgentTaskAssignedEvent,
  AgentTaskCompletedEvent,
  TaskCreatedEvent,
  TaskStartedEvent,
  TaskCompletedEvent,
  TaskFailedEvent,
  TaskBlockedEvent,
  TaskQueuedEvent,
  MemoryStoredEvent,
  MemoryRetrievedEvent,
  MemoryDeletedEvent,
  MemoryExpiredEvent,
  SwarmInitializedEvent,
  SwarmScaledEvent,
  SwarmTerminatedEvent,
  SwarmPhaseChangedEvent,
  SwarmMilestoneReachedEvent,
  SwarmErrorEvent,
} from './domain-events.js';

// Domain Event Factory Functions
export {
  createAgentSpawnedEvent,
  createAgentStartedEvent,
  createAgentStoppedEvent,
  createAgentFailedEvent,
  createTaskCreatedEvent,
  createTaskStartedEvent,
  createTaskCompletedEvent,
  createTaskFailedEvent,
  createMemoryStoredEvent,
  createMemoryRetrievedEvent,
  createMemoryDeletedEvent,
  createSwarmInitializedEvent,
  createSwarmScaledEvent,
  createSwarmTerminatedEvent,
} from './domain-events.js';

// Event Store
export { EventStore } from './event-store.js';
export type {
  EventStoreConfig,
  EventFilter,
  EventSnapshot,
  EventStoreStats,
} from './event-store.js';

// Projections
export {
  Projection,
  AgentStateProjection,
  TaskHistoryProjection,
  MemoryIndexProjection,
} from './projections.js';
export type {
  AgentProjectionState,
  TaskProjectionState,
  MemoryProjectionState,
} from './projections.js';

// State Reconstruction (ADR-007)
export {
  StateReconstructor,
  createStateReconstructor,
  AgentAggregate,
  TaskAggregate,
  type AggregateRoot,
  type ReconstructorOptions,
} from './state-reconstructor.js';
