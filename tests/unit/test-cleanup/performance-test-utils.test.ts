/**
 * Performance Testing Utilities Test Suite
 * Validates benchmarking and load testing capabilities
 */

import { describe, it, beforeEach, afterEach } from "https://deno.land/std@0.220.0/testing/bdd.ts";
import { assertEquals, assert } from "https://deno.land/std@0.220.0/assert/mod.ts";
import { PerformanceTestUtils } from "./performance-test-utils.ts";

describe("PerformanceTestUtils", () => {
  beforeEach(() => {
    PerformanceTestUtils.resetCleanup();
  });

  afterEach(async () => {
    await PerformanceTestUtils.getCleanup().cleanup();
  });

  describe("measurePerformance", () => {
    it("should measure execution time and memory", async () => {
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'result';
      };
      
      const { result, metrics } = await PerformanceTestUtils.measurePerformance(operation, {
        trackMemory: true
      });
      
      assertEquals(result, 'result');
      assert(metrics.duration >= 90); // Should take at least ~100ms
      assertEquals(metrics.operations, 1);
      assert(metrics.throughput > 0);
      
      // Memory metrics should be present when tracking is enabled
      assert(typeof metrics.memoryUsed === 'number');
      assert(typeof metrics.memoryDelta === 'number');
    });
  });

  describe("benchmark", () => {
    it("should run performance benchmark", async () => {
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return Math.random();
      };
      
      const { results, stats } = await PerformanceTestUtils.benchmark(operation, {
        iterations: 10,
        warmupIterations: 2
      });
      
      assertEquals(results.length, 10);
      assertEquals(stats.operations, 10);
      assert(stats.mean > 0);
      assert(stats.min > 0);
      assert(stats.max >= stats.min);
      assert(stats.throughput > 0);
      
      // Standard deviation should be reasonable
      assert(stats.stdDev >= 0);
      
      // Individual results should match total operations
      assertEquals(stats.individual.length, 10);
    });
  });

  describe("profile", () => {
    it("should provide performance profile with recommendations", async () => {
      const operation = async () => {
        await new Promise(resolve => setTimeout(resolve, 20));
        return 'result';
      };
      
      const { result, benchmark, recommendations } = await PerformanceTestUtils.profile(operation, {
        iterations: 5
      });
      
      assertEquals(result, 'result');
      assertEquals(benchmark.operations, 5);
      assert(Array.isArray(recommendations));
      assert(recommendations.length > 0);
      
      // Should have some meaningful recommendation
      assert(recommendations.some(rec => rec.length > 10));
    });
  });

  describe("loadTest", () => {
    it("should perform concurrent load testing", async () => {
      let operationCount = 0;
      const operation = async () => {
        operationCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return operationCount;
      };
      
      const loadTestResult = await PerformanceTestUtils.loadTest(operation, {
        concurrency: 3,
        duration: 200, // Short duration for testing
        maxOperations: 50
      });
      
      assert(loadTestResult.totalOperations > 0);
      assert(loadTestResult.successfulOperations <= loadTestResult.totalOperations);
      assertEquals(loadTestResult.failedOperations, 0); // Should not fail
      assert(loadTestResult.averageLatency >= 0);
      assert(loadTestResult.throughput >= 0);
      assertEquals(loadTestResult.errors.length, 0);
    });

    it("should handle operation failures in load test", async () => {
      let shouldFail = false;
      const operation = async () => {
        if (shouldFail) {
          throw new Error('Simulated failure');
        }
        shouldFail = true; // Fail every other operation
        return 'success';
      };
      
      const loadTestResult = await PerformanceTestUtils.loadTest(operation, {
        concurrency: 2,
        duration: 100,
        maxOperations: 10
      });
      
      assert(loadTestResult.totalOperations > 0);
      assert(loadTestResult.failedOperations > 0);
      assert(loadTestResult.errors.length > 0);
    });
  });

  describe("memoryStressTest", () => {
    it("should detect memory usage patterns", async () => {
      const operation = async () => {
        // Create some objects but don't hold references (should be GC'd)
        const tempArray = new Array(100).fill(Math.random());
        return tempArray.length;
      };
      
      const memoryResult = await PerformanceTestUtils.memoryStressTest(operation, {
        iterations: 50,
        memoryThreshold: 1024 * 1024 * 50 // 50MB threshold
      });
      
      assert(typeof memoryResult.completed === 'boolean');
      assert(memoryResult.iterations > 0);
      assert(memoryResult.peakMemory >= 0);
      assert(typeof memoryResult.memoryLeak === 'boolean');
      assert(typeof memoryResult.memoryIncrease === 'number');
      
      // For this simple operation, should complete without major memory issues
      assertEquals(memoryResult.completed, true);
    });
  });
});