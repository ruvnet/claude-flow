/**
 * @claude-flow/performance - Flash Attention Integration
 *
 * Integrates @ruvector/attention Flash Attention capabilities into V3 performance module.
 * Provides optimized attention mechanisms with 2.49x-7.47x speedup targets.
 *
 * Features:
 * - Flash Attention for memory-efficient processing
 * - Automatic runtime selection (NAPI/WASM/JS)
 * - Performance benchmarking and metrics
 * - Speedup tracking and validation
 */

import {
  FlashAttention,
  DotProductAttention,
  type BenchmarkResult as AttentionBenchmarkResult,
  type ArrayInput,
} from '@ruvector/attention';

// ============================================================================
// Types
// ============================================================================

export interface AttentionInput {
  query: Float32Array | number[];
  keys: Float32Array[] | number[][];
  values: Float32Array[] | number[][];
  dim?: number;
  blockSize?: number;
}

export interface AttentionOutput {
  result: Float32Array;
  runtime: 'napi' | 'wasm' | 'js';
  executionTimeMs: number;
  memoryUsageBytes?: number;
}

export interface BenchmarkResult {
  flashAttention: {
    averageTimeMs: number;
    opsPerSecond: number;
    memoryUsageBytes?: number;
  };
  baseline: {
    averageTimeMs: number;
    opsPerSecond: number;
    memoryUsageBytes?: number;
  };
  speedup: number;
  meetsTarget: boolean; // true if speedup >= 2.49x
  timestamp: Date;
}

export interface PerformanceMetrics {
  totalOperations: number;
  averageSpeedup: number;
  peakSpeedup: number;
  averageExecutionTimeMs: number;
  totalMemorySavedBytes: number;
  successRate: number; // % of operations meeting target
  // Memory tracking metrics
  baselineMemoryBytes: number;
  optimizedMemoryBytes: number;
  memorySavedBytes: number;
  memorySavedPercent: number;
  peakMemoryBytes: number;
}

// ============================================================================
// Flash Attention Optimizer
// ============================================================================

export class FlashAttentionOptimizer {
  private flashAttention: FlashAttention;
  private baselineAttention: DotProductAttention;
  private metrics: {
    operations: number;
    totalSpeedup: number;
    peakSpeedup: number;
    totalExecutionTime: number;
    successfulOperations: number;
    // Memory tracking
    totalBaselineMemory: number;
    totalOptimizedMemory: number;
    peakMemory: number;
  };

  constructor(
    private readonly dim: number = 512,
    private readonly blockSize: number = 64
  ) {
    this.flashAttention = new FlashAttention(dim, blockSize);
    this.baselineAttention = new DotProductAttention(dim);
    this.metrics = {
      operations: 0,
      totalSpeedup: 0,
      peakSpeedup: 0,
      totalExecutionTime: 0,
      successfulOperations: 0,
      totalBaselineMemory: 0,
      totalOptimizedMemory: 0,
      peakMemory: 0,
    };
  }

  /**
   * Optimize attention computation using Flash Attention
   * @param input - Query, keys, and values for attention computation
   * @returns Optimized attention output with performance metrics
   */
  optimize(input: AttentionInput): AttentionOutput {
    const startTime = performance.now();
    const startMemory = this.getMemoryUsage();

    // Convert inputs if needed
    const query = this.ensureFloat32Array(input.query);
    const keys = input.keys.map(k => this.ensureFloat32Array(k));
    const values = input.values.map(v => this.ensureFloat32Array(v));

    // Use synchronous Flash Attention with raw Float32Arrays
    const result = this.flashAttention.computeRaw(query, keys, values);

    const executionTimeMs = performance.now() - startTime;
    const endMemory = this.getMemoryUsage();
    const memoryUsageBytes = endMemory - startMemory;

    // Update metrics
    this.metrics.operations++;
    this.metrics.totalExecutionTime += executionTimeMs;

    return {
      result,
      runtime: this.detectRuntime(),
      executionTimeMs,
      memoryUsageBytes: memoryUsageBytes > 0 ? memoryUsageBytes : undefined,
    };
  }

