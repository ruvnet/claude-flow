/**
 * Attention Memory Efficiency Benchmark
 *
 * Target: 50-75% memory reduction
 *
 * Measures memory efficiency of different attention implementations
 * and optimization strategies.
 */

import { benchmark, BenchmarkRunner, formatTime, formatBytes } from '../../src/framework/benchmark.js';

// ============================================================================
// Memory Tracking
// ============================================================================

interface MemorySnapshot {
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  rss: number;
}

function takeMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
    rss: mem.rss,
  };
}

function calculateMemoryDelta(before: MemorySnapshot, after: MemorySnapshot): number {
  return after.heapUsed - before.heapUsed;
}

// ============================================================================
// Attention Implementations for Memory Testing
// ============================================================================

/**
 * Standard attention - stores full attention matrix
 */
function standardAttention(
  query: Float32Array,
  key: Float32Array,
  value: Float32Array,
  seqLength: number,
  headDim: number
): { output: Float32Array; attentionMatrix: Float32Array } {
  const scale = 1 / Math.sqrt(headDim);

  // Full attention matrix - O(n^2) memory
  const attentionMatrix = new Float32Array(seqLength * seqLength);

  // Compute scores
  for (let i = 0; i < seqLength; i++) {
    for (let j = 0; j < seqLength; j++) {
      let dot = 0;
      for (let k = 0; k < headDim; k++) {
        dot += query[i * headDim + k]! * key[j * headDim + k]!;
      }
      attentionMatrix[i * seqLength + j] = dot * scale;
    }
  }

  // Softmax
  for (let i = 0; i < seqLength; i++) {
    let max = -Infinity;
    for (let j = 0; j < seqLength; j++) {
      max = Math.max(max, attentionMatrix[i * seqLength + j]!);
    }

    let sum = 0;
    for (let j = 0; j < seqLength; j++) {
      const exp = Math.exp(attentionMatrix[i * seqLength + j]! - max);
      attentionMatrix[i * seqLength + j] = exp;
      sum += exp;
    }

    for (let j = 0; j < seqLength; j++) {
      attentionMatrix[i * seqLength + j]! /= sum;
    }
  }

  // Output
  const output = new Float32Array(seqLength * headDim);
  for (let i = 0; i < seqLength; i++) {
    for (let k = 0; k < headDim; k++) {
      let sum = 0;
      for (let j = 0; j < seqLength; j++) {
        sum += attentionMatrix[i * seqLength + j]! * value[j * headDim + k]!;
      }
      output[i * headDim + k] = sum;
    }
  }

  return { output, attentionMatrix };
}

/**
 * Memory-efficient attention - no full matrix storage
 */
function memoryEfficientAttention(
  query: Float32Array,
  key: Float32Array,
  value: Float32Array,
  seqLength: number,
  headDim: number
): { output: Float32Array } {
  const scale = 1 / Math.sqrt(headDim);
  const output = new Float32Array(seqLength * headDim);

  // Process row by row - O(n) memory for scores
  const rowScores = new Float32Array(seqLength);

  for (let i = 0; i < seqLength; i++) {
    // Compute scores for this row
    let max = -Infinity;
    for (let j = 0; j < seqLength; j++) {
      let dot = 0;
      for (let k = 0; k < headDim; k++) {
        dot += query[i * headDim + k]! * key[j * headDim + k]!;
      }
      rowScores[j] = dot * scale;
      max = Math.max(max, rowScores[j]!);
    }

    // Softmax
    let sum = 0;
    for (let j = 0; j < seqLength; j++) {
      rowScores[j] = Math.exp(rowScores[j]! - max);
      sum += rowScores[j]!;
    }
    for (let j = 0; j < seqLength; j++) {
      rowScores[j]! /= sum;
    }

    // Compute output for this row
    for (let k = 0; k < headDim; k++) {
      let val = 0;
      for (let j = 0; j < seqLength; j++) {
        val += rowScores[j]! * value[j * headDim + k]!;
      }
      output[i * headDim + k] = val;
    }
  }

  return { output };
}

/**
 * Chunked attention - process in blocks
 */
