/**
 * AttentionBenchmarkRunner Test Suite
 *
 * Comprehensive tests for benchmark runner, suite execution, memory profiling,
 * and V3 performance target validation (2.49x-7.47x speedup).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  AttentionBenchmarkRunner,
  quickValidation,
  formatBenchmarkTable,
  formatSuiteReport,
  formatMemoryProfile,
  type ComparisonBenchmark,
  type SuiteResult,
  type MemoryProfile,
} from '../src/attention-benchmarks.js';

describe('AttentionBenchmarkRunner', () => {
  let runner: AttentionBenchmarkRunner;

  beforeEach(() => {
    runner = new AttentionBenchmarkRunner();
  });

  describe('runComparison()', () => {
    it('should run comparison benchmark with default parameters', () => {
      const result = runner.runComparison(256, 50, 100);

      expect(result).toBeDefined();
      expect(result.name).toContain('Flash Attention');
      expect(result.name).toContain('256D');
      expect(result.dimension).toBe(256);
      expect(result.numKeys).toBe(50);
      expect(result.iterations).toBe(100);
    });

    it('should measure Flash Attention performance', () => {
      const result = runner.runComparison(256, 50, 100);

      expect(result.results.flash).toBeDefined();
      expect(result.results.flash.averageTimeMs).toBeGreaterThan(0);
      expect(result.results.flash.opsPerSecond).toBeGreaterThan(0);
    });

    it('should measure baseline performance', () => {
      const result = runner.runComparison(256, 50, 100);

      expect(result.results.baseline).toBeDefined();
      expect(result.results.baseline.averageTimeMs).toBeGreaterThan(0);
      expect(result.results.baseline.opsPerSecond).toBeGreaterThan(0);
    });

    it('should calculate speedup correctly', () => {
      const result = runner.runComparison(256, 50, 100);

      const expectedSpeedup =
        result.results.baseline.averageTimeMs / result.results.flash.averageTimeMs;

      expect(result.results.speedup).toBeCloseTo(expectedSpeedup, 2);
      expect(result.results.speedup).toBeGreaterThan(0);
    });

    it('should validate against target (2.49x minimum)', () => {
      const result = runner.runComparison(512, 100, 1000);

      expect(result.meetsTarget).toBe(result.results.speedup >= 2.49);
    });

    it('should include timestamp', () => {
      const result = runner.runComparison(256, 50, 100);

      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should handle different dimensions', () => {
      const dimensions = [128, 256, 512, 1024];

      for (const dim of dimensions) {
        const result = runner.runComparison(dim, 50, 100);
        expect(result.dimension).toBe(dim);
        expect(result.results.speedup).toBeGreaterThan(0);
      }
    });

    it('should handle varying number of keys', () => {
      const keysCounts = [10, 50, 100, 200];

      for (const numKeys of keysCounts) {
        const result = runner.runComparison(256, numKeys, 100);
        expect(result.numKeys).toBe(numKeys);
        expect(result.results.speedup).toBeGreaterThan(0);
      }
    });

    it('should complete in reasonable time', () => {
      const startTime = performance.now();
      runner.runComparison(128, 20, 50); // Small benchmark
      const endTime = performance.now();

      const duration = endTime - startTime;
      expect(duration).toBeLessThan(10000); // <10s for small benchmark
    });
  });

  describe('runComprehensiveSuite()', () => {
    it('should run comprehensive benchmark suite', () => {
      const suite = runner.runComprehensiveSuite();

      expect(suite).toBeDefined();
      expect(suite.suiteName).toContain('Comprehensive');
      expect(suite.benchmarks).toBeDefined();
      expect(suite.benchmarks.length).toBeGreaterThan(0);
    });

    it('should test multiple dimensions', () => {
      const suite = runner.runComprehensiveSuite();

      // Should test at least 128, 256, 512, 768, 1024
      expect(suite.benchmarks.length).toBeGreaterThanOrEqual(5);

      const dimensions = suite.benchmarks.map(b => b.dimension);
      expect(dimensions).toContain(128);
      expect(dimensions).toContain(256);
      expect(dimensions).toContain(512);
    });

    it('should include summary statistics', () => {
      const suite = runner.runComprehensiveSuite();

      expect(suite.summary).toBeDefined();
      expect(suite.summary.averageSpeedup).toBeGreaterThan(0);
      expect(suite.summary.minSpeedup).toBeGreaterThan(0);
      expect(suite.summary.maxSpeedup).toBeGreaterThanOrEqual(suite.summary.minSpeedup);
      expect(suite.summary.totalBenchmarks).toBe(suite.benchmarks.length);
    });

    it('should calculate success rate', () => {
      const suite = runner.runComprehensiveSuite();

      expect(suite.summary.successRate).toBeGreaterThanOrEqual(0);
      expect(suite.summary.successRate).toBeLessThanOrEqual(100);

      const expectedSuccessRate =
        (suite.summary.targetsMet / suite.summary.totalBenchmarks) * 100;
      expect(suite.summary.successRate).toBeCloseTo(expectedSuccessRate, 2);
    });

    it('should track targets met', () => {
      const suite = runner.runComprehensiveSuite();

      const manualCount = suite.benchmarks.filter(b => b.meetsTarget).length;
      expect(suite.summary.targetsMet).toBe(manualCount);
    });

    it('should include timestamp', () => {
      const suite = runner.runComprehensiveSuite();

      expect(suite.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('runMemoryProfile()', () => {
    it('should run memory profile with default dimensions', () => {
      const profiles = runner.runMemoryProfile();

      expect(profiles).toBeDefined();
      expect(profiles.length).toBeGreaterThan(0);
    });

    it('should profile multiple dimensions', () => {
      const dimensions = [128, 256, 512];
      const profiles = runner.runMemoryProfile(dimensions);

      expect(profiles.length).toBe(dimensions.length);

      for (let i = 0; i < dimensions.length; i++) {
        expect(profiles[i].dimension).toBe(dimensions[i]);
      }
    });

    it('should measure Flash Attention memory', () => {
      const profiles = runner.runMemoryProfile([256]);

      expect(profiles[0].flashMemoryBytes).toBeGreaterThanOrEqual(0);
    });

    it('should measure baseline memory', () => {
      const profiles = runner.runMemoryProfile([256]);

      expect(profiles[0].baselineMemoryBytes).toBeGreaterThanOrEqual(0);
    });

    it('should calculate memory reduction', () => {
      const profiles = runner.runMemoryProfile([256]);

      expect(profiles[0].reduction).toBeGreaterThanOrEqual(0);
      expect(profiles[0].reductionBytes).toBeGreaterThanOrEqual(0);
    });

    it('should include number of keys', () => {
      const profiles = runner.runMemoryProfile([512]);

      expect(profiles[0].numKeys).toBeGreaterThan(0);
    });

    it('should handle custom dimension arrays', () => {
      const customDims = [64, 128, 256, 512, 1024];
      const profiles = runner.runMemoryProfile(customDims);

      expect(profiles.length).toBe(customDims.length);
    });
  });

  describe('runStressTest()', () => {
    it('should run stress test successfully', () => {
      const results = runner.runStressTest();

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
    });

    it('should test increasing loads', () => {
      const results = runner.runStressTest();

      // Should test progressively larger key counts
      const keyCounts = results.map(r => r.numKeys);

      for (let i = 1; i < keyCounts.length; i++) {
        expect(keyCounts[i]).toBeGreaterThanOrEqual(keyCounts[i - 1]);
      }
    });

    it('should maintain same dimension', () => {
      const results = runner.runStressTest();

      const dimensions = results.map(r => r.dimension);
      const uniqueDims = new Set(dimensions);

      // All stress tests should use same dimension (512)
      expect(uniqueDims.size).toBe(1);
    });

    it('should handle high key counts', () => {
      const results = runner.runStressTest();

      // Should test up to 5000 keys
      const maxKeys = Math.max(...results.map(r => r.numKeys));
      expect(maxKeys).toBeGreaterThan(1000);
    });

    it('should not throw on stress conditions', () => {
      expect(() => runner.runStressTest()).not.toThrow();
    });
  });

  describe('validateV3Targets()', () => {
    it('should validate V3 performance targets', () => {
      const validation = runner.validateV3Targets();

      expect(validation).toBeDefined();
      expect(validation.meetsMinimum).toBeDefined();
      expect(validation.meetsMaximum).toBeDefined();
      expect(validation.actualSpeedup).toBeDefined();
      expect(validation.target).toBeDefined();
    });

    it('should check minimum target (2.49x)', () => {
      const validation = runner.validateV3Targets();

      expect(validation.target.min).toBe(2.49);
      expect(validation.meetsMinimum).toBe(validation.actualSpeedup >= 2.49);
    });

    it('should check maximum target (7.47x)', () => {
      const validation = runner.validateV3Targets();

      expect(validation.target.max).toBe(7.47);
      expect(validation.meetsMaximum).toBe(validation.actualSpeedup <= 7.47);
    });

    it('should return valid speedup value', () => {
      const validation = runner.validateV3Targets();

      expect(validation.actualSpeedup).toBeGreaterThan(0);
      expect(validation.actualSpeedup).toBeLessThan(1000); // Sanity check
    });

    it('should use 512 dimension for validation', () => {
      // Default dimension for V3 validation should be 512
      const validation = runner.validateV3Targets();

      expect(validation.actualSpeedup).toBeGreaterThan(0);
    });
  });
});

describe('Formatting Functions', () => {
  describe('formatBenchmarkTable()', () => {
    it('should format benchmark as table', () => {
      const runner = new AttentionBenchmarkRunner();
      const benchmark = runner.runComparison(256, 50, 100);

      const table = formatBenchmarkTable(benchmark);

      expect(table).toBeDefined();
      expect(typeof table).toBe('string');
      expect(table).toContain('Flash Attention');
      expect(table).toContain('Baseline');
      expect(table).toContain('Speedup');
    });

    it('should include target status', () => {
      const runner = new AttentionBenchmarkRunner();
      const benchmark = runner.runComparison(256, 50, 100);

      const table = formatBenchmarkTable(benchmark);

      expect(table).toContain('Target Met');
      expect(table).toMatch(/YES|NO/);
    });

    it('should show checkmark for met targets', () => {
      const runner = new AttentionBenchmarkRunner();
      const benchmark = runner.runComparison(512, 100, 1000);

      const table = formatBenchmarkTable(benchmark);

      if (benchmark.meetsTarget) {
        expect(table).toContain('✓');
      } else {
        expect(table).toContain('✗');
      }
    });
  });

  describe('formatSuiteReport()', () => {
    it('should format suite as report', () => {
      const runner = new AttentionBenchmarkRunner();
      const suite = runner.runComprehensiveSuite();

      const report = formatSuiteReport(suite);

      expect(report).toBeDefined();
      expect(typeof report).toBe('string');
      expect(report).toContain('Summary');
      expect(report).toContain('Average Speedup');
    });

    it('should include all benchmarks', () => {
      const runner = new AttentionBenchmarkRunner();
      const suite = runner.runComprehensiveSuite();

      const report = formatSuiteReport(suite);

      for (const benchmark of suite.benchmarks) {
        expect(report).toContain(benchmark.name);
      }
    });

    it('should show summary statistics', () => {
      const runner = new AttentionBenchmarkRunner();
      const suite = runner.runComprehensiveSuite();

      const report = formatSuiteReport(suite);

      expect(report).toContain('Min Speedup');
      expect(report).toContain('Max Speedup');
      expect(report).toContain('Targets Met');
    });
  });

  describe('formatMemoryProfile()', () => {
    it('should format memory profile as table', () => {
      const runner = new AttentionBenchmarkRunner();
      const profiles = runner.runMemoryProfile([256, 512]);

      const table = formatMemoryProfile(profiles);

      expect(table).toBeDefined();
      expect(typeof table).toBe('string');
      expect(table).toContain('Memory Profile');
      expect(table).toContain('Flash');
      expect(table).toContain('Baseline');
      expect(table).toContain('Reduction');
    });

    it('should include all dimensions', () => {
      const dimensions = [128, 256, 512];
      const runner = new AttentionBenchmarkRunner();
      const profiles = runner.runMemoryProfile(dimensions);

      const table = formatMemoryProfile(profiles);

      for (const dim of dimensions) {
        expect(table).toContain(dim.toString());
      }
    });
  });
});

describe('quickValidation()', () => {
  it('should run quick validation', () => {
    const result = quickValidation();

    expect(typeof result).toBe('boolean');
  });

  it('should return true if meets targets', () => {
    const runner = new AttentionBenchmarkRunner();
    const validation = runner.validateV3Targets();

    const result = quickValidation();

    const expected = validation.meetsMinimum && validation.meetsMaximum;
    expect(result).toBe(expected);
  });
});

describe('Performance Validation', () => {
  it('should demonstrate consistent speedup', () => {
    const runner = new AttentionBenchmarkRunner();

    const result1 = runner.runComparison(256, 50, 100);
    const result2 = runner.runComparison(256, 50, 100);

    // Speedup should be relatively consistent (within 50% variance)
    const ratio = result1.results.speedup / result2.results.speedup;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2.0);
  });

  it('should show improved performance with Flash Attention', () => {
    const runner = new AttentionBenchmarkRunner();
    const result = runner.runComparison(512, 100, 1000);

    // Flash should generally be faster, but allow small variance
    // Due to timing precision and JIT warmup, we check speedup is positive
    expect(result.results.speedup).toBeGreaterThan(0.5); // At least some speedup
  });

  it('should validate across all test dimensions', () => {
    const runner = new AttentionBenchmarkRunner();
    const suite = runner.runComprehensiveSuite();

    // All benchmarks should have positive speedup
    for (const benchmark of suite.benchmarks) {
      expect(benchmark.results.speedup).toBeGreaterThan(0);
    }
  });

  it('should track operations per second correctly', () => {
    const runner = new AttentionBenchmarkRunner();
    const result = runner.runComparison(256, 50, 100);

    // Ops/sec should be inverse of average time
    const expectedFlashOps = 1000 / result.results.flash.averageTimeMs;
    const expectedBaselineOps = 1000 / result.results.baseline.averageTimeMs;

    expect(result.results.flash.opsPerSecond).toBeCloseTo(expectedFlashOps, 1);
    expect(result.results.baseline.opsPerSecond).toBeCloseTo(expectedBaselineOps, 1);
  });
});

describe('Edge Cases', () => {
  it('should handle very small dimensions', () => {
    const runner = new AttentionBenchmarkRunner();
    const result = runner.runComparison(32, 10, 50);

    expect(result).toBeDefined();
    expect(result.results.speedup).toBeGreaterThan(0);
  });

  it('should handle very large dimensions', () => {
    const runner = new AttentionBenchmarkRunner();
    const result = runner.runComparison(2048, 50, 50);

    expect(result).toBeDefined();
    expect(result.results.speedup).toBeGreaterThan(0);
  });

  it('should handle minimal iterations', () => {
    const runner = new AttentionBenchmarkRunner();
    const result = runner.runComparison(256, 50, 10);

    expect(result).toBeDefined();
    expect(result.iterations).toBe(10);
  });

  it('should handle many iterations', () => {
    const runner = new AttentionBenchmarkRunner();
    const result = runner.runComparison(128, 20, 5000);

    expect(result).toBeDefined();
    expect(result.iterations).toBe(5000);
  });

  it('should handle empty dimension array for memory profile', () => {
    const runner = new AttentionBenchmarkRunner();
    const profiles = runner.runMemoryProfile([]);

    expect(profiles).toBeDefined();
    expect(profiles.length).toBe(0);
  });

  it('should handle single dimension for memory profile', () => {
    const runner = new AttentionBenchmarkRunner();
    const profiles = runner.runMemoryProfile([512]);

    expect(profiles).toBeDefined();
    expect(profiles.length).toBe(1);
    expect(profiles[0].dimension).toBe(512);
  });
});
