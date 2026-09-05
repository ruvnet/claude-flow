#!/usr/bin/env node
// benchmark-codemods.mjs — measured benchmark for deterministic Tier-1 codemods (ADR-143).
//
// Runs every case in bench/codemod-corpus.json through applyCodemod() and records:
//   - correctness vs the golden `expected` output
//   - latency (avg / p50 / p99 / max)
//   - cost: $0 measured (no API call) + estimated savings vs an LLM edit
//
// Writes a run JSON (tagged summary.benchmark="codemod-tier1") into the
// cost-tracker plugin's runs dir, which is exactly what `cost-trend` reads:
//   plugins/ruflo-cost-tracker/docs/benchmarks/runs/codemod-<timestamp>.json
// View the series with: BENCH_NAME=codemod-tier1 node scripts/trend.mjs
//
// Usage:
//   node scripts/benchmark-codemods.mjs            # build dist first (npm run build)
//   BENCH_JSON=1 node scripts/benchmark-codemods.mjs   # machine-readable JSON to stdout
//   BENCH_NO_WRITE=1 node scripts/benchmark-codemods.mjs  # don't write a run file

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(SCRIPT_DIR, '../../../..');
// Write to the cost-tracker plugin's runs dir — the exact path `cost-trend` reads.
const RUNS_DIR = join(REPO_ROOT, 'plugins', 'ruflo-cost-tracker', 'docs', 'benchmarks', 'runs');

// Estimated per-edit LLM cost (USD). Documented estimates, NOT a live call —
// used only to express the savings of a $0 deterministic codemod.
const LLM_EDIT_COST = { haiku: 0.0002, sonnet: 0.003, opus: 0.015 };

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  const { applyCodemod } = await import('../dist/src/ruvector/codemods/engine.js');
  const corpus = JSON.parse(readFileSync(join(CLI_ROOT, 'bench', 'codemod-corpus.json'), 'utf-8'));
  const cases = corpus.cases;

  const results = [];
  const latencies = [];
  let correct = 0;

  for (const c of cases) {
    const t0 = performance.now();
    const r = applyCodemod(c.intent, c.code, { language: c.language });
    const latencyMs = performance.now() - t0;
    latencies.push(latencyMs);
    const ok = r.success && r.output === c.expected;
    if (ok) correct++;
    results.push({
      id: c.id, intent: c.intent, correct: ok, changed: r.changed,
      edits: r.edits, latencyMs: Number(latencyMs.toFixed(4)),
      ...(ok ? {} : { gotPrefix: (r.output ?? '').slice(0, 80), reason: r.reason }),
    });
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const avg = latencies.reduce((s, x) => s + x, 0) / latencies.length;
  const winRate = correct / cases.length;
  const estSavings = {
    vsHaiku: Number((LLM_EDIT_COST.haiku * cases.length).toFixed(6)),
    vsSonnet: Number((LLM_EDIT_COST.sonnet * cases.length).toFixed(6)),
    vsOpus: Number((LLM_EDIT_COST.opus * cases.length).toFixed(6)),
  };

  const summary = {
    runAt: new Date().toISOString(),
    benchmark: 'codemod-tier1',
    corpusVersion: corpus.version,
    corpusSize: cases.length,
    winRate,
    winRatePct: `${(winRate * 100).toFixed(1)}%`,
    successCount: correct,
    avgLatencyMs: Number(avg.toFixed(4)),
    p50LatencyMs: Number(percentile(sorted, 50).toFixed(4)),
    p99LatencyMs: Number(percentile(sorted, 99).toFixed(4)),
    maxLatencyMs: Number(Math.max(...latencies).toFixed(4)),
    structuralCostUsd: 0,
    llmBaseline: 'estimated',
    estimatedSavingsUsd: estSavings,
  };

  const run = { summary, results };

  if (process.env.BENCH_JSON) {
    console.log(JSON.stringify(run, null, 2));
  } else {
    console.log(`# Codemod Tier-1 benchmark (${cases.length} cases, corpus v${corpus.version})`);
    console.log('');
    console.log('| Metric | Value |');
    console.log('|---|---:|');
    console.log(`| Win rate (correct vs golden) | ${summary.winRatePct} (${correct}/${cases.length}) |`);
    console.log(`| Avg latency | ${summary.avgLatencyMs} ms |`);
    console.log(`| p50 / p99 / max latency | ${summary.p50LatencyMs} / ${summary.p99LatencyMs} / ${summary.maxLatencyMs} ms |`);
    console.log(`| Measured cost | $0 (no API call) |`);
    console.log(`| Est. savings vs Haiku/Sonnet/Opus | $${estSavings.vsHaiku} / $${estSavings.vsSonnet} / $${estSavings.vsOpus} |`);
    console.log('');
    const failed = results.filter((r) => !r.correct);
    if (failed.length) {
      console.log('## Failures');
      for (const f of failed) console.log(`- \`${f.id}\` (${f.intent}): ${f.reason ?? `got "${f.gotPrefix}"`}`);
      console.log('');
    }
  }

  if (!process.env.BENCH_NO_WRITE) {
    mkdirSync(RUNS_DIR, { recursive: true });
    const stamp = summary.runAt.replace(/[:.]/g, '-');
    writeFileSync(join(RUNS_DIR, `codemod-${stamp}.json`), JSON.stringify(run, null, 2));
    writeFileSync(join(RUNS_DIR, 'codemod-latest.json'), JSON.stringify(run, null, 2));
    if (!process.env.BENCH_JSON) console.log(`Wrote run to ${join(RUNS_DIR, `codemod-${stamp}.json`)}`);
  }

  // Non-zero exit if any case regressed — usable as a CI guardrail.
  if (correct !== cases.length) process.exit(1);
}

main().catch((err) => {
  console.error('benchmark failed:', err);
  process.exit(1);
});
