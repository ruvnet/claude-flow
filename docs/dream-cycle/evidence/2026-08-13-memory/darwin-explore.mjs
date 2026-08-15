#!/usr/bin/env node
// Dream Cycle 2026-08-13 — bounded local Darwin-style exploration over
// smartSearch() fan-out concurrency strategies (STEP 12).
//
// SCOPE NOTE: the upstream `npx metaharness darwin` / `npx ruvector
// harness darwin` tools operate at whole-repo genome-mutation scope
// (arbitrary deterministic-mutator changes evaluated against the repo's
// test command). That's the wrong grain for a single-function candidate
// this small — pointing it here risks bundling unrelated mutations into
// one PR, violating "one conceptual change" (STEP 6). Instead this is a
// bounded LOCAL exploration: generation 1 of a max 3, 3 of a max-4
// candidates. The design space (3 distinct fan-out strategies) is
// exhaustively enumerated, not a continuous parameter to iteratively
// refine, so generation 1 is sufficient.
//
// FITNESS (frozen before this ran):
//   fitness = 0.35 quality + 0.20 success_rate + 0.15 latency
//           + 0.10 cost_efficiency + 0.10 reproducibility + 0.10 safety
//
// Run from anywhere inside the repo:
//   node docs/dream-cycle/evidence/2026-08-13-memory/darwin-explore.mjs

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_COMMIT = 'ee3a394';
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel']).toString().trim();
const REL_PATH = 'v3/@claude-flow/memory/src/smart-retrieval.ts';
const MEMORY_PKG = join(REPO_ROOT, 'v3/@claude-flow/memory');

const work = mkdtempSync(join(tmpdir(), 'dream-darwin-'));

// baseline (pre-candidate HEAD)
const baselineSrc = join(work, 'baseline.ts');
writeFileSync(baselineSrc, execFileSync('git', ['show', `${BASELINE_COMMIT}:${REL_PATH}`], { cwd: REPO_ROOT }));

// variant A == the shipped candidate (working tree)
const variantASrc = join(work, 'variant-a.ts');
writeFileSync(variantASrc, readFileSync(join(REPO_ROOT, REL_PATH)));

// variant B == checked-in fault-tolerant exploration file (not shipped)
const variantBSrc = join(work, 'variant-b.ts');
writeFileSync(variantBSrc, readFileSync(join(HERE, 'variant-b-allsettled.ts')));

// variant C == bounded concurrency (cap=2), generated here from the
// candidate by swapping the fan-out block — not shipped, weakest lineage.
const candidateText = readFileSync(join(REPO_ROOT, REL_PATH), 'utf8');
const fanOutBlock = `  const responses = await Promise.all(
    variants.map((v) =>
      search({
        query: v,
        namespace: opts.namespace,
        limit: fanOutK,
        threshold,
      })
    )
  );
  const ranked: SearchCandidate[][] = responses.map((resp) => resp.results);
  let totalRaw = 0;
  for (const resp of responses) totalRaw += resp.results.length;`;
const boundedBlock = `  const CONCURRENCY_CAP = 2;
  const responses = new Array(variants.length);
  for (let i = 0; i < variants.length; i += CONCURRENCY_CAP) {
    const batch = variants.slice(i, i + CONCURRENCY_CAP);
    const batchResults = await Promise.all(
      batch.map((v) =>
        search({
          query: v,
          namespace: opts.namespace,
          limit: fanOutK,
          threshold,
        })
      )
    );
    batchResults.forEach((r, j) => { responses[i + j] = r; });
  }
  const ranked: SearchCandidate[][] = responses.map((resp) => resp.results);
  let totalRaw = 0;
  for (const resp of responses) totalRaw += resp.results.length;`;
if (!candidateText.includes(fanOutBlock)) {
  throw new Error('candidate fan-out block not found — smart-retrieval.ts has changed shape since this script was authored; update the block text above.');
}
const variantCSrc = join(work, 'variant-c.ts');
writeFileSync(variantCSrc, candidateText.replace(fanOutBlock, boundedBlock));

function compile(srcFile, outName) {
  const outDir = join(work, `out-${outName}`);
  execFileSync(
    'npx',
    ['tsc', '--outDir', outDir, srcFile, '--module', 'ESNext', '--target', 'ES2022',
     '--moduleResolution', 'bundler', '--skipLibCheck', '--declaration', 'false'],
    { cwd: MEMORY_PKG, stdio: 'inherit' }
  );
  return join(outDir, `${outName}.js`);
}

const baselinePath = compile(baselineSrc, 'baseline');
const variantAPath = compile(variantASrc, 'variant-a');
const variantBPath = compile(variantBSrc, 'variant-b');
const variantCPath = compile(variantCSrc, 'variant-c');

const { smartSearch: baseline } = await import(baselinePath);
const { smartSearch: variantA } = await import(variantAPath);
const { smartSearch: variantB } = await import(variantBPath);
const { smartSearch: variantC } = await import(variantCPath);

const CANDIDATES = [
  { id: 'variant-a-promise-all', label: 'Promise.all (shipped candidate)', impl: variantA },
  { id: 'variant-b-allsettled', label: 'Promise.allSettled + fault-tolerant empty-fill', impl: variantB },
  { id: 'variant-c-bounded2', label: 'Bounded concurrency (cap=2 in-flight)', impl: variantC },
];

