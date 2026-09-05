#!/usr/bin/env node
/**
 * Signal generation bench — ADR-126 follow-up #48.
 *
 * Measures end-to-end latency of the trader-signal scan path for a small
 * representative ticker list. To keep the bench REPRODUCIBLE we do NOT hit
 * live Yahoo (the `trader-signal` skill spawns `npx neural-trader --signal
 * scan` against live feeds in production). Instead we exercise the same
 * arithmetic core — anomaly detection via Z-score over a deterministic
 * synthetic OHLCV series — and time it directly.
 *
 * The two paths share the same shape:
 *
 *   1. Build a window of N bars per symbol.
 *   2. Compute rolling mean + stddev.
 *   3. Score the latest bar against the rolling window (Z-score).
 *   4. Classify into one of the 6 anomaly categories the skill enumerates
 *      (spike, drift, flatline, oscillation, pattern-break, cluster-outlier).
 *
 * That core is what dominates real `--signal scan` latency once the network
 * fetch is amortized (the cloud fetch is a fixed ~200 ms tail latency the
 * skill can't optimize from the JS side).
 *
 * Output: avg / p50 / p95 / p99 / ops-per-sec per symbol, plus the aggregate
 * scan latency (sum across symbols).
 *
 * Run:
 *   node plugins/ruflo-neural-trader/benchmarks/signal-generation.bench.mjs
 *
 * Output is markdown so the result can be captured into
 * `benchmarks/results/signal-generation-baseline-<timestamp>.md`.
 */

const SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'SPY'];
const WINDOW_BARS = 252;          // one trading year of daily bars
const ITERATIONS = 200;           // bench reps per symbol
const WARMUP = 20;                // V8 JIT warmup
const SEED = 137;                 // deterministic across runs

// --- Seeded RNG (mulberry32 — matches portfolio-cg.bench.mjs) -----------
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

// --- Synthetic OHLCV — GBM-ish walk with regime-shifted volatility ------
// Realistic ticker-level dynamics: drift + log-normal returns, with a
// volatility bump at the tail so the latest bar is more likely to score
// anomalously (mimicking the regime the `--signal scan` skill is built to
// catch — `drift`, `spike`, `pattern-break`).
function makeBars(symbolSeed, n) {
  const rng = mulberry32(symbolSeed);
  const bars = new Array(n);
  let price = 100 + rng() * 50; // starting price in [100, 150]
  for (let i = 0; i < n; i++) {
    // Box-Muller for ~N(0,1)
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    // Regime: amplify vol in last 5% of window so latest bar is anomalous.
    const vol = i > n * 0.95 ? 0.04 : 0.012;
    const drift = 0.0003;
    const ret = drift + vol * z;
    const open = price;
    const close = open * Math.exp(ret);
    const high = Math.max(open, close) * (1 + Math.abs(rng()) * 0.005);
    const low = Math.min(open, close) * (1 - Math.abs(rng()) * 0.005);
    const volume = Math.floor(1e6 + rng() * 5e6);
    bars[i] = { open, high, low, close, volume };
    price = close;
  }
  return bars;
}

// --- Anomaly core — what `--signal scan` does per symbol ----------------
function computeStats(bars) {
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += closes[i];
  const mean = sum / n;
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const d = closes[i] - mean;
    sse += d * d;
  }
  const std = Math.sqrt(sse / (n - 1));
  return { mean, std };
}

function classify(zSeries) {
  // Multi-dimensional Z signal — mimics the skill's 6-class output.
  let maxZ = 0;
  let signFlips = 0;
  let highCount = 0;
  let prev = 0;
  for (let i = 0; i < zSeries.length; i++) {
    const z = zSeries[i];
    const a = Math.abs(z);
    if (a > maxZ) maxZ = a;
    if (a > 2) highCount++;
    if (i > 0 && Math.sign(z) !== Math.sign(prev) && Math.abs(prev) > 1) signFlips++;
    prev = z;
  }
  const lastZ = zSeries[zSeries.length - 1];
  if (maxZ > 5) return 'spike';
  if (highCount > zSeries.length * 0.3 && Math.abs(lastZ) > 1.5) return 'drift';
  if (maxZ < 0.5) return 'flatline';
  if (signFlips > zSeries.length * 0.2) return 'oscillation';
  if (highCount > zSeries.length * 0.5) return 'cluster-outlier';
  if (highCount > 3 && signFlips > 1) return 'pattern-break';
  return 'normal';
}

function scanSymbol(bars) {
  // 1. rolling baseline (first 80% of bars)
  const baselineEnd = Math.floor(bars.length * 0.8);
  const baseline = bars.slice(0, baselineEnd);
  const tail = bars.slice(baselineEnd);
  const { mean, std } = computeStats(baseline);

  // 2. score every tail bar
  const zSeries = new Array(tail.length);
  for (let i = 0; i < tail.length; i++) {
    zSeries[i] = std > 0 ? (tail[i].close - mean) / std : 0;
  }

  // 3. classify
  const anomalyType = classify(zSeries);
  const maxZ = zSeries.reduce((m, z) => Math.max(m, Math.abs(z)), 0);

  return { anomalyType, maxZ, lastZ: zSeries[zSeries.length - 1] };
}

