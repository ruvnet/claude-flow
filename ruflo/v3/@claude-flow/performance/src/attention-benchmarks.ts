/**
 * @claude-flow/performance - Flash Attention Benchmarks
 *
 * Comprehensive benchmark suite for Flash Attention performance validation.
 * Validates 2.49x-7.47x speedup targets and memory efficiency improvements.
 */

import {
  FlashAttentionOptimizer,
  createFlashAttentionOptimizer,
  type BenchmarkResult,
  type AttentionInput,
} from './attention-integration.js';
import {
  FlashAttention,
  DotProductAttention,
  MultiHeadAttention,
  LinearAttention,
} from '@ruvector/attention';

// ============================================================================
// Types
// ============================================================================

export interface ComparisonBenchmark {
  name: string;
  dimension: number;
  numKeys: number;
  iterations: number;
  results: {
    flash: {
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
    memoryReduction?: number; // Percentage
  };
  meetsTarget: boolean;
  timestamp: Date;
}

export interface SuiteResult {
  suiteName: string;
  benchmarks: ComparisonBenchmark[];
  summary: {
    averageSpeedup: number;
    minSpeedup: number;
    maxSpeedup: number;
    targetsMet: number;
    totalBenchmarks: number;
    successRate: number;
  };
  timestamp: Date;
}

export interface MemoryProfile {
  dimension: number;
  numKeys: number;
  flashMemoryBytes: number;
  baselineMemoryBytes: number;
  reduction: number; // Percentage
  reductionBytes: number;
}

// ============================================================================
// Benchmark Runner
// ============================================================================

export class AttentionBenchmarkRunner {
  /**
   * Run comprehensive benchmark suite across multiple dimensions
   */
  runComprehensiveSuite(): SuiteResult {
    const benchmarks: ComparisonBenchmark[] = [];

    // Test configurations: [dimension, numKeys, iterations]
    const configs: [number, number, number][] = [
      [128, 50, 1000],    // Small: Mobile/edge devices
      [256, 100, 1000],   // Medium: Standard use cases
      [512, 100, 1000],   // Large: High-performance scenarios
      [768, 150, 500],    // XL: Transformer models
      [1024, 200, 500],   // XXL: Large language models
    ];

    for (const [dim, numKeys, iterations] of configs) {
      const benchmark = this.runComparison(dim, numKeys, iterations);
      benchmarks.push(benchmark);
    }

    return this.createSuiteResult('Comprehensive Flash Attention Suite', benchmarks);
  }

  /**
   * Run benchmark comparing Flash Attention vs baseline
   */
  runComparison(
    dimension: number,
    numKeys: number = 100,
    iterations: number = 1000
  ): ComparisonBenchmark {
    // Create Flash and baseline attention mechanisms
    const flash = new FlashAttention(dimension, 64);
    const baseline = new DotProductAttention(dimension);

    // Create test data
    const query = new Float32Array(dimension);
    const keys = Array.from({ length: numKeys }, () => new Float32Array(dimension));
    const values = Array.from({ length: numKeys }, () => new Float32Array(dimension));

    // Fill with random data
    for (let i = 0; i < dimension; i++) {
      query[i] = Math.random();
    }
    for (let i = 0; i < numKeys; i++) {
      for (let j = 0; j < dimension; j++) {
        keys[i][j] = Math.random();
        values[i][j] = Math.random();
      }
    }

    // Benchmark Flash Attention
    const flashStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      flash.computeRaw(query, keys, values);
    }
    const flashEnd = performance.now();
    const flashTimeMs = flashEnd - flashStart;
    const flashAvgMs = flashTimeMs / iterations;
    const flashOps = 1000 / flashAvgMs;

    // Benchmark baseline
    const baselineStart = performance.now();
    for (let i = 0; i < iterations; i++) {
      baseline.computeRaw(query, keys, values);
    }
    const baselineEnd = performance.now();
    const baselineTimeMs = baselineEnd - baselineStart;
    const baselineAvgMs = baselineTimeMs / iterations;
    const baselineOps = 1000 / baselineAvgMs;

    const speedup = baselineAvgMs / flashAvgMs;
    const meetsTarget = speedup >= 2.49; // Minimum V3 target