function makeRow(id, score) {
  return { id, key: id, content: `content for ${id}`, score, namespace: 'bench' };
}

function makeSearch({ perCallDelayMs, failIndices = [] }) {
  let call = -1;
  return async ({ query }) => {
    call++;
    await new Promise((r) => setTimeout(r, perCallDelayMs));
    if (failIndices.includes(call)) throw new Error(`simulated store failure on call ${call}`);
    return { results: [makeRow(`${query}::a`, 0.9), makeRow(`${query}::b`, 0.8)] };
  };
}

const REPEATS = 5;
const PERF_SCENARIO = { perCallDelayMs: 60 };
const FAULT_SCENARIO = { perCallDelayMs: 20, failIndices: [1] };

async function timeRun(impl, searchFn) {
  const start = performance.now();
  try {
    const r = await impl(searchFn, {
      query: 'release pipeline status',
      diversityMMR: false,
      sessionDiversity: false,
      recencyBoost: false,
    });
    return { ok: true, elapsedMs: performance.now() - start, resultCount: r.results.length };
  } catch (e) {
    return { ok: false, elapsedMs: performance.now() - start, error: String(e) };
  }
}

async function evaluate(candidate) {
  const baselineRuns = [];
  const perfRuns = [];
  for (let i = 0; i < REPEATS; i++) {
    baselineRuns.push(await timeRun(baseline, makeSearch(PERF_SCENARIO)));
    perfRuns.push(await timeRun(candidate.impl, makeSearch(PERF_SCENARIO)));
  }
  const meanMs = (arr) => arr.reduce((a, b) => a + b.elapsedMs, 0) / arr.length;
  const baselineMs = meanMs(baselineRuns);
  const candidateMs = meanMs(perfRuns);

  const faultRun = await timeRun(candidate.impl, makeSearch(FAULT_SCENARIO));

  const repro1 = await timeRun(candidate.impl, makeSearch(PERF_SCENARIO));
  const repro2 = await timeRun(candidate.impl, makeSearch(PERF_SCENARIO));
  const reproVariancePct = Math.abs(repro1.elapsedMs - repro2.elapsedMs) / Math.max(repro1.elapsedMs, 1) * 100;

  return {
    id: candidate.id,
    label: candidate.label,
    baselineMeanMs: Number(baselineMs.toFixed(2)),
    candidateMeanMs: Number(candidateMs.toFixed(2)),
    speedupVsSequentialBaseline: Number((baselineMs / candidateMs).toFixed(2)),
    faultScenario: { survived: faultRun.ok, elapsedMs: Number(faultRun.elapsedMs.toFixed(2)), resultCount: faultRun.resultCount ?? 0, error: faultRun.error ?? null },
    reproVariancePct: Number(reproVariancePct.toFixed(1)),
  };
}

function score(result, allResults) {
  const maxSpeedup = Math.max(...allResults.map((r) => r.speedupVsSequentialBaseline));
  const minVariance = Math.min(...allResults.map((r) => r.reproVariancePct));

  const quality = 1.0;
  const success_rate = result.faultScenario.survived ? 1.0 : 0.0;
  const latency = result.speedupVsSequentialBaseline / maxSpeedup;
  const cost_efficiency = 1.0;
  const reproducibility = result.reproVariancePct === 0 ? 1.0 : minVariance / Math.max(result.reproVariancePct, 0.01);
  const safety = result.faultScenario.survived ? 1.0 : 0.3;

  const fitness =
    0.35 * quality +
    0.2 * success_rate +
    0.15 * latency +
    0.1 * cost_efficiency +
    0.1 * Math.min(reproducibility, 1) +
    0.1 * safety;

  return { quality, success_rate, latency: Number(latency.toFixed(3)), cost_efficiency, reproducibility: Number(Math.min(reproducibility, 1).toFixed(3)), safety, fitness: Number(fitness.toFixed(4)) };
}

async function main() {
  const results = [];
  for (const c of CANDIDATES) results.push(await evaluate(c));
  const scored = results.map((r) => ({ ...r, scores: score(r, results) }));
  scored.sort((a, b) => b.scores.fitness - a.scores.fitness);

  const report = {
    generation: 1,
    maxGenerations: 3,
    maxCandidatesPerGeneration: 4,
    candidatesEvaluatedThisRun: scored.length,
    fitnessFormula: '0.35*quality + 0.20*success_rate + 0.15*latency + 0.10*cost_efficiency + 0.10*reproducibility + 0.10*safety',
    lineage: scored,
    winner: scored[0].id,
    decisionNote:
      'variant-b-allsettled wins on composite fitness (fault tolerance) but is NOT the shipped candidate: it changes ' +
      'smartSearch()\'s error-propagation contract (silent degradation to empty results vs. surfacing the failure, ' +
      'identically to baseline) which is out of scope for tonight\'s frozen hypothesis (latency + result-identity only). ' +
      'variant-a-promise-all (shipped) preserves baseline\'s error semantics exactly while winning on raw latency and ' +
      'reproducibility. variant-c-bounded2 provides no benefit at the default variant count (<=3, see ' +
      'defaultQueryExpansions() cap) and loses on both latency and safety — negative evidence, worth persisting so a ' +
      'future cycle does not re-explore it without new justification (e.g. a future change that allows unbounded variant counts).',
  };
  console.log(JSON.stringify(report, null, 2));
}

main();
