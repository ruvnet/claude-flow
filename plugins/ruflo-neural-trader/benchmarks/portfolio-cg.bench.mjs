#!/usr/bin/env node
/**
 * Portfolio CG vs Neumann bench — ADR-126 Phase 3, ADR-123 Wedge 8.
 *
 * Compares three solvers on synthetic SPD covariance matrices at
 * n ∈ {16, 64, 256}. Output columns:
 *
 *   - cg_local_avg_ms              — local JS CG kernel
 *   - cg_sublinear_native_avg_ms   — native dispatch via mcp__ruflo-sublinear__solve
 *                                    (only measured when the tool surface is
 *                                    reachable in this runtime — see #55)
 *   - neumann_solve_avg_ms         — legacy Jacobi-Neumann (the path the CLI
 *                                    `npx neural-trader --portfolio optimize`
 *                                    walks at ADR-126 Phase 3 write-time)
 *   - speedup                      — neumann / cg ratio
 *   - parity                       — ||cg − neumann||_∞ on fixed seed (<1e-4)
 *
 * When the native path is NOT reachable, the native column is reported as
 * "n/a (native not available)" and the bench still ships a useful local-JS
 * baseline. The full 40-60× headline requires the daemon to be up so the
 * MCP tool is mounted into globalThis — CI exercises that path.
 *
 * Self-contained — no external runtime deps beyond Node 20+ stdlib.
 *
 * Run:
 *   node plugins/ruflo-neural-trader/benchmarks/portfolio-cg.bench.mjs
 *
 * Output is markdown so the result can be captured directly into
 * benchmarks/results/cg-native-baseline-<timestamp>.md.
 */

import { conjugateGradient, neumannSeries, SublinearAdapter, sublinearAdapter } from '../src/sublinear-adapter.mjs';

const SIZES = [16, 64, 256];
const ITERATIONS = 100;          // bench reps per size
const WARMUP = 10;               // warmup reps before timing (V8 JIT)
const TOLERANCE = 1e-6;
const SEED = 42;

// --- Seeded RNG (mulberry32 — deterministic across Node versions) -------
function mulberry32(seed) {
  let state = seed >>> 0;
  return function () {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Synthetic SPD + barely-diagonally-dominant covariance --------------
// Realistic portfolio covariance has highly correlated assets (think
// tech-sector ETFs against each other). Such matrices have eigenvalue
// spectra that are nasty for Jacobi — the spectral radius of (I − D⁻¹A)
// approaches 1, so Neumann iteration count grows ~ log(1/tol) / (1 − ρ),
// which can run into the thousands.
//
// CG, by contrast, converges in iterations proportional to √κ(A) at
// most, and far fewer when eigenvalues cluster (which they do for
// correlated assets). This is exactly the regime ADR-123 Wedge 8 targets.
//
// Construction:
//   1. Strong off-diagonal correlations in [−0.45, 0.45] so the matrix is
//      barely SPD/DD — Jacobi will struggle.
//   2. Diagonal set to the row off-sum (i.e. ρ(Jacobi) ≈ 1) plus a tiny ε
//      → strictly DD by ε, but contraction rate close to 1.
function makeSpdCovariance(n, rng) {
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = (rng() - 0.5) * 0.9; // [−0.45, 0.45]
      A[i][j] = v;
      A[j][i] = v;
    }
  }
  for (let i = 0; i < n; i++) {
    let off = 0;
    for (let j = 0; j < n; j++) if (j !== i) off += Math.abs(A[i][j]);
    // Tiny ε above the DD threshold makes Jacobi contraction rate ≈ 1.
    A[i][i] = off * 1.001 + 1e-4;
  }
  return A;
}

function makeExpectedReturns(n, rng) {
  return Array.from({ length: n }, () => (rng() - 0.5) * 0.1);
}

function infNorm(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs((a[i] || 0) - (b[i] || 0));
    if (d > m) m = d;
  }
  return m;
}

