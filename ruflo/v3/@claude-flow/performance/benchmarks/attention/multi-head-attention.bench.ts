/**
 * Multi-Head Attention Benchmark
 *
 * Target: Baseline comparison for Flash Attention improvements
 *
 * Measures multi-head attention performance with different
 * configurations and parallelization strategies.
 */

import { benchmark, BenchmarkRunner, formatTime, formatBytes } from '../../src/framework/benchmark.js';

// ============================================================================
// Multi-Head Attention Types
// ============================================================================

interface MHAConfig {
  seqLength: number;
  headDim: number;
  numHeads: number;
  batchSize: number;
  dropout?: number;
}

interface MHAResult {
  output: Float32Array;
  headOutputs: Float32Array[];
  memoryUsed: number;
  computeTime: number;
}

// ============================================================================
// Multi-Head Attention Implementation
// ============================================================================

/**
 * Standard multi-head attention
 */
class MultiHeadAttention {
  private config: MHAConfig;

  constructor(config: MHAConfig) {
    this.config = config;
  }

  /**
   * Single head attention
   */
  private singleHeadAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array
  ): Float32Array {
    const { seqLength, headDim } = this.config;
    const scale = 1 / Math.sqrt(headDim);

    // Compute attention scores
    const scores = new Float32Array(seqLength * seqLength);

    for (let i = 0; i < seqLength; i++) {
      for (let j = 0; j < seqLength; j++) {
        let dot = 0;
        for (let k = 0; k < headDim; k++) {
          dot += query[i * headDim + k]! * key[j * headDim + k]!;
        }
        scores[i * seqLength + j] = dot * scale;
      }
    }

    // Softmax
    for (let i = 0; i < seqLength; i++) {
      let max = -Infinity;
      for (let j = 0; j < seqLength; j++) {
        max = Math.max(max, scores[i * seqLength + j]!);
      }

      let sum = 0;
      for (let j = 0; j < seqLength; j++) {
        const exp = Math.exp(scores[i * seqLength + j]! - max);
        scores[i * seqLength + j] = exp;
        sum += exp;
      }

      for (let j = 0; j < seqLength; j++) {
        scores[i * seqLength + j]! /= sum;
      }
    }

    // Weighted sum
    const output = new Float32Array(seqLength * headDim);

    for (let i = 0; i < seqLength; i++) {
      for (let k = 0; k < headDim; k++) {
        let sum = 0;
        for (let j = 0; j < seqLength; j++) {
          sum += scores[i * seqLength + j]! * value[j * headDim + k]!;
        }
        output[i * headDim + k] = sum;
      }
    }

    return output;
  }

  /**
   * Forward pass through all heads sequentially
   */
  forwardSequential(
    queries: Float32Array[],
    keys: Float32Array[],
    values: Float32Array[]
  ): MHAResult {
    const memBefore = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    const { seqLength, headDim, numHeads } = this.config;
    const headOutputs: Float32Array[] = [];

    // Process each head sequentially
    for (let h = 0; h < numHeads; h++) {
      const headOutput = this.singleHeadAttention(
        queries[h]!,
        keys[h]!,
        values[h]!
      );
      headOutputs.push(headOutput);
    }

    // Concatenate heads
    const output = new Float32Array(seqLength * headDim * numHeads);
    for (let h = 0; h < numHeads; h++) {
      for (let i = 0; i < seqLength; i++) {
        for (let k = 0; k < headDim; k++) {
          output[i * headDim * numHeads + h * headDim + k] =
            headOutputs[h]![i * headDim + k]!;
        }
      }
    }

    return {
      output,
      headOutputs,
      memoryUsed: process.memoryUsage().heapUsed - memBefore,
      computeTime: performance.now() - startTime,
    };
  }

  /**
   * Forward pass with parallel head computation (simulated)
   */
  async forwardParallel(
    queries: Float32Array[],
    keys: Float32Array[],
    values: Float32Array[]
  ): Promise<MHAResult> {
    const memBefore = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    const { seqLength, headDim, numHeads } = this.config;

    // Process all heads in parallel
    const headPromises = queries.map((q, h) =>
      Promise.resolve(this.singleHeadAttention(q, keys[h]!, values[h]!))
    );

    const headOutputs = await Promise.all(headPromises);

    // Concatenate heads
    const output = new Float32Array(seqLength * headDim * numHeads);
    for (let h = 0; h < numHeads; h++) {
      for (let i = 0; i < seqLength; i++) {
        for (let k = 0; k < headDim; k++) {
          output[i * headDim * numHeads + h * headDim + k] =
            headOutputs[h]![i * headDim + k]!;
        }
      }
    }

    return {
      output,
      headOutputs,
      memoryUsed: process.memoryUsage().heapUsed - memBefore,
      computeTime: performance.now() - startTime,
    };
  }
}

