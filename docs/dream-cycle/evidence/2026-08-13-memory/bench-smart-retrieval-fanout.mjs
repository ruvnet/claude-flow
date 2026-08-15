#!/usr/bin/env node
// Dream Cycle 2026-08-13 — baseline vs candidate evaluation for the
// smart-retrieval multi-query fan-out concurrency change (v3/@claude-flow/memory).
//
// Self-contained: extracts the pre-candidate baseline from git history,
// compiles both baseline and current working-tree candidate with tsc,
// and benchmarks them against identical mock search functions. Run from
// anywhere inside the repo:
//
//   node docs/dream-cycle/evidence/2026-08-13-memory/bench-smart-retrieval-fanout.mjs
//
// Requires: node, and `tsc` resolvable (npm install in v3/@claude-flow/memory).
//
// Hypothesis (frozen before this script produced any results):
//   Given a smartSearch() call with the default multiQuery=true (2-3
//   generated query variants), when the sequential await-in-a-for-loop
//   variant fan-out is replaced with Promise.all-based concurrent
//   fan-out, then end-to-end smartSearch() wall-clock latency should
//   improve relative to the sequential baseline, subject to:
//     (1) result correctness — fused output must be IDENTICAL (same
//         items, same order) to the baseline for the same inputs;
//     (2) no increase in per-query error rate;
//     (3) regression threshold — >=30% wall-clock improvement for a
//         3-variant fan-out under simulated per-call latency; the
//         single-variant (multiQuery=false) path must show ~0 change
//         (<15% delta either direction — generous CI-jitter bound).
//
// BASELINE_COMMIT below is the commit this candidate was diffed against
// (pre-edit HEAD at authoring time). If smart-retrieval.ts has changed
// again since, `git show` will still resolve this historical blob as
// long as the commit is reachable — the comparison remains a fair
// apples-to-apples "was this specific change worth it" check even if
// the file has moved on.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE_COMMIT = 'ee3a394'; // pre-candidate HEAD (dream(memory) ledger scaffold commit)
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const REL_PATH = 'v3/@claude-flow/memory/src/smart-retrieval.ts';
const MEMORY_PKG = join(REPO_ROOT, 'v3/@claude-flow/memory');

const work = mkdtempSync(join(tmpdir(), 'dream-bench-'));
const baselineSrc = join(work, 'baseline-smart-retrieval.ts');
const candidateSrc = join(work, 'candidate-smart-retrieval.ts');

writeFileSync(
  baselineSrc,
  execFileSync('git', ['show', `${BASELINE_COMMIT}:${REL_PATH}`], { cwd: REPO_ROOT })
);
writeFileSync(candidateSrc, execFileSync('cat', [join(REPO_ROOT, REL_PATH)]));

function compile(srcFile, outDir) {
  execFileSync(
    'npx',
    ['tsc', '--outDir', outDir, srcFile, '--module', 'ESNext', '--target', 'ES2022',
     '--moduleResolution', 'bundler', '--skipLibCheck', '--declaration', 'false'],
    { cwd: MEMORY_PKG, stdio: 'inherit' }
  );
}

const baselineOut = join(work, 'baseline-out');
const candidateOut = join(work, 'candidate-out');
compile(baselineSrc, baselineOut);
compile(candidateSrc, candidateOut);

const { smartSearch: baselineSearch } = await import(
  join(baselineOut, 'baseline-smart-retrieval.js')
);
const { smartSearch: candidateSearch } = await import(
  join(candidateOut, 'candidate-smart-retrieval.js')
);

function makeCandidateRow(id, score) {
  return { id, key: id, content: `content for ${id}`, score, namespace: 'bench' };
}

// A "task corpus": scenarios varying variant count and simulated
// per-call network/DB latency. Small, honest, representative of the
// real shape of the hot path (multiQuery default true => 2-3 variants).
const SCENARIOS = [
  { name: 'multiQuery-default-fast-store', perCallDelayMs: 15, multiQuery: true },
  { name: 'multiQuery-default-slow-store', perCallDelayMs: 60, multiQuery: true },
  { name: 'multiQuery-off-single-variant', perCallDelayMs: 60, multiQuery: false },
  { name: 'explicit-5-variants-slow-store', perCallDelayMs: 60, multiQuery: true,
    queryExpansions: () => ['v1 term', 'v2 term', 'v3 term', 'v4 term', 'v5 term'] },
];

