#!/usr/bin/env node
// bench-parse-mcp-scan — perf characterization for iter-50's
// parseMcpScanText. Sister to iter-41's bench-similarity.mjs.
//
// THE CLAIM
// parseMcpScanText is a small regex over short text. Sub-microsecond
// per call expected. Phase-3 consumers (oia-audit + the audit-trend
// introduced/cleared diff) call it once per audit run, so the per-call
// cost compounds if the parser is on a slow path.
//
// WHAT IT MEASURES
// Per-call mean + p50 + p99 over 100k iters, across 3 categories:
//   - empty: parseMcpScanText('') — fastest path
//   - typical: ruflo's actual single-INFO output
//   - rich: a synthetic multi-finding payload with continuation lines
//
// USAGE
//   node scripts/bench-parse-mcp-scan.mjs                  # default 100k iters
//   node scripts/bench-parse-mcp-scan.mjs --iters 1000000
//   node scripts/bench-parse-mcp-scan.mjs --format json
//   node scripts/bench-parse-mcp-scan.mjs --max-mean-us 5  # CI gate
//
// EXIT CODES
//   0  ok (or threshold satisfied)
//   1  --max-mean-us exceeded by any category

import { performance } from 'node:perf_hooks';
import { parseMcpScanText } from './_harness.mjs';

const ARGS = (() => {
  const a = { iters: 100_000, format: 'table', maxMeanUs: null };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--iters') a.iters = parseInt(process.argv[++i], 10);
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--max-mean-us') a.maxMeanUs = parseFloat(process.argv[++i]);
  }
  return a;
})();

const EMPTY = '';

const TYPICAL = `harness mcp-scan — /repo

  [INFO] No MCP security issues found
         Policy is default-deny with safe capability grants and an audit log.

Result: INFO (1 finding, 0 high)
`;

const RICH = `harness mcp-scan — /repo

  [HIGH] First high-severity finding
         Continuation line 1
         Continuation line 2
  [WARN] Second warning finding
         Some additional context
  [HIGH] Third high finding
  [INFO] Fourth informational
         Multi-line message body
         Spanning three lines
         Ending here
  [CRITICAL] Fifth critical issue
         With single continuation

Result: HIGH (5 findings, 2 high)
`;

function bench(label, input, iters) {
  // Warm-up
  for (let i = 0; i < 10_000; i++) parseMcpScanText(input);

  const samples = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    parseMcpScanText(input);
    samples[i] = performance.now() - t0;
  }
  let sum = 0;
  for (let i = 0; i < iters; i++) sum += samples[i];
  const mean = sum / iters;
  const sorted = Array.from(samples).sort((x, y) => x - y);
  const p50 = sorted[Math.floor(iters * 0.5)];
  const p99 = sorted[Math.floor(iters * 0.99)];
  return {
    label, iters,
    meanMs: mean, p50Ms: p50, p99Ms: p99,
    meanUs: mean * 1000, p99Us: p99 * 1000,
  };
}

// iter 87 — suppress markdown header in --format json so captured
// file stays valid JSON.
if (ARGS.format !== 'json') {
  console.log(`# bench-parse-mcp-scan — iter-50 parser per-call cost\n`);
  console.log(`iters: ${ARGS.iters.toLocaleString()}\n`);
}

const results = [
  bench('empty', EMPTY, ARGS.iters),
  bench('typical (1 INFO)', TYPICAL, ARGS.iters),
  bench('rich (5 findings)', RICH, ARGS.iters),
];

let gate = { triggered: false, reasons: [] };
if (ARGS.maxMeanUs != null) {
  for (const r of results) {
    if (r.meanUs > ARGS.maxMeanUs) {
      gate.triggered = true;
      gate.reasons.push(`${r.label}: mean ${r.meanUs.toFixed(3)}μs > ceiling ${ARGS.maxMeanUs}μs`);
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
  contract: 'parseMcpScanText is sub-microsecond for empty/typical; rich (5 findings, 14 lines) stays under 10μs.',
};

if (ARGS.format === 'json') {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`| Category            |       mean |        p50 |        p99 |`);
  console.log(`|---------------------|-----------:|-----------:|-----------:|`);
  for (const r of results) {
    console.log(`| ${r.label.padEnd(19)} | ${r.meanUs.toFixed(3).padStart(7)}μs | ${(r.p50Ms * 1000).toFixed(3).padStart(7)}μs | ${r.p99Us.toFixed(3).padStart(7)}μs |`);
  }
  console.log('');
  if (payload.gate) {
    if (payload.gate.triggered) {
      console.log(`⚠ ALERT: ceiling ${ARGS.maxMeanUs}μs exceeded by:`);
      for (const reason of payload.gate.reasons) console.log(`    - ${reason}`);
    } else {
      console.log(`✓ all categories within --max-mean-us ${ARGS.maxMeanUs}μs ceiling`);
    }
  }
}

if (gate.triggered) process.exit(1);