    return {
      name: `Flash Attention ${dimension}D x ${numKeys} keys`,
      dimension,
      numKeys,
      iterations,
      results: {
        flash: {
          averageTimeMs: flashAvgMs,
          opsPerSecond: flashOps,
          memoryUsageBytes: undefined,
        },
        baseline: {
          averageTimeMs: baselineAvgMs,
          opsPerSecond: baselineOps,
          memoryUsageBytes: undefined,
        },
        speedup,
        memoryReduction: undefined,
      },
      meetsTarget,
      timestamp: new Date(),
    };
  }

  /**
   * Run memory profiling benchmark
   */
  runMemoryProfile(
    dimensions: number[] = [128, 256, 512, 768, 1024]
  ): MemoryProfile[] {
    const profiles: MemoryProfile[] = [];

    for (const dim of dimensions) {
      const numKeys = Math.min(200, dim / 2);
      const profile = this.profileMemory(dim, numKeys);
      profiles.push(profile);
    }

    return profiles;
  }

  /**
   * Run stress test with increasing load
   */
  runStressTest(): ComparisonBenchmark[] {
    const results: ComparisonBenchmark[] = [];

    // Progressively increase load
    const stressConfigs: [number, number, number][] = [
      [512, 100, 100],
      [512, 500, 100],
      [512, 1000, 100],
      [512, 2000, 50],
      [512, 5000, 50],
    ];

    for (const [dim, numKeys, iterations] of stressConfigs) {
      try {
        const benchmark = this.runComparison(dim, numKeys, iterations);
        results.push(benchmark);
      } catch (error) {
        console.error(`Stress test failed at ${numKeys} keys:`, error);
        break;
      }
    }

    return results;
  }

  /**
   * Validate V3 performance targets (2.49x-7.47x speedup)
   */
  validateV3Targets(): {
    meetsMinimum: boolean;
    meetsMaximum: boolean;
    actualSpeedup: number;
    target: { min: number; max: number };
  } {
    const optimizer = createFlashAttentionOptimizer(512);
    const result = optimizer.benchmark();

    return {
      meetsMinimum: result.speedup >= 2.49,
      meetsMaximum: result.speedup <= 7.47,
      actualSpeedup: result.speedup,
      target: { min: 2.49, max: 7.47 },
    };
  }

  /**
   * Profile memory usage for a specific configuration
   */
  private profileMemory(
    dimension: number,
    numKeys: number
  ): MemoryProfile {
    // Create test data
    const query = new Float32Array(dimension).fill(1);
    const keys = Array.from({ length: numKeys }, () =>
      new Float32Array(dimension).fill(1)
    );
    const values = Array.from({ length: numKeys }, () =>
      new Float32Array(dimension).fill(1)
    );

    // Measure Flash Attention memory
    const flashMemoryBefore = this.getMemoryUsage();
    const flashAttention = new FlashAttention(dimension, 64); // Add blockSize
    flashAttention.compute(query, keys, values);
    const flashMemoryAfter = this.getMemoryUsage();
    const flashMemoryBytes = flashMemoryAfter - flashMemoryBefore;

    // Measure baseline memory
    const baselineMemoryBefore = this.getMemoryUsage();
    const baselineAttention = new DotProductAttention(dimension);
    baselineAttention.compute(query, keys, values);
    const baselineMemoryAfter = this.getMemoryUsage();
    const baselineMemoryBytes = baselineMemoryAfter - baselineMemoryBefore;

    const reductionBytes = baselineMemoryBytes - flashMemoryBytes;
    const reduction = (reductionBytes / baselineMemoryBytes) * 100;

    return {
      dimension,
      numKeys,
      flashMemoryBytes: Math.max(0, flashMemoryBytes),
      baselineMemoryBytes: Math.max(0, baselineMemoryBytes),
      reduction: Math.max(0, reduction),
      reductionBytes: Math.max(0, reductionBytes),
    };
  }

  /**
   * Calculate memory reduction percentage
   */
  private calculateMemoryReduction(
    baselineBytes?: number,
    flashBytes?: number
  ): number | undefined {
    if (!baselineBytes || !flashBytes) {
      return undefined;
    }

    const reduction = ((baselineBytes - flashBytes) / baselineBytes) * 100;
    return Math.max(0, reduction);
  }

