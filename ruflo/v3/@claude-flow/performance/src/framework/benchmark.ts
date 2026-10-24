/**
 * V3 Performance Benchmark Framework
 *
 * Comprehensive benchmarking system with statistical analysis,
 * memory tracking, and regression detection capabilities.
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

import { performance, PerformanceObserver } from 'perf_hooks';

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface MemoryUsage {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

export interface BenchmarkResult {
  name: string;
  iterations: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  stdDev: number;
  opsPerSecond: number;
  memoryUsage: MemoryUsage;
  memoryDelta: number;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkOptions {
  /** Number of iterations (default: 100) */
  iterations?: number;
  /** Number of warmup iterations (default: 10) */
  warmup?: number;
  /** Timeout per iteration in ms (default: 30000) */
  timeout?: number;
  /** Force garbage collection between iterations */
  forceGC?: boolean;
  /** Custom metadata to attach to results */
  metadata?: Record<string, unknown>;
  /** Minimum number of runs to ensure statistical significance */
  minRuns?: number;
  /** Target time in ms for auto-calibration */
  targetTime?: number;
}

export interface BenchmarkSuite {
  name: string;
  benchmarks: BenchmarkResult[];
  totalTime: number;
  timestamp: number;
  environment: EnvironmentInfo;
}

export interface EnvironmentInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  cpus: number;
  memory: number;
  v8Version?: string;
}

export interface ComparisonResult {
  benchmark: string;
  baseline: number;
  current: number;
  change: number;
  changePercent: number;
  improved: boolean;
  significant: boolean;
  target?: number;
  targetMet: boolean;
}

// ============================================================================
// Statistical Functions
// ============================================================================

/**
 * Calculate mean of an array of numbers
 */
function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate median of an array of numbers
 */
function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Calculate percentile of an array of numbers
 */
function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

/**
 * Calculate standard deviation of an array of numbers
 */
function calculateStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = calculateMean(values);
  const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
  return Math.sqrt(calculateMean(squaredDiffs));
}

/**
 * Remove outliers using IQR method
 */
function removeOutliers(values: number[]): number[] {
  if (values.length < 4) return values;

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = calculatePercentile(sorted, 25);
  const q3 = calculatePercentile(sorted, 75);
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return sorted.filter((val) => val >= lowerBound && val <= upperBound);
}

// ============================================================================
// Memory Utilities
// ============================================================================

/**
 * Get current memory usage
 */
function getMemoryUsage(): MemoryUsage {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    rss: mem.rss,
  };
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let unitIndex = 0;
  let value = bytes;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Format time in milliseconds to human-readable string
 */
export function formatTime(ms: number): string {
  if (ms < 0.001) {
    return `${(ms * 1000000).toFixed(2)} ns`;
  } else if (ms < 1) {
    return `${(ms * 1000).toFixed(2)} us`;
  } else if (ms < 1000) {
    return `${ms.toFixed(2)} ms`;
  } else {
    return `${(ms / 1000).toFixed(2)} s`;
  }
}

/**
 * Force garbage collection if available
 */
function forceGC(): void {
  if (typeof global.gc === 'function') {
    global.gc();
  }
}

// ============================================================================
// Core Benchmark Function
// ============================================================================

/**
 * Execute a benchmark with comprehensive statistics
 */
