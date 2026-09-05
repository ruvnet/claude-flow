#!/usr/bin/env node
// cost-trend — read every docs/benchmarks/runs/*.json and surface drift in
// the gate metrics (winRate, avg latency, total cost). Catches regressions
// the smoke gate misses (gate is binary; trend is a curve).
//
// Usage:
//   node scripts/trend.mjs                     # markdown summary (booster series)
//   TREND_FORMAT=json node scripts/trend.mjs   # machine-readable JSON
//   TREND_LIMIT=10 node scripts/trend.mjs      # consider only the most recent N runs
//   BENCH_NAME=codemod-tier1 node scripts/trend.mjs  # a specific benchmark series
//
// Runs are tagged via summary.benchmark. With no BENCH_NAME, only legacy booster
// runs (untagged or benchmark==="booster") are shown, so other benchmarks
// (e.g. codemod-tier1) never conflate the booster drift curve.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, '..');
const RUNS_DIR = join(PLUGIN_ROOT, 'docs', 'benchmarks', 'runs');

function loadRuns() {
  const benchName = process.env.BENCH_NAME;
  const files = readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json') && !f.endsWith('latest.json'))
    .map((f) => ({ f, mtime: statSync(join(RUNS_DIR, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  const limit = parseInt(process.env.TREND_LIMIT || '50', 10);
  return files.map(({ f }) => {
    try {
      const json = JSON.parse(readFileSync(join(RUNS_DIR, f), 'utf-8'));
      return { file: f, summary: json.summary || {} };
    } catch {
      return null;
    }
  }).filter(Boolean)
    // Keep one benchmark series: BENCH_NAME if set, else legacy booster runs
    // (untagged or benchmark==="booster"). Prevents cross-benchmark conflation.
    .filter((r) => {
      const b = r.summary.benchmark;
      return benchName ? b === benchName : (b === undefined || b === 'booster');
    })
    .slice(-limit);
}

function pct(n) { return `${(n * 100).toFixed(1)}%`; }
function ms(n)  { return `${(n || 0).toFixed(2)}ms`; }
function delta(curr, prev, fmt = (x) => x.toFixed(2), unit = '') {
  if (prev === null || prev === undefined || curr === null || curr === undefined) return '';
  const d = curr - prev;
  const sign = d > 0 ? '+' : '';
  return ` (${sign}${fmt(d)}${unit})`;
}

function main() {
  const runs = loadRuns();
  if (runs.length === 0) {
    console.log('No bench runs found in', RUNS_DIR);
    process.exit(0);
  }

  const series = runs.map((r) => ({
    file: r.file,
    runAt: r.summary.runAt,
    winRate: r.summary.winRate,
    avgLatencyMs: r.summary.avgLatencyMs,
    p99LatencyMs: r.summary.p99LatencyMs,
    overallCorrect: r.summary.overallCorrect,
    escalationRate: r.summary.escalationRate,
    avgConfidence: r.summary.avgConfidence,
    speedupVsLlm: r.summary.speedupVsLlm,
    llmCost: r.summary.llmBaseline?.totalCostUsd,
    anthropicSonnet:
      r.summary.anthropic?.['claude-sonnet-4-6']?.avgLatencyMs || null,
    anthropicOpus:
      r.summary.anthropic?.['claude-opus-4-7']?.avgLatencyMs || null,
  }));

  const first = series[0];
  const last = series[series.length - 1];

  if (process.env.TREND_FORMAT === 'json') {
    console.log(JSON.stringify({ runs: series.length, first, last, series }, null, 2));
    return;
  }

  console.log(`# cost-tracker bench trend (${series.length} runs)`);
  console.log('');
  console.log(`First run: \`${first.file}\` (${first.runAt})`);
  console.log(`Last run:  \`${last.file}\` (${last.runAt})`);
  console.log('');
  console.log('## Drift summary (last vs first)');
  console.log('');
  console.log('| Metric | First | Last | Δ |');
  console.log('|---|---:|---:|---:|');
  if (first.winRate != null && last.winRate != null) {
    console.log(`| Win rate (Tier 1) | ${pct(first.winRate)} | ${pct(last.winRate)} | ${pct(last.winRate - first.winRate)} |`);
  }
  if (first.avgLatencyMs != null && last.avgLatencyMs != null) {
    console.log(`| Avg latency | ${ms(first.avgLatencyMs)} | ${ms(last.avgLatencyMs)} | ${ms(last.avgLatencyMs - first.avgLatencyMs)} |`);
  }
  if (first.p99LatencyMs != null && last.p99LatencyMs != null) {
    console.log(`| p99 latency | ${ms(first.p99LatencyMs)} | ${ms(last.p99LatencyMs)} | ${ms(last.p99LatencyMs - first.p99LatencyMs)} |`);
  }
  if (first.escalationRate != null && last.escalationRate != null) {
    console.log(`| Escalation rate | ${pct(first.escalationRate)} | ${pct(last.escalationRate)} | ${pct(last.escalationRate - first.escalationRate)} |`);
  }
  if (first.speedupVsLlm != null && last.speedupVsLlm != null) {
    console.log(`| Speedup vs Gemini | ${first.speedupVsLlm.toFixed(1)}× | ${last.speedupVsLlm.toFixed(1)}× | ${(last.speedupVsLlm - first.speedupVsLlm).toFixed(1)}× |`);
  }

  console.log('');
  console.log('## Per-run series');
  console.log('');
  console.log('| Run | Win rate | Avg lat | p99 | Escalation | Sonnet 4.6 lat | Opus 4.7 lat |');
  console.log('|---|---:|---:|---:|---:|---:|---:|');
  for (const r of series) {
    const wr = r.winRate != null ? pct(r.winRate) : '—';
    const al = r.avgLatencyMs != null ? ms(r.avgLatencyMs) : '—';
    const p99 = r.p99LatencyMs != null ? ms(r.p99LatencyMs) : '—';
    const er = r.escalationRate != null ? pct(r.escalationRate) : '—';
    const son = r.anthropicSonnet != null ? ms(r.anthropicSonnet) : '—';
    const opu = r.anthropicOpus != null ? ms(r.anthropicOpus) : '—';
    const tag = r.file.replace(/\.json$/, '').slice(0, 19);
    console.log(`| \`${tag}\` | ${wr} | ${al} | ${p99} | ${er} | ${son} | ${opu} |`);
  }

  // Regression flagging
  if (first.winRate != null && last.winRate != null && last.winRate < first.winRate) {
    console.log('');
    console.log(`> ⚠ Regression: win rate dropped ${pct(last.winRate - first.winRate)}`);
  }
  if (first.avgLatencyMs != null && last.avgLatencyMs != null && last.avgLatencyMs > first.avgLatencyMs * 1.5) {
    console.log('');
    console.log(`> ⚠ Regression: avg latency rose ${(last.avgLatencyMs / first.avgLatencyMs).toFixed(2)}× from first run`);
  }
}

main();
