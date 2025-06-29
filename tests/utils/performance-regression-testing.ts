/// <reference types="jest" />

/**
 * Performance Regression Testing Framework
 * Comprehensive performance monitoring and regression detection
 */

import * as fs from 'fs';
import * as path from 'path';
import { AsyncTestUtils, PerformanceTestUtils } from './test-utils.js';
import { TEST_STABILITY_CONFIG } from '../test-stability.config.js';

/**
 * Performance metric types
 */
export type PerformanceMetricType = 
  | 'duration'
  | 'memory'
  | 'cpu'
  | 'throughput'
  | 'latency'
  | 'allocation_rate'
  | 'gc_time'
  | 'event_loop_lag';

/**
 * Performance measurement
 */
export interface PerformanceMeasurement {
  type: PerformanceMetricType;
  value: number;
  unit: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Performance baseline
 */
export interface PerformanceBaseline {
  testName: string;
  environment: {
    nodeVersion: string;
    platform: string;
    cpuCount: number;
    totalMemory: number;
  };
  metrics: {
    [key in PerformanceMetricType]?: {
      mean: number;
      median: number;
      p95: number;
      p99: number;
      min: number;
      max: number;
      standardDeviation: number;
    };
  };
  sampleSize: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Performance regression result
 */
export interface PerformanceRegressionResult {
  testName: string;
  regressionDetected: boolean;
  severity: 'none' | 'minor' | 'moderate' | 'major' | 'critical';
  metrics: Array<{
    type: PerformanceMetricType;
    baseline: number;
    current: number;
    change: number;
    changePercent: number;
    threshold: number;
    exceeded: boolean;
  }>;
  recommendation?: string;
}

/**
 * Performance test configuration
 */
export interface PerformanceTestConfig {
  iterations: number;
  warmupIterations: number;
  concurrency: number;
  timeout: number;
  collectGCMetrics: boolean;
  collectMemoryMetrics: boolean;
  collectCPUMetrics: boolean;
  collectEventLoopMetrics: boolean;
  regressionThresholds: {
    [key in PerformanceMetricType]?: number; // Percentage increase that triggers regression
  };
}

/**
 * Performance regression testing manager
 */
export class PerformanceRegressionTester {
  private baselines: Map<string, PerformanceBaseline> = new Map();
  private baselineFilePath: string;
  private config: PerformanceTestConfig;

  constructor(baselineFilePath?: string, config?: Partial<PerformanceTestConfig>) {
    this.baselineFilePath = baselineFilePath || path.join(process.cwd(), 'tests/performance-baselines.json');
    this.config = {
      iterations: 100,
      warmupIterations: 10,
      concurrency: 1,
      timeout: 30000,
      collectGCMetrics: true,
      collectMemoryMetrics: true,
      collectCPUMetrics: false, // Requires additional dependencies
      collectEventLoopMetrics: true,
      regressionThresholds: {
        duration: 20, // 20% increase
        memory: 25, // 25% increase
        throughput: -15, // 15% decrease
        latency: 20, // 20% increase
        allocation_rate: 30, // 30% increase
        gc_time: 50, // 50% increase
        event_loop_lag: 40 // 40% increase
      },
      ...config
    };
    this.loadBaselines();
  }

  /**
   * Run performance test with regression detection
   */
  async runPerformanceTest<T>(
    testName: string,
    testFunction: () => Promise<T>,
    options?: Partial<PerformanceTestConfig>
  ): Promise<{
    result: T;
    measurements: PerformanceMeasurement[];
    baseline: PerformanceBaseline;
    regressionResult: PerformanceRegressionResult;
  }> {
    const testConfig = { ...this.config, ...options };
    
    console.log(`Running performance test: ${testName}`);
    console.log(`Configuration: ${testConfig.iterations} iterations, ${testConfig.warmupIterations} warmup`);

    // Warmup phase
    console.log('Warming up...');
    for (let i = 0; i < testConfig.warmupIterations; i++) {
      await testFunction();
    }

    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }

    // Main test phase
    console.log('Running performance measurements...');
    const measurements: PerformanceMeasurement[] = [];
    let finalResult: T;