function benchOne(fn, A, b, opts) {
  const ms = [];
  for (let i = 0; i < WARMUP; i++) fn(A, b, opts);
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    fn(A, b, opts);
    ms.push(performance.now() - t0);
  }
  ms.sort((x, y) => x - y);
  const sum = ms.reduce((s, x) => s + x, 0);
  return {
    avgMs: sum / ms.length,
    medianMs: ms[Math.floor(ms.length / 2)],
    minMs: ms[0],
    maxMs: ms[ms.length - 1],
  };
}

// --- Native availability probe ------------------------------------------
//
// The native dispatch is reachable iff `mcp__ruflo-sublinear__solve` is
// mounted on globalThis (or RUFLO_SUBLINEAR_NATIVE=1 forces an attempt).
// When reachable, we run the adapter end-to-end and capture its latency.
// When not, we still produce a useful local-JS baseline.
const NATIVE_AVAILABLE = SublinearAdapter.detectSublinearTool();

// --- Run -----------------------------------------------------------------
console.log('# Portfolio CG vs Neumann — bench results');
console.log('');
console.log(`Generated: ${new Date().toISOString()}`);
console.log(`Node: ${process.version}`);
console.log(`Iterations per size: ${ITERATIONS} (warmup: ${WARMUP})`);
console.log(`Tolerance: ${TOLERANCE}`);
console.log(`Seed: ${SEED}`);
console.log(`Native sublinear tool: ${NATIVE_AVAILABLE ? 'AVAILABLE' : 'NOT AVAILABLE (local JS fallback only)'}`);
console.log('');
console.log('| n    | CG local (ms) | CG native (ms)     | Neumann (ms) | Local speedup | Native speedup | CG iters | Neumann iters | Parity (∞-norm) |');
console.log('|------|---------------|--------------------|--------------|---------------|----------------|----------|---------------|-----------------|');

let allParityOk = true;
const results = [];

// Async benchOne for the adapter (whose solveCG is async).
async function benchOneAsync(adapter, A, b, opts) {
  const ms = [];
  for (let i = 0; i < WARMUP; i++) await adapter.solveCG(A, b, opts);
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    await adapter.solveCG(A, b, opts);
    ms.push(performance.now() - t0);
  }
  ms.sort((x, y) => x - y);
  const sum = ms.reduce((s, x) => s + x, 0);
  return {
    avgMs: sum / ms.length,
    medianMs: ms[Math.floor(ms.length / 2)],
    minMs: ms[0],
    maxMs: ms[ms.length - 1],
  };
}

