/**
 * Flash Attention Integration Demo
 *
 * Demonstrates how to use the Flash Attention integration in V3 performance module.
 */

import {
  FlashAttentionOptimizer,
  createFlashAttentionOptimizer,
  quickBenchmark,
  AttentionBenchmarkRunner,
  quickValidation,
  runAndDisplaySuite,
  type AttentionInput,
} from '../index.js';

// ============================================================================
// Example 1: Basic Flash Attention Usage
// ============================================================================

async function basicUsageExample() {
  console.log('\n=== Example 1: Basic Flash Attention Usage ===\n');

  // Create optimizer with 512-dimensional vectors
  const optimizer = createFlashAttentionOptimizer(512, 64);

  // Prepare input data
  const dim = 512;
  const numKeys = 100;

  const input: AttentionInput = {
    query: new Float32Array(dim).fill(1.0),
    keys: Array.from({ length: numKeys }, () => new Float32Array(dim).fill(1.0)),
    values: Array.from({ length: numKeys }, () => new Float32Array(dim).fill(1.0)),
  };

  // Run optimized attention
  const output = await optimizer.optimize(input);

  console.log(`Runtime: ${output.runtime}`);
  console.log(`Execution time: ${output.executionTimeMs.toFixed(3)}ms`);
  console.log(`Result shape: Float32Array[${output.result.length}]`);
  console.log(`Memory usage: ${output.memoryUsageBytes ? `${(output.memoryUsageBytes / 1024).toFixed(2)} KB` : 'N/A'}`);
}

// ============================================================================
// Example 2: Performance Benchmarking
// ============================================================================

async function benchmarkExample() {
  console.log('\n=== Example 2: Performance Benchmarking ===\n');

  // Quick benchmark with default settings
  const result = await quickBenchmark(512);

  console.log(`Flash Attention: ${result.flashAttention.averageTimeMs.toFixed(3)}ms`);
  console.log(`Baseline: ${result.baseline.averageTimeMs.toFixed(3)}ms`);
  console.log(`Speedup: ${result.speedup.toFixed(2)}x`);
  console.log(`Meets target (≥2.49x): ${result.meetsTarget ? 'YES ✓' : 'NO ✗'}`);
}

// ============================================================================
// Example 3: Comprehensive Suite
// ============================================================================

async function comprehensiveSuiteExample() {
  console.log('\n=== Example 3: Comprehensive Benchmark Suite ===\n');

  const runner = new AttentionBenchmarkRunner();
  const suite = await runner.runComprehensiveSuite();

  console.log(`Suite: ${suite.suiteName}`);
  console.log(`Benchmarks run: ${suite.summary.totalBenchmarks}`);
  console.log(`Average speedup: ${suite.summary.averageSpeedup.toFixed(2)}x`);
  console.log(`Min speedup: ${suite.summary.minSpeedup.toFixed(2)}x`);
  console.log(`Max speedup: ${suite.summary.maxSpeedup.toFixed(2)}x`);
  console.log(`Success rate: ${suite.summary.successRate.toFixed(1)}%`);
}

// ============================================================================
// Example 4: V3 Target Validation
// ============================================================================

async function targetValidationExample() {
  console.log('\n=== Example 4: V3 Target Validation ===\n');

  const isValid = await quickValidation();

  console.log(`\nValidation result: ${isValid ? 'PASSED ✓' : 'FAILED ✗'}`);
}

// ============================================================================
// Example 5: Continuous Metrics Tracking
// ============================================================================

async function metricsTrackingExample() {
  console.log('\n=== Example 5: Continuous Metrics Tracking ===\n');

  const optimizer = createFlashAttentionOptimizer(512);

  // Run multiple operations
  const dim = 512;
  const input: AttentionInput = {
    query: new Float32Array(dim).fill(1.0),
    keys: Array.from({ length: 100 }, () => new Float32Array(dim).fill(1.0)),
    values: Array.from({ length: 100 }, () => new Float32Array(dim).fill(1.0)),
  };

  console.log('Running 10 operations...\n');

  for (let i = 0; i < 10; i++) {
    await optimizer.optimize(input);
  }

  // Run benchmarks to update speedup metrics
  await optimizer.benchmark();

  // Get accumulated metrics
  const metrics = optimizer.getMetrics();

  console.log(`Total operations: ${metrics.totalOperations}`);
  console.log(`Average speedup: ${metrics.averageSpeedup.toFixed(2)}x`);
  console.log(`Peak speedup: ${metrics.peakSpeedup.toFixed(2)}x`);
  console.log(`Average execution time: ${metrics.averageExecutionTimeMs.toFixed(3)}ms`);
  console.log(`Success rate: ${metrics.successRate.toFixed(1)}%`);
}

// ============================================================================
// Main Demo Runner
// ============================================================================

async function runAllExamples() {
  try {
    await basicUsageExample();
    await benchmarkExample();
    await comprehensiveSuiteExample();
    await targetValidationExample();
    await metricsTrackingExample();

    console.log('\n=== All Examples Completed ===\n');
  } catch (error) {
    console.error('Error running examples:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}

// Export for programmatic use
export {
  basicUsageExample,
  benchmarkExample,
  comprehensiveSuiteExample,
  targetValidationExample,
  metricsTrackingExample,
  runAllExamples,
};