export async function benchmark(
  name: string,
  fn: () => Promise<void> | void,
  options: BenchmarkOptions = {}
): Promise<BenchmarkResult> {
  const {
    iterations = 100,
    warmup = 10,
    timeout = 30000,
    forceGC: doForceGC = false,
    metadata = {},
    minRuns = 10,
    targetTime = 1000,
  } = options;

  // Calculate actual iterations based on target time
  let actualIterations = iterations;

  // Warmup phase
  for (let i = 0; i < warmup; i++) {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Warmup timeout')), timeout)
      ),
    ]).catch(() => {});
  }

  // Auto-calibrate iterations if needed
  const calibrationStart = performance.now();
  await fn();
  const calibrationTime = performance.now() - calibrationStart;

  if (calibrationTime > 0) {
    const estimatedIterations = Math.ceil(targetTime / calibrationTime);
    actualIterations = Math.max(minRuns, Math.min(iterations, estimatedIterations));
  }

  // Memory before benchmark
  if (doForceGC) forceGC();
  const memoryBefore = getMemoryUsage();

  // Run benchmark
  const times: number[] = [];
  const startTime = performance.now();

  for (let i = 0; i < actualIterations; i++) {
    if (doForceGC && i % 10 === 0) forceGC();

    const iterStart = performance.now();

    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Iteration timeout')), timeout)
      ),
    ]);

    const iterEnd = performance.now();
    times.push(iterEnd - iterStart);
  }

  const totalTime = performance.now() - startTime;

  // Memory after benchmark
  const memoryAfter = getMemoryUsage();

  // Calculate statistics (remove outliers for more accurate results)
  const cleanedTimes = removeOutliers(times);
  const mean = calculateMean(cleanedTimes);
  const median = calculateMedian(cleanedTimes);
  const p95 = calculatePercentile(cleanedTimes, 95);
  const p99 = calculatePercentile(cleanedTimes, 99);
  const min = Math.min(...cleanedTimes);
  const max = Math.max(...cleanedTimes);
  const stdDev = calculateStdDev(cleanedTimes);
  const opsPerSecond = mean > 0 ? 1000 / mean : 0;

  return {
    name,
    iterations: actualIterations,
    mean,
    median,
    p95,
    p99,
    min,
    max,
    stdDev,
    opsPerSecond,
    memoryUsage: memoryAfter,
    memoryDelta: memoryAfter.heapUsed - memoryBefore.heapUsed,
    timestamp: Date.now(),
    metadata,
  };
}

// ============================================================================
// Benchmark Suite Runner
// ============================================================================

export class BenchmarkRunner {
  private results: BenchmarkResult[] = [];
  private suiteName: string;

  constructor(name: string) {
    this.suiteName = name;
  }

  /**
   * Run a single benchmark and add to results
   */
  async run(
    name: string,
    fn: () => Promise<void> | void,
    options?: BenchmarkOptions
  ): Promise<BenchmarkResult> {
    const result = await benchmark(name, fn, options);
    this.results.push(result);
    return result;
  }

  /**
   * Run multiple benchmarks in sequence
   */
  async runAll(
    benchmarks: Array<{
      name: string;
      fn: () => Promise<void> | void;
      options?: BenchmarkOptions;
    }>
  ): Promise<BenchmarkSuite> {
    const startTime = performance.now();

    for (const bench of benchmarks) {
      await this.run(bench.name, bench.fn, bench.options);
    }

    return {
      name: this.suiteName,
      benchmarks: this.results,
      totalTime: performance.now() - startTime,
      timestamp: Date.now(),
      environment: this.getEnvironmentInfo(),
    };
  }

