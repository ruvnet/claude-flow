/**
 * Performance Baseline System
 *
 * Captures and compares performance metrics to detect regressions.
 *
 * @module v3/testing/regression/performance-baseline
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

/**
 * Baseline metric definition
 */
export interface BaselineMetric {
  name: string;
  value: number;
  unit: string;
  category: 'latency' | 'throughput' | 'memory' | 'cpu' | 'startup';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Baseline comparison result
 */
export interface BaselineComparison {
  metric: string;
  baseline: number;
  current: number;
  unit: string;
  degradation: number; // Percentage difference
  regression: boolean; // Is this a significant regression?
  improvement: boolean; // Is this an improvement?
}

/**
 * Baseline configuration
 */
export interface BaselineConfig {
  baselinePath: string;
  performanceThreshold: number; // Percentage allowed degradation
}

/**
 * Stored baseline data
 */
interface BaselineData {
  version: string;
  capturedAt: number;
  metrics: BaselineMetric[];
}

/**
 * Performance Baseline Manager
 *
 * Manages performance baselines for regression detection.
 */
export class PerformanceBaseline {
  private readonly baselinePath: string;
  private readonly threshold: number;
  private cachedBaseline: BaselineData | null = null;

  constructor(config: BaselineConfig) {
    this.baselinePath = join(config.baselinePath, 'performance.json');
    this.threshold = config.performanceThreshold;
  }

  /**
   * Capture current performance as baseline
   */
  async captureBaseline(): Promise<BaselineData> {
    const metrics = await this.measureCurrentPerformance();

    const baseline: BaselineData = {
      version: '1.0.0',
      capturedAt: Date.now(),
      metrics,
    };

    await this.saveBaseline(baseline);
    this.cachedBaseline = baseline;

    return baseline;
  }

  /**
   * Compare current performance against baseline
   */
  async compare(): Promise<BaselineComparison[]> {
    const baseline = await this.loadBaseline();
    if (!baseline) {
      console.warn('No baseline found. Capturing initial baseline...');
      await this.captureBaseline();
      return [];
    }

    const currentMetrics = await this.measureCurrentPerformance();
    const comparisons: BaselineComparison[] = [];

    for (const current of currentMetrics) {
      const baselineMetric = baseline.metrics.find((m) => m.name === current.name);
      if (!baselineMetric) continue;

      const isHigherBetter = current.category === 'throughput';
      const diff = current.value - baselineMetric.value;
      const percentChange = (diff / baselineMetric.value) * 100;

      // For latency/memory, higher is worse. For throughput, lower is worse.
      const degradation = isHigherBetter ? -percentChange : percentChange;

      comparisons.push({
        metric: current.name,
        baseline: baselineMetric.value,
        current: current.value,
        unit: current.unit,
        degradation,
        regression: degradation > this.threshold,
        improvement: degradation < -this.threshold,
      });
    }

    return comparisons;
  }

  /**
   * Measure current performance metrics
   */
  private async measureCurrentPerformance(): Promise<BaselineMetric[]> {
    const metrics: BaselineMetric[] = [];
    const timestamp = Date.now();

    // Memory metrics
    const memUsage = process.memoryUsage();
    metrics.push({
      name: 'heap_used',
      value: memUsage.heapUsed / 1024 / 1024,
      unit: 'MB',
      category: 'memory',
      timestamp,
    });
    metrics.push({
      name: 'heap_total',
      value: memUsage.heapTotal / 1024 / 1024,
      unit: 'MB',
      category: 'memory',
      timestamp,
    });
    metrics.push({
      name: 'rss',
      value: memUsage.rss / 1024 / 1024,
      unit: 'MB',
      category: 'memory',
      timestamp,
    });

    // Startup time simulation
    const startupStart = performance.now();
    await this.simulateStartup();
    const startupTime = performance.now() - startupStart;
    metrics.push({
      name: 'startup_time',
      value: startupTime,
      unit: 'ms',
      category: 'startup',
      timestamp,
    });

    // Latency benchmarks
    const latencyMetrics = await this.measureLatency();
    metrics.push(...latencyMetrics);

    // Throughput benchmarks
    const throughputMetrics = await this.measureThroughput();
    metrics.push(...throughputMetrics);

    return metrics;
  }