  /**
   * Benchmark Flash Attention vs baseline attention
   * @returns Comprehensive benchmark results with speedup metrics
   */
  benchmark(): BenchmarkResult {
    const dim = this.dim;
    const numKeys = 100;
    const iterations = 1000;

    // Create test data
    const query = new Float32Array(dim);
    const keys = Array.from({ length: numKeys }, () => new Float32Array(dim));
    const values = Array.from({ length: numKeys }, () => new Float32Array(dim));

    // Fill with random data
    for (let i = 0; i < dim; i++) {
      query[i] = Math.random();
    }
    for (let i = 0; i < numKeys; i++) {
      for (let j = 0; j < dim; j++) {
        keys[i][j] = Math.random();
        values[i][j] = Math.random();
      }
    }

    // Force garbage collection if available for accurate memory measurement
    this.forceGC();

    // Measure baseline memory usage
    const baselineMemoryBefore = this.getMemoryUsage();
    let baselinePeakMemory = baselineMemoryBefore;

    // Benchmark baseline (DotProduct) - run first to establish baseline memory
    const baselineStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.baselineAttention.computeRaw(query, keys, values);
      // Sample memory periodically (every 100 iterations to reduce overhead)
      if (i % 100 === 0) {
        const currentMemory = this.getMemoryUsage();
        if (currentMemory > baselinePeakMemory) {
          baselinePeakMemory = currentMemory;
        }
      }
    }
    const baselineEnd = performance.now();
    const baselineMemoryAfter = this.getMemoryUsage();
    const baselineTimeMs = baselineEnd - baselineStart;
    const baselineAvgMs = baselineTimeMs / iterations;
    const baselineMemoryUsed = Math.max(0, baselinePeakMemory - baselineMemoryBefore);

    // Force garbage collection before Flash Attention benchmark
    this.forceGC();

    // Measure Flash Attention memory usage
    const flashMemoryBefore = this.getMemoryUsage();
    let flashPeakMemory = flashMemoryBefore;

