/**
 * @claude-flow/swarm/workers
 * Worker Dispatch Module (agentic-flow@alpha compatible)
 *
 * Provides background worker functionality with 12 trigger types
 * for analysis, optimization, and automation tasks.
 *
 * Triggers:
 * - ultralearn: Deep pattern learning
 * - optimize: Code/performance optimization
 * - consolidate: Memory consolidation
 * - predict: Predictive analysis
 * - audit: Security/quality audit
 * - map: Codebase mapping
 * - preload: Context preloading
 * - deepdive: Deep code analysis
 * - document: Documentation generation
 * - refactor: Code refactoring suggestions
 * - benchmark: Performance benchmarking
 * - testgaps: Test coverage analysis
 *
 * @module @claude-flow/swarm/workers
 * @version 3.0.0-alpha.1
 */

export {
  WorkerDispatchService,
  getWorkerDispatchService,
  createWorkerDispatchService,
  type WorkerTrigger,
  type WorkerStatus,
  type WorkerConfig,
  type WorkerInstance,
  type WorkerResult,
  type WorkerMetrics,
  type WorkerArtifact,
  type DispatchOptions,
  type TriggerDetectionResult,
} from './worker-dispatch.js';

// Re-export trigger types for convenience
export const WORKER_TRIGGERS = [
  'ultralearn',
  'optimize',
  'consolidate',
  'predict',
  'audit',
  'map',
  'preload',
  'deepdive',
  'document',
  'refactor',
  'benchmark',
  'testgaps',
] as const;

export const WORKER_PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;

export const WORKER_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
