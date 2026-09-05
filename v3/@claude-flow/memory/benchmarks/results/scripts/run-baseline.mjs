#!/usr/bin/env node
/**
 * ADR-125 Phase 6 — HNSW baseline measurement script.
 *
 * Pre-builds the package (`npm run build`) then exercises the canonical
 * HNSWIndex against 1,000 random 128-dim cosine vectors. Emits a JSON blob
 * suitable for archiving alongside `baseline-<timestamp>.md`.
 *
 * Usage:
 *   cd v3/@claude-flow/memory
 *   npm run build
 *   node benchmarks/results/scripts/run-baseline.mjs
 *
 * Companion to `benchmarks/hnsw-search.bench.ts` (which runs under vitest).
 */

import { HNSWIndex } from '../../../dist/hnsw-index.js';

const N = 1000;
const DIM = 128;
const M = 16;
const EF_CONSTRUCTION = 200;
const ITERS = 200;

function randomVector(dim) {
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

const buildStart = performance.now();
const index = new HNSWIndex({
  dimensions: DIM,
  M,
  efConstruction: EF_CONSTRUCTION,
  maxElements: N + 1000,
  metric: 'cosine',
});
for (let i = 0; i < N; i++) {
  await index.addPoint('vec-' + i, randomVector(DIM));
}
const buildTime = performance.now() - buildStart;

const queries = Array.from({ length: 50 }, () => randomVector(DIM));
for (let i = 0; i < 10; i++) await index.search(queries[i % queries.length], 10);

let t = performance.now();
for (let i = 0; i < ITERS; i++) {
  await index.search(queries[i % queries.length], 10);
}
const k10Avg = (performance.now() - t) / ITERS;

t = performance.now();
for (let i = 0; i < ITERS; i++) {
  await index.search(queries[i % queries.length], 50);
}
const k50Avg = (performance.now() - t) / ITERS;

let addCounter = N;
t = performance.now();
for (let i = 0; i < 200; i++) {
  await index.addPoint('add-' + addCounter++, randomVector(DIM));
}
const addAvg = (performance.now() - t) / 200;

console.log(
  JSON.stringify(
    {
      build_time_ms: +buildTime.toFixed(2),
      search_k10_avg_ms: +k10Avg.toFixed(4),
      search_k50_avg_ms: +k50Avg.toFixed(4),
      add_avg_ms: +addAvg.toFixed(4),
      search_k10_ops_per_sec: +(1000 / k10Avg).toFixed(1),
      search_k50_ops_per_sec: +(1000 / k50Avg).toFixed(1),
    },
    null,
    2
  )
);
