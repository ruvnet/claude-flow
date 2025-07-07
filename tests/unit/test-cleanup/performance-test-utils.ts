/**
 * Performance Testing Utilities for Deno
 * Advanced benchmarking and load testing capabilities
 */

import { TestCleanup } from "./test-cleanup.ts";

export interface PerformanceMetrics {
  duration: number;
  operations: number;
  throughput: number;
  memoryUsed?: number;
  memoryDelta?: number;
}

export interface BenchmarkResult {
  individual: number[];
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  operations: number;
  throughput: number;
}

export interface PerformanceProfile {
  result: unknown;
  benchmark: BenchmarkResult;
  recommendations: string[];
}

export class PerformanceTestUtils {
  private static cleanup = new TestCleanup();

  static getCleanup(): TestCleanup {
    return this.cleanup;
  }

  static resetCleanup(): void {
    this.cleanup = new TestCleanup();
  }

  /**
   * Measure performance of an async operation
   */
  static async measurePerformance<T>(
    operation: () => Promise<T>,
    options: { trackMemory?: boolean } = {}
  ): Promise<{ result: T; metrics: PerformanceMetrics }> {
    const startTime = performance.now();
    let startMemory = 0;
    
    if (options.trackMemory) {
      // Force GC before measurement
      if ((globalThis as { gc?: () => void }).gc) {
        (globalThis as { gc: () => void }).gc();
      }
      
      // Get memory usage (Deno-specific)
      try {
        startMemory = (Deno.memoryUsage?.() as { heapUsed: number })?.heapUsed || 0;
      } catch {
        // Fallback if memoryUsage is not available
        startMemory = 0;
      }
    }

    const result = await operation();

    const endTime = performance.now();
    const duration = endTime - startTime;
    
    let endMemory = 0;
    if (options.trackMemory) {
      try {
        endMemory = (Deno.memoryUsage?.() as { heapUsed: number })?.heapUsed || 0;
      } catch {
        endMemory = 0;
      }
    }

    const metrics: PerformanceMetrics = {
      duration,
      operations: 1,
      throughput: 1000 / duration, // ops per second
      memoryUsed: endMemory,
      memoryDelta: endMemory - startMemory,
    };

    return { result, metrics };
  }

  /**
   * Run a benchmark with multiple iterations
   */
  static async benchmark<T>(
    operation: () => Promise<T>,
    options: {
      iterations?: number;
      warmupIterations?: number;
      trackMemory?: boolean;
    } = {}
  ): Promise<{ results: T[]; stats: BenchmarkResult }> {
    const {
      iterations = 100,
      warmupIterations = 10,
      trackMemory = false,
    } = options;

    // Warmup phase
    for (let i = 0; i < warmupIterations; i++) {
      await operation();
    }

    // Force GC before benchmark
    if ((globalThis as { gc?: () => void }).gc) {
      (globalThis as { gc: () => void }).gc();
    }

    const results: T[] = [];
    const durations: number[] = [];

    // Benchmark phase
    for (let i = 0; i < iterations; i++) {
      const { result, metrics } = await this.measurePerformance(operation, { trackMemory });
      results.push(result);
      durations.push(metrics.duration);
    }

    // Calculate statistics
    const sortedDurations = [...durations].sort((a, b) => a - b);
    const mean = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const median = sortedDurations[Math.floor(sortedDurations.length / 2)];
    const min = Math.min(...durations);
    const max = Math.max(...durations);
    
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);

    const stats: BenchmarkResult = {
      individual: durations,
      mean,
      median,
      min,
      max,
      stdDev,
      operations: iterations,
      throughput: 1000 / mean, // ops per second
    };

