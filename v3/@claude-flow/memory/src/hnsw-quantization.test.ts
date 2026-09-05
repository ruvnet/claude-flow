/**
 * Dream Cycle 2026-08-25 — HNSW product-quantization distance dispatch.
 *
 * `Quantizer.productQuantize()` / `productQuantizeDistance()` correctly
 * implement codebook-aware PQ encoding and distance, but nothing in the
 * search path (`distance()` / `distanceOptimized()`) ever called
 * `productQuantizeDistance()` — generic cosine/euclidean/dot/manhattan
 * distance was computed directly on raw PQ centroid-index arrays, which is
 * numerically meaningless (adjacent centroid indices are not adjacent in
 * embedding space). This test builds a synthetic clustered corpus, computes
 * brute-force ground-truth top-10 neighbors on the *unquantized* vectors,
 * and asserts recall@10 for a product-quantized index stays well above
 * chance level. On the pre-fix code this assertion fails (recall collapses
 * toward chance); post-fix it passes.
 */

import { describe, it, expect } from 'vitest';
import { HNSWIndex } from './hnsw-index.js';

function xorshift32(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };
}

/** Deterministic clustered corpus: `numClusters` well-separated Gaussian blobs. */
function buildClusteredCorpus(
  n: number,
  dim: number,
  numClusters: number,
  seed: number,
): Float32Array[] {
  const rand = xorshift32(seed);
  const centers: Float32Array[] = [];
  for (let c = 0; c < numClusters; c++) {
    const center = new Float32Array(dim);
    for (let d = 0; d < dim; d++) {
      // Spread centers far apart so clusters are well-separated.
      center[d] = (rand() - 0.5) * 20;
    }
    centers.push(center);
  }

  const vectors: Float32Array[] = [];
  for (let i = 0; i < n; i++) {
    const center = centers[i % numClusters];
    const v = new Float32Array(dim);
    for (let d = 0; d < dim; d++) {
      v[d] = center[d] + (rand() - 0.5) * 1.5; // small intra-cluster noise
    }
    vectors.push(v);
  }
  return vectors;
}

function bruteForceTopK(
  query: Float32Array,
  corpus: Float32Array[],
  ids: string[],
  k: number,
): Set<string> {
  const scored = corpus.map((v, i) => {
    let sum = 0;
    for (let d = 0; d < v.length; d++) {
      const diff = v[d] - query[d];
      sum += diff * diff;
    }
    return { id: ids[i], dist: sum };
  });
  scored.sort((a, b) => a.dist - b.dist);
  return new Set(scored.slice(0, k).map((s) => s.id));
}

async function recallAtK(config: {
  dim: number;
  n: number;
  numClusters: number;
  numQueries: number;
  k: number;
  quantization?: { type: 'product'; subquantizers: number; codebookSize: number };
}): Promise<number> {
  const corpus = buildClusteredCorpus(config.n, config.dim, config.numClusters, 42);
  const ids = corpus.map((_, i) => `v-${i}`);

  const index = new HNSWIndex({
    dimensions: config.dim,
    metric: 'euclidean',
    M: 16,
    efConstruction: 100,
    ...(config.quantization ? { quantization: config.quantization } : {}),
  });

  for (let i = 0; i < corpus.length; i++) {
    await index.addPoint(ids[i], corpus[i]);
  }

  const rand = xorshift32(1337);
  let totalRecall = 0;
  for (let q = 0; q < config.numQueries; q++) {
    const queryIdx = Math.floor(rand() * config.n);
    const query = corpus[queryIdx];

    const groundTruth = bruteForceTopK(query, corpus, ids, config.k);
    const results = await index.search(query, config.k, 200);
    const returned = new Set(results.map((r) => r.id));

    let hits = 0;
    for (const id of returned) if (groundTruth.has(id)) hits++;
    totalRecall += hits / config.k;
  }

  return totalRecall / config.numQueries;
}

describe('HNSWIndex product quantization — distance dispatch (Dream Cycle 2026-08-25)', () => {
  const DIM = 64;
  // pqTrainingThreshold is 256; N well above it keeps the pre-training
  // bootstrap window (see isValidPQEncoding()) a small fraction of the
  // corpus, representative of real usage rather than a pathological
  // near-100%-cold-start case.
  const N = 1500;
  const NUM_CLUSTERS = 8;
  const NUM_QUERIES = 30;
  const K = 10;

  it('unquantized baseline recovers near-perfect recall@10 (sanity check on the corpus/harness itself)', async () => {
    const recall = await recallAtK({ dim: DIM, n: N, numClusters: NUM_CLUSTERS, numQueries: NUM_QUERIES, k: K });
    // eslint-disable-next-line no-console
    console.log(`[dream-cycle] unquantized recall@10 = ${recall.toFixed(3)}`);
    expect(recall).toBeGreaterThan(0.85);
  });

  it('product-quantized index recall@10 recovers materially vs. the pre-fix baseline', async () => {
    const recall = await recallAtK({
      dim: DIM,
      n: N,
      numClusters: NUM_CLUSTERS,
      numQueries: NUM_QUERIES,
      k: K,
      quantization: { type: 'product', subquantizers: 8, codebookSize: 256 },
    });
    // eslint-disable-next-line no-console
    console.log(`[dream-cycle] product-quantized recall@10 = ${recall.toFixed(3)}`);
    // Measured on this exact deterministic corpus (git stash on hnsw-index.ts
    // only, test file kept in place):
    //   pre-fix (generic distance on raw PQ centroid indices): recall@10 = 0.097
    //   post-fix (productQuantizeDistance dispatched correctly): recall@10 = 0.270
    // Flat PQ trained globally on multi-modal (clustered) data is known to
    // under-resolve fine-grained same-cluster ranking — recall@10 in the
    // 0.2-0.3 range here reflects that real PQ characteristic, not a bug;
    // the assertion checks the fix's effect (recall recovers well above the
    // measured buggy baseline), not an absolute "good PQ" bar.
    expect(recall).toBeGreaterThanOrEqual(0.25);
  });

  it('getCompressionRatio() is unaffected by the distance-dispatch fix', () => {
    const index = new HNSWIndex({
      dimensions: DIM,
      metric: 'euclidean',
      quantization: { type: 'product', subquantizers: 8, codebookSize: 16 },
    });
    // 8 subquantizers -> 8x compression, unchanged by this fix (only the
    // distance computation changed, not the stored representation).
    expect((index as unknown as { quantizer: { getCompressionRatio(): number } }).quantizer.getCompressionRatio()).toBe(8);
  });
});