const REPEATS = 5;

function makeSearch(perCallDelayMs, resultsPerVariant = 3) {
  const fn = async ({ query }) => {
    await new Promise((resolve) => setTimeout(resolve, perCallDelayMs));
    return {
      results: [
        makeCandidateRow(`${query}::a`, 0.9),
        makeCandidateRow(`${query}::b`, 0.8),
        makeCandidateRow(`${query}::c`, 0.7),
      ].slice(0, resultsPerVariant),
    };
  };
  return fn;
}

async function timeRun(impl, opts) {
  const fn = makeSearch(opts.perCallDelayMs);
  const start = performance.now();
  const result = await impl(fn, {
    query: 'what is the status of the release pipeline',
    multiQuery: opts.multiQuery,
    queryExpansions: opts.queryExpansions,
    diversityMMR: false,
    sessionDiversity: false,
    recencyBoost: false,
  });
  const elapsedMs = performance.now() - start;
  return { elapsedMs, ids: result.results.map((r) => r.id), stats: result.stats };
}

async function runScenario(scenario) {
  const baselineRuns = [];
  const candidateRuns = [];
  for (let i = 0; i < REPEATS; i++) {
    baselineRuns.push(await timeRun(baselineSearch, scenario));
    candidateRuns.push(await timeRun(candidateSearch, scenario));
  }

  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const baselineMs = mean(baselineRuns.map((r) => r.elapsedMs));
  const candidateMs = mean(candidateRuns.map((r) => r.elapsedMs));
  const speedup = baselineMs / candidateMs;
  const improvementPct = ((baselineMs - candidateMs) / baselineMs) * 100;

  const qualityIdentical = baselineRuns.every(
    (b, i) => JSON.stringify(b.ids) === JSON.stringify(candidateRuns[i].ids)
  );

  return {
    scenario: scenario.name,
    perCallDelayMs: scenario.perCallDelayMs,
    variantCount: baselineRuns[0].stats.variantCount,
    baselineMeanMs: Number(baselineMs.toFixed(2)),
    candidateMeanMs: Number(candidateMs.toFixed(2)),
    speedup: Number(speedup.toFixed(3)),
    improvementPct: Number(improvementPct.toFixed(1)),
    qualityIdentical,
  };
}

async function main() {
  const results = [];
  for (const scenario of SCENARIOS) {
    results.push(await runScenario(scenario));
  }

  const report = {
    hypothesis: 'Concurrent (Promise.all) variant fan-out in smartSearch reduces wall-clock latency vs sequential await-loop fan-out, with zero result-set change.',
    baselineCommit: BASELINE_COMMIT,
    corpus: SCENARIOS.map((s) => s.name),
    repeatsPerScenario: REPEATS,
    results,
    verdict: null,
  };

  const multiVariantScenarios = results.filter((r) => r.variantCount > 1);
  const allQualityIdentical = results.every((r) => r.qualityIdentical);
  const minImprovementAmongMultiVariant = Math.min(
    ...multiVariantScenarios.map((r) => r.improvementPct)
  );
  const singleVariantScenario = results.find((r) => r.variantCount === 1);
  const singleVariantRegression = singleVariantScenario
    ? Math.abs(singleVariantScenario.improvementPct)
    : 0;

  report.verdict = {
    allQualityIdentical,
    minImprovementPctAmongMultiVariantScenarios: Number(minImprovementAmongMultiVariant.toFixed(1)),
    meetsThirtyPercentThreshold: minImprovementAmongMultiVariant >= 30,
    singleVariantPathRegressionPct: Number(singleVariantRegression.toFixed(1)),
    singleVariantPathStable: singleVariantRegression < 15,
    ACCEPT: allQualityIdentical && minImprovementAmongMultiVariant >= 30 && singleVariantRegression < 15,
  };

  console.log(JSON.stringify(report, null, 2));
}

main();
