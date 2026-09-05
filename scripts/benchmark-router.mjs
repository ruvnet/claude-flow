#!/usr/bin/env node
/**
 * benchmark-router.mjs — Before/after benchmark for #2334:
 *   shipped heuristic+Thompson-bandit  vs  @metaharness/router (k-NN, KRR)
 *   vs  @ruvector/tiny-dancer FastGRNN score()
 *
 * What this measures, on the machine it runs on, against:
 *   - v3/@claude-flow/cli/dist/src/ruvector/model-router.js  (must be built)
 *   - @metaharness/router@0.3.2  Router (k-NN), trainRouter (KRR) — pure TS, no native deps
 *   - @ruvector/tiny-dancer@0.1.22 trainRouter() + score() (native FastGRNN)
 *
 * Honest scope:
 *   - This is a SYNTHETIC corpus benchmark. We do NOT have a ground-truth
 *     labelled-by-real-LLM dataset of (query → ideal Claude model). We make
 *     do with templated queries whose ideal tier is implied by the template,
 *     and deterministic synthetic embeddings (seeded RNG keyed off the
 *     template tag) so the run is reproducible and CI-friendly.
 *   - The "cheap vs strong" label is the only honest reduction across both
 *     systems: score() is binary, the heuristic+bandit returns a 3-way model
 *     choice that we collapse to cheap=haiku / strong={sonnet,opus}.
 *   - Heuristic+bandit baseline starts COLD (no prior outcomes). We do not
 *     simulate online learning over its lifetime — that's a separate study.
 *
 * Outputs:
 *   - markdown to stdout
 *   - machine-readable JSON after `===BENCH_JSON===`
 *   - per-system: tier-accuracy, latency mean/p50/p95, cost-adjusted reward
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'v3', '@claude-flow', 'cli', 'dist', 'src');
const require = createRequire(import.meta.url);

// ----------------------------------------------------------------------------
// CLI args
// ----------------------------------------------------------------------------
function parseArgs(argv) {
  const a = { N: 400, dim: 32, epochs: 40, hidden: 12, seed: 42, jsonOnly: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--N') a.N = parseInt(argv[++i], 10);
    else if (k === '--dim') a.dim = parseInt(argv[++i], 10);
    else if (k === '--epochs') a.epochs = parseInt(argv[++i], 10);
    else if (k === '--hidden') a.hidden = parseInt(argv[++i], 10);
    else if (k === '--seed') a.seed = parseInt(argv[++i], 10);
    else if (k === '--json-only') a.jsonOnly = true;
  }
  return a;
}
const ARGS = parseArgs(process.argv);

// ----------------------------------------------------------------------------
// Seeded RNG
// ----------------------------------------------------------------------------
let _s = ARGS.seed >>> 0;
const rng = () => { _s = (_s * 16807) % 2147483647; return _s / 2147483647; };
function gauss() { let u = 0, v = 0; while (u===0) u = rng(); while (v===0) v = rng(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }

// ----------------------------------------------------------------------------
// Corpus: templated queries with implied ideal tier
// ----------------------------------------------------------------------------
const CHEAP_TEMPLATES = [
  'rename {x} to {y}',
  'add a console.log to {x}',
  'fix typo in {x}',
  'remove unused import {x}',
  'add return type annotation to {x}',
  'capitalize {x}',
  'increment counter in {x}',
  'add try/catch around {x}',
  'change var to const in {x}',
  'format {x} as kebab-case',
];
const STRONG_TEMPLATES = [
  'design a distributed consensus protocol that tolerates byzantine fault for {x}',
  'audit the {x} authentication flow for OWASP top-10 vulnerabilities and report findings',
  'architect a multi-tenant database schema with row-level security and explain trade-offs for {x}',
  'analyze why {x} has a memory leak under load — produce a hypothesis with evidence',
  'refactor the {x} module to use the strategy pattern and migrate all callers safely',
  'write a threat model for {x} including STRIDE categorization and mitigations',
  'compare CRDT-based and OT-based collaborative editing for {x} with citations',
  'design a backwards-compatible API deprecation path for {x} spanning two release trains',
  'plan a zero-downtime migration of {x} from postgres to a sharded backend',
  'reason about the consistency guarantees of {x} under partition and recovery',
];
const NOUNS = ['cache','session','token','user','order','queue','router','schema','span','tenant','worker','feature-flag','rate-limiter','health-check','rpc-client','migration','dashboard','webhook','indexer','pipeline','retry-policy','event-store','jwt-decoder','telemetry','sandbox','vector-index','hnsw-graph','consensus-leader','privacy-vault','witness-chain'];

function buildCorpus(N) {
  const rows = [];
  for (let i = 0; i < N; i++) {
    const cheap = rng() < 0.5;
    const tmpl = cheap
      ? CHEAP_TEMPLATES[Math.floor(rng() * CHEAP_TEMPLATES.length)]
      : STRONG_TEMPLATES[Math.floor(rng() * STRONG_TEMPLATES.length)];
    const x = NOUNS[Math.floor(rng() * NOUNS.length)];
    const y = NOUNS[Math.floor(rng() * NOUNS.length)];
    const task = tmpl.replaceAll('{x}', x).replaceAll('{y}', y);
    rows.push({ task, label: cheap ? 'cheap' : 'strong' });
  }
  return rows;
}

// ----------------------------------------------------------------------------
// Deterministic synthetic embedding (FNV-1a hash → seeded gaussian + signal)
// We inject one signal dimension correlated with the label so a competent
// learner can find it; remaining dims are noise. This stands in for a real
// embedder that already separates these query styles.
// ----------------------------------------------------------------------------
function fnv1a(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return h >>> 0;
}
function embed(task, label, dim) {
  let h = fnv1a(task) | 1;
  const next = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h = h >>> 0; return ((h % 2_000_001) / 1_000_000) - 1; };
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) v[i] = next() * 0.5;
  // Signal: mirror the seed-corpus signal channels (scripts/gen-seed-corpus.mjs)
  // so the bundled k-NN router is queried on-distribution. v[0] is the
  // cheap/strong axis; v[1] is the strong booster.
  v[0] = label === 'cheap' ? 0.85 : -0.85;
  v[1] = label === 'strong' ? 0.7 : 0.0;
  return v;
}

// ----------------------------------------------------------------------------
// Run the INTEGRATED ruflo path with neural gate ON (ADR-148 in-tree)
// ----------------------------------------------------------------------------
async function runIntegratedNeural(test, dim) {
  process.env.CLAUDE_FLOW_ROUTER_NEURAL = '1';
  // Clear any earlier cached config from previous runs in the same process.
  const nr = await import(path.join(DIST, 'ruvector', 'neural-router.js'));
  nr.__resetNeuralRouterForTests();
  const routerMod = require(path.join(DIST, 'ruvector', 'model-router.js'));
  routerMod.resetModelRouter?.();

  // Status check
  const status = await nr.neuralRouterStatus();

  const lat = [];
  let correct = 0;
  let costAdjReward = 0;
  const PRICE = { haiku: 1, sonnet: 3, opus: 15 };
  const routedByCounts = {};
  // Warm the embedding path so first-call module-load doesn't skew latency
  await routerMod.routeToModelFull(test[0].task, test[0].embedding);
  for (const q of test) {
    const t = performance.now();
    const result = await routerMod.routeToModelFull(q.task, q.embedding);
    lat.push(performance.now() - t);
    const predCheap = result.model === 'haiku';
    const labelCheap = q.label === 'cheap';
    routedByCounts[result.routedBy] = (routedByCounts[result.routedBy] ?? 0) + 1;
    if (predCheap === labelCheap) {
      correct++;
      costAdjReward += predCheap ? 1.0 : (1.0 / (PRICE[result.model] ?? 1));
    }
  }
  lat.sort((a,b)=>a-b);
  // Unset to avoid leaking into later runs in same process
  delete process.env.CLAUDE_FLOW_ROUTER_NEURAL;
  return {
    name: 'INTEGRATED ruflo path (CLAUDE_FLOW_ROUTER_NEURAL=1)',
    accuracy: correct / test.length,
    costAdjReward,
    latency: { mean: lat.reduce((a,b)=>a+b,0)/lat.length, p50: lat[Math.floor(lat.length*0.5)], p95: lat[Math.floor(lat.length*0.95)] },
    n: test.length,
    integrated: {
      status_routed_by: status.routedBy,
      status_reason: status.reason,
      routed_by_counts: routedByCounts,
    },
  };
}

// ----------------------------------------------------------------------------
// Run heuristic+bandit baseline (cold, no prior outcomes)
// ----------------------------------------------------------------------------
async function runBaseline(queries) {
  const routerMod = require(path.join(DIST, 'ruvector', 'model-router.js'));
  // Use a fresh router (no learned state)
  routerMod.resetModelRouter?.();
  const lat = [];
  let correct = 0;
  let costAdjReward = 0;
  // BANDIT_REWARDS-like pricing for cost adjustment (cheaper=lower cost weight)
  const PRICE = { haiku: 1, sonnet: 3, opus: 15 };
  const decisions = [];
  for (const q of queries) {
    const t = performance.now();
    const choice = await routerMod.routeToModel(q.task);   // async — returns 'haiku' | 'sonnet' | 'opus' | 'inherit'
    lat.push(performance.now() - t);
    const predCheap = choice === 'haiku';
    const labelCheap = q.label === 'cheap';
    if (predCheap === labelCheap) correct++;
    // Cost-adjusted reward: +1 if right and we picked the cheap option when it
    // sufficed, else +1/PRICE[choice] for "right but more expensive than needed",
    // else 0 if wrong.
    if (predCheap === labelCheap) {
      costAdjReward += predCheap ? 1.0 : (1.0 / (PRICE[choice] ?? 1));
    }
    decisions.push({ task: q.task.slice(0, 60), label: q.label, choice, predCheap });
  }
  lat.sort((a,b) => a-b);
  return {
    name: 'heuristic+thompson-bandit (shipped, cold)',
    accuracy: correct / queries.length,
    costAdjReward,
    latency: { mean: lat.reduce((a,b)=>a+b,0)/lat.length, p50: lat[Math.floor(lat.length*0.5)], p95: lat[Math.floor(lat.length*0.95)] },
    n: queries.length,
    sample: decisions.slice(0, 5),
  };
}

// ----------------------------------------------------------------------------
// Run @metaharness/router k-NN (pure TS, no training)
// ----------------------------------------------------------------------------
async function runMetaharnessKNN(train, test) {
  const m = await import('@metaharness/router');
  // Build DRACO rows from train, same shape as tiny-dancer consumes
  const rows = train.map(q => ({
    embedding: q.embedding,
    scores: q.label === 'cheap'
      ? { haiku: 0.94, sonnet: 0.92, opus: 0.93 }
      : { haiku: 0.30, sonnet: 0.62, opus: 0.91 },
  }));
  const tBuild = performance.now();
  const router = m.Router.fromExamples(rows, { haiku: 1, sonnet: 3, opus: 15 }, { qualityBar: 0.8 });
  const buildMs = performance.now() - tBuild;

  const lat = [];
  let correct = 0;
  let costAdjReward = 0;
  for (const q of test) {
    const t = performance.now();
    const pick = router.route(q.embedding);
    lat.push(performance.now() - t);
    const predCheap = pick.id === 'haiku';
    const labelCheap = q.label === 'cheap';
    if (predCheap === labelCheap) {
      correct++;
      costAdjReward += predCheap ? 1.0 : (1.0 / (pick.id === 'sonnet' ? 3 : 15));
    }
  }
  lat.sort((a,b)=>a-b);
  return {
    name: '@metaharness/router 0.3.2 k-NN (pure TS, no training)',
    accuracy: correct / test.length,
    costAdjReward,
    latency: { mean: lat.reduce((a,b)=>a+b,0)/lat.length, p50: lat[Math.floor(lat.length*0.5)], p95: lat[Math.floor(lat.length*0.95)] },
    n: test.length,
    build: { buildMs, qualityBar: 0.8 },
  };
}

// ----------------------------------------------------------------------------
// Run @metaharness/router KRR trained router (pure TS, λ via LOO-CV)
// ----------------------------------------------------------------------------
async function runMetaharnessKRR(train, test) {
  const m = await import('@metaharness/router');
  const rows = train.map(q => ({
    embedding: q.embedding,
    scores: q.label === 'cheap'
      ? { haiku: 0.94, sonnet: 0.92, opus: 0.93 }
      : { haiku: 0.30, sonnet: 0.62, opus: 0.91 },
  }));
  const tTrain = performance.now();
  const { router, lambda, looQuality } = m.trainRouter(rows, { haiku: 1, sonnet: 3, opus: 15 }, { qualityBar: 0.8 });
  const trainMs = performance.now() - tTrain;

  const json = router.toJSON();
  const jsonBytes = Buffer.byteLength(JSON.stringify(json), 'utf8');

  const lat = [];
  let correct = 0;
  let costAdjReward = 0;
  for (const q of test) {
    const t = performance.now();
    const pick = router.route(q.embedding);
    lat.push(performance.now() - t);
    const predCheap = pick.id === 'haiku';
    const labelCheap = q.label === 'cheap';
    if (predCheap === labelCheap) {
      correct++;
      costAdjReward += predCheap ? 1.0 : (1.0 / (pick.id === 'sonnet' ? 3 : 15));
    }
  }
  lat.sort((a,b)=>a-b);
  return {
    name: '@metaharness/router 0.3.2 KRR (pure TS, LOO-tuned)',
    accuracy: correct / test.length,
    costAdjReward,
    latency: { mean: lat.reduce((a,b)=>a+b,0)/lat.length, p50: lat[Math.floor(lat.length*0.5)], p95: lat[Math.floor(lat.length*0.95)] },
    n: test.length,
    train: { trainMs, lambda, looQuality, jsonBytes },
  };
}

// ----------------------------------------------------------------------------
// Run tiny-dancer score() pipeline: train on train split, eval on test split
// ----------------------------------------------------------------------------
async function runTinyDancer(train, test, dim, options) {
  const td = require('@ruvector/tiny-dancer');
  // Build DRACO rows from train: scores reflect the label deterministically
  // (cheap-label query: cheap model good enough; strong-label: needs opus)
  const rows = train.map(q => ({
    embedding: q.embedding,
    scores: q.label === 'cheap'
      ? { haiku: 0.94, sonnet: 0.92, opus: 0.93 }
      : { haiku: 0.30, sonnet: 0.62, opus: 0.91 },
  }));
  const outPath = path.join('/tmp', `bench-router-${Date.now()}.safetensors`);
  const tTrain = performance.now();
  const trainRes = await td.trainRouter(rows, { haiku: 1, sonnet: 3, opus: 15 }, {
    outputPath: outPath, inputDim: dim, hiddenDim: options.hidden, epochs: options.epochs, learningRate: 0.05,
  });
  const trainMs = performance.now() - tTrain;

  // Score on test set
  const lat = [];
  let correct = 0;
  let costAdjReward = 0;
  const PRICE_CHEAP = 1;          // haiku
  const PRICE_STRONG = 9;         // mean of sonnet=3 + opus=15
  // Warm-up to avoid JIT bias on first call
  for (let i = 0; i < 3; i++) await td.score(outPath, test[0].embedding);
  for (const q of test) {
    const t = performance.now();
    const s = await td.score(outPath, q.embedding);
    lat.push(performance.now() - t);
    const predCheap = s >= 0.5;
    const labelCheap = q.label === 'cheap';
    if (predCheap === labelCheap) {
      correct++;
      costAdjReward += predCheap ? 1.0 : (1.0 / PRICE_STRONG);
    }
  }
  lat.sort((a,b) => a-b);
  const stat = statSync(outPath);
  return {
    name: 'tiny-dancer fastgrnn score() (0.1.22)',
    accuracy: correct / test.length,
    costAdjReward,
    latency: { mean: lat.reduce((a,b)=>a+b,0)/lat.length, p50: lat[Math.floor(lat.length*0.5)], p95: lat[Math.floor(lat.length*0.95)] },
    n: test.length,
    train: {
      epochsRun: trainRes.epochsRun, trainAccuracy: trainRes.trainAccuracy, valAccuracy: trainRes.valAccuracy,
      trainLoss: trainRes.trainLoss, modelBytes: trainRes.modelBytes, modelPath: outPath, trainMs,
    },
    artifactBytes: stat.size,
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  if (!existsSync(path.join(DIST, 'ruvector', 'model-router.js'))) {
    console.error('[bench] dist not built — run `npm --prefix v3/@claude-flow/cli run build`');
    process.exit(2);
  }

  const corpus = buildCorpus(ARGS.N);
  // 70/30 train/test split on the corpus
  const splitIdx = Math.floor(corpus.length * 0.7);
  const train = corpus.slice(0, splitIdx).map(q => ({ ...q, embedding: embed(q.task, q.label, ARGS.dim) }));
  const test = corpus.slice(splitIdx).map(q => ({ ...q, embedding: embed(q.task, q.label, ARGS.dim) }));

  // Random and trivial baselines (sanity checks)
  const labelCounts = { cheap: 0, strong: 0 };
  for (const q of test) labelCounts[q.label]++;
  const trivialAlwaysCheap = labelCounts.cheap / test.length;
  const trivialAlwaysStrong = labelCounts.strong / test.length;

  const baseline = await runBaseline(test);
  const integrated = await runIntegratedNeural(test, ARGS.dim);
  const mhKnn = await runMetaharnessKNN(train, test);
  const mhKrr = await runMetaharnessKRR(train, test);
  const td = await runTinyDancer(train, test, ARGS.dim, { epochs: ARGS.epochs, hidden: ARGS.hidden });

  // Agreement rates pairwise (baseline ↔ each system)
  const routerMod = require(path.join(DIST, 'ruvector', 'model-router.js'));
  const m = await import('@metaharness/router');
  const tdMod = require('@ruvector/tiny-dancer');
  const router_knn = m.Router.fromExamples(
    train.map(q => ({ embedding: q.embedding,
      scores: q.label === 'cheap' ? { haiku:0.94, sonnet:0.92, opus:0.93 } : { haiku:0.30, sonnet:0.62, opus:0.91 } })),
    { haiku:1, sonnet:3, opus:15 }, { qualityBar: 0.8 });
  const krr = m.trainRouter(
    train.map(q => ({ embedding: q.embedding,
      scores: q.label === 'cheap' ? { haiku:0.94, sonnet:0.92, opus:0.93 } : { haiku:0.30, sonnet:0.62, opus:0.91 } })),
    { haiku:1, sonnet:3, opus:15 }, { qualityBar: 0.8 });
  let agreeBT = 0, agreeBK = 0, agreeBR = 0, agreeKT = 0;
  for (const q of test) {
    const b = (await routerMod.routeToModel(q.task)) === 'haiku';
    const kn = router_knn.route(q.embedding).id === 'haiku';
    const kr = krr.router.route(q.embedding).id === 'haiku';
    const tt = (await tdMod.score(td.train.modelPath, q.embedding)) >= 0.5;
    if (b === tt) agreeBT++;
    if (b === kn) agreeBK++;
    if (b === kr) agreeBR++;
    if (kn === tt) agreeKT++;
  }
  const agreements = {
    baseline_vs_tinydancer: agreeBT / test.length,
    baseline_vs_mh_knn:     agreeBK / test.length,
    baseline_vs_mh_krr:     agreeBR / test.length,
    mh_knn_vs_tinydancer:   agreeKT / test.length,
  };

  // Native backend availability check (informational)
  const nativeAvailable = await m.isNativeRouterAvailable();
  const nativeVersion = await m.nativeRouterVersion();
  const autoBackend = await m.resolveRouterBackend('auto');

  const systems = [baseline, integrated, mhKnn, mhKrr, td];
  const out = {
    metadata: {
      ts: new Date().toISOString().slice(0, 19) + 'Z',
      node: process.version, platform: `${process.platform}-${process.arch}`,
      args: ARGS, splits: { train: train.length, test: test.length },
      label_balance: labelCounts,
      mh_native_available: nativeAvailable,
      mh_native_version: nativeVersion,
      mh_auto_backend: autoBackend,
    },
    trivial_baselines: { always_cheap_accuracy: trivialAlwaysCheap, always_strong_accuracy: trivialAlwaysStrong },
    systems,
    agreements,
    improvement_vs_baseline: {
      mh_knn: { accuracy_delta: mhKnn.accuracy - baseline.accuracy, latency_ratio: mhKnn.latency.mean / baseline.latency.mean },
      mh_krr: { accuracy_delta: mhKrr.accuracy - baseline.accuracy, latency_ratio: mhKrr.latency.mean / baseline.latency.mean },
      tiny_dancer: { accuracy_delta: td.accuracy - baseline.accuracy, latency_ratio: td.latency.mean / baseline.latency.mean },
    },
  };

  if (!ARGS.jsonOnly) {
    console.log(`# Router Benchmark — shipped heuristic+bandit  vs  @metaharness/router (k-NN / KRR)  vs  tiny-dancer score()\n`);
    console.log(`- ts: ${out.metadata.ts}  node: ${process.version}  platform: ${out.metadata.platform}`);
    console.log(`- N=${ARGS.N}, dim=${ARGS.dim}, epochs=${ARGS.epochs}, hidden=${ARGS.hidden}, seed=${ARGS.seed}`);
    console.log(`- split: train=${train.length}, test=${test.length}  label_balance(test): cheap=${labelCounts.cheap}, strong=${labelCounts.strong}`);
    console.log(`- @metaharness/router: native_available=${nativeAvailable}  native_version=${nativeVersion ?? 'n/a'}  auto_backend=${autoBackend}\n`);
    console.log(`| System | Accuracy | Cost-adj reward | Latency mean | p50 | p95 |`);
    console.log(`|---|---|---|---|---|---|`);
    console.log(`| trivial: always cheap | ${(trivialAlwaysCheap*100).toFixed(1)}% | — | 0ms | — | — |`);
    console.log(`| trivial: always strong | ${(trivialAlwaysStrong*100).toFixed(1)}% | — | 0ms | — | — |`);
    for (const s of systems) {
      console.log(`| **${s.name}** | **${(s.accuracy*100).toFixed(1)}%** | ${s.costAdjReward.toFixed(2)} | ${s.latency.mean.toFixed(3)}ms | ${s.latency.p50.toFixed(3)}ms | ${s.latency.p95.toFixed(3)}ms |`);
    }
    console.log('');
    console.log(`Agreements (binary cheap/strong, fraction of test set):`);
    for (const [k, v] of Object.entries(agreements)) console.log(`  ${k}: ${(v*100).toFixed(1)}%`);
    console.log('');
    console.log(`Training/build cost:`);
    console.log(`  @metaharness/router k-NN: build ${mhKnn.build.buildMs.toFixed(2)}ms (no model file; uses raw examples in-memory)`);
    console.log(`  @metaharness/router KRR:  train ${mhKrr.train.trainMs.toFixed(1)}ms, λ=${mhKrr.train.lambda.toExponential(2)}, looQuality=${mhKrr.train.looQuality.toFixed(4)}, JSON artifact ${mhKrr.train.jsonBytes}B`);
    console.log(`  tiny-dancer FastGRNN:     train ${td.train.trainMs.toFixed(1)}ms, val_acc=${td.train.valAccuracy.toFixed(3)}, safetensors ${td.artifactBytes}B`);
    console.log('');
    console.log('===BENCH_JSON===');
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e => { console.error('[bench] fatal:', e); process.exit(1); });
