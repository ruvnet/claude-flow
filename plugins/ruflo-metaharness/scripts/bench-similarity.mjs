#!/usr/bin/env node
// bench-similarity.mjs — micro-benchmark for ADR-152 §3.1's production
// similarity() function. Establishes the per-call cost budget that
// future Phase-3 consumers (§3.2 Recommender N×M ranking, §3.3 Drift
// fleet-wide scan, §3.4 Capability graph traversal) inherit.
//
// THE CLAIM (iter 41 baseline)
//   similarity(a, b) is a pure 9-dim cosine + 4-field categorical +
//   set-jaccard composite — sub-microsecond per call on Apple Silicon /
//   Node 22. Phase-3 consumers can therefore safely call it 10k+ times
//   per request without sweating budget.
//
// WHAT IT MEASURES
//   - Per-call mean + p50 + p99 over 1M iterations
//   - Three input categories (cheap / typical / rich) to surface any
//     payload-size sensitivity in projectToVec
//
// USAGE
//   node scripts/bench-similarity.mjs                    # default 1M iters
//   node scripts/bench-similarity.mjs --iters 5000000
//   node scripts/bench-similarity.mjs --format json
//   node scripts/bench-similarity.mjs --max-mean-us 10   # CI gate (exit 1 if mean > 10μs)
//
// EXIT CODES
//   0  ok (or --max-mean-us not set / threshold satisfied)
//   1  --max-mean-us threshold exceeded (regression)

import { performance } from 'node:perf_hooks';
import { similarity } from './_similarity.mjs';

const ARGS = (() => {
  const a = {
    iters: 1_000_000,
    format: 'table',
    // CI regression gate. When --max-mean-us N is set, exit 1 if any
    // measured category's mean per-call cost exceeds N microseconds.
    // Default ceiling 10μs chosen as ~5× headroom over Apple-Silicon
    // baseline; works on slower CI runners.
    maxMeanUs: null,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--iters') a.iters = parseInt(process.argv[++i], 10);
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--max-mean-us') a.maxMeanUs = parseFloat(process.argv[++i]);
  }
  return a;
})();

// ───────────────────────────────────────────────────────────────────
// Three fixture categories
// ───────────────────────────────────────────────────────────────────

const CHEAP = {
  // Bare-bones — everything defaulted from missing fields
  score: { harnessFit: 50 },
  genome: { agent_topology: ['a'] },
};

const TYPICAL = {
  // The shape the iter-38 oia-audit fingerprint produces
  score: {
    harnessFit: 78, compileConfidence: 92, taskCoverage: 65,
    toolSafety: 88, memoryUsefulness: 70, estCostPerRunUsd: 0.04,
    recommendedMode: 'CLI + MCP', archetype: 'compliance-harness',
    template: 'vertical:legal',
  },
  genome: {
    repo_type: 'node_mcp_ci',
    agent_topology: ['contract-analyst', 'redline-reviewer', 'risk-rater', 'compliance-officer'],
    risk_score: 0.45, test_confidence: 0.7, publish_readiness: 0.6,
  },
};

const RICH = {
  // Larger agent_topology (Jaccard's variable-cost path)
  score: TYPICAL.score,
  genome: {
    ...TYPICAL.genome,
    agent_topology: Array.from({ length: 32 }, (_, i) => `agent-${i}`),
  },
};

// ───────────────────────────────────────────────────────────────────
// Benchmark harness
// ───────────────────────────────────────────────────────────────────

function bench(label, a, b, iters) {
  // Warm-up
  for (let i = 0; i < 10_000; i++) similarity(a, b);

  const samples = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    similarity(a, b);
    samples[i] = performance.now() - t0;
  }

  // Stats
  let sum = 0;
  for (let i = 0; i < iters; i++) sum += samples[i];
  const mean = sum / iters;

  const sorted = Array.from(samples).sort((x, y) => x - y);
  const p50 = sorted[Math.floor(iters * 0.5)];
  const p99 = sorted[Math.floor(iters * 0.99)];

  return {
    label,
    iters,
    meanMs: mean,
    p50Ms: p50,
    p99Ms: p99,
    meanUs: mean * 1000,
    p99Us: p99 * 1000,
  };
}

// ───────────────────────────────────────────────────────────────────
// iter 87 — suppress markdown header when --format json so the file
// captured via `> /tmp/bench-similarity.json` is valid JSON. Iter 82's
// CI step JSON.parse'd the captured file but silently failed because
// the `# bench-similarity` header contaminated the input.
if (ARGS.format !== 'json') {
  console.log(`# bench-similarity — ADR-152 §3.1 per-call cost\n`);
  console.log(`iters: ${ARGS.iters.toLocaleString()}\n`);
}

const results = [
  bench('cheap', CHEAP, CHEAP, ARGS.iters),
  bench('typical', TYPICAL, TYPICAL, ARGS.iters),
  bench('rich (32 agents)', RICH, RICH, ARGS.iters),
];

let gate = { triggered: false, reasons: [] };
if (ARGS.maxMeanUs != null) {
  for (const r of results) {
    if (r.meanUs > ARGS.maxMeanUs) {
      gate.triggered = true;
      gate.reasons.push(`${r.label}: mean ${r.meanUs.toFixed(3)}μs > threshold ${ARGS.maxMeanUs}μs`);
    }
  }
}

const payload = {
  iters: ARGS.iters,
  results,
  gate: ARGS.maxMeanUs != null ? {
    thresholdUs: ARGS.maxMeanUs,
    triggered: gate.triggered,
    reasons: gate.reasons,
  } : null,
  generatedAt: new Date().toISOString(),
  // The performance contract — captured for /docs/benchmarks consumers
  contract: 'similarity() is sub-microsecond on Apple Silicon / Node 22+; Phase-3 consumers may freely call O(N²) on N=1000 harnesses (~1s budget).',
};

if (ARGS.format === 'json') {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`| Category         |       mean |        p50 |        p99 |`);
  console.log(`|------------------|-----------:|-----------:|-----------:|`);
  for (const r of results) {
    console.log(`| ${r.label.padEnd(16)} | ${r.meanUs.toFixed(3).padStart(7)}μs | ${(r.p50Ms * 1000).toFixed(3).padStart(7)}μs | ${r.p99Us.toFixed(3).padStart(7)}μs |`);
  }
  console.log('');
  if (payload.gate) {
    if (payload.gate.triggered) {
      console.log(`⚠ ALERT: mean per-call exceeded ${ARGS.maxMeanUs}μs ceiling:`);
      for (const reason of payload.gate.reasons) console.log(`    - ${reason}`);
    } else {
      console.log(`✓ all categories within --max-mean-us ${ARGS.maxMeanUs}μs ceiling`);
    }
  }
}

if (gate.triggered) process.exit(1);
