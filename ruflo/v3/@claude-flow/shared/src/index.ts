/**
 * @claude-flow/shared - Shared Module
 * Common types, events, utilities, and core interfaces for V3 Claude-Flow
 *
 * Based on ADR-002 (DDD) and ADR-006 (Unified Memory Service)
 */

// =============================================================================
// Types - Primary type definitions (from ./types.js)
// =============================================================================
export * from './types.js';

// =============================================================================
// Events - Event bus and basic event interfaces (from ./events.js)
// =============================================================================
export { EventBus } from './events.js';
export type { IEventBus, EventFilter } from './events.js';

// =============================================================================
// Event Sourcing - ADR-007 Domain events and event store
// (from ./events/index.js - no duplicates with ./events.js)
// =============================================================================
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
  EventStoreConfig,
  EventSnapshot,
  EventStoreStats,
  AgentProjectionState,
  TaskProjectionState,
  MemoryProjectionState,
  AggregateRoot,
  ReconstructorOptions,
} from './events/index.js';

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
  EventStore,
  Projection,
  AgentStateProjection,
  TaskHistoryProjection,
  MemoryIndexProjection,
  StateReconstructor,
  createStateReconstructor,
  AgentAggregate,
  TaskAggregate,
} from './events/index.js';

// =============================================================================
// Plugin System - ADR-004
// =============================================================================
export * from './plugin-loader.js';
export * from './plugin-registry.js';

// =============================================================================
// Core - DDD interfaces, config, orchestrator
// Note: Only export non-overlapping items from core to avoid duplicates with types.js
// =============================================================================
export {
  // Event Bus
  createEventBus,
  // Orchestrator
  createOrchestrator,
  TaskManager,
  SessionManager,
  HealthMonitor,
  LifecycleManager,
  EventCoordinator,
  // Config validation/loading
  ConfigLoader,
  loadConfig,
  ConfigValidator,
  validateAgentConfig,
  validateTaskConfig,
  validateSwarmConfig,
  validateMemoryConfig,
  validateMCPServerConfig,
  validateOrchestratorConfig,
  validateSystemConfig,
  // Defaults
  defaultAgentConfig,
  defaultTaskConfig,
  defaultSwarmConfigCore,
  defaultMemoryConfig,
  defaultMCPServerConfig,
  defaultOrchestratorConfig,
  defaultSystemConfig,
  agentTypePresets,
  mergeWithDefaults,
} from './core/index.js';

export type {
  // Config types
  LoadedConfig,
  ConfigSource,
  ValidationResult,
  ValidationError,
  // Orchestrator types
  OrchestratorFacadeConfig,
  OrchestratorComponents,
  SessionManagerConfig,
  HealthMonitorConfig,
  LifecycleManagerConfig,
  // Schema types (from config - note these extend the basic types from types.js)
  AgentConfig,
  TaskConfig,
  SwarmConfig as SwarmConfigSchema,
  MemoryConfig,
  MCPServerConfig,
  OrchestratorConfig,
  SystemConfig,
  AgentConfigInput,
  TaskConfigInput,
  SwarmConfigInput,
  MemoryConfigInput,
  MCPServerConfigInput,
  OrchestratorConfigInput,
  SystemConfigInput,
  // Interface types
  ITask,
  ITaskCreate,
  ITaskResult,
  IAgent,
  IAgentConfig,
  IEventBus as ICoreEventBus,
  IMemoryBackend as ICoreMemoryBackend,
  ISwarmConfig,
  ISwarmState,
  ICoordinator,
  ICoordinationManager,
  IHealthStatus,
  IComponentHealth,
  IHealthMonitor,
  IMetricsCollector,
  IOrchestratorMetrics,
  IOrchestrator,
  SwarmTopology,
  CoordinationStatus,
} from './core/index.js';

// =============================================================================
// Hooks System
// =============================================================================
export * from './hooks/index.js';

// =============================================================================
// Security Utilities
// =============================================================================
export * from './security/index.js';

// =============================================================================
// Resilience Patterns
// =============================================================================
export * from './resilience/index.js';

// =============================================================================
// Services
// =============================================================================
export * from './services/index.js';
