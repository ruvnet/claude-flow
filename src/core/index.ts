/**
 * Core Module Exports
 * Provides essential orchestration and system functionality
 */

// Orchestrator
export { 
  Orchestrator,
  type AgentInfo,
  type TaskInfo,
  type SessionInfo,
  type WorkflowStatus,
  type HealthCheckResult
} from './orchestrator-fixed.js';

// Event Bus
export { 
  EventBus,
  eventBus,
  type IEventBus
} from './event-bus.js';

// Logger
export {
  Logger,
  LogLevel,
  type ILogger,
  type LoggerOptions,
  type LogEntry
} from './logger.js';

// JSON Persistence
export {
  JsonPersistenceManager,
  type PersistedAgent,
  type PersistedTask
} from './json-persistence.js';

// Core Types
// TODO: Define these types when needed
// export type {
//   SystemHealth,
//   SystemStatus,
//   CoreMetrics,
//   CoreConfig
// } from '../types/core-types.js';