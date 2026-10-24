/**
 * @claude-flow/performance
 *
 * Performance module for claude-flow v3.
 * Provides benchmarking, Flash Attention validation, and optimization utilities.
 *
 * Target Performance Metrics:
 * - CLI Startup: <500ms (5x faster)
 * - MCP Init: <400ms (4.5x faster)
 * - Agent Spawn: <200ms (4x faster)
 * - Vector Search: <1ms (150x faster)
 * - Memory Write: <5ms (10x faster)
 * - Swarm Consensus: <100ms (5x faster)
 * - Flash Attention: 2.49x-7.47x speedup
 * - Memory Usage: <256MB (50% reduction)
 */

// Re-export benchmark framework
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

// Re-export Flash Attention integration
export {
  FlashAttentionOptimizer,
  createFlashAttentionOptimizer,
  quickBenchmark,
  type AttentionInput,
  type AttentionOutput,
  type BenchmarkResult as AttentionBenchmarkResult,
  type PerformanceMetrics as AttentionMetrics,
} from './attention-integration.js';

// Re-export Flash Attention benchmarks
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

// Default export for convenience
export { default } from './framework/benchmark.js';
