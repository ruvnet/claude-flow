/**
 * HNSW Search Benchmark (ADR-125 Phase 6).
 *
 * Vitest `bench()` suite that measures the canonical `HNSWIndex.search()`
 * against a 1k-entry index. The bench exists so `npm run bench` produces
 * non-empty output and gives the README perf table a real referent.
 *
 * Result interpretation:
 * - `hnsw.search k=10` is the headline number — single-query latency against
 *   1,000 random 128-dim vectors.
 * - `hnsw.add (single)` measures incremental insert cost; useful for tracking
 *   regression as ADR-125 Phase 3 adds persistence.
 *
 * @see {@link ../docs/adr/ADR-125-memory-consolidation.md}
 */

import { describe, bench, beforeAll } from 'vitest';
import { HNSWIndex } from '../src/hnsw-index.js';

// Bench scale chosen to fit Phase 6's "ONE simple benchmark against 1k entries"
// scope. Dimensions kept small (128) so the bench completes in seconds — the
// goal is a runnable referent, not a full perf evaluation (that's Phase 3+).
const N = 1_000;
const DIM = 128;
const M = 16;
const EF_CONSTRUCTION = 200;

function randomVector(dim: number): Float32Array {
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() * 2 - 1;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

describe('HNSW search — 1k entries, 128-dim', () => {
  let index: HNSWIndex;
  let queries: Float32Array[];

  beforeAll(async () => {
    index = new HNSWIndex({
      dimensions: DIM,
      M,
      efConstruction: EF_CONSTRUCTION,
      maxElements: N + 100,
      metric: 'cosine',
    });

    // Pre-populate
    for (let i = 0; i < N; i++) {
      await index.addPoint(`vec-${i}`, randomVector(DIM));
    }

    // Pre-generate query vectors so the bench measures search, not RNG.
    queries = Array.from({ length: 50 }, () => randomVector(DIM));
  });

  bench(
    'hnsw.search k=10',
    async () => {
      const q = queries[Math.floor(Math.random() * queries.length)]!;
      await index.search(q, 10);
    },
    { iterations: 100, warmupIterations: 10 }
  );

  bench(
    'hnsw.search k=50',
    async () => {
      const q = queries[Math.floor(Math.random() * queries.length)]!;
      await index.search(q, 50);
    },
    { iterations: 100, warmupIterations: 10 }
  );
});

describe('HNSW add — incremental insert cost', () => {
  let index: HNSWIndex;
  let counter = 0;

  beforeAll(() => {
    index = new HNSWIndex({
      dimensions: DIM,
      M,
      efConstruction: EF_CONSTRUCTION,
      maxElements: 10_000,
      metric: 'cosine',
    });
  });

  bench(
    'hnsw.add (single)',
    async () => {
      await index.addPoint(`add-${counter++}`, randomVector(DIM));
    },
    { iterations: 500, warmupIterations: 50 }
  );
});
