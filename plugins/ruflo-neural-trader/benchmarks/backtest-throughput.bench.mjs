#!/usr/bin/env node
/**
 * Backtest throughput bench — ADR-126 follow-up #48.
 *
 * Measures bars/second + total runtime + resulting Sharpe ratio for a
 * reference backtest scenario:
 *
 *   - 1 symbol (synthetic GBM, seeded)
 *   - 252 daily bars (one trading year)
 *   - Strategy: SMA(10) / SMA(50) crossover
 *   - Position: long-only, full-capital on cross-up, exit on cross-down
 *
 * Self-contained, no live data, no `npx neural-trader` shell-out. The point
 * is to baseline the JS-side compute throughput so we have a regression
 * gate for the Phase 4 attribution / Phase 5 explainer changes (both
 * touch the per-bar hot loop).
 *
 * Output:
 *   - bars/sec
 *   - total runtime
 *   - sharpe (annualized, 252 bars/year)
 *   - max drawdown
 *   - trade count
 *
 * Run:
 *   node plugins/ruflo-neural-trader/benchmarks/backtest-throughput.bench.mjs
 *
 * Output is markdown so the result can be captured into
 * `benchmarks/results/backtest-throughput-baseline-<timestamp>.md`.
 */

const BARS = 252;                 // one trading year (daily)
const ITERATIONS = 100;           // bench reps
const WARMUP = 10;                // V8 JIT warmup
const FAST_PERIOD = 10;           // SMA-fast window
const SLOW_PERIOD = 50;           // SMA-slow window
const SEED = 314159;
const COMMISSION_BPS = 5;         // 5 basis points round-trip

// --- Seeded RNG (mulberry32 — matches other benches) --------------------
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

// --- Synthetic GBM bars --------------------------------------------------
// Stable-ish ticker dynamics with a slight upward drift so SMA-cross has
// something to trade. Bars are deterministic across runs.
function makeBars(n, seed) {
  const rng = mulberry32(seed);
  const bars = new Array(n);
  let price = 100;
  for (let i = 0; i < n; i++) {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const drift = 0.0005;
    const vol = 0.015;
    const ret = drift + vol * z;
    const close = price * Math.exp(ret);
    bars[i] = { close, return: ret };
    price = close;
  }
  return bars;
}

// --- SMA cross backtest --------------------------------------------------
function runBacktest(bars) {
  const n = bars.length;
  let fastSum = 0;
  let slowSum = 0;
  let position = 0;           // 0 = flat, 1 = long
  let entryPrice = 0;
  const equity = new Array(n).fill(1.0);
  const trades = [];
  let prevFast = 0;
  let prevSlow = 0;

  for (let i = 0; i < n; i++) {
    const close = bars[i].close;

    // Rolling sums
    fastSum += close;
    slowSum += close;
    if (i >= FAST_PERIOD) fastSum -= bars[i - FAST_PERIOD].close;
    if (i >= SLOW_PERIOD) slowSum -= bars[i - SLOW_PERIOD].close;

    if (i < SLOW_PERIOD) {
      equity[i] = i > 0 ? equity[i - 1] : 1.0;
      continue;
    }

    const fastMa = fastSum / FAST_PERIOD;
    const slowMa = slowSum / SLOW_PERIOD;

    // Mark-to-market the open position first
    if (position === 1) {
      equity[i] = equity[i - 1] * (close / bars[i - 1].close);
    } else {
      equity[i] = equity[i - 1];
    }

    // Cross detection — entries trigger at next bar's open (i+1) but for
    // bench purposes we model the fill at this bar's close (the realistic
    // skill applies a fill-delay slippage model; here we want raw throughput).
    if (i > SLOW_PERIOD) {
      const crossUp = prevFast <= prevSlow && fastMa > slowMa;
      const crossDown = prevFast >= prevSlow && fastMa < slowMa;
      if (crossUp && position === 0) {
        position = 1;
        entryPrice = close;
        // Apply commission as drag on equity
        equity[i] *= 1 - COMMISSION_BPS / 1e4;
      } else if (crossDown && position === 1) {
        position = 0;
        trades.push({ entry: entryPrice, exit: close, ret: close / entryPrice - 1 });
        entryPrice = 0;
        equity[i] *= 1 - COMMISSION_BPS / 1e4;
      }
    }

    prevFast = fastMa;
    prevSlow = slowMa;
  }

  // Force-close any open position at last bar
  if (position === 1) {
    trades.push({ entry: entryPrice, exit: bars[n - 1].close, ret: bars[n - 1].close / entryPrice - 1 });
  }

  return { equity, trades };
}

