#!/usr/bin/env node
/**
 * M4 microbench — RaBitQ-style 1-bit-per-dim signature comparison vs the
 * full Float32 dot product, at the per-pair granularity.
 *
 * Hypothesis: Hamming distance over packed Uint32 signatures (12 words at
 * dim=384) should be ~6-8x faster than the 384-multiply dot product,
 * because (a) the inner loop has fewer ops per word and (b) Uint32 ops
 * compile to tighter machine code than Float32 multiplies in V8.
 *
 * If the hypothesis holds, RaBitQ as a pre-filter on scoreShards's hot
 * loop should drop the cosine cost from ~400µs at N=1000 to ~50µs +
 * exact-cosine for the top-K shortlist only. That delivers a real ≥2x
 * end-to-end speedup that we couldn't get from Phase 1 / M3 micro-tuning.
 *
 * This bench measures the per-pair cost only — the end-to-end retrieve()
 * speedup is measured by bench-retriever-scale.mjs once M4 wires in.
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
const DIM = 384;
const ITERS = 1_000_000;

function bench(name, fn, iters = ITERS) {
  const TRIALS = 5;
  const warm = Math.min(50_000, Math.floor(iters / 10));
  for (let i = 0; i < warm; i++) fn();
  const ops = [];
  for (let t = 0; t < TRIALS; t++) {
    const s = performance.now();
    for (let i = 0; i < iters; i++) fn();
    ops.push(iters / ((performance.now() - s) / 1000));
  }
  ops.sort((a, b) => a - b);
  return {
    name,
    iters,
    trials: TRIALS,
    opsPerSec: Math.round(ops[2]),
    avgNanos: Math.round((1 / ops[2]) * 1e9 * 100) / 100,
    opsMin: Math.round(ops[0]),
    opsMax: Math.round(ops[TRIALS - 1]),
  };
}

function makeVec(seed) {
  let s = seed >>> 0 || 1;
  const v = new Float32Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    s = (s * 9301 + 49297) % 233280;
    v[i] = s / 233280 - 0.5;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

function buildSig(v) {
  const words = (DIM + 31) >>> 5;
  const sig = new Uint32Array(words);
  for (let w = 0; w < words; w++) {
    let bits = 0;
    const start = w * 32;
    const end = Math.min(DIM, start + 32);
    for (let b = start; b < end; b++) {
      if (v[b] > 0) bits |= 1 << (b - start);
    }
    sig[w] = bits >>> 0;
  }
  return sig;
}

function popcount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return (x * 0x01010101) >>> 24;
}

const a = makeVec(1);
const b = makeVec(2);
const sigA = buildSig(a);
const sigB = buildSig(b);
const WORDS = sigA.length;

// Cosine: 384 multiplies + sum, then defensive clamp.
function cosineDot(a, b) {
  let dot = 0;
  for (let i = 0; i < DIM; i++) dot += a[i] * b[i];
  return dot < 0 ? 0 : dot > 1 ? 1 : dot;
}

// Hamming: 12 XOR + popcount, single sum.
function hammingSim(sigA, sigB) {
  let hamming = 0;
  for (let w = 0; w < WORDS; w++) hamming += popcount32((sigA[w] ^ sigB[w]) >>> 0);
  // Sign-random-projection theorem: cos(θ) ≈ cos(π · hamming/dim)
  return Math.cos((Math.PI * hamming) / DIM);
}

// Sanity — agreement should be reasonable on random vectors
const cosVal = cosineDot(a, b);
const hamVal = hammingSim(sigA, sigB);
console.log(`Sanity: cosine = ${cosVal.toFixed(4)} · Hamming-approx = ${hamVal.toFixed(4)} · Δ = ${Math.abs(cosVal - hamVal).toFixed(4)}`);

const r1 = bench('cosine.dot (float32, 384-d)', () => cosineDot(a, b));
const r2 = bench('hamming.popcount (uint32, 12 words)', () => hammingSim(sigA, sigB));

const out = {
  tag: TAG,
  dim: DIM,
  wordsPerSig: WORDS,
  iters: ITERS,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  capturedAt: new Date().toISOString(),
  sanityCheck: { cosine: cosVal, hammingApprox: hamVal },
  results: [r1, r2],
  speedup: Math.round((r2.opsPerSec / r1.opsPerSec) * 100) / 100,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, `guidance-quantization-${TAG}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`\nWrote ${outPath}\n`);
console.log('| Method                             | Ops/sec     | ns/pair  |');
console.log('|------------------------------------|------------:|---------:|');
console.log(`| ${r1.name.padEnd(34)} | ${String(r1.opsPerSec).padStart(11)} | ${String(r1.avgNanos).padStart(8)} |`);
console.log(`| ${r2.name.padEnd(34)} | ${String(r2.opsPerSec).padStart(11)} | ${String(r2.avgNanos).padStart(8)} |`);
console.log(`\nHamming speedup vs dot: ${out.speedup}x`);