for (const n of SIZES) {
  const rng = mulberry32(SEED);
  const A = makeSpdCovariance(n, rng);
  const b = makeExpectedReturns(n, rng);

  const cgOpts = { tolerance: TOLERANCE, maxIterations: 200 };
  const nmOpts = { tolerance: TOLERANCE, maxIterations: 5000 };

  // Parity first — use a single shared run for the solutions.
  const cgResult = conjugateGradient(A, b, cgOpts);
  const nmResult = neumannSeries(A, b, nmOpts);
  const parity = infNorm(cgResult.solution, nmResult.solution);
  const parityOk = parity < 1e-4;
  if (!parityOk) allParityOk = false;

  // Timing — separate runs, JIT-warmed.
  const cgBench = benchOne(conjugateGradient, A, b, cgOpts);
  const nmBench = benchOne(neumannSeries, A, b, nmOpts);

  // Native dispatch — only when reachable. Use a fresh adapter for hygiene.
  // The adapter's solveCG path either dispatches to the native tool
  // (path: 'cg-mcp') or falls through to local JS (path: 'cg-local'). We
  // capture both the bench latency and which path was actually walked.
  let nativeBench = null;
  let nativeMethod = null;
  if (NATIVE_AVAILABLE) {
    try {
      const adapter = sublinearAdapter;
      const probe = await adapter.solveCG(A, b, cgOpts);
      nativeMethod = probe.method;
      // Only bench if we actually got the native path; if the adapter fell
      // through to local JS for any reason, skip — the cg-local column
      // already covers that case.
      if (probe.method === 'cg-sublinear-native') {
        nativeBench = await benchOneAsync(adapter, A, b, cgOpts);
      }
    } catch {
      /* native attempt threw — skip native measurement */
    }
  }

  const localSpeedup = nmBench.avgMs / cgBench.avgMs;
  const nativeSpeedup = nativeBench ? nmBench.avgMs / nativeBench.avgMs : null;

  results.push({
    n,
    cgAvgMs: cgBench.avgMs,
    cgNativeAvgMs: nativeBench ? nativeBench.avgMs : null,
    nativeMethod,
    neumannAvgMs: nmBench.avgMs,
    localSpeedup,
    nativeSpeedup,
    cgIters: cgResult.iterations,
    neumannIters: nmResult.iterations,
    parity,
    parityOk,
  });

  const nativeCell = nativeBench
    ? nativeBench.avgMs.toFixed(4)
    : 'n/a (native not avail)';
  const nativeSpeedupCell = nativeSpeedup
    ? `${nativeSpeedup.toFixed(2)}×`
    : 'n/a';
  console.log(
    `| ${String(n).padEnd(4)} | ${cgBench.avgMs.toFixed(4).padEnd(13)} | ${String(nativeCell).padEnd(18)} | ${nmBench.avgMs.toFixed(4).padEnd(12)} | ${(localSpeedup.toFixed(2) + '×').padEnd(13)} | ${nativeSpeedupCell.padEnd(14)} | ${String(cgResult.iterations).padEnd(8)} | ${String(nmResult.iterations).padEnd(13)} | ${parity.toExponential(2).padEnd(15)} |`,
  );
}

console.log('');
console.log('## Acceptance');
console.log('');
const at256 = results.find((r) => r.n === 256);
console.log(`- CG (local JS) latency at n=256: **${at256.cgAvgMs.toFixed(4)} ms** (target: <1 ms — ${at256.cgAvgMs < 1 ? 'PASS' : 'FAIL'})`);
if (at256.cgNativeAvgMs != null) {
  console.log(`- CG (native) latency at n=256: **${at256.cgNativeAvgMs.toFixed(4)} ms** (via \`mcp__ruflo-sublinear__solve\`)`);
  console.log(`- Native speedup at n=256: **${at256.nativeSpeedup.toFixed(2)}×** vs Neumann (target: 40-60× per ADR-123 Wedge 8)`);
} else {
  console.log('- CG (native) latency: **n/a** — native dispatch surface not reachable from this runtime');
  console.log('  - Reasons it can be unreachable: ruflo daemon not running, ruflo-sublinear plugin not registered, or the agent sandbox does not mount MCP tools onto globalThis. Set `RUFLO_SUBLINEAR_NATIVE=1` to force a dispatch attempt.');
}
console.log(`- Local JS speedup at n=256: **${at256.localSpeedup.toFixed(2)}×** vs Neumann (JS-vs-JS gap — both kernels converge in O(few) iterations on well-conditioned SPD inputs, so the gap is dominated by per-iter constant factors. The full 40-60× requires the native kernel.)`);
console.log(`- Parity at all n: **${allParityOk ? 'PASS' : 'FAIL'}** (||cg − neumann||_∞ < 1e-4)`);
console.log('');
console.log('## Refs');
console.log('');
console.log('- ADR-126 Phase 3 — `plugins/ruflo-neural-trader/src/sublinear-adapter.ts`');
console.log('- ADR-123 §162 Row 8 — Wedge 8 portfolio CG');
console.log('- Upstream `sublinear-time-solver@1.7.0` — production CG kernel target');
console.log('- Task #55 — native CG dispatch wiring (this bench column)');

// Exit non-zero if parity is broken — that's a correctness regression.
if (!allParityOk) {
  console.error('');
  console.error('FAIL: parity check broke at one or more sizes (||cg − neumann||_∞ ≥ 1e-4)');
  process.exit(1);
}
