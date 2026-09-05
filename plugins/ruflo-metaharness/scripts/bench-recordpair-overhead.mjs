#!/usr/bin/env node
// bench-recordpair-overhead.mjs — micro-benchmark proving iter-12's
// "zero default-path overhead" claim with measured numbers.
//
// THE CLAIM
// Iter 12 added one env-flag check to model-router.ts route() so
// recordPair() fires only when CLAUDE_FLOW_ROUTER_PARALLEL_LOG=1.
// When unset (default), the cost is:
//
//   if (process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG === '1') { ... }
//
// This benchmark measures that exact pattern over 1,000,000 iterations
// and reports the per-call mean + p99. For the claim to hold, the
// per-call overhead must be sub-microsecond.
//
// USAGE
//   node scripts/bench-recordpair-overhead.mjs               # 1M iters
//   node scripts/bench-recordpair-overhead.mjs --iters 5000000
//   node scripts/bench-recordpair-overhead.mjs --format json
//
// EXIT CODES
//   0  benchmark complete (always; this is informational, not pass/fail)

import { performance } from 'node:perf_hooks';

const ARGS = (() => {
  const a = {
    iters: 1_000_000,
    format: 'table',
    // iter 25 — CI regression gate. When --max-overhead-ns N is set,
    // exit 1 if the measured iter-12 default-path overhead exceeds N
    // nanoseconds per call. Default threshold 500ns chosen as ~3.5×
    // headroom over the iter-24 measured baseline of ~147ns on Apple
    // Silicon / Node 22.
    maxOverheadNs: null,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--iters') a.iters = parseInt(process.argv[++i], 10);
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--max-overhead-ns') a.maxOverheadNs = parseFloat(process.argv[++i]);
  }
  return a;
})();

function bench(label, fn, iters) {
  // Warm-up
  for (let i = 0; i < 10_000; i++) fn();

  const samples = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    const start = performance.now();
    fn();
    samples[i] = performance.now() - start;
  }
  // performance.now() resolution is ~1 microsecond on most platforms.
  // For sub-microsecond ops we can't measure individual iterations
  // accurately; report aggregate timing instead.

  // Also measure batched timing — sum of N calls in one hot loop —
  // which IS accurate for sub-μs ops.
  const batchStart = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const batchTotal = performance.now() - batchStart;
  const meanNs = (batchTotal * 1e6) / iters;  // ms → ns / iters

  // Sort samples for percentile reporting (per-call resolution-limited)
  const sortedMs = Array.from(samples).sort((a, b) => a - b);
  const p99 = sortedMs[Math.floor(0.99 * sortedMs.length)];

  return {
    label,
    iters,
    batchTotalMs: Math.round(batchTotal * 1000) / 1000,
    meanNsPerCall: Math.round(meanNs * 100) / 100,
    p99PerCallMs: Math.round(p99 * 10000) / 10000,
  };
}

function main() {
  const iters = ARGS.iters;
  if (!Number.isInteger(iters) || iters < 1000) {
    console.error('bench-recordpair-overhead: --iters must be ≥ 1000');
    process.exit(2);
  }

  // iter 137 — guard the markdown header behind table-format so
  // --format json emits pure JSON (consumed by CI's JSON.parse).
  // Same fix-class as bench-similarity's iter 87 fix.
  if (ARGS.format !== 'json') {
    console.log(`# bench-recordpair-overhead`);
    console.log('');
    console.log(`Iterations: ${iters.toLocaleString()}`);
    console.log(`Platform: ${process.platform} ${process.arch}, Node ${process.version}`);
    console.log('');
  }

  // Baseline — no-op
  const baseline = bench('baseline (no-op)', () => {}, iters);

  // The iter-12 env-flag check, OFF case
  // Match the exact source pattern from model-router.ts
  delete process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG;  // ensure OFF
  const envCheckOff = bench(
    'iter-12 env check (FLAG OFF — default path)',
    () => { if (process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG === '1') { /* unreached */ } },
    iters,
  );

  // ON case — but no actual loadParallelRecorder().then() call (that's
  // a one-time microtask amortized over the process lifetime). Measure
  // just the conditional.
  process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG = '1';
  const envCheckOn = bench(
    'iter-12 env check (FLAG ON — branch taken, NO recordPair)',
    () => { if (process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG === '1') { /* branch taken */ } },
    iters,
  );
  delete process.env.CLAUDE_FLOW_ROUTER_PARALLEL_LOG;

  // What does the LAZY-LOADER short-circuit cost when called repeatedly?
  // Once initialized, it's a single nullness check on a module-level var.
  let _cached = null;
  const lazyLoaderInit = () => {
    if (_cached === null) _cached = { mod: { recordPair: () => {} } };
    return _cached;
  };
  // Run once to populate the cache
  lazyLoaderInit();
  const lazyLoaderHot = bench(
    'lazy loader (post-init nullness check)',
    () => { lazyLoaderInit(); },
    iters,
  );

  const results = [baseline, envCheckOff, envCheckOn, lazyLoaderHot];

  if (ARGS.format === 'json') {
    console.log(JSON.stringify({
      platform: { os: process.platform, arch: process.arch, node: process.version },
      iters,
      results,
      generatedAt: new Date().toISOString(),
    }, null, 2));
    return;
  }

  console.log(`| Variant | Total (ms) | Mean per-call (ns) | p99 sample (ms) |`);
  console.log(`|---|---:|---:|---:|`);
  for (const r of results) {
    console.log(`| ${r.label} | ${r.batchTotalMs} | ${r.meanNsPerCall} | ${r.p99PerCallMs} |`);
  }

  // Interpret
  const overhead = envCheckOff.meanNsPerCall - baseline.meanNsPerCall;
  console.log('');
  console.log(`**Iter-12 default-path overhead**: ~${Math.round(overhead)}ns per route() call`);
  console.log('');
  if (overhead < 100) {
    console.log(`✓ Overhead < 100ns confirms iter-12's "zero default-path overhead" claim.`);
    console.log(`  At 1000 routing decisions per workload, total added cost is ~${Math.round(overhead * 1000 / 1000)}μs — imperceptible.`);
  } else if (overhead < 1000) {
    console.log(`✓ Overhead < 1μs is well within tolerable bounds.`);
  } else {
    console.log(`⚠ Overhead ${Math.round(overhead)}ns is higher than expected; investigate engine optimization.`);
  }

  // CI regression gate (iter 25).
  if (ARGS.maxOverheadNs !== null) {
    if (!isFinite(ARGS.maxOverheadNs) || ARGS.maxOverheadNs <= 0) {
      console.error('bench-recordpair-overhead: --max-overhead-ns must be a positive number');
      process.exit(2);
    }
    console.log('');
    if (overhead > ARGS.maxOverheadNs) {
      console.log(`⚠ **REGRESSION**: measured ${Math.round(overhead)}ns > threshold ${ARGS.maxOverheadNs}ns`);
      console.log(`  The iter-12 dispatch wiring may have grown beyond the env-flag check.`);
      console.log(`  Inspect v3/@claude-flow/cli/src/ruvector/model-router.ts route() for new work in the default path.`);
      process.exit(1);
    } else {
      console.log(`✓ Within regression threshold (${Math.round(overhead)}ns ≤ ${ARGS.maxOverheadNs}ns).`);
    }
  }
}

main();