function chunkedAttention(
  query: Float32Array,
  key: Float32Array,
  value: Float32Array,
  seqLength: number,
  headDim: number,
  chunkSize: number = 64
): { output: Float32Array } {
  const scale = 1 / Math.sqrt(headDim);
  const output = new Float32Array(seqLength * headDim);
  const numChunks = Math.ceil(seqLength / chunkSize);

  // Chunk buffer - O(chunkSize^2) memory
  const chunkScores = new Float32Array(chunkSize * seqLength);
  const rowMax = new Float32Array(chunkSize).fill(-Infinity);
  const rowSum = new Float32Array(chunkSize).fill(0);

  for (let ci = 0; ci < numChunks; ci++) {
    const iStart = ci * chunkSize;
    const iEnd = Math.min(iStart + chunkSize, seqLength);
    const iSize = iEnd - iStart;

    // Reset accumulators
    rowMax.fill(-Infinity);
    rowSum.fill(0);
    output.fill(0, iStart * headDim, iEnd * headDim);

    for (let cj = 0; cj < numChunks; cj++) {
      const jStart = cj * chunkSize;
      const jEnd = Math.min(jStart + chunkSize, seqLength);
      const jSize = jEnd - jStart;

      // Compute chunk scores
      for (let i = 0; i < iSize; i++) {
        for (let j = 0; j < jSize; j++) {
          let dot = 0;
          for (let k = 0; k < headDim; k++) {
            dot += query[(iStart + i) * headDim + k]! * key[(jStart + j) * headDim + k]!;
          }
          chunkScores[i * seqLength + jStart + j] = dot * scale;
        }
      }

      // Online softmax update
      for (let i = 0; i < iSize; i++) {
        const prevMax = rowMax[i]!;

        // Find new max
        for (let j = 0; j < jSize; j++) {
          rowMax[i] = Math.max(rowMax[i]!, chunkScores[i * seqLength + jStart + j]!);
        }

        // Rescale previous
        if (prevMax !== -Infinity && prevMax !== rowMax[i]) {
          const rescale = Math.exp(prevMax - rowMax[i]!);
          rowSum[i]! *= rescale;
          for (let k = 0; k < headDim; k++) {
            output[(iStart + i) * headDim + k]! *= rescale;
          }
        }

        // Add new exponentials
        for (let j = 0; j < jSize; j++) {
          const exp = Math.exp(chunkScores[i * seqLength + jStart + j]! - rowMax[i]!);
          chunkScores[i * seqLength + jStart + j] = exp;
          rowSum[i]! += exp;
        }

        // Accumulate output
        for (let k = 0; k < headDim; k++) {
          for (let j = 0; j < jSize; j++) {
            output[(iStart + i) * headDim + k]! +=
              chunkScores[i * seqLength + jStart + j]! * value[(jStart + j) * headDim + k]!;
          }
        }
      }
    }

    // Final normalization
    for (let i = 0; i < iSize; i++) {
      for (let k = 0; k < headDim; k++) {
        output[(iStart + i) * headDim + k]! /= rowSum[i]!;
      }
    }
  }

  return { output };
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

// ============================================================================
// Benchmark Suite
// ============================================================================

export async function runMemoryEfficiencyBenchmarks(): Promise<void> {
  const runner = new BenchmarkRunner('Attention Memory Efficiency');

  console.log('\n--- Attention Memory Efficiency Benchmarks ---\n');

  // Test configurations
  const seqLengths = [128, 256, 512, 1024];
  const headDim = 64;

  // Memory scaling comparison
  console.log('--- Memory Scaling by Sequence Length ---\n');

  const memoryResults: Array<{
    seqLength: number;
    standard: number;
    efficient: number;
    chunked: number;
    reduction: number;
  }> = [];

  for (const seqLength of seqLengths) {
    console.log(`Sequence Length: ${seqLength}`);

    const size = seqLength * headDim;
    const query = generateRandomTensor(size);
    const key = generateRandomTensor(size);
    const value = generateRandomTensor(size);

    // Standard attention memory
    if (typeof global.gc === 'function') global.gc();
    const standardBefore = takeMemorySnapshot();
    const standardResult = standardAttention(query, key, value, seqLength, headDim);
    const standardAfter = takeMemorySnapshot();
    const standardMem = calculateMemoryDelta(standardBefore, standardAfter);
    void standardResult;

    // Memory-efficient attention
    if (typeof global.gc === 'function') global.gc();
    const efficientBefore = takeMemorySnapshot();
    const efficientResult = memoryEfficientAttention(query, key, value, seqLength, headDim);
    const efficientAfter = takeMemorySnapshot();
    const efficientMem = calculateMemoryDelta(efficientBefore, efficientAfter);
    void efficientResult;

    // Chunked attention
    if (typeof global.gc === 'function') global.gc();
    const chunkedBefore = takeMemorySnapshot();
    const chunkedResult = chunkedAttention(query, key, value, seqLength, headDim);
    const chunkedAfter = takeMemorySnapshot();
    const chunkedMem = calculateMemoryDelta(chunkedBefore, chunkedAfter);
    void chunkedResult;

    const reduction = ((standardMem - efficientMem) / standardMem) * 100;

    memoryResults.push({
      seqLength,
      standard: standardMem,
      efficient: efficientMem,
      chunked: chunkedMem,
      reduction,
    });

    console.log(`  Standard:  ${formatBytes(standardMem)}`);
    console.log(`  Efficient: ${formatBytes(efficientMem)}`);
    console.log(`  Chunked:   ${formatBytes(chunkedMem)}`);
    console.log(`  Reduction: ${reduction.toFixed(1)}%`);
    console.log('');
  }

  // Theoretical memory comparison
  console.log('--- Theoretical Memory Analysis ---\n');

  for (const seqLength of seqLengths) {
    const bytesPerFloat = 4;

    // Standard: stores full n x n attention matrix
    const standardTheory = seqLength * seqLength * bytesPerFloat;

    // Efficient: stores only one row at a time
    const efficientTheory = seqLength * bytesPerFloat;

    // Chunked: stores chunk x n scores
    const chunkSize = 64;
    const chunkedTheory = chunkSize * seqLength * bytesPerFloat;

    console.log(`Seq ${seqLength}:`);
    console.log(`  Standard:  ${formatBytes(standardTheory)} (n^2)`);
    console.log(`  Efficient: ${formatBytes(efficientTheory)} (n)`);
    console.log(`  Chunked:   ${formatBytes(chunkedTheory)} (chunk * n)`);
    console.log(`  Theoretical reduction: ${((1 - efficientTheory / standardTheory) * 100).toFixed(1)}%`);
    console.log('');
  }

  // Performance vs Memory tradeoff
  console.log('--- Performance vs Memory Tradeoff ---\n');

  const tradeoffConfig = { seqLength: 512, headDim: 64 };
  const size = tradeoffConfig.seqLength * tradeoffConfig.headDim;
  const q = generateRandomTensor(size);
  const k = generateRandomTensor(size);
  const v = generateRandomTensor(size);

  // Standard performance
  const standardPerfResult = await runner.run(
    'standard-attention-perf',
    async () => {
      standardAttention(q, k, v, tradeoffConfig.seqLength, tradeoffConfig.headDim);
    },
    { iterations: 20 }
  );

  console.log(`Standard Performance: ${formatTime(standardPerfResult.mean)}`);

  // Efficient performance
  const efficientPerfResult = await runner.run(
    'efficient-attention-perf',
    async () => {
      memoryEfficientAttention(q, k, v, tradeoffConfig.seqLength, tradeoffConfig.headDim);
    },
    { iterations: 20 }
  );

  console.log(`Memory-Efficient Performance: ${formatTime(efficientPerfResult.mean)}`);

  // Chunked performance with different chunk sizes
  const chunkSizes = [32, 64, 128, 256];

  for (const chunkSize of chunkSizes) {
    const chunkedPerfResult = await runner.run(
      `chunked-attention-chunk${chunkSize}`,
      async () => {
        chunkedAttention(q, k, v, tradeoffConfig.seqLength, tradeoffConfig.headDim, chunkSize);
      },
      { iterations: 20 }
    );

    console.log(`Chunked (size=${chunkSize}): ${formatTime(chunkedPerfResult.mean)}`);
  }

  // Multi-head memory analysis
  console.log('\n--- Multi-Head Memory Analysis ---\n');

  const numHeads = [4, 8, 16, 32];
  const mhaSeqLength = 256;

  for (const heads of numHeads) {
    const mhaSize = mhaSeqLength * headDim;

    // Standard MHA memory
    const standardMHAMem = mhaSeqLength * mhaSeqLength * 4 * heads; // attention matrices
    const qkvMem = mhaSize * 4 * 3 * heads; // QKV storage

    // GQA memory (shared KV)
    const gqaKVHeads = heads / 4;
    const gqaMem = mhaSeqLength * mhaSeqLength * 4 * heads + // attention matrices (same)
      mhaSize * 4 * heads + // Q storage
      mhaSize * 4 * 2 * gqaKVHeads; // shared KV

    // MQA memory (single KV)
    const mqaMem = mhaSeqLength * mhaSeqLength * 4 * heads + // attention matrices
      mhaSize * 4 * heads + // Q storage
      mhaSize * 4 * 2; // single KV

    console.log(`${heads} heads:`);
    console.log(`  Standard MHA: ${formatBytes(standardMHAMem + qkvMem)}`);
    console.log(`  GQA (${gqaKVHeads} KV): ${formatBytes(gqaMem)}`);
    console.log(`  MQA (1 KV):   ${formatBytes(mqaMem)}`);
    console.log(`  MQA reduction: ${(((standardMHAMem + qkvMem) - mqaMem) / (standardMHAMem + qkvMem) * 100).toFixed(1)}%`);
    console.log('');
  }

  // Summary
  console.log('--- Summary ---\n');

  console.log('Memory Reduction Achieved:');
  for (const result of memoryResults) {
    const targetMet = result.reduction >= 50;
    console.log(
      `  Seq ${result.seqLength}: ${result.reduction.toFixed(1)}% ${targetMet ? '(TARGET MET)' : ''}`
    );
  }

  console.log('\nPerformance Comparison (seq=512):');
  console.log(`  Standard: ${formatTime(standardPerfResult.mean)}`);
  console.log(`  Efficient: ${formatTime(efficientPerfResult.mean)}`);

  // Print full results
  runner.printResults();
}

// ============================================================================
// Memory Efficiency Optimization Strategies
// ============================================================================

export const memoryOptimizations = {
  /**
   * Online softmax computation
   */
  onlineSoftmax: {
    description: 'Compute softmax in streaming fashion without storing all values',
    expectedImprovement: 'O(n) instead of O(n^2) for softmax',
    implementation: `
      class OnlineSoftmax {
        private max = -Infinity;
        private sum = 0;
        private count = 0;

        add(value: number): void {
          if (value > this.max) {
            this.sum *= Math.exp(this.max - value);
            this.max = value;
          }
          this.sum += Math.exp(value - this.max);
          this.count++;
        }

        normalize(value: number): number {
          return Math.exp(value - this.max) / this.sum;
        }
      }
    `,
  },

  /**
   * Gradient checkpointing
   */
  gradientCheckpointing: {
    description: 'Recompute attention during backward pass instead of storing',
    expectedImprovement: 'O(1) memory for activations',
    implementation: `
      function checkpointedAttention(q, k, v) {
        const output = computeAttention(q, k, v);

        function backward(gradOutput) {
          // Recompute attention weights during backward
          const attnWeights = recomputeAttention(q, k);
          return computeGradients(gradOutput, attnWeights, q, k, v);
        }

        return { output, backward };
      }
    `,
  },

  /**
   * Sparse attention patterns
   */
  sparseAttention: {
    description: 'Only compute attention for relevant positions',
    expectedImprovement: 'O(n * k) instead of O(n^2) where k << n',
    implementation: `
      function sparseAttention(q, k, v, pattern: 'local' | 'strided' | 'block') {
        const sparseMask = generateSparsePattern(q.length, pattern);
        return computeAttentionWithMask(q, k, v, sparseMask);
      }
    `,
  },

  /**
   * Quantization
   */
  quantization: {
    description: 'Use lower precision for attention computation',
    expectedImprovement: '2-4x memory reduction',
    implementation: `
      function quantizedAttention(q, k, v) {
        // Quantize to int8
        const qInt8 = quantizeToInt8(q);
        const kInt8 = quantizeToInt8(k);

        // Compute in int8
        const scores = computeInt8Attention(qInt8, kInt8);

        // Dequantize for output
        return dequantizeAndApply(scores, v);
      }
    `,
  },

  /**
   * Memory pooling
   */
  memoryPooling: {
    description: 'Reuse memory buffers across forward passes',
    expectedImprovement: 'Eliminates allocation overhead',
    implementation: `
      class AttentionMemoryPool {
        private scoreBuffer: Float32Array;
        private outputBuffer: Float32Array;

        forward(q, k, v) {
          // Reuse pre-allocated buffers
          computeScores(q, k, this.scoreBuffer);
          applySoftmax(this.scoreBuffer);
          computeOutput(this.scoreBuffer, v, this.outputBuffer);
          return this.outputBuffer;
        }
      }
    `,
  },
};

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runMemoryEfficiencyBenchmarks().catch(console.error);
}

export default runMemoryEfficiencyBenchmarks;