/**
 * Grouped-Query Attention (GQA)
 * Multiple query heads share fewer key/value heads
 */
class GroupedQueryAttention {
  private config: MHAConfig;
  private kvHeads: number;
  private groupSize: number;

  constructor(config: MHAConfig, kvHeads: number) {
    this.config = config;
    this.kvHeads = kvHeads;
    this.groupSize = config.numHeads / kvHeads;
  }

  forward(
    queries: Float32Array[],
    keys: Float32Array[],
    values: Float32Array[]
  ): MHAResult {
    const memBefore = process.memoryUsage().heapUsed;
    const startTime = performance.now();

    const { seqLength, headDim, numHeads } = this.config;
    const headOutputs: Float32Array[] = [];

    // Process each query head, sharing K/V within groups
    for (let h = 0; h < numHeads; h++) {
      const kvIndex = Math.floor(h / this.groupSize);
      const headOutput = this.singleHeadAttention(
        queries[h]!,
        keys[kvIndex]!,
        values[kvIndex]!
      );
      headOutputs.push(headOutput);
    }

    // Concatenate heads
    const output = new Float32Array(seqLength * headDim * numHeads);
    for (let h = 0; h < numHeads; h++) {
      for (let i = 0; i < seqLength; i++) {
        for (let k = 0; k < headDim; k++) {
          output[i * headDim * numHeads + h * headDim + k] =
            headOutputs[h]![i * headDim + k]!;
        }
      }
    }

    return {
      output,
      headOutputs,
      memoryUsed: process.memoryUsage().heapUsed - memBefore,
      computeTime: performance.now() - startTime,
    };
  }

