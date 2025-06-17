/**
 * Coordination system exports
 */

// Core coordination components
export { CoordinationManager, type ICoordinationManager } from './manager.js';
export { TaskScheduler } from './scheduler.js';
export { ResourceManager } from './resources.js';
export { MessageRouter } from './messaging.js';

// Advanced scheduling
export { 
  AdvancedTaskScheduler,
  type SchedulingStrategy,
  type SchedulingContext,
  CapabilitySchedulingStrategy,
  RoundRobinSchedulingStrategy,
  LeastLoadedSchedulingStrategy,
  AffinitySchedulingStrategy,
} from './advanced-scheduler.js';

// Work stealing
export {
  WorkStealingCoordinator,
  type WorkStealingConfig,
  type AgentWorkload,
} from './work-stealing.js';

// Dependency management
export {
  DependencyGraph,
  type DependencyNode,
  type DependencyPath,
} from './dependency-graph.js';

// Circuit breakers
export {
  CircuitBreaker,
  CircuitBreakerManager,
  CircuitState,
  type CircuitBreakerConfig,
  type CircuitBreakerMetrics,
} from './circuit-breaker.js';

// Conflict resolution
export {
  ConflictResolver,
  PriorityResolutionStrategy,
  TimestampResolutionStrategy,
  VotingResolutionStrategy,
  OptimisticLockManager,
  type ResourceConflict,
  type TaskConflict,
  type ConflictResolution,
  type ConflictResolutionStrategy,
} from './conflict-resolution.js';

// Metrics and monitoring
export {
  CoordinationMetricsCollector,
  type CoordinationMetrics,
  type MetricsSample,
} from './metrics.js';