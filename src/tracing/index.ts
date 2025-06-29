/**
 * Process Execution Tracing Framework
 * 
 * Provides comprehensive process execution tracing with automatic child-process
 * usage tracking, metrics collection, and threshold enforcement.
 */

// Core tracing functionality
export {
  spawn,
  exec,
  execFile,
  fork,
  getExecutionId,
  getMetrics,
  getSpawnCount,
  resetMetrics,
  exportMetrics,
  isThresholdExceeded,
  spawnOriginal,
  execOriginal,
  execFileOriginal,
  forkOriginal
} from './child.js';

// Metrics and configuration
export {
  metrics,
  ProcessMetricsCollector,
  type ProcessMetrics,
  type ProcessExecution,
  type ThresholdViolation,
  type TracingConfig
} from './metrics.js';

// Enhanced options interfaces
export {
  type TracedSpawnOptions,
  type TracedExecOptions,
  type TracedExecFileOptions,
  type TracedForkOptions
} from './child.js';

// Re-export Node.js types for convenience
export { ChildProcess } from './child.js';
export type {
  SpawnOptions,
  ExecOptions,
  ExecFileOptions,
  ForkOptions
} from './child.js';
