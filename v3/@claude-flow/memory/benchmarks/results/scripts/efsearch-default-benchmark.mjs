#!/usr/bin/env node
/**
 * Dream Cycle 2026-08-15 — HNSWIndex query-time `efSearch` default benchmark.
 *
 * Measures HNSWIndex.search()'s *implicit default* behavior (no explicit
 * `ef` argument, the path every real caller in agentdb-adapter.ts hits
 * unless it opts in to `options.ef`) against a deterministic, clustered
 * synthetic corpus with live brute-force ground truth for recall@10.
 *
 * Run once against the pre-candidate dist/ (implicit default = efConstruction,
 * 200) and once against the post-candidate dist/ (implicit default = efSearch,
 * 50) to get baseline vs candidate receipts — see compare-efsearch-receipts.mjs.
 *
 * Also records explicit ef=50/ef=200 runs (identical on both commits) as a
 * process-internal cross-check that the *implicit-default* delta reported
 * above is really attributable to the ef value and not some other change.
 *
 * Usage:
 *   cd v3/@claude-flow/memory && npm run build
 *   node benchmarks/results/scripts/efsearch-default-benchmark.mjs --label baseline
 *   node benchmarks/results/scripts/efsearch-default-benchmark.mjs --label candidate
 */

import { HNSWIndex } from '../../../dist/hnsw-index.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const args = { label: 'run', sizes: [3000, 8000], dims: 256, queries: 60, k: 10 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--label') args.label = argv[++i];
    else if (argv[i] === '--sizes') args.sizes = argv[++i].split(',').map(Number);
  }
  return args;
}
const ARGS = parseArgs(process.argv);

// Deterministic RNG (mulberry32) — same construction used by
// scripts/benchmark-intelligence.mjs so results follow the repo's existing
// seeded-benchmark convention.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < v.length; i++) v[i] *= inv;
  return v;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function bruteTopK(vectors, query, k) {
  const scored = new Array(vectors.length);
  for (let i = 0; i < vectors.length; i++) scored[i] = [i, cosine(query, vectors[i])];
  scored.sort((x, y) => y[1] - x[1]);
  return scored.slice(0, k).map((s) => s[0]);
}

/** Clustered dataset — mirrors scripts/benchmark-intelligence.mjs's makeDataset
 * so recall isn't measured against a trivially-uniform (near-orthogonal,
 * always-easy) random cloud. */
function makeDataset(n, dims, seed) {
  const rng = mulberry32(seed);
  const numClusters = Math.max(8, Math.round(Math.sqrt(n) / 4));
  const centroids = [];
  for (let c = 0; c < numClusters; c++) {
    const v = new Float32Array(dims);
    for (let d = 0; d < dims; d++) v[d] = rng() * 2 - 1;
    normalize(v);
    centroids.push(v);
  }
  const vectors = new Array(n);
  for (let i = 0; i < n; i++) {
    const base = centroids[i % numClusters];
    const v = new Float32Array(dims);
    for (let d = 0; d < dims; d++) v[d] = base[d] + (rng() * 2 - 1) * 0.35;
    normalize(v);
    vectors[i] = v;
  }
  return vectors;
}

function makeQueries(dataset, n, dims, count, seed) {
  const rng = mulberry32(seed);
  const queries = [];
  for (let q = 0; q < count; q++) {
    const src = dataset[Math.floor(rng() * n)];
    const v = new Float32Array(dims);
    for (let d = 0; d < dims; d++) v[d] = src[d] + (rng() * 2 - 1) * 0.05;
    queries.push(normalize(v));
  }
  return queries;
}

const round = (x, d = 4) => (x == null || Number.isNaN(x) ? null : Number(x.toFixed(d)));

async function measure(index, queries, exactByQuery, k, ef) {
  // Warm pass — see scripts/benchmark-intelligence.mjs for rationale (first
  // touch pays JIT/allocation overhead; measure steady state).
  for (const q of queries) await index.search(q, k, ef);

  let total = 0, hits = 0, want = 0;
  const perQueryMs = [];
  const perQueryRecall = [];
  for (let qi = 0; qi < queries.length; qi++) {
    const t0 = performance.now();
    const res = await index.search(queries[qi], k, ef);
    const dt = performance.now() - t0;
    total += dt;
    perQueryMs.push(dt);
    const ids = new Set(res.map((r) => parseInt(r.id, 10)));
    let queryHits = 0;
    for (const id of exactByQuery[qi]) if (ids.has(id)) queryHits++;
    hits += queryHits;
    want += k;
    perQueryRecall.push(queryHits / k);
  }
  return {
    msPerQuery: round(total / queries.length, 5),
    recallAt10: round(hits / want, 4),
    perQueryMs,
    perQueryRecall,
  };
}

async function run() {
  const out = { label: ARGS.label, k: ARGS.k, dims: ARGS.dims, byN: {} };

  for (const N of ARGS.sizes) {
    const dataset = makeDataset(N, ARGS.dims, 1234 + N);
    const queries = makeQueries(dataset, N, ARGS.dims, ARGS.queries, 99 + N);
    const exactByQuery = queries.map((q) => bruteTopK(dataset, q, ARGS.k));

    const t0 = performance.now();
    const index = new HNSWIndex({
      dimensions: ARGS.dims,
      M: 16,
      efConstruction: 200,
      maxElements: N + 100,
      metric: 'cosine',
    });
    for (let i = 0; i < N; i++) await index.addPoint(String(i), dataset[i]);
    const buildMs = round(performance.now() - t0, 2);

    const entry = { n: N, buildMs };
    // THE headline measurement: no explicit `ef` — this is the code path
    // every real caller hits when it doesn't opt in to options.ef.
    entry.implicitDefault = await measure(index, queries, exactByQuery, ARGS.k, undefined);
    // Cross-check: explicit ef=200 / ef=50 are identical on both commits —
    // included so a reader can confirm the implicit-default delta above is
    // really attributable to the ef value used, not something else that
    // changed between the baseline and candidate builds.
    entry.explicitEf200 = await measure(index, queries, exactByQuery, ARGS.k, 200);
    entry.explicitEf50 = await measure(index, queries, exactByQuery, ARGS.k, 50);

    out.byN[N] = entry;
    console.log(
      `N=${N} build=${buildMs}ms | implicit-default: ${entry.implicitDefault.msPerQuery}ms/q recall@10=${entry.implicitDefault.recallAt10} ` +
      `| ef=200: ${entry.explicitEf200.msPerQuery}ms/q recall@10=${entry.explicitEf200.recallAt10} ` +
      `| ef=50: ${entry.explicitEf50.msPerQuery}ms/q recall@10=${entry.explicitEf50.recallAt10}`
    );
  }

  const outPath = path.join(RESULTS_DIR, `receipt-${ARGS.label}.json`);
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`Wrote ${outPath}`);
}

run();