    for (let i = 0; i < testConfig.iterations; i++) {
      const iterationMeasurements = await this.measureIteration(testFunction, testConfig);
      measurements.push(...iterationMeasurements.measurements);
      
      if (i === testConfig.iterations - 1) {
        finalResult = iterationMeasurements.result;
      }

      // Small delay to prevent overwhelming the system
      if (i < testConfig.iterations - 1) {
        await AsyncTestUtils.delay(1);
      }
    }

    // Analyze measurements and create/update baseline
    const baseline = await this.createOrUpdateBaseline(testName, measurements);
    
    // Detect regressions
    const regressionResult = this.detectRegressions(testName, measurements, baseline);

    // Save updated baselines
    await this.saveBaselines();

    return {
      result: finalResult!,
      measurements,
      baseline,
      regressionResult
    };
  }

  /**
   * Create performance benchmark for a function
   */
  async benchmarkFunction<T>(
    functionName: string,
    testFunction: () => Promise<T>,
    inputs: any[][],
    options?: Partial<PerformanceTestConfig>
  ): Promise<{
    results: Array<{
      input: any[];
      result: T;
      measurements: PerformanceMeasurement[];
      regressionResult: PerformanceRegressionResult;
    }>;
    summary: {
      totalTime: number;
      averageTime: number;
      throughput: number;
      memoryPeak: number;
    };
  }> {
    const results = [];
    const startTime = performance.now();
    let memoryPeak = 0;

    for (const input of inputs) {
      const testName = `${functionName}_${JSON.stringify(input).substring(0, 50)}`;
      
      const wrappedFunction = async () => {
        return testFunction.apply(null, input);
      };

      const testResult = await this.runPerformanceTest(testName, wrappedFunction, options);
      
      results.push({
        input,
        result: testResult.result,
        measurements: testResult.measurements,
        regressionResult: testResult.regressionResult
      });

      // Track peak memory usage
      const memoryMeasurements = testResult.measurements.filter(m => m.type === 'memory');
      if (memoryMeasurements.length > 0) {
        const maxMemory = Math.max(...memoryMeasurements.map(m => m.value));
        memoryPeak = Math.max(memoryPeak, maxMemory);
      }
    }

    const totalTime = performance.now() - startTime;
    const averageTime = totalTime / inputs.length;
    const throughput = inputs.length / (totalTime / 1000); // ops/second

    return {
      results,
      summary: {
        totalTime,
        averageTime,
        throughput,
        memoryPeak
      }
    };
  }

  /**
   * Load test for performance under concurrent load
   */
  async loadTest<T>(
    testName: string,
    testFunction: () => Promise<T>,
    loadConfig: {
      concurrentUsers: number;
      duration: number; // milliseconds
      rampUpTime: number; // milliseconds
    }
  ): Promise<{
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    averageResponseTime: number;
    throughput: number;
    errorRate: number;
    measurements: PerformanceMeasurement[];
  }> {
    const { concurrentUsers, duration, rampUpTime } = loadConfig;
    const results: Array<{ success: boolean; duration: number; error?: Error }> = [];
    const measurements: PerformanceMeasurement[] = [];
    
    console.log(`Running load test: ${concurrentUsers} concurrent users for ${duration}ms`);

    const startTime = Date.now();
    const endTime = startTime + duration;
    const rampUpInterval = rampUpTime / concurrentUsers;

    // Track system metrics during load test
    const metricsCollector = this.startSystemMetricsCollection(measurements);

    const workers: Promise<void>[] = [];

    // Ramp up users
    for (let i = 0; i < concurrentUsers; i++) {
      const worker = (async () => {
        // Stagger user start times
        await AsyncTestUtils.delay(i * rampUpInterval);

        while (Date.now() < endTime) {
          const requestStart = performance.now();
          try {
            await testFunction();
            const requestEnd = performance.now();
            results.push({
              success: true,
              duration: requestEnd - requestStart
            });
          } catch (error) {
            const requestEnd = performance.now();
            results.push({
              success: false,
              duration: requestEnd - requestStart,
              error: error as Error
            });
          }

          // Small delay to prevent overwhelming
          await AsyncTestUtils.delay(10);
        }
      })();

      workers.push(worker);
    }

    // Wait for all workers to complete
    await Promise.all(workers);

    // Stop metrics collection
    clearInterval(metricsCollector);

    // Calculate results
    const totalRequests = results.length;
    const successfulRequests = results.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;
    const averageResponseTime = results.reduce((sum, r) => sum + r.duration, 0) / totalRequests;
    const actualDuration = Date.now() - startTime;
    const throughput = totalRequests / (actualDuration / 1000); // requests per second
    const errorRate = failedRequests / totalRequests;

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      averageResponseTime,
      throughput,
      errorRate,
      measurements
    };
  }