// --- Metrics on equity curve --------------------------------------------
function sharpe(equity) {
  // Daily returns from equity
  const rets = new Array(equity.length - 1);
  for (let i = 1; i < equity.length; i++) {
    rets[i - 1] = equity[i] / equity[i - 1] - 1;
  }
  let sum = 0;
  for (let i = 0; i < rets.length; i++) sum += rets[i];
  const mean = sum / rets.length;
  let sse = 0;
  for (let i = 0; i < rets.length; i++) {
    const d = rets[i] - mean;
    sse += d * d;
  }
  const std = Math.sqrt(sse / (rets.length - 1));
  if (std === 0) return 0;
  // Annualize: √252 for daily data
  return (mean / std) * Math.sqrt(252);
}

function maxDrawdown(equity) {
  let peak = equity[0];
  let maxDd = 0;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] > peak) peak = equity[i];
    const dd = (equity[i] - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

// --- Bench ---------------------------------------------------------------
console.log('# Backtest throughput — bench results');
console.log('');
console.log(`Generated: ${new Date().toISOString()}`);
console.log(`Node: ${process.version}`);
console.log(`Bars: ${BARS} (1y daily)`);
console.log(`Strategy: SMA(${FAST_PERIOD}) / SMA(${SLOW_PERIOD}) crossover`);
console.log(`Commission: ${COMMISSION_BPS} bps round-trip`);
console.log(`Iterations: ${ITERATIONS} (warmup: ${WARMUP})`);
console.log(`Seed: ${SEED}`);
console.log('');

const bars = makeBars(BARS, SEED);

// Warmup
for (let i = 0; i < WARMUP; i++) runBacktest(bars);

// Timed
const ms = new Array(ITERATIONS);
let lastResult;
for (let i = 0; i < ITERATIONS; i++) {
  const t0 = performance.now();
  lastResult = runBacktest(bars);
  ms[i] = performance.now() - t0;
}

ms.sort((a, b) => a - b);
const avgMs = ms.reduce((s, x) => s + x, 0) / ms.length;
const p50Ms = ms[Math.floor(ms.length / 2)];
const p95Ms = ms[Math.floor(ms.length * 0.95)];
const p99Ms = ms[Math.floor(ms.length * 0.99)];
const barsPerSec = (BARS / (avgMs / 1000));

// Strategy metrics
const sh = sharpe(lastResult.equity);
const dd = maxDrawdown(lastResult.equity);
const finalEq = lastResult.equity[lastResult.equity.length - 1];

console.log('## Throughput');
console.log('');
console.log('| Metric            | Value         |');
console.log('|-------------------|---------------|');
console.log(`| Avg runtime       | ${avgMs.toFixed(4)} ms |`);
console.log(`| p50 runtime       | ${p50Ms.toFixed(4)} ms |`);
console.log(`| p95 runtime       | ${p95Ms.toFixed(4)} ms |`);
console.log(`| p99 runtime       | ${p99Ms.toFixed(4)} ms |`);
console.log(`| Bars/sec          | ${barsPerSec.toFixed(0)} |`);
console.log('');
console.log('## Strategy metrics (last iteration)');
console.log('');
console.log('| Metric            | Value         |');
console.log('|-------------------|---------------|');
console.log(`| Final equity      | ${finalEq.toFixed(4)} (vs 1.000 start) |`);
console.log(`| Sharpe (ann.)     | ${sh.toFixed(3)} |`);
console.log(`| Max drawdown      | ${(dd * 100).toFixed(2)}% |`);
console.log(`| Trade count       | ${lastResult.trades.length} |`);
console.log('');
console.log('## Acceptance');
console.log('');
console.log(`- Avg runtime: **${avgMs.toFixed(4)} ms** (target: <10 ms — ${avgMs < 10 ? 'PASS' : 'FAIL'})`);
console.log(`- Throughput: **${barsPerSec.toFixed(0)} bars/sec** (target: >25,000 bars/sec — ${barsPerSec > 25000 ? 'PASS' : 'FAIL'})`);
console.log('');
console.log('## Notes');
console.log('');
console.log('- The reference scenario is deliberately small (1y / 1 symbol /');
console.log('  1 strategy) so the bench measures the per-bar compute kernel,');
console.log('  not memory pressure or GC behavior. Walk-forward and');
console.log('  Monte-Carlo variants are upstream `npx neural-trader` features');
console.log('  and are NOT modeled here.');
console.log('- Commissions are applied as equity drag at fill time (5 bps');
console.log('  round-trip is the SOTA mid-cap-ETF default the skill uses).');
console.log('');
console.log('## Refs');
console.log('');
console.log('- ADR-126 §SOTA delta — bench-driven perf work');
console.log('- `plugins/ruflo-neural-trader/skills/trader-backtest/SKILL.md` — production backtest path');