    // Benchmark Flash Attention
    const flashStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      this.flashAttention.computeRaw(query, keys, values);
      // Sample memory periodically
      if (i % 100 === 0) {
        const currentMemory = this.getMemoryUsage();
        if (currentMemory > flashPeakMemory) {
          flashPeakMemory = currentMemory;
        }
      }
    }
    const flashEnd = performance.now();
    const flashTimeMs = flashEnd - flashStart;
    const flashAvgMs = flashTimeMs / iterations;
    const flashMemoryUsed = Math.max(0, flashPeakMemory - flashMemoryBefore);

    const speedup = baselineAvgMs / flashAvgMs;
    const meetsTarget = speedup >= 2.49; // Minimum target: 2.49x

    // Update peak speedup
    if (speedup > this.metrics.peakSpeedup) {
      this.metrics.peakSpeedup = speedup;
    }

    // Update memory tracking metrics
    this.metrics.totalBaselineMemory += baselineMemoryUsed;
    this.metrics.totalOptimizedMemory += flashMemoryUsed;
    if (flashPeakMemory > this.metrics.peakMemory) {
      this.metrics.peakMemory = flashPeakMemory;
    }

    this.metrics.totalSpeedup += speedup;
    if (meetsTarget) {
      this.metrics.successfulOperations++;
    }

    return {
      flashAttention: {
        averageTimeMs: flashAvgMs,
        opsPerSecond: 1000 / flashAvgMs,
        memoryUsageBytes: flashMemoryUsed,
      },
      baseline: {
        averageTimeMs: baselineAvgMs,
        opsPerSecond: 1000 / baselineAvgMs,
        memoryUsageBytes: baselineMemoryUsed,
      },
      speedup,
      meetsTarget,
      timestamp: new Date(),
    };
  }

  /**
   * Get current speedup factor from accumulated metrics
   * @returns Average speedup factor across all operations
   */
  getSpeedup(): number {
    if (this.metrics.operations === 0) {
      return 0;
    }
    return this.metrics.totalSpeedup / this.metrics.operations;
  }

  /**
   * Get comprehensive performance metrics
   * @returns Detailed performance statistics
   */
  getMetrics(): PerformanceMetrics {
    const avgSpeedup = this.getSpeedup();

    // Calculate memory savings
    const baselineMemory = this.metrics.totalBaselineMemory;
    const optimizedMemory = this.metrics.totalOptimizedMemory;
    const memorySaved = Math.max(0, baselineMemory - optimizedMemory);
    const memorySavedPercent =
      baselineMemory > 0 ? (memorySaved / baselineMemory) * 100 : 0;

    return {
      totalOperations: this.metrics.operations,
      averageSpeedup: avgSpeedup,
      peakSpeedup: this.metrics.peakSpeedup,
      averageExecutionTimeMs:
        this.metrics.operations > 0
          ? this.metrics.totalExecutionTime / this.metrics.operations
          : 0,
      totalMemorySavedBytes: memorySaved,
      successRate:
        this.metrics.operations > 0
          ? (this.metrics.successfulOperations / this.metrics.operations) * 100
          : 0,
      // Memory tracking metrics
      baselineMemoryBytes: baselineMemory,
      optimizedMemoryBytes: optimizedMemory,
      memorySavedBytes: memorySaved,
      memorySavedPercent: memorySavedPercent,
      peakMemoryBytes: this.metrics.peakMemory,
    };
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.metrics = {
      operations: 0,
      totalSpeedup: 0,
      peakSpeedup: 0,
      totalExecutionTime: 0,
      successfulOperations: 0,
      totalBaselineMemory: 0,
      totalOptimizedMemory: 0,
      peakMemory: 0,
    };
  }

  /**
   * Ensure input is Float32Array for optimal performance
   */
  private ensureFloat32Array(input: ArrayInput): Float32Array {
    if (input instanceof Float32Array) {
      return input;
    }
    return new Float32Array(input);
  }

  /**
   * Detect which runtime is being used
   */
  private detectRuntime(): 'napi' | 'wasm' | 'js' {
    // Check if NAPI bindings are available
    try {
      if (typeof process !== 'undefined' && process.versions && 'napi' in process.versions) {
        return 'napi';
      }
    } catch {
      // Not in Node.js environment
    }

    // Check for WebAssembly support
    if (typeof globalThis !== 'undefined' && 'WebAssembly' in globalThis) {
      return 'wasm';
    }

    // Fallback to pure JS
    return 'js';
  }

  /**
   * Get current memory usage in bytes
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }

  /**
   * Force garbage collection if available (requires --expose-gc flag)
   * This helps get more accurate memory measurements
   */
  private forceGC(): void {
    if (typeof global !== 'undefined' && typeof (global as any).gc === 'function') {
      (global as any).gc();
    }
  }

  /**
   * Benchmark memory usage across multiple dimensions
   * Validates the 50-75% memory reduction target
   * @param dimensions - Array of dimensions to test (default: [128, 256, 512, 1024])
   * @returns Memory profiling results for each dimension
   */
  benchmarkMemory(
    dimensions: number[] = [128, 256, 512, 1024]
  ): {
    dimension: number;
    baselineMemoryBytes: number;
    optimizedMemoryBytes: number;
    memorySavedBytes: number;
    memorySavedPercent: number;
    meetsTarget: boolean; // true if 50-75% reduction achieved
  }[] {
    const results: {
      dimension: number;
      baselineMemoryBytes: number;
      optimizedMemoryBytes: number;
      memorySavedBytes: number;
      memorySavedPercent: number;
      meetsTarget: boolean;
    }[] = [];

    for (const dim of dimensions) {
      const numKeys = 100;
      const iterations = 100; // Fewer iterations for memory profiling

      // Create test data
      const query = new Float32Array(dim);
      const keys = Array.from({ length: numKeys }, () => new Float32Array(dim));
      const values = Array.from({ length: numKeys }, () => new Float32Array(dim));

      // Fill with random data
      for (let i = 0; i < dim; i++) {
        query[i] = Math.random();
      }
      for (let i = 0; i < numKeys; i++) {
        for (let j = 0; j < dim; j++) {
          keys[i][j] = Math.random();
          values[i][j] = Math.random();
        }
      }

      // Create temporary instances for this dimension
      const flashAttention = new FlashAttention(dim, this.blockSize);
      const baselineAttention = new DotProductAttention(dim);

      // Measure baseline memory
      this.forceGC();
      const baselineMemBefore = this.getMemoryUsage();
      let baselinePeak = baselineMemBefore;

      for (let i = 0; i < iterations; i++) {
        baselineAttention.computeRaw(query, keys, values);
        if (i % 10 === 0) {
          const curr = this.getMemoryUsage();
          if (curr > baselinePeak) baselinePeak = curr;
        }
      }
      const baselineMemoryUsed = Math.max(0, baselinePeak - baselineMemBefore);

      // Measure Flash Attention memory
      this.forceGC();
      const flashMemBefore = this.getMemoryUsage();
      let flashPeak = flashMemBefore;

      for (let i = 0; i < iterations; i++) {
        flashAttention.computeRaw(query, keys, values);
        if (i % 10 === 0) {
          const curr = this.getMemoryUsage();
          if (curr > flashPeak) flashPeak = curr;
        }
      }
      const flashMemoryUsed = Math.max(0, flashPeak - flashMemBefore);

      const memorySaved = Math.max(0, baselineMemoryUsed - flashMemoryUsed);
      const memorySavedPercent =
        baselineMemoryUsed > 0 ? (memorySaved / baselineMemoryUsed) * 100 : 0;

      // Target: 50-75% memory reduction
      const meetsTarget = memorySavedPercent >= 50 && memorySavedPercent <= 100;

      results.push({
        dimension: dim,
        baselineMemoryBytes: baselineMemoryUsed,
        optimizedMemoryBytes: flashMemoryUsed,
        memorySavedBytes: memorySaved,
        memorySavedPercent: memorySavedPercent,
        meetsTarget: meetsTarget,
      });

      // Update global metrics
      this.metrics.totalBaselineMemory += baselineMemoryUsed;
      this.metrics.totalOptimizedMemory += flashMemoryUsed;
      if (flashPeak > this.metrics.peakMemory) {
        this.metrics.peakMemory = flashPeak;
      }
    }

    return results;
  }
}

// ============================================================================
// Convenience Factory Functions
// ============================================================================

/**
 * Create a Flash Attention optimizer with default settings
 * @param dim - Dimension of attention vectors (default: 512)
 * @param blockSize - Block size for Flash Attention (default: 64)
 * @returns Configured FlashAttentionOptimizer instance
 */
export function createFlashAttentionOptimizer(
  dim: number = 512,
  blockSize: number = 64
): FlashAttentionOptimizer {
  return new FlashAttentionOptimizer(dim, blockSize);
}

/**
 * Quick benchmark of Flash Attention performance
 * @param dim - Dimension to test (default: 512)
 * @returns Benchmark results with speedup metrics
 */
export function quickBenchmark(dim: number = 512): BenchmarkResult {
  const optimizer = createFlashAttentionOptimizer(dim);
  return optimizer.benchmark();
}

// ============================================================================
// Exports
// ============================================================================

export {
  FlashAttention,
  DotProductAttention,
  type AttentionBenchmarkResult,
};