  /**
   * Memory leak detection test
   */
  async memoryLeakTest<T>(
    testName: string,
    testFunction: () => Promise<T>,
    iterations: number = 1000
  ): Promise<{
    leakDetected: boolean;
    memoryGrowth: number;
    finalMemoryUsage: number;
    measurements: PerformanceMeasurement[];
    analysis: string;
  }> {
    console.log(`Running memory leak test: ${testName} (${iterations} iterations)`);

    const measurements: PerformanceMeasurement[] = [];
    const memorySnapshots: number[] = [];

    // Force initial garbage collection
    if (global.gc) {
      global.gc();
    }

    const initialMemory = process.memoryUsage().heapUsed;
    memorySnapshots.push(initialMemory);

    // Run test iterations
    for (let i = 0; i < iterations; i++) {
      await testFunction();

      // Take memory snapshot every 100 iterations
      if (i % 100 === 0) {
        if (global.gc) {
          global.gc(); // Force garbage collection
        }
        
        const currentMemory = process.memoryUsage().heapUsed;
        memorySnapshots.push(currentMemory);
        
        measurements.push({
          type: 'memory',
          value: currentMemory,
          unit: 'bytes',
          timestamp: Date.now(),
          metadata: { iteration: i }
        });
      }

      // Small delay to allow garbage collection
      if (i % 100 === 0) {
        await AsyncTestUtils.delay(10);
      }
    }

    // Final memory check
    if (global.gc) {
      global.gc();
    }
    
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryGrowth = finalMemory - initialMemory;
    const growthThreshold = 10 * 1024 * 1024; // 10MB threshold

    // Analyze memory trend
    const memoryTrend = this.calculateMemoryTrend(memorySnapshots);
    const leakDetected = memoryGrowth > growthThreshold && memoryTrend > 0.1;

    let analysis = `Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB. `;
    if (leakDetected) {
      analysis += `Potential memory leak detected (growth rate: ${(memoryTrend * 100).toFixed(2)}%/100 iterations).`;
    } else {
      analysis += 'No significant memory leak detected.';
    }

    return {
      leakDetected,
      memoryGrowth,
      finalMemoryUsage: finalMemory,
      measurements,
      analysis
    };
  }

  private async measureIteration<T>(
    testFunction: () => Promise<T>,
    config: PerformanceTestConfig
  ): Promise<{
    result: T;
    measurements: PerformanceMeasurement[];
  }> {
    const measurements: PerformanceMeasurement[] = [];
    const timestamp = Date.now();

    // Pre-execution measurements
    const initialMemory = process.memoryUsage();
    const startTime = performance.now();

    // Track event loop lag if enabled
    let eventLoopStart: number | undefined;
    if (config.collectEventLoopMetrics) {
      eventLoopStart = performance.now();
    }

    // Execute test function
    const result = await testFunction();

    // Post-execution measurements
    const endTime = performance.now();
    const finalMemory = process.memoryUsage();

    // Duration measurement
    measurements.push({
      type: 'duration',
      value: endTime - startTime,
      unit: 'milliseconds',
      timestamp
    });

    // Memory measurements
    if (config.collectMemoryMetrics) {
      measurements.push({
        type: 'memory',
        value: finalMemory.heapUsed,
        unit: 'bytes',
        timestamp
      });

      // Memory allocation rate
      const memoryDelta = finalMemory.heapUsed - initialMemory.heapUsed;
      if (memoryDelta > 0) {
        measurements.push({
          type: 'allocation_rate',
          value: memoryDelta / (endTime - startTime),
          unit: 'bytes/ms',
          timestamp
        });
      }
    }

    // Event loop lag measurement
    if (config.collectEventLoopMetrics && eventLoopStart !== undefined) {
      setImmediate(() => {
        const eventLoopLag = performance.now() - eventLoopStart!;
        measurements.push({
          type: 'event_loop_lag',
          value: eventLoopLag,
          unit: 'milliseconds',
          timestamp
        });
      });
    }

    return { result, measurements };
  }