  /**
   * Get current memory usage
   */
  private getMemoryUsage(): number {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      return process.memoryUsage().heapUsed;
    }
    return 0;
  }

  /**
   * Create suite result with summary statistics
   */
  private createSuiteResult(
    suiteName: string,
    benchmarks: ComparisonBenchmark[]
  ): SuiteResult {
    const speedups = benchmarks.map(b => b.results.speedup);
    const averageSpeedup = speedups.reduce((a, b) => a + b, 0) / speedups.length;
    const minSpeedup = Math.min(...speedups);
    const maxSpeedup = Math.max(...speedups);
    const targetsMet = benchmarks.filter(b => b.meetsTarget).length;
    const totalBenchmarks = benchmarks.length;
    const successRate = (targetsMet / totalBenchmarks) * 100;

    return {
      suiteName,
      benchmarks,
      summary: {
        averageSpeedup,
        minSpeedup,
        maxSpeedup,
        targetsMet,
        totalBenchmarks,
        successRate,
      },
      timestamp: new Date(),
    };
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format benchmark results as human-readable table
 */
export function formatBenchmarkTable(benchmark: ComparisonBenchmark): string {
  const { name, results, meetsTarget } = benchmark;
  const status = meetsTarget ? '✓' : '✗';

  return `
${status} ${name}
  Flash Attention:  ${results.flash.averageTimeMs.toFixed(3)}ms
  Baseline:         ${results.baseline.averageTimeMs.toFixed(3)}ms
  Speedup:          ${results.speedup.toFixed(2)}x
  Memory Reduction: ${results.memoryReduction?.toFixed(1) ?? 'N/A'}%
  Target Met:       ${meetsTarget ? 'YES' : 'NO'} (target: ≥2.49x)
`.trim();
}

/**
 * Format suite results as summary report
 */
export function formatSuiteReport(suite: SuiteResult): string {
  const { suiteName, summary, benchmarks } = suite;

  const header = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${suiteName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Summary:
  Average Speedup:  ${summary.averageSpeedup.toFixed(2)}x
  Min Speedup:      ${summary.minSpeedup.toFixed(2)}x
  Max Speedup:      ${summary.maxSpeedup.toFixed(2)}x
  Targets Met:      ${summary.targetsMet}/${summary.totalBenchmarks} (${summary.successRate.toFixed(1)}%)
  Target Range:     2.49x - 7.47x

Benchmarks:
`.trim();

  const benchmarkTables = benchmarks
    .map(b => formatBenchmarkTable(b))
    .join('\n\n');

  return `${header}\n\n${benchmarkTables}\n`;
}

/**
 * Format memory profile as table
 */
export function formatMemoryProfile(profiles: MemoryProfile[]): string {
  const header = `
Memory Profile Results
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Dim    Keys    Flash (KB)  Baseline (KB)  Reduction
`.trim();

  const rows = profiles.map(p => {
    const flashKB = (p.flashMemoryBytes / 1024).toFixed(1);
    const baselineKB = (p.baselineMemoryBytes / 1024).toFixed(1);
    const reduction = p.reduction.toFixed(1);

    return `${p.dimension.toString().padEnd(6)} ${p.numKeys.toString().padEnd(7)} ${flashKB.padEnd(11)} ${baselineKB.padEnd(14)} ${reduction}%`;
  });

  return `${header}\n${rows.join('\n')}`;
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick performance validation
 */
export function quickValidation(): boolean {
  const runner = new AttentionBenchmarkRunner();
  const validation = runner.validateV3Targets();

  console.log(`
V3 Performance Target Validation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Target Range:    2.49x - 7.47x
Actual Speedup:  ${validation.actualSpeedup.toFixed(2)}x
Meets Minimum:   ${validation.meetsMinimum ? 'YES ✓' : 'NO ✗'}
Within Range:    ${validation.meetsMaximum ? 'YES ✓' : 'NO ✗'}
  `.trim());

  return validation.meetsMinimum && validation.meetsMaximum;
}

/**
 * Run and display comprehensive benchmark suite
 */
export function runAndDisplaySuite(): SuiteResult {
  const runner = new AttentionBenchmarkRunner();
  const suite = runner.runComprehensiveSuite();

  console.log(formatSuiteReport(suite));

  return suite;
}

/**
 * Run and display memory profile
 */
export function runAndDisplayMemoryProfile(): MemoryProfile[] {
  const runner = new AttentionBenchmarkRunner();
  const profiles = runner.runMemoryProfile();

  console.log(formatMemoryProfile(profiles));

  return profiles;
}

// ============================================================================
// Exports
// ============================================================================

export { FlashAttentionOptimizer, createFlashAttentionOptimizer };