    return { results, stats };
  }

  /**
   * Profile performance and provide recommendations
   */
  static async profile<T>(
    operation: () => Promise<T>,
    options: {
      iterations?: number;
      thresholds?: {
        slowOperation?: number;
        memoryLeak?: number;
        highVariability?: number;
      };
    } = {}
  ): Promise<PerformanceProfile> {
    const { iterations = 50 } = options;
    const thresholds = {
      slowOperation: 100, // ms
      memoryLeak: 1024 * 1024, // 1MB
      highVariability: 0.3, // 30% coefficient of variation
      ...options.thresholds,
    };

    const { results, stats } = await this.benchmark(operation, {
      iterations,
      trackMemory: true,
    });

    const recommendations: string[] = [];

    // Analyze performance characteristics
    if (stats.mean > thresholds.slowOperation) {
      recommendations.push(
        `Operation is slow (${stats.mean.toFixed(2)}ms avg). Consider optimization.`
      );
    }

    const coefficientOfVariation = stats.stdDev / stats.mean;
    if (coefficientOfVariation > thresholds.highVariability) {
      recommendations.push(
        `High performance variability (CV: ${(coefficientOfVariation * 100).toFixed(1)}%). ` +
        `Consider investigating inconsistent execution paths.`
      );
    }

    if (stats.throughput < 10) {
      recommendations.push(
        `Low throughput (${stats.throughput.toFixed(2)} ops/sec). ` +
        `Consider batching or parallel processing.`
      );
    }

    if (stats.throughput > 1000) {
      recommendations.push(
        `High throughput (${stats.throughput.toFixed(2)} ops/sec). ` +
        `Performance is excellent.`
      );
    }

    if (recommendations.length === 0) {
      recommendations.push("Performance appears optimal for this operation.");
    }

    return {
      result: results[0],
      benchmark: stats,
      recommendations,
    };
  }

  /**
   * Load testing with concurrent operations
   */
  static async loadTest<T>(
    operation: () => Promise<T>,
    options: {
      concurrency?: number;
      duration?: number;
      maxOperations?: number;
    } = {}
  ): Promise<{
    totalOperations: number;
    successfulOperations: number;
    failedOperations: number;
    averageLatency: number;
    throughput: number;
    errors: Error[];
  }> {
    const {
      concurrency = 10,
      duration = 5000, // 5 seconds
      maxOperations = Infinity,
    } = options;

    const startTime = Date.now();
    const endTime = startTime + duration;
    
    let totalOperations = 0;
    let successfulOperations = 0;
    let failedOperations = 0;
    const latencies: number[] = [];
    const errors: Error[] = [];

    const workers: Promise<void>[] = [];

    // Create concurrent workers
    for (let i = 0; i < concurrency; i++) {
      const worker = (async () => {
        while (Date.now() < endTime && totalOperations < maxOperations) {
          const operationStart = performance.now();
          totalOperations++;

          try {
            await operation();
            successfulOperations++;
            latencies.push(performance.now() - operationStart);
          } catch (error) {
            failedOperations++;
            errors.push(error as Error);
          }
        }
      })();

      workers.push(worker);
    }

    // Wait for all workers to complete
    await Promise.all(workers);

    const actualDuration = Date.now() - startTime;
    const averageLatency = latencies.length > 0 
      ? latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length 
      : 0;

    return {
      totalOperations,
      successfulOperations,
      failedOperations,
      averageLatency,
      throughput: (successfulOperations / actualDuration) * 1000, // ops per second
      errors,
    };
  }

  /**
   * Memory stress testing
   */
  static async memoryStressTest<T>(
    operation: () => Promise<T>,
    options: {
      iterations?: number;
      memoryThreshold?: number;
    } = {}
  ): Promise<{
    completed: boolean;
    iterations: number;
    peakMemory: number;
    memoryLeak: boolean;
    memoryIncrease: number;
  }> {
    const { iterations = 1000, memoryThreshold = 100 * 1024 * 1024 } = options; // 100MB default

    // Force GC and get baseline
    if ((globalThis as { gc?: () => void }).gc) {
      (globalThis as { gc: () => void }).gc();
    }

    let baselineMemory = 0;
    let peakMemory = 0;
    
    try {
      baselineMemory = (Deno.memoryUsage?.() as { heapUsed: number })?.heapUsed || 0;
      peakMemory = baselineMemory;
    } catch {
      // Handle case where memoryUsage is not available
      baselineMemory = 0;
      peakMemory = 0;
    }

    let completed = false;
    let currentIteration = 0;

    try {
      for (currentIteration = 0; currentIteration < iterations; currentIteration++) {
        await operation();

        // Check memory every 10 iterations
        if (currentIteration % 10 === 0) {
          try {
            const currentMemory = (Deno.memoryUsage?.() as { heapUsed: number })?.heapUsed || 0;
            peakMemory = Math.max(peakMemory, currentMemory);

            if (currentMemory > memoryThreshold) {
              break;
            }
          } catch {
            // Continue if memory check fails
          }
        }
      }

      completed = currentIteration === iterations;
    } catch (error) {
      // Test failed due to error, not memory
      throw error;
    }

    // Final memory check
    let finalMemory = 0;
    try {
      finalMemory = (Deno.memoryUsage?.() as { heapUsed: number })?.heapUsed || 0;
    } catch {
      finalMemory = 0;
    }

    const memoryIncrease = finalMemory - baselineMemory;
    const memoryLeak = memoryIncrease > (baselineMemory * 0.1); // 10% increase considered a leak

    return {
      completed,
      iterations: currentIteration,
      peakMemory,
      memoryLeak,
      memoryIncrease,
    };
  }
}