  private singleHeadAttention(
    query: Float32Array,
    key: Float32Array,
    value: Float32Array
  ): Float32Array {
    const { seqLength, headDim } = this.config;
    const scale = 1 / Math.sqrt(headDim);

    const scores = new Float32Array(seqLength * seqLength);

    for (let i = 0; i < seqLength; i++) {
      for (let j = 0; j < seqLength; j++) {
        let dot = 0;
        for (let k = 0; k < headDim; k++) {
          dot += query[i * headDim + k]! * key[j * headDim + k]!;
        }
        scores[i * seqLength + j] = dot * scale;
      }
    }

    // Softmax
    for (let i = 0; i < seqLength; i++) {
      let max = -Infinity;
      for (let j = 0; j < seqLength; j++) {
        max = Math.max(max, scores[i * seqLength + j]!);
      }

      let sum = 0;
      for (let j = 0; j < seqLength; j++) {
        const exp = Math.exp(scores[i * seqLength + j]! - max);
        scores[i * seqLength + j] = exp;
        sum += exp;
      }

      for (let j = 0; j < seqLength; j++) {
        scores[i * seqLength + j]! /= sum;
      }
    }

    const output = new Float32Array(seqLength * headDim);

    for (let i = 0; i < seqLength; i++) {
      for (let k = 0; k < headDim; k++) {
        let sum = 0;
        for (let j = 0; j < seqLength; j++) {
          sum += scores[i * seqLength + j]! * value[j * headDim + k]!;
        }
        output[i * headDim + k] = sum;
      }
    }

    return output;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateRandomTensor(size: number): Float32Array {
  const tensor = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    tensor[i] = Math.random() * 2 - 1;
  }
  return tensor;
}

function createMultiHeadQKV(
  config: MHAConfig
): { queries: Float32Array[]; keys: Float32Array[]; values: Float32Array[] } {
  const { seqLength, headDim, numHeads } = config;
  const size = seqLength * headDim;

  return {
    queries: Array.from({ length: numHeads }, () => generateRandomTensor(size)),
    keys: Array.from({ length: numHeads }, () => generateRandomTensor(size)),
    values: Array.from({ length: numHeads }, () => generateRandomTensor(size)),
  };
}

// ============================================================================
// Benchmark Suite
// ============================================================================

export async function runMultiHeadAttentionBenchmarks(): Promise<void> {
  const runner = new BenchmarkRunner('Multi-Head Attention');

  console.log('\n--- Multi-Head Attention Benchmarks ---\n');

  // Test configurations
  const configs: MHAConfig[] = [
    { seqLength: 128, headDim: 64, numHeads: 8, batchSize: 1 },
    { seqLength: 256, headDim: 64, numHeads: 8, batchSize: 1 },
    { seqLength: 512, headDim: 64, numHeads: 8, batchSize: 1 },
    { seqLength: 256, headDim: 64, numHeads: 16, batchSize: 1 },
  ];

  for (const config of configs) {
    const { seqLength, numHeads } = config;
    console.log(`\n--- Seq: ${seqLength}, Heads: ${numHeads} ---`);

    const mha = new MultiHeadAttention(config);
    const { queries, keys, values } = createMultiHeadQKV(config);

    // Sequential forward
    const seqResult = await runner.run(
      `mha-sequential-seq${seqLength}-h${numHeads}`,
      async () => {
        mha.forwardSequential(queries, keys, values);
      },
      { iterations: 50 }
    );

    console.log(`Sequential: ${formatTime(seqResult.mean)}`);

    // Parallel forward
    const parallelResult = await runner.run(
      `mha-parallel-seq${seqLength}-h${numHeads}`,
      async () => {
        await mha.forwardParallel(queries, keys, values);
      },
      { iterations: 50 }
    );

    console.log(`Parallel: ${formatTime(parallelResult.mean)}`);

    // Speedup
    const speedup = seqResult.mean / parallelResult.mean;
    console.log(`Parallel Speedup: ${speedup.toFixed(2)}x`);
  }

  // Grouped-Query Attention comparison
  console.log('\n--- Grouped-Query Attention Comparison ---');

  const gqaConfig: MHAConfig = {
    seqLength: 256,
    headDim: 64,
    numHeads: 8,
    batchSize: 1,
  };

  const standardMHA = new MultiHeadAttention(gqaConfig);
  const { queries, keys, values } = createMultiHeadQKV(gqaConfig);

  // Standard MHA (8 query heads, 8 KV heads)
  const standardResult = await runner.run(
    'mha-standard-8heads',
    async () => {
      standardMHA.forwardSequential(queries, keys, values);
    },
    { iterations: 50 }
  );

  console.log(`Standard MHA (8 QKV heads): ${formatTime(standardResult.mean)}`);

  // GQA with 4 KV heads
  const gqa4 = new GroupedQueryAttention(gqaConfig, 4);
  const kvFor4 = {
    keys: keys.slice(0, 4),
    values: values.slice(0, 4),
  };

  const gqa4Result = await runner.run(
    'gqa-4-kv-heads',
    async () => {
      gqa4.forward(queries, kvFor4.keys, kvFor4.values);
    },
    { iterations: 50 }
  );

  console.log(`GQA (8 Q, 4 KV heads): ${formatTime(gqa4Result.mean)}`);

  // GQA with 2 KV heads
  const gqa2 = new GroupedQueryAttention(gqaConfig, 2);
  const kvFor2 = {
    keys: keys.slice(0, 2),
    values: values.slice(0, 2),
  };

  const gqa2Result = await runner.run(
    'gqa-2-kv-heads',
    async () => {
      gqa2.forward(queries, kvFor2.keys, kvFor2.values);
    },
    { iterations: 50 }
  );

  console.log(`GQA (8 Q, 2 KV heads): ${formatTime(gqa2Result.mean)}`);

  // Memory comparison
  console.log('\n--- Memory Usage Comparison ---');

  const memConfig: MHAConfig = {
    seqLength: 512,
    headDim: 64,
    numHeads: 8,
    batchSize: 1,
  };

  const { queries: q512, keys: k512, values: v512 } = createMultiHeadQKV(memConfig);
  const mha512 = new MultiHeadAttention(memConfig);

  const memResult = mha512.forwardSequential(q512, k512, v512);
  console.log(`MHA Memory (seq=512, h=8): ${formatBytes(memResult.memoryUsed)}`);

  // Per-head memory
  const perHeadMem = memResult.memoryUsed / memConfig.numHeads;
  console.log(`Per-head memory: ${formatBytes(perHeadMem)}`);

  // Theoretical attention matrix size
  const attentionMatrixSize = memConfig.seqLength * memConfig.seqLength * 4 * memConfig.numHeads;
  console.log(`Theoretical attention matrices: ${formatBytes(attentionMatrixSize)}`);

  // Summary
  console.log('\n--- Summary ---');
  console.log('Standard MHA vs GQA:');
  console.log(`  8 KV heads: ${formatTime(standardResult.mean)}`);
  console.log(`  4 KV heads: ${formatTime(gqa4Result.mean)} (${(standardResult.mean / gqa4Result.mean).toFixed(2)}x)`);
  console.log(`  2 KV heads: ${formatTime(gqa2Result.mean)} (${(standardResult.mean / gqa2Result.mean).toFixed(2)}x)`);

  // Print full results
  runner.printResults();
}

// ============================================================================
// Multi-Head Attention Optimization Strategies
// ============================================================================

export const mhaOptimizations = {
  /**
   * Parallel head computation
   */
  parallelHeads: {
    description: 'Compute attention heads in parallel',
    expectedImprovement: 'Up to num_heads x speedup',
    implementation: `
      async function parallelMHA(queries, keys, values) {
        const headResults = await Promise.all(
          queries.map((q, i) => computeHead(q, keys[i], values[i]))
        );
        return concatenateHeads(headResults);
      }
    `,
  },

  /**
   * Grouped-Query Attention
   */
  groupedQueryAttention: {
    description: 'Share K/V across multiple query heads',
    expectedImprovement: '2-4x memory, 1.5-2x speed',
    implementation: `
      // Instead of numHeads K/V pairs, use numHeads / groupSize
      class GQA {
        forward(queries, keys, values) {
          return queries.map((q, i) => {
            const kvIdx = Math.floor(i / groupSize);
            return attention(q, keys[kvIdx], values[kvIdx]);
          });
        }
      }
    `,
  },

  /**
   * Multi-Query Attention
   */
  multiQueryAttention: {
    description: 'Single K/V pair shared across all heads',
    expectedImprovement: '8x memory, 2-3x speed',
    implementation: `
      class MQA {
        forward(queries, key, value) {
          // All heads share single K and V
          return queries.map(q => attention(q, key, value));
        }
      }
    `,
  },

  /**
   * Fused QKV projection
   */
  fusedQKVProjection: {
    description: 'Fuse Q, K, V projections into single operation',
    expectedImprovement: '20-30% projection overhead',
    implementation: `
      function fusedQKV(input, weights) {
        // Single matmul for all QKV
        const qkv = matmul(input, weights.qkv);
        return splitQKV(qkv, numHeads, headDim);
      }
    `,
  },

  /**
   * KV caching for inference
   */
  kvCaching: {
    description: 'Cache K/V for autoregressive generation',
    expectedImprovement: 'O(1) per token instead of O(n)',
    implementation: `
      class CachedMHA {
        private kvCache: { k: Float32Array[], v: Float32Array[] } = { k: [], v: [] };

        forward(query, key, value, useCache: boolean) {
          if (useCache) {
            this.kvCache.k.push(key);
            this.kvCache.v.push(value);
            return attention(query, this.kvCache.k, this.kvCache.v);
          }
          return attention(query, [key], [value]);
        }
      }
    `,
  },
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMultiHeadAttentionBenchmarks().catch(console.error);
}

export default runMultiHeadAttentionBenchmarks;
