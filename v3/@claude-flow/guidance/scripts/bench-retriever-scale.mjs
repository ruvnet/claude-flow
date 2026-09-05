#!/usr/bin/env node
/**
 * Retriever scaling benchmark — measures the real customer-facing latency
 * of ShardRetriever.retrieve() as the shard count grows. This is the
 * function that runs on every hooks pre-task / pre-edit lookup, so its
 * scaling behaviour matters more than micro-benchmarks of helper
 * functions.
 *
 * The current implementation linearly scans every shard for every query
 * (retriever.ts:268 scoreShards). At N=1000 shards on a 384-dim hash
 * embedding, that's 1000 cosine similarities + 1000 glob matches per
 * query.
 *
 * Output: docs/benchmarks/guidance-retriever-scale-<tag>.json
 *
 * Usage:
 *   node v3/@claude-flow/guidance/scripts/bench-retriever-scale.mjs --tag=baseline
 */

import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../..');
const OUT_DIR = resolve(REPO_ROOT, 'docs', 'benchmarks');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const TAG = args.tag || 'untagged';

const { createRetriever } = await import(resolve(__dirname, '../dist/retriever.js'));

async function bench(name, fn, iters) {
  const TRIALS = 5;
  // Warmup
  for (let i = 0; i < Math.max(5, Math.floor(iters / 10)); i++) await fn();
  const ops = [];
  for (let t = 0; t < TRIALS; t++) {
    const s = performance.now();
    for (let i = 0; i < iters; i++) await fn();
    ops.push(iters / ((performance.now() - s) / 1000));
  }
  ops.sort((a, b) => a - b);
  return {
    name,
    iters,
    trials: TRIALS,
    opsPerSec: Math.round(ops[2]),
    avgMicros: Math.round((1 / ops[2]) * 1e6 * 1000) / 1000,
    opsMin: Math.round(ops[0]),
    opsMax: Math.round(ops[TRIALS - 1]),
  };
}

function makeShard(i) {
  return {
    id: `shard-${i}`,
    rule: {
      id: `rule-${i}`,
      text: `Rule ${i}: enforce invariant ${i} when tool is bash or write and intent matches commit`,
      summary: `Rule ${i} summary`,
      riskClass: i % 5 === 0 ? 'critical' : i % 3 === 0 ? 'high' : 'medium',
      toolClasses: ['bash', 'write'],
      intents: i % 7 === 0 ? ['security'] : ['general'],
      domains: ['general'],
      repoScopes: ['**/*'],
      priority: 5,
      source: 'root',
      isConstitution: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    compactText: `Rule ${i}: enforce invariant ${i} when tool is bash or write and intent matches commit. ` +
      `This rule prevents accidental writes that bypass the secret-scan gate when committing changes.`,
    embedding: null,
  };
}

function makeBundle(n) {
  return {
    constitution: {
      content: '# Project\n## Rules\n- NEVER commit secrets',
      ruleIds: [],
      source: 'root',
      bytes: 100,
    },
    shards: Array.from({ length: n }, (_, i) => makeShard(i)),
    manifest: { version: '1.0', hash: 'test', shardCount: n, generatedAt: new Date().toISOString() },
  };
}

const results = [];

for (const N of [10, 100, 500, 1000]) {
  const r = createRetriever();
  await r.loadBundle(makeBundle(N));
  const query = 'I need to commit a secret-scan fix in the auth module';
  // Unfiltered query — every shard passes through cosine.
  const unfiltered = await bench(
    `retrieve(N=${N}, unfiltered)`,
    () => r.retrieve({ taskDescription: query, maxShards: 5 }),
    Math.max(50, Math.floor(2000 / Math.sqrt(N))),
  );
  // Filtered query — riskFilter restricts to ~20% of shards (critical
  // only). With M3's filter-then-cosine ordering, this should be ~5x
  // cheaper than the unfiltered case at N=1000. Without it, identical.
  const filtered = await bench(
    `retrieve(N=${N}, riskFilter=[critical])`,
    () => r.retrieve({ taskDescription: query, maxShards: 5, riskFilter: ['critical'] }),
    Math.max(50, Math.floor(2000 / Math.sqrt(N))),
  );
  results.push({ N, unfiltered, filtered });
}

const out = {
  tag: TAG,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  capturedAt: new Date().toISOString(),
  results,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, `guidance-retriever-scale-${TAG}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`\nWrote ${outPath}\n`);
console.log('| N shards | unfiltered ops/s | filtered ops/s | filter speedup |');
console.log('|---------:|-----------------:|---------------:|---------------:|');
for (const r of results) {
  const ratio = (r.filtered.opsPerSec / r.unfiltered.opsPerSec).toFixed(2);
  console.log(
    `| ${String(r.N).padStart(8)} | ${String(r.unfiltered.opsPerSec).padStart(16)} | ${String(r.filtered.opsPerSec).padStart(14)} | ${ratio.padStart(14)}x |`,
  );
}