  /**
   * Simulate startup to measure initialization time
   */
  private async simulateStartup(): Promise<void> {
    // Import key modules to simulate startup
    await import('@claude-flow/shared');
    await import('@claude-flow/memory');
  }

  /**
   * Measure operation latency
   */
  private async measureLatency(): Promise<BaselineMetric[]> {
    const metrics: BaselineMetric[] = [];
    const timestamp = Date.now();

    // Event bus latency
    const eventLatency = await this.benchmarkEventBus();
    metrics.push({
      name: 'event_bus_latency',
      value: eventLatency,
      unit: 'μs',
      category: 'latency',
      timestamp,
    });

    // Memory operation latency
    const memLatency = await this.benchmarkMemoryOps();
    metrics.push({
      name: 'memory_op_latency',
      value: memLatency,
      unit: 'μs',
      category: 'latency',
      timestamp,
    });

    return metrics;
  }

  /**
   * Measure throughput
   */
  private async measureThroughput(): Promise<BaselineMetric[]> {
    const metrics: BaselineMetric[] = [];
    const timestamp = Date.now();

    // Events per second
    const eventsPerSec = await this.benchmarkEventThroughput();
    metrics.push({
      name: 'events_per_second',
      value: eventsPerSec,
      unit: 'ops/sec',
      category: 'throughput',
      timestamp,
    });

    // Memory operations per second
    const memOpsPerSec = await this.benchmarkMemoryThroughput();
    metrics.push({
      name: 'memory_ops_per_second',
      value: memOpsPerSec,
      unit: 'ops/sec',
      category: 'throughput',
      timestamp,
    });

    return metrics;
  }

  /**
   * Benchmark event bus operations
   */
  private async benchmarkEventBus(): Promise<number> {
    const { EventBus, createAgentSpawnedEvent } = await import('@claude-flow/shared');
    const eventBus = new EventBus();

    const iterations = 1000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      const event = createAgentSpawnedEvent(`bench-${i}`, 'worker', 'default', ['test']);
      await eventBus.emit(event);
    }

    const elapsed = performance.now() - start;
    return (elapsed / iterations) * 1000; // Convert to microseconds
  }

  /**
   * Benchmark memory operations
   */
  private async benchmarkMemoryOps(): Promise<number> {
    // Simulate memory operations with a simple Map
    const map = new Map<string, unknown>();
    const iterations = 10000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      map.set(`key-${i}`, { data: `value-${i}`, timestamp: Date.now() });
    }

    for (let i = 0; i < iterations; i++) {
      map.get(`key-${i}`);
    }

    const elapsed = performance.now() - start;
    return (elapsed / (iterations * 2)) * 1000; // Convert to microseconds
  }

  /**
   * Benchmark event throughput
   */
  private async benchmarkEventThroughput(): Promise<number> {
    const { EventBus } = await import('@claude-flow/shared');
    const eventBus = new EventBus();

    let count = 0;
    eventBus.subscribe('agent:spawned', () => { count++; });

    const { createAgentSpawnedEvent } = await import('@claude-flow/shared');
    const duration = 1000; // 1 second
    const start = Date.now();

    while (Date.now() - start < duration) {
      const event = createAgentSpawnedEvent('bench-agent', 'worker', 'default', ['test']);
      await eventBus.emit(event);
    }

    return count;
  }

  /**
   * Benchmark memory throughput
   */
  private async benchmarkMemoryThroughput(): Promise<number> {
    const map = new Map<string, unknown>();
    let count = 0;

    const duration = 1000; // 1 second
    const start = Date.now();

    while (Date.now() - start < duration) {
      const key = `key-${count}`;
      map.set(key, { data: count, timestamp: Date.now() });
      map.get(key);
      map.delete(key);
      count++;
    }

    return count;
  }

  /**
   * Load baseline from file
   */
  private async loadBaseline(): Promise<BaselineData | null> {
    if (this.cachedBaseline) {
      return this.cachedBaseline;
    }

    try {
      const content = await readFile(this.baselinePath, 'utf-8');
      this.cachedBaseline = JSON.parse(content);
      return this.cachedBaseline;
    } catch {
      return null;
    }
  }

  /**
   * Save baseline to file
   */
  private async saveBaseline(baseline: BaselineData): Promise<void> {
    await mkdir(dirname(this.baselinePath), { recursive: true });
    await writeFile(this.baselinePath, JSON.stringify(baseline, null, 2));
  }
}
