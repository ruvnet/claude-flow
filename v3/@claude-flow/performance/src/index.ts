/**
 * @claude-flow/performance
 *
 * Performance module for claude-flow v3.
 * Provides benchmarking, Flash Attention validation, optimization, and
 * resource-aware admission primitives.
 */

export {
  benchmark,
  BenchmarkRunner,
  compareResults,
  printComparisonReport,
  formatBytes,
  formatTime,
  meetsTarget,
  V3_PERFORMANCE_TARGETS,
  type BenchmarkResult,
  type BenchmarkOptions,
  type BenchmarkSuite,
  type EnvironmentInfo,
  type ComparisonResult,
  type MemoryUsage,
  type PerformanceTarget,
} from './framework/benchmark.js';

export {
  FlashAttentionOptimizer,
  createFlashAttentionOptimizer,
  quickBenchmark,
  type AttentionInput,
  type AttentionOutput,
  type BenchmarkResult as AttentionBenchmarkResult,
  type PerformanceMetrics as AttentionMetrics,
} from './attention-integration.js';

export {
  AttentionBenchmarkRunner,
  formatBenchmarkTable,
  formatSuiteReport,
  formatMemoryProfile,
  quickValidation,
  runAndDisplaySuite,
  runAndDisplayMemoryProfile,
  type ComparisonBenchmark,
  type SuiteResult,
  type MemoryProfile,
} from './attention-benchmarks.js';

export {
  decideResourceAdmission,
  type ResourceVerdict,
  type ResourceLimit,
  type ResourceProfile,
  type ResourceHostSnapshot,
  type ResourcePolicy,
  type ResourceAdmissionInput,
  type ResourceAdmissionDecision,
} from './resource-admission.js';

export { default } from './framework/benchmark.js';
