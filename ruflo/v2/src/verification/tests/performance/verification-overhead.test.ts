/**
 * Performance Benchmark Tests for Verification Overhead
 * 
 * Tests the performance impact of the verification system including:
 * - Truth scoring calculation performance
 * - Memory usage during verification
 * - Throughput under load
 * - Latency impact on agent communication
 */

import { jest } from '@jest/globals';
import { performance } from 'perf_hooks';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Import verification components
import TruthScoreCalculator from '../../../../.claude/helpers/truth-score.js';

interface PerformanceMetrics {
  operations: number;
  totalTime: number;
  averageTime: number;
  throughput: number;
  memoryUsage: {
    initial: number;
    peak: number;
    final: number;
    delta: number;
  };
  p50: number;
  p95: number;
  p99: number;
}

interface BenchmarkResult {
  testName: string;
  metrics: PerformanceMetrics;
  passed: boolean;
  thresholds: BenchmarkThresholds;
}

interface BenchmarkThresholds {
  maxAverageTime: number;
  minThroughput: number;
  maxMemoryDelta: number;
  maxP99Latency: number;
}

describe('Verification System Performance Benchmarks', () => {
  let tempDir: string;
  let calculator: any;
  let performanceResults: BenchmarkResult[] = [];

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'verification-perf-'));
    
    // Setup truth score calculator
    calculator = new TruthScoreCalculator();
    calculator.configPath = path.join(tempDir, 'verification.json');
    calculator.memoryPath = path.join(tempDir, 'truth-scores');
    await calculator.init();
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    
    // Generate performance report
    await generatePerformanceReport(performanceResults);
  });

  describe('Truth Score Calculation Performance', () => {
    test('should calculate truth scores efficiently at scale', async () => {
      const thresholds: BenchmarkThresholds = {
        maxAverageTime: 5, // 5ms per calculation
        minThroughput: 200, // 200 calculations per second
        maxMemoryDelta: 50 * 1024 * 1024, // 50MB max memory increase
        maxP99Latency: 20 // 20ms p99 latency
      };

      const operations = 1000;
      const evidenceVariants = generateEvidenceVariants(10);
      const durations: number[] = [];
      
      const initialMemory = process.memoryUsage().heapUsed;
      let peakMemory = initialMemory;

      const startTime = performance.now();

      for (let i = 0; i < operations; i++) {
        const evidence = evidenceVariants[i % evidenceVariants.length];
        
        const operationStart = performance.now();
        const score = calculator.calculateScore(evidence);
        const operationEnd = performance.now();
        
        durations.push(operationEnd - operationStart);
        
        // Track memory usage
        const currentMemory = process.memoryUsage().heapUsed;
        peakMemory = Math.max(peakMemory, currentMemory);
        
        // Verify score is valid
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }

      const endTime = performance.now();
      const finalMemory = process.memoryUsage().heapUsed;
      
      const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
        initial: initialMemory,
        peak: peakMemory,
        final: finalMemory
      });

      const result: BenchmarkResult = {
        testName: 'Truth Score Calculation Performance',
        metrics,
        passed: validateBenchmark(metrics, thresholds),
        thresholds
      };

      performanceResults.push(result);

      // Assert performance requirements
      expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
      expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
      expect(metrics.memoryUsage.delta).toBeLessThanOrEqual(thresholds.maxMemoryDelta);
      expect(metrics.p99).toBeLessThanOrEqual(thresholds.maxP99Latency);
    });

    test('should handle concurrent truth score calculations efficiently', async () => {
      const thresholds: BenchmarkThresholds = {
        maxAverageTime: 8, // 8ms per calculation (slightly higher for concurrency)
        minThroughput: 150, // 150 calculations per second
        maxMemoryDelta: 100 * 1024 * 1024, // 100MB max memory increase
        maxP99Latency: 30 // 30ms p99 latency
      };

      const concurrency = 10;
      const operationsPerWorker = 100;
      const totalOperations = concurrency * operationsPerWorker;

      const initialMemory = process.memoryUsage().heapUsed;
      const startTime = performance.now();

      // Create concurrent workers
      const workerPromises = Array.from({ length: concurrency }, async (_, workerIndex) => {
        const workerDurations: number[] = [];
        const evidenceVariants = generateEvidenceVariants(5);

        for (let i = 0; i < operationsPerWorker; i++) {
          const evidence = evidenceVariants[i % evidenceVariants.length];
          
          const operationStart = performance.now();
          const score = calculator.calculateScore(evidence);
          const operationEnd = performance.now();
          
          workerDurations.push(operationEnd - operationStart);
          
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);

          // Add small delay to simulate realistic workload
          if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 1));
          }
        }

        return workerDurations;
      });

      const allDurations = (await Promise.all(workerPromises)).flat();
      const endTime = performance.now();
      const finalMemory = process.memoryUsage().heapUsed;

      const metrics = calculatePerformanceMetrics(totalOperations, allDurations, startTime, endTime, {
        initial: initialMemory,
        peak: finalMemory, // Simplified for concurrent case
        final: finalMemory
      });

      const result: BenchmarkResult = {
        testName: 'Concurrent Truth Score Calculation',
        metrics,
        passed: validateBenchmark(metrics, thresholds),
        thresholds
      };

      performanceResults.push(result);

      expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
      expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
      expect(metrics.memoryUsage.delta).toBeLessThanOrEqual(thresholds.maxMemoryDelta);
    }, 30000);
  });

  describe('Memory Usage Optimization', () => {
    test('should maintain stable memory usage during extended operations', async () => {
      const thresholds: BenchmarkThresholds = {
        maxAverageTime: 10, // 10ms per operation
        minThroughput: 100, // 100 operations per second
        maxMemoryDelta: 20 * 1024 * 1024, // 20MB max memory increase
        maxP99Latency: 50 // 50ms p99 latency
      };

      const operations = 2000;
      const evidenceVariants = generateEvidenceVariants(20);
      const durations: number[] = [];
      const memorySnapshots: number[] = [];

      const initialMemory = process.memoryUsage().heapUsed;
      memorySnapshots.push(initialMemory);

      const startTime = performance.now();

      for (let i = 0; i < operations; i++) {
        const evidence = evidenceVariants[i % evidenceVariants.length];
        
        const operationStart = performance.now();
        
        // Perform multiple operations to test memory accumulation
        const score1 = calculator.calculateScore(evidence);
        const comparison = calculator.compareClaimToReality(
          { tests_pass: true, no_lint_errors: true },
          { tests_pass: score1 > 0.8, lint_errors: score1 > 0.9 ? 0 : 2 }
        );
        
        const operationEnd = performance.now();
        durations.push(operationEnd - operationStart);

        // Take memory snapshots every 100 operations
        if (i % 100 === 0) {
          const currentMemory = process.memoryUsage().heapUsed;
          memorySnapshots.push(currentMemory);

          // Force garbage collection every 500 operations to test cleanup
          if (i % 500 === 0 && global.gc) {
            global.gc();
          }
        }
      }

      const endTime = performance.now();
      const finalMemory = process.memoryUsage().heapUsed;
      const peakMemory = Math.max(...memorySnapshots);

      const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
        initial: initialMemory,
        peak: peakMemory,
        final: finalMemory
      });

      // Check for memory leaks by analyzing memory growth trend
      const memoryGrowthRate = (finalMemory - initialMemory) / operations;
      expect(memoryGrowthRate).toBeLessThan(1000); // Less than 1KB per operation

      const result: BenchmarkResult = {
        testName: 'Extended Memory Usage Stability',
        metrics,
        passed: validateBenchmark(metrics, thresholds) && memoryGrowthRate < 1000,
        thresholds
      };

      performanceResults.push(result);

      expect(metrics.memoryUsage.delta).toBeLessThanOrEqual(thresholds.maxMemoryDelta);
    }, 45000);

    test('should efficiently handle large evidence datasets', async () => {
      const thresholds: BenchmarkThresholds = {
        maxAverageTime: 15, // 15ms per operation (larger datasets)
        minThroughput: 70, // 70 operations per second
        maxMemoryDelta: 150 * 1024 * 1024, // 150MB max memory increase
        maxP99Latency: 100 // 100ms p99 latency
      };

      const operations = 500;
      const durations: number[] = [];

      const initialMemory = process.memoryUsage().heapUsed;
      const startTime = performance.now();

      for (let i = 0; i < operations; i++) {
        // Create large evidence objects
        const largeEvidence = generateLargeEvidence(i);
        
        const operationStart = performance.now();
        const score = calculator.calculateScore(largeEvidence);
        const operationEnd = performance.now();
        
        durations.push(operationEnd - operationStart);
        
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);

        // Cleanup large objects to prevent memory accumulation
        if (i % 50 === 0 && global.gc) {
          global.gc();
        }
      }

      const endTime = performance.now();
      const finalMemory = process.memoryUsage().heapUsed;

      const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
        initial: initialMemory,
        peak: finalMemory,
        final: finalMemory
      });

      const result: BenchmarkResult = {
        testName: 'Large Evidence Dataset Handling',
        metrics,
        passed: validateBenchmark(metrics, thresholds),
        thresholds
      };

      performanceResults.push(result);

      expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
      expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
    }, 30000);
  });

  describe('Truth Score Storage Performance', () => {
    test('should store truth scores efficiently at high volume', async () => {
      const thresholds: BenchmarkThresholds = {
        maxAverageTime: 20, // 20ms per storage operation
        minThroughput: 50, // 50 storage operations per second
        maxMemoryDelta: 100 * 1024 * 1024, // 100MB max memory increase
        maxP99Latency: 100 // 100ms p99 latency
      };

      const operations = 200; // Reduced for storage operations
      const durations: number[] = [];

      const initialMemory = process.memoryUsage().heapUsed;
      const startTime = performance.now();

      for (let i = 0; i < operations; i++) {
        const agentId = `agent-${i % 10}`;
        const taskId = `task-${i}`;
        const score = Math.random();
        const evidence = generateEvidenceVariants(1)[0];

        const operationStart = performance.now();
        await calculator.storeTruthScore(agentId, taskId, score, evidence);
        const operationEnd = performance.now();
        
        durations.push(operationEnd - operationStart);
      }

      const endTime = performance.now();
      const finalMemory = process.memoryUsage().heapUsed;

      const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
        initial: initialMemory,
        peak: finalMemory,
        final: finalMemory
      });

      const result: BenchmarkResult = {
        testName: 'High Volume Truth Score Storage',
        metrics,
        passed: validateBenchmark(metrics, thresholds),
        thresholds
      };

      performanceResults.push(result);

      expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
      expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);

      // Verify all files were created
      const files = await fs.readdir(calculator.memoryPath);
      expect(files.length).toBe(operations);
    }, 30000);

    test('should retrieve agent history efficiently', async () => {
      const thresholds: BenchmarkThresholds = {
        maxAverageTime: 50, // 50ms per history retrieval
        minThroughput: 20, // 20 retrievals per second
        maxMemoryDelta: 50 * 1024 * 1024, // 50MB max memory increase
        maxP99Latency: 200 // 200ms p99 latency
      };

      // First, create test data
      const agents = Array.from({ length: 10 }, (_, i) => `perf-agent-${i}`);
      for (const agentId of agents) {
        for (let i = 0; i < 50; i++) {
          await calculator.storeTruthScore(
            agentId,
            `history-task-${i}`,
            Math.random(),
            { test: `data-${i}` }
          );
        }
      }

      const operations = 100;
      const durations: number[] = [];

      const initialMemory = process.memoryUsage().heapUsed;
      const startTime = performance.now();

      for (let i = 0; i < operations; i++) {
        const agentId = agents[i % agents.length];
        const limit = Math.floor(Math.random() * 20) + 5; // 5-24 entries

        const operationStart = performance.now();
        const history = await calculator.getAgentHistory(agentId, limit);
        const operationEnd = performance.now();
        
        durations.push(operationEnd - operationStart);
        
        expect(history.length).toBeLessThanOrEqual(limit);
        expect(history.length).toBeGreaterThan(0);
      }

      const endTime = performance.now();
      const finalMemory = process.memoryUsage().heapUsed;

      const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
        initial: initialMemory,
        peak: finalMemory,
        final: finalMemory
      });

      const result: BenchmarkResult = {
        testName: 'Agent History Retrieval Performance',
        metrics,
        passed: validateBenchmark(metrics, thresholds),
        thresholds
      };

      performanceResults.push(result);

      expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
      expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
    }, 45000);
  });

  describe('Report Generation Performance', () => {
    test('should generate reports efficiently with large datasets', async () => {
      const thresholds: BenchmarkThresholds = {
        maxAverageTime: 1000, // 1 second per report generation
        minThroughput: 1, // 1 report per second
        maxMemoryDelta: 200 * 1024 * 1024, // 200MB max memory increase
        maxP99Latency: 3000 // 3 second p99 latency
      };

      // Create large dataset for report generation
      const agents = Array.from({ length: 50 }, (_, i) => `report-agent-${i}`);
      for (const agentId of agents) {
        for (let i = 0; i < 100; i++) {
          await calculator.storeTruthScore(
            agentId,
            `report-task-${i}`,
            Math.random(),
            { complexity: Math.random(), quality: Math.random() }
          );
        }
      }

      const operations = 10; // Fewer operations for expensive report generation
      const durations: number[] = [];

      const initialMemory = process.memoryUsage().heapUsed;
      const startTime = performance.now();

      for (let i = 0; i < operations; i++) {
        const format = i % 2 === 0 ? 'json' : 'markdown';

        const operationStart = performance.now();
        const report = await calculator.generateReport(format);
        const operationEnd = performance.now();
        
        durations.push(operationEnd - operationStart);
        
        if (format === 'json') {
          expect(typeof report).toBe('object');
          expect(report.total_verifications).toBeGreaterThan(0);
          expect(Object.keys(report.agents).length).toBe(agents.length);
        } else {
          expect(typeof report).toBe('string');
          expect(report).toContain('# Truth Score Report');
          expect(report).toContain('Agent Performance');
        }

        // Force garbage collection between operations
        if (global.gc) {
          global.gc();
        }
      }

      const endTime = performance.now();
      const finalMemory = process.memoryUsage().heapUsed;

      const metrics = calculatePerformanceMetrics(operations, durations, startTime, endTime, {
        initial: initialMemory,
        peak: finalMemory,
        final: finalMemory
      });

      const result: BenchmarkResult = {
        testName: 'Large Dataset Report Generation',
        metrics,
        passed: validateBenchmark(metrics, thresholds),
        thresholds
      };

      performanceResults.push(result);

      expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
      expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
    }, 60000);
  });

  describe('System Load Testing', () => {
    test('should maintain performance under sustained load', async () => {
      const thresholds: BenchmarkThresholds = {
        maxAverageTime: 25, // 25ms average under load
        minThroughput: 40, // 40 operations per second
        maxMemoryDelta: 300 * 1024 * 1024, // 300MB max memory increase
        maxP99Latency: 150 // 150ms p99 latency
      };

      const loadDuration = 15000; // 15 seconds of sustained load
      const batchSize = 10;
      const batchInterval = 100; // 100ms between batches

      const durations: number[] = [];
      const initialMemory = process.memoryUsage().heapUsed;
      const startTime = performance.now();
      
      let operationCount = 0;
      const evidenceVariants = generateEvidenceVariants(5);

      const loadTestPromise = new Promise<void>((resolve) => {
        const interval = setInterval(async () => {
          if (performance.now() - startTime >= loadDuration) {
            clearInterval(interval);
            resolve();
            return;
          }

          // Process batch of operations
          const batchPromises = Array.from({ length: batchSize }, async (_, i) => {
            const evidence = evidenceVariants[(operationCount + i) % evidenceVariants.length];
            
            const operationStart = performance.now();
            
            // Mixed operations to simulate realistic load
            if (i % 3 === 0) {
              const score = calculator.calculateScore(evidence);
              expect(score).toBeGreaterThanOrEqual(0);
            } else if (i % 3 === 1) {
              const comparison = calculator.compareClaimToReality(
                { tests_pass: true },
                { tests_pass: Math.random() > 0.5 }
              );
              expect(comparison.truth_score).toBeGreaterThanOrEqual(0);
            } else {
              await calculator.storeTruthScore(
                `load-agent-${operationCount + i}`,
                `load-task-${operationCount + i}`,
                Math.random(),
                evidence
              );
            }
            
            const operationEnd = performance.now();
            durations.push(operationEnd - operationStart);
          });

          await Promise.all(batchPromises);
          operationCount += batchSize;
        }, batchInterval);
      });

      await loadTestPromise;

      const endTime = performance.now();
      const finalMemory = process.memoryUsage().heapUsed;

      const metrics = calculatePerformanceMetrics(operationCount, durations, startTime, endTime, {
        initial: initialMemory,
        peak: finalMemory,
        final: finalMemory
      });

      const result: BenchmarkResult = {
        testName: 'Sustained Load Performance',
        metrics,
        passed: validateBenchmark(metrics, thresholds),
        thresholds
      };

      performanceResults.push(result);

      expect(metrics.averageTime).toBeLessThanOrEqual(thresholds.maxAverageTime);
      expect(metrics.throughput).toBeGreaterThanOrEqual(thresholds.minThroughput);
      expect(operationCount).toBeGreaterThan(100); // Should process significant number of operations
    }, 20000);
  });

  // Helper functions
  function generateEvidenceVariants(count: number): any[] {
    return Array.from({ length: count }, (_, i) => ({
      test_results: {
        passed: Math.floor(Math.random() * 20),
        total: 20
      },
      lint_results: {
        errors: Math.floor(Math.random() * 5)
      },
      type_results: {
        errors: Math.floor(Math.random() * 3)
      },
      build_results: {
        success: Math.random() > 0.2
      },
      performance_metrics: {
        response_time: Math.random() * 500 + 50,
        memory_usage: Math.random() * 100 + 50
      },
      complexity_score: Math.random(),
      variant_id: i
    }));
  }

  function generateLargeEvidence(index: number): any {
    return {
      test_results: {
        passed: Math.floor(Math.random() * 100),
        total: 100,
        detailed_results: Array.from({ length: 100 }, (_, i) => ({
          test_name: `test_${i}`,
          status: Math.random() > 0.1 ? 'passed' : 'failed',
          duration: Math.random() * 1000,
          memory_usage: Math.random() * 50
        }))
      },
      lint_results: {
        errors: Math.floor(Math.random() * 10),
        warnings: Math.floor(Math.random() * 20),
        file_reports: Array.from({ length: 50 }, (_, i) => ({
          file: `file_${i}.js`,
          issues: Math.floor(Math.random() * 5)
        }))
      },
      build_results: {
        success: Math.random() > 0.1,
        build_log: 'x'.repeat(10000), // 10KB of build log data
        dependencies: Array.from({ length: 200 }, (_, i) => `package_${i}`)
      },
      performance_data: {
        metrics: Array.from({ length: 1000 }, () => Math.random() * 100),
        timestamps: Array.from({ length: 1000 }, (_, i) => Date.now() + i * 1000)
      },
      index
    };
  }

  function calculatePerformanceMetrics(
    operations: number,
    durations: number[],
    startTime: number,
    endTime: number,
    memory: { initial: number; peak: number; final: number }
  ): PerformanceMetrics {
    const totalTime = endTime - startTime;
    const averageTime = durations.reduce((a, b) => a + b, 0) / durations.length;
    const throughput = (operations / totalTime) * 1000; // Operations per second

    const sortedDurations = durations.sort((a, b) => a - b);
    const p50 = sortedDurations[Math.floor(sortedDurations.length * 0.5)];
    const p95 = sortedDurations[Math.floor(sortedDurations.length * 0.95)];
    const p99 = sortedDurations[Math.floor(sortedDurations.length * 0.99)];

    return {
      operations,
      totalTime,
      averageTime,
      throughput,
      memoryUsage: {
        initial: memory.initial,
        peak: memory.peak,
        final: memory.final,
        delta: memory.final - memory.initial
      },
      p50,
      p95,
      p99
    };
  }

  function validateBenchmark(metrics: PerformanceMetrics, thresholds: BenchmarkThresholds): boolean {
    return (
      metrics.averageTime <= thresholds.maxAverageTime &&
      metrics.throughput >= thresholds.minThroughput &&
      metrics.memoryUsage.delta <= thresholds.maxMemoryDelta &&
      metrics.p99 <= thresholds.maxP99Latency
    );
  }

  async function generatePerformanceReport(results: BenchmarkResult[]) {
    const reportPath = path.join(tempDir, 'performance-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: results.length,
        passedTests: results.filter(r => r.passed).length,
        failedTests: results.filter(r => !r.passed).length
      },
      results: results.map(r => ({
        testName: r.testName,
        passed: r.passed,
        metrics: {
          averageTime: `${r.metrics.averageTime.toFixed(2)}ms`,
          throughput: `${r.metrics.throughput.toFixed(2)} ops/sec`,
          memoryDelta: `${(r.metrics.memoryUsage.delta / 1024 / 1024).toFixed(2)}MB`,
          p99Latency: `${r.metrics.p99.toFixed(2)}ms`
        },
        thresholds: {
          maxAverageTime: `${r.thresholds.maxAverageTime}ms`,
          minThroughput: `${r.thresholds.minThroughput} ops/sec`,
          maxMemoryDelta: `${(r.thresholds.maxMemoryDelta / 1024 / 1024).toFixed(0)}MB`,
          maxP99Latency: `${r.thresholds.maxP99Latency}ms`
        }
      }))
    };

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    console.log(`Performance report generated: ${reportPath}`);
  }
});