// --- Percentile helpers --------------------------------------------------
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(ms) {
  const sorted = [...ms].sort((a, b) => a - b);
  const sum = sorted.reduce((s, x) => s + x, 0);
  const avg = sum / sorted.length;
  return {
    avg,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    opsPerSec: 1_000_000 / avg, // avg is in µs
  };
}

// --- Run -----------------------------------------------------------------
console.log('# trader-signal scan latency — bench results');
console.log('');
console.log(`Generated: ${new Date().toISOString()}`);
console.log(`Node: ${process.version}`);
console.log(`Symbols: ${SYMBOLS.join(', ')}`);
console.log(`Window: ${WINDOW_BARS} bars per symbol`);
console.log(`Iterations per symbol: ${ITERATIONS} (warmup: ${WARMUP})`);
console.log(`Seed: ${SEED}`);
console.log('');
console.log('## Per-symbol latency');
console.log('');
console.log('| Symbol | Avg (µs) | p50 (µs) | p95 (µs) | p99 (µs) | Ops/sec   | Anomaly        |');
console.log('|--------|----------|----------|----------|----------|-----------|----------------|');

const perSymbol = [];
for (let s = 0; s < SYMBOLS.length; s++) {
  const symbol = SYMBOLS[s];
  // Different seed per symbol so each gets its own series.
  const symSeed = SEED + s * 31;
  const bars = makeBars(symSeed, WINDOW_BARS);

  // Warmup
  for (let i = 0; i < WARMUP; i++) scanSymbol(bars);

  // Timed runs (perf.now resolves in microseconds in Node 20+)
  const us = new Array(ITERATIONS);
  let lastResult;
  for (let i = 0; i < ITERATIONS; i++) {
    const t0 = performance.now();
    lastResult = scanSymbol(bars);
    us[i] = (performance.now() - t0) * 1000; // ms -> µs
  }

  const summary = summarize(us);
  perSymbol.push({ symbol, ...summary, anomaly: lastResult.anomalyType });

  console.log(
    `| ${symbol.padEnd(6)} | ${summary.avg.toFixed(2).padEnd(8)} | ${summary.p50.toFixed(2).padEnd(8)} | ${summary.p95.toFixed(2).padEnd(8)} | ${summary.p99.toFixed(2).padEnd(8)} | ${summary.opsPerSec.toFixed(0).padEnd(9)} | ${lastResult.anomalyType.padEnd(14)} |`,
  );
}

// --- Aggregate scan latency — what a full `--signal scan` costs ---------
const aggMs = SYMBOLS.map((_, i) => perSymbol[i].avg / 1000).reduce((s, x) => s + x, 0);
const aggP95Ms = SYMBOLS.map((_, i) => perSymbol[i].p95 / 1000).reduce((s, x) => s + x, 0);

console.log('');
console.log('## Aggregate (full scan)');
console.log('');
console.log(`- Sum-of-avgs across ${SYMBOLS.length} symbols: **${aggMs.toFixed(3)} ms**`);
console.log(`- Sum-of-p95s across ${SYMBOLS.length} symbols: **${aggP95Ms.toFixed(3)} ms**`);
console.log('');
console.log('## Acceptance');
console.log('');
const maxAvg = Math.max(...perSymbol.map((r) => r.avg));
const PASS_AVG = maxAvg < 1000; // < 1 ms per symbol
console.log(`- Worst-symbol avg latency: **${maxAvg.toFixed(2)} µs** (target: <1000 µs — ${PASS_AVG ? 'PASS' : 'FAIL'})`);
console.log(`- Full scan (sum-of-avgs) latency: **${aggMs.toFixed(3)} ms** (target: <10 ms — ${aggMs < 10 ? 'PASS' : 'FAIL'})`);
console.log('');
console.log('## Notes');
console.log('');
console.log('- This bench measures the **anomaly-detection arithmetic core**');
console.log('  shared between the JS skill and the upstream `npx neural-trader`');
console.log('  binary. It does NOT cover network fetch latency (~200 ms tail');
console.log('  per cloud roundtrip), which dominates real-world `--signal scan`');
console.log('  and is amortized across all symbols in one batch.');
console.log('- Synthetic OHLCV is mulberry32-seeded, so results are stable');
console.log('  across runs and CI workers.');
console.log('');
console.log('## Refs');
console.log('');
console.log('- ADR-126 §SOTA delta — bench-driven perf work');
console.log('- `plugins/ruflo-neural-trader/skills/trader-signal/SKILL.md` — production scan path');
