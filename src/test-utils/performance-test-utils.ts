/**
 * Performance Testing Utilities for Jest Environment
 * Addresses Issue #120 - Jest-compatible performance testing with proper cleanup
 */

import { TestCleanup } from './test-cleanup.js';

/**
 * Performance metrics for test operations
 */
export interface PerformanceMetrics {
  duration: number;
  memoryUsed: number;
  cpuUsage?: number;
  operations: number;
  throughput: number;
}

/**
 * Performance benchmark statistics
 */
export interface BenchmarkStats {
  mean: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  p95: number;
  p99: number;
  operations: number;
  throughput: number;
}

/**
 * Load testing results
 */
export interface LoadTestResults {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageResponseTime: number;
  requestsPerSecond: number;
  errors: Error[];
  memoryStats: PerformanceMetrics[];
}

/**
 * Performance testing utilities compatible with Jest
 */
export class PerformanceTestUtils {
  private static cleanup = new TestCleanup();

  /**
   * Get the current test cleanup instance
   */
  static getCleanup(): TestCleanup {
    return this.cleanup;
  }

  /**
   * Reset cleanup for new test
   */
  static resetCleanup(): void {
    this.cleanup = new TestCleanup();
  }

  /**
   * Measure execution time and memory usage of operation
   */
  static async measurePerformance<T>(
    operation: () => Promise<T>,
    options: { trackMemory?: boolean } = {}
  ): Promise<{ result: T; metrics: PerformanceMetrics }> {
    const { trackMemory = true } = options;
    
    // Force garbage collection before measurement
    if (global.gc) {
      global.gc();
    }
    
    const startTime = performance.now();
    const startMemory = trackMemory ? process.memoryUsage().heapUsed : 0;
    
    try {
      const result = await operation();
      
      const endTime = performance.now();
      const endMemory = trackMemory ? process.memoryUsage().heapUsed : 0;
      
      const metrics: PerformanceMetrics = {
        duration: endTime - startTime,
        memoryUsed: endMemory - startMemory,
        operations: 1,
        throughput: 1000 / (endTime - startTime) // ops per second
      };
      
      return { result, metrics };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Run performance benchmark with multiple iterations
   */
  static async benchmark<T>(
    operation: () => Promise<T>,
    options: {
      iterations?: number;
      warmupIterations?: number;
      concurrency?: number;
      trackMemory?: boolean;
    } = {}
  ): Promise<{
    results: T[];
    stats: BenchmarkStats;
    memoryStats?: PerformanceMetrics[];
  }> {
    const { 
      iterations = 100, 
      warmupIterations = 10, 
      concurrency = 1,
      trackMemory = false
    } = options;

    // Warmup phase
    for (let i = 0; i < warmupIterations; i++) {
      await operation();
    }

    // Force garbage collection after warmup
    if (global.gc) {
      global.gc();
    }

    const durations: number[] = [];
    const results: T[] = [];
    const memoryStats: PerformanceMetrics[] = [];

    const runBatch = async (batchSize: number) => {
      const promises = Array.from({ length: batchSize }, async () => {
        const { result, metrics } = await this.measurePerformance(operation, { trackMemory });
        return { result, metrics };
      });

      const batchResults = await Promise.all(promises);
      
      for (const { result, metrics } of batchResults) {
        results.push(result);
        durations.push(metrics.duration);
        if (trackMemory) {
          memoryStats.push(metrics);
        }
      }
    };

    // Run in batches based on concurrency
    const batches = Math.ceil(iterations / concurrency);
    for (let i = 0; i < batches; i++) {
      const batchSize = Math.min(concurrency, iterations - i * concurrency);
      await runBatch(batchSize);
    }

    // Calculate statistics
    const sortedDurations = durations.sort((a, b) => a - b);
    const mean = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    const median = sortedDurations[Math.floor(sortedDurations.length / 2)];
    const min = sortedDurations[0];
    const max = sortedDurations[sortedDurations.length - 1];
    
    const variance = durations.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / durations.length;
    const stdDev = Math.sqrt(variance);
    
    const p95 = sortedDurations[Math.floor(sortedDurations.length * 0.95)];
    const p99 = sortedDurations[Math.floor(sortedDurations.length * 0.99)];
    
    const totalDuration = durations.reduce((sum, d) => sum + d, 0);
    const throughput = (iterations * 1000) / totalDuration;

    const stats: BenchmarkStats = {
      mean,
      median,
      min,
      max,
      stdDev,
      p95,
      p99,
      operations: iterations,
      throughput
    };

    return {
      results,
      stats,
      memoryStats: trackMemory ? memoryStats : undefined
    };
  }

  /**
   * Load testing utility with proper cleanup
   */
  static async loadTest<T>(
    operation: () => Promise<T>,
    options: {
      duration?: number; // ms
      rampUpTime?: number; // ms
      maxConcurrency?: number;
      requestsPerSecond?: number;
      trackMemory?: boolean;
    } = {}
  ): Promise<LoadTestResults> {
    const {
      duration = 30000,
      rampUpTime = 5000,
      maxConcurrency = 10,
      requestsPerSecond = 10,
      trackMemory = false
    } = options;

    const results: Array<{ success: boolean; duration: number; error?: Error }> = [];
    const memoryStats: PerformanceMetrics[] = [];
    const startTime = Date.now();
    const endTime = startTime + duration;
    
    let currentConcurrency = 1;
    const targetInterval = 1000 / requestsPerSecond;
    const rampUpIncrement = (maxConcurrency - 1) / (rampUpTime / 1000);

    const runRequest = async () => {
      try {
        const { metrics } = await this.measurePerformance(operation, { trackMemory });
        results.push({ success: true, duration: metrics.duration });
        if (trackMemory) {
          memoryStats.push(metrics);
        }
      } catch (error) {
        results.push({
          success: false,
          duration: 0,
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    };

    const activeRequests = new Set<Promise<void>>();

    while (Date.now() < endTime) {
      // Ramp up concurrency
      const elapsed = Date.now() - startTime;
      if (elapsed < rampUpTime) {
        currentConcurrency = Math.min(
          maxConcurrency,
          1 + Math.floor((elapsed / 1000) * rampUpIncrement)
        );
      } else {
        currentConcurrency = maxConcurrency;
      }

      // Start new requests up to current concurrency
      while (activeRequests.size < currentConcurrency && Date.now() < endTime) {
        const requestPromise = runRequest().finally(() => {
          activeRequests.delete(requestPromise);
        });
        
        activeRequests.add(requestPromise);
        
        // Wait for interval using cleanup-tracked timeout
        await this.cleanup.createTimeoutPromise<void>(
          (resolve) => {
            this.cleanup.setTimeout(resolve, targetInterval);
          },
          targetInterval + 100
        );
      }
    }

    // Wait for all active requests to complete
    await Promise.all(activeRequests);

    // Calculate results
    const totalRequests = results.length;
    const successfulRequests = results.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;
    const averageResponseTime = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + r.duration, 0) / (successfulRequests || 1);
    const actualDuration = Date.now() - startTime;
    const actualRequestsPerSecond = totalRequests / (actualDuration / 1000);
    const errors = results.filter(r => r.error).map(r => r.error!);

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      averageResponseTime,
      requestsPerSecond: actualRequestsPerSecond,
      errors,
      memoryStats,
    };
  }

  /**
   * Memory stress testing
   */
  static async stressTestMemory<T>(
    operation: () => Promise<T>,
    options: {
      duration?: number;
      maxMemoryMB?: number;
      iterations?: number;
    } = {}
  ): Promise<{
    result: T;
    memoryPeak: number;
    memoryLeak: boolean;
    iterations: number;
  }> {
    const { duration = 10000, maxMemoryMB = 100, iterations = 1000 } = options;
    
    // Force garbage collection before test
    if (global.gc) {
      global.gc();
    }
    
    const startMemory = process.memoryUsage().heapUsed;
    const startTime = Date.now();
    let memoryPeak = startMemory;
    let result: T;
    let completedIterations = 0;
    
    try {
      while (Date.now() - startTime < duration && completedIterations < iterations) {
        result = await operation();
        completedIterations++;
        
        const currentMemory = process.memoryUsage().heapUsed;
        memoryPeak = Math.max(memoryPeak, currentMemory);
        
        // Check if memory usage exceeds limit
        if (currentMemory > maxMemoryMB * 1024 * 1024) {
          throw new Error(`Memory usage exceeded ${maxMemoryMB}MB limit`);
        }
      }
      
      // Force garbage collection after test
      if (global.gc) {
        global.gc();
      }
      
      const endMemory = process.memoryUsage().heapUsed;
      const memoryLeak = (endMemory - startMemory) > (1024 * 1024); // 1MB threshold
      
      return {
        result: result!,
        memoryPeak: memoryPeak - startMemory,
        memoryLeak,
        iterations: completedIterations
      };
      
    } catch (error) {
      throw error;
    }
  }

  /**
   * Comprehensive performance profile
   */
  static async profile<T>(
    operation: () => Promise<T>,
    options: {
      iterations?: number;
      concurrency?: number;
      trackMemory?: boolean;
    } = {}
  ): Promise<{
    result: T;
    benchmark: BenchmarkStats;
    memoryProfile?: PerformanceMetrics[];
    recommendations: string[];
  }> {
    const { iterations = 50, concurrency = 1, trackMemory = true } = options;
    
    const { results, stats, memoryStats } = await this.benchmark(
      operation,
      { iterations, concurrency, trackMemory, warmupIterations: 5 }
    );
    
    const recommendations: string[] = [];
    
    // Performance recommendations
    if (stats.mean > 1000) {
      recommendations.push('Consider optimizing: average execution time > 1s');
    }
    
    if (stats.stdDev > stats.mean * 0.5) {
      recommendations.push('High variance detected: execution time is inconsistent');
    }
    
    if (trackMemory && memoryStats) {
      const avgMemoryUsage = memoryStats.reduce((sum, m) => sum + m.memoryUsed, 0) / memoryStats.length;
      if (avgMemoryUsage > 10 * 1024 * 1024) { // 10MB
        recommendations.push('High memory usage detected: consider optimization');
      }
    }
    
    if (stats.throughput < 1) {
      recommendations.push('Low throughput detected: less than 1 operation per second');
    }
    
    return {
      result: results[0],
      benchmark: stats,
      memoryProfile: memoryStats,
      recommendations
    };
  }
}