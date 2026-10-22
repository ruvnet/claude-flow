/**
 * Reproducible, bounded AgentDBBackend comparison for #4249.
 * Build memory first, then: AGENTDB_DISABLE_TRANSFORMERS=1 node benchmarks/agentdb-hnsw.mjs
 * Run this identical file in a baseline checkout and the candidate checkout.
 * No model, network embeddings, random wall-clock seeds, or speed assertions.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { AgentDBBackend } from '../dist/agentdb-backend.js';
import { createDefaultEntry } from '../dist/types.js';

const dimensions = 64;
const count = 1024;
const queryCount = 100;
const k = 10;
let seed = 4249;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000 * 2 - 1;
};
const vector = () => Float32Array.from({ length: dimensions }, random);
const entries = Array.from({ length: count }, (_, i) => ({
  ...createDefaultEntry({ key: `v${i}`, content: `v${i}` }),
  id: `v${i}`,
  embedding: vector(),
}));
const queries = Array.from({ length: queryCount }, vector);
const cosine = (a, b) => {
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2;
  }
  return dot / Math.sqrt(aa * bb);
};
const expected = queries.map((q) => new Set(entries.map((entry) => ({
  id: entry.id, score: cosine(q, entry.embedding),
})).sort((a, b) => b.score - a.score).slice(0, k).map((entry) => entry.id)));
const backend = new AgentDBBackend({
  dbPath: ':memory:', vectorDimension: dimensions, vectorBackend: 'hnswlib',
});
try {
  await backend.initialize();
  if (!backend.isAvailable()) throw new Error('Real AgentDB failed to initialize');
  await backend.bulkInsert(entries);
  const coldStart = performance.now();
  await backend.search(queries[0], { k });
  const coldSearchMs = performance.now() - coldStart;
  for (let i = 0; i < 10; i++) await backend.search(queries[i], { k });
  const times = [];
  let matched = 0;
  for (let i = 0; i < queryCount; i++) {
    const start = performance.now();
    const results = await backend.search(queries[i], { k });
    times.push(performance.now() - start);
    matched += results.filter((r) => expected[i].has(r.entry.id)).length;
  }
  times.sort((a, b) => a - b);
  const stats = await backend.getStats();
  console.log(JSON.stringify({
    node: process.version,
    platform: `${platform()}-${arch()}`,
    cpu: cpus()[0]?.model,
    dimensions, count, queryCount, k, seed: 4249,
    sourceSha256: Object.fromEntries([
      '../src/agentdb-backend.ts', '../src/agentdb-hnsw-adapter.ts',
      './agentdb-hnsw.mjs', '../dist/agentdb-backend.js', '../dist/agentdb-hnsw-adapter.js',
    ].map((name) => {
      const path = new URL(name, import.meta.url);
      return [name, existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null];
    })),
    nativeIndexBuilt: !!stats.hnswStats,
    coldSearchMs,
    warmP50Ms: times[Math.floor(times.length * 0.5)],
    warmP95Ms: times[Math.floor(times.length * 0.95)],
    recallAt10: matched / (queryCount * k),
    limitation: 'Single-process bounded run, precomputed seeded vectors, not a production or universal speedup claim.',
  }, null, 2));
} finally {
  await backend.shutdown();
}