  private async createOrUpdateBaseline(
    testName: string,
    measurements: PerformanceMeasurement[]
  ): Promise<PerformanceBaseline> {
    const existingBaseline = this.baselines.get(testName);
    
    // Group measurements by type
    const measurementsByType = new Map<PerformanceMetricType, number[]>();
    for (const measurement of measurements) {
      if (!measurementsByType.has(measurement.type)) {
        measurementsByType.set(measurement.type, []);
      }
      measurementsByType.get(measurement.type)!.push(measurement.value);
    }

    // Calculate statistics for each metric type
    const metrics: PerformanceBaseline['metrics'] = {};
    for (const [type, values] of measurementsByType) {
      if (values.length > 0) {
        values.sort((a, b) => a - b);
        const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
        const median = values[Math.floor(values.length / 2)];
        const p95 = values[Math.floor(values.length * 0.95)];
        const p99 = values[Math.floor(values.length * 0.99)];
        const min = values[0];
        const max = values[values.length - 1];
        
        // Calculate standard deviation
        const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
        const standardDeviation = Math.sqrt(variance);

        metrics[type] = {
          mean,
          median,
          p95,
          p99,
          min,
          max,
          standardDeviation
        };
      }
    }

    const baseline: PerformanceBaseline = {
      testName,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        cpuCount: require('os').cpus().length,
        totalMemory: require('os').totalmem()
      },
      metrics,
      sampleSize: measurements.length,
      createdAt: existingBaseline?.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    this.baselines.set(testName, baseline);
    return baseline;
  }

  private detectRegressions(
    testName: string,
    currentMeasurements: PerformanceMeasurement[],
    baseline: PerformanceBaseline
  ): PerformanceRegressionResult {
    const regressionMetrics = [];
    let maxSeverity: PerformanceRegressionResult['severity'] = 'none';

    // Group current measurements by type
    const currentByType = new Map<PerformanceMetricType, number[]>();
    for (const measurement of currentMeasurements) {
      if (!currentByType.has(measurement.type)) {
        currentByType.set(measurement.type, []);
      }
      currentByType.get(measurement.type)!.push(measurement.value);
    }

    // Compare against baseline for each metric type
    for (const [type, currentValues] of currentByType) {
      const baselineMetric = baseline.metrics[type];
      if (!baselineMetric) continue;

      const currentMean = currentValues.reduce((sum, v) => sum + v, 0) / currentValues.length;
      const change = currentMean - baselineMetric.mean;
      const changePercent = (change / baselineMetric.mean) * 100;
      
      const threshold = this.config.regressionThresholds[type] || 20;
      const exceeded = Math.abs(changePercent) > Math.abs(threshold);

      regressionMetrics.push({
        type,
        baseline: baselineMetric.mean,
        current: currentMean,
        change,
        changePercent,
        threshold,
        exceeded
      });

      // Determine severity
      if (exceeded) {
        const severityLevel = this.calculateSeverity(changePercent, threshold);
        if (this.getSeverityWeight(severityLevel) > this.getSeverityWeight(maxSeverity)) {
          maxSeverity = severityLevel;
        }
      }
    }

    const regressionDetected = regressionMetrics.some(m => m.exceeded);
    
    let recommendation: string | undefined;
    if (regressionDetected) {
      recommendation = this.generateRegressionRecommendation(regressionMetrics, maxSeverity);
    }

    return {
      testName,
      regressionDetected,
      severity: maxSeverity,
      metrics: regressionMetrics,
      recommendation
    };
  }

  private calculateSeverity(changePercent: number, threshold: number): PerformanceRegressionResult['severity'] {
    const ratio = Math.abs(changePercent) / Math.abs(threshold);
    
    if (ratio >= 3) return 'critical';
    if (ratio >= 2) return 'major';
    if (ratio >= 1.5) return 'moderate';
    if (ratio >= 1) return 'minor';
    return 'none';
  }

  private getSeverityWeight(severity: PerformanceRegressionResult['severity']): number {
    const weights = { none: 0, minor: 1, moderate: 2, major: 3, critical: 4 };
    return weights[severity];
  }