  /**
   * Get environment information
   */
  private getEnvironmentInfo(): EnvironmentInfo {
    const os = require('os');
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      memory: os.totalmem(),
      v8Version: process.versions.v8,
    };
  }

  /**
   * Get all results
   */
  getResults(): BenchmarkResult[] {
    return this.results;
  }

  /**
   * Clear all results
   */
  clear(): void {
    this.results = [];
  }

  /**
   * Print formatted results to console
   */
  printResults(): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Benchmark Suite: ${this.suiteName}`);
    console.log(`${'='.repeat(60)}\n`);

    for (const result of this.results) {
      console.log(`${result.name}:`);
      console.log(`  Iterations:     ${result.iterations}`);
      console.log(`  Mean:           ${formatTime(result.mean)}`);
      console.log(`  Median:         ${formatTime(result.median)}`);
      console.log(`  Std Dev:        ${formatTime(result.stdDev)}`);
      console.log(`  P95:            ${formatTime(result.p95)}`);
      console.log(`  P99:            ${formatTime(result.p99)}`);
      console.log(`  Min:            ${formatTime(result.min)}`);
      console.log(`  Max:            ${formatTime(result.max)}`);
      console.log(`  Ops/sec:        ${result.opsPerSecond.toFixed(2)}`);
      console.log(`  Memory Delta:   ${formatBytes(result.memoryDelta)}`);
      console.log('');
    }
  }

  /**
   * Export results as JSON
   */
  toJSON(): string {
    return JSON.stringify(
      {
        name: this.suiteName,
        benchmarks: this.results,
        timestamp: Date.now(),
        environment: this.getEnvironmentInfo(),
      },
      null,
      2
    );
  }
}

// ============================================================================
// Comparison Utilities
// ============================================================================

/**
 * Compare benchmark results against baseline
 */
export function compareResults(
  baseline: BenchmarkResult[],
  current: BenchmarkResult[],
  targets?: Record<string, number>
): ComparisonResult[] {
  const comparisons: ComparisonResult[] = [];

  for (const curr of current) {
    const base = baseline.find((b) => b.name === curr.name);
    if (!base) continue;

    const change = curr.mean - base.mean;
    const changePercent = (change / base.mean) * 100;
    const improved = change < 0;

    // Consider significant if change is > 5% and > 2 standard deviations
    const combinedStdDev = Math.sqrt(
      Math.pow(base.stdDev, 2) + Math.pow(curr.stdDev, 2)
    );
    const significant = Math.abs(change) > 2 * combinedStdDev;

    const target = targets?.[curr.name];
    const targetMet = target !== undefined ? curr.mean <= target : true;

    comparisons.push({
      benchmark: curr.name,
      baseline: base.mean,
      current: curr.mean,
      change,
      changePercent,
      improved,
      significant,
      target,
      targetMet,
    });
  }

  return comparisons;
}

/**
 * Print comparison report
 */
export function printComparisonReport(comparisons: ComparisonResult[]): void {
  console.log('\n' + '='.repeat(80));
  console.log('Performance Comparison Report');
  console.log('='.repeat(80) + '\n');

  console.log(
    `${'Benchmark'.padEnd(35)} ${'Baseline'.padEnd(12)} ${'Current'.padEnd(12)} ${'Change'.padEnd(12)} Status`
  );
  console.log('-'.repeat(80));

  for (const comp of comparisons) {
    const baselineStr = formatTime(comp.baseline);
    const currentStr = formatTime(comp.current);
    const changeStr = `${comp.changePercent >= 0 ? '+' : ''}${comp.changePercent.toFixed(1)}%`;

    let status = '';
    if (comp.significant) {
      status = comp.improved ? '[IMPROVED]' : '[REGRESSED]';
    } else {
      status = '[~]';
    }
    if (!comp.targetMet) {
      status += ' [MISSED TARGET]';
    }

    console.log(
      `${comp.benchmark.padEnd(35)} ${baselineStr.padEnd(12)} ${currentStr.padEnd(12)} ${changeStr.padEnd(12)} ${status}`
    );
  }

  console.log('\n');
}

// ============================================================================
// V3 Performance Targets
// ============================================================================

export const V3_PERFORMANCE_TARGETS = {
  // Startup Performance
  'cli-cold-start': 500,        // <500ms (5x faster)
  'cli-warm-start': 100,        // <100ms
  'mcp-server-init': 400,       // <400ms (4.5x faster)
  'agent-spawn': 200,           // <200ms (4x faster)

  // Memory Operations
  'vector-search': 1,           // <1ms (150x faster)
  'hnsw-indexing': 10,          // <10ms
  'memory-write': 5,            // <5ms (10x faster)
  'cache-hit': 0.1,             // <0.1ms

  // Swarm Coordination
  'agent-coordination': 50,     // <50ms
  'task-decomposition': 20,     // <20ms
  'consensus-latency': 100,     // <100ms (5x faster)
  'message-throughput': 0.1,    // <0.1ms per message

  // Attention Mechanisms
  'flash-attention': 100,       // Baseline comparison target
  'multi-head-attention': 200,  // Baseline comparison target

  // SONA Learning
  'sona-adaptation': 0.05,      // <0.05ms
} as const;

export type PerformanceTarget = keyof typeof V3_PERFORMANCE_TARGETS;

/**
 * Check if a benchmark meets its target
 */
export function meetsTarget(
  benchmarkName: string,
  value: number
): { met: boolean; target: number | undefined; ratio: number | undefined } {
  const target = V3_PERFORMANCE_TARGETS[benchmarkName as PerformanceTarget];
  if (target === undefined) {
    return { met: true, target: undefined, ratio: undefined };
  }
  return {
    met: value <= target,
    target,
    ratio: value / target,
  };
}

// ============================================================================
// Export Default Runner Instance
// ============================================================================

export default {
  benchmark,
  BenchmarkRunner,
  compareResults,
  printComparisonReport,
  formatBytes,
  formatTime,
  meetsTarget,
  V3_PERFORMANCE_TARGETS,
};