  private generateRegressionRecommendation(
    metrics: any[],
    severity: PerformanceRegressionResult['severity']
  ): string {
    const exceededMetrics = metrics.filter(m => m.exceeded);
    const metricTypes = exceededMetrics.map(m => m.type).join(', ');
    
    let recommendation = `Performance regression detected in: ${metricTypes}. `;
    
    switch (severity) {
      case 'critical':
        recommendation += 'Immediate action required. Consider reverting changes and investigating root cause.';
        break;
      case 'major':
        recommendation += 'Significant performance degradation. Review recent changes and optimize critical paths.';
        break;
      case 'moderate':
        recommendation += 'Noticeable performance impact. Monitor closely and consider optimization.';
        break;
      case 'minor':
        recommendation += 'Minor performance impact detected. Monitor in subsequent builds.';
        break;
    }

    return recommendation;
  }

  private startSystemMetricsCollection(measurements: PerformanceMeasurement[]): NodeJS.Timeout {
    return setInterval(() => {
      const memUsage = process.memoryUsage();
      const timestamp = Date.now();

      measurements.push({
        type: 'memory',
        value: memUsage.heapUsed,
        unit: 'bytes',
        timestamp
      });

      // Collect GC metrics if available
      if (this.config.collectGCMetrics && global.gc) {
        const gcStart = performance.now();
        global.gc();
        const gcTime = performance.now() - gcStart;
        
        measurements.push({
          type: 'gc_time',
          value: gcTime,
          unit: 'milliseconds',
          timestamp
        });
      }
    }, 1000); // Collect every second
  }

  private calculateMemoryTrend(snapshots: number[]): number {
    if (snapshots.length < 2) return 0;

    // Simple linear regression to calculate trend
    const n = snapshots.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = snapshots;

    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    
    // Normalize slope by average memory usage
    const avgMemory = sumY / n;
    return slope / avgMemory;
  }

  private loadBaselines(): void {
    try {
      if (fs.existsSync(this.baselineFilePath)) {
        const data = fs.readFileSync(this.baselineFilePath, 'utf8');
        const baselines = JSON.parse(data);
        
        for (const [testName, baseline] of Object.entries(baselines)) {
          this.baselines.set(testName, baseline as PerformanceBaseline);
        }
        
        console.log(`Loaded ${this.baselines.size} performance baselines from ${this.baselineFilePath}`);
      }
    } catch (error) {
      console.warn('Failed to load performance baselines:', error);
    }
  }

  private async saveBaselines(): Promise<void> {
    try {
      const baselinesObject = Object.fromEntries(this.baselines);
      const data = JSON.stringify(baselinesObject, null, 2);
      
      // Ensure directory exists
      const dir = path.dirname(this.baselineFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(this.baselineFilePath, data, 'utf8');
      console.log(`Saved ${this.baselines.size} performance baselines to ${this.baselineFilePath}`);
    } catch (error) {
      console.error('Failed to save performance baselines:', error);
    }
  }

  /**
   * Generate performance report
   */
  generatePerformanceReport(
    results: Array<{
      testName: string;
      regressionResult: PerformanceRegressionResult;
      measurements: PerformanceMeasurement[];
    }>
  ): string {
    const report = [
      '# Performance Test Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Node.js: ${process.version}`,
      `Platform: ${process.platform}`,
      '',
      '## Summary',
      ''
    ];

    const regressions = results.filter(r => r.regressionResult.regressionDetected);
    const totalTests = results.length;
    const passedTests = totalTests - regressions.length;

    report.push(`- Total Tests: ${totalTests}`);
    report.push(`- Passed: ${passedTests}`);
    report.push(`- Regressions Detected: ${regressions.length}`);
    report.push('');

    if (regressions.length > 0) {
      report.push('## Regressions Detected');
      report.push('');

      for (const regression of regressions) {
        report.push(`### ${regression.testName}`);
        report.push(`**Severity:** ${regression.regressionResult.severity}`);
        report.push('');
        report.push('**Affected Metrics:**');

        for (const metric of regression.regressionResult.metrics.filter(m => m.exceeded)) {
          report.push(`- ${metric.type}: ${metric.changePercent.toFixed(2)}% change (threshold: ${metric.threshold}%)`);
        }

        if (regression.regressionResult.recommendation) {
          report.push('');
          report.push(`**Recommendation:** ${regression.regressionResult.recommendation}`);
        }
        report.push('');
      }
    }

    return report.join('\n');
  }
}