// Refit isotonic calibrator from production trajectory data (ADR-149 iter 60).
//
// Iter 22 created the IsotonicCalibrator and fit it from synthetic seed
// corpus LOO. Iter 23/26 validated against seed LOO. Iter 25 added per-tier
// calibrators. Iter 31 made outcome rows carry `quality` (binary 1.0/0.0).
//
// With enough paired decisions in the trajectory, we can fit a calibrator
// from REAL PRODUCTION data instead of synthetic seed. Same isotonic
// regression algorithm — it handles binary observations fine (this is
// what Platt scaling does for classifier outputs).
//
// METHOD
//   1. Read trajectory JSONL → pair decisions ↔ outcomes by task_hash
//   2. For each pair with embedding + quality + concrete modelId:
//        predicted = KRR.predict(modelId, embedding)
//        observed  = outcome.quality (binary 0/1)
//   3. Optionally apply existing bundled calibrator to `predicted`
//      (--vs-bundled) for fair comparison against the production fit
//   4. Fit IsotonicCalibrator on (predicted, observed) pairs
//   5. Write to assets/model-router/seed-router.calibrator.production.json
//      (separate file — does NOT overwrite the seed-fit bundle)
//   6. Report MAE before/after, bucket counts
//
// USAGE
//   node scripts/refit-calibrator-from-production.mjs
//   node scripts/refit-calibrator-from-production.mjs --min-pairs 100
//   node scripts/refit-calibrator-from-production.mjs --write production.calibrator.json
//   node scripts/refit-calibrator-from-production.mjs --dry-run

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mh from '@metaharness/router';
import { IsotonicCalibrator } from '../v3/@claude-flow/cli/dist/src/ruvector/router-calibrator.js';

const ARGS = (() => {
  const a = {
    in: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? resolve('.swarm', 'model-router-trajectories.jsonl'),
    artifact: resolve('v3/@claude-flow/cli/assets/model-router/seed-router.krr.json'),
    out: resolve('v3/@claude-flow/cli/assets/model-router/seed-router.calibrator.production.json'),
    minPairs: 50,
    dryRun: false,
    format: 'table',
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--in') a.in = process.argv[++i];
    else if (v === '--artifact') a.artifact = process.argv[++i];
    else if (v === '--write') a.out = process.argv[++i];
    else if (v === '--min-pairs') a.minPairs = parseInt(process.argv[++i], 10);
    else if (v === '--dry-run') a.dryRun = true;
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function emit(payload) {
  if (ARGS.format === 'json') console.log(JSON.stringify(payload, null, 2));
  else printTable(payload);
}

function printTable(p) {
  console.log('');
  console.log('Production-fit calibrator — ADR-149 iter 60');
  console.log('─'.repeat(72));
  console.log(`  Trajectory:     ${p.input}`);
  console.log(`  KRR artifact:   ${p.artifact}`);
  console.log(`  Min pairs:      ${p.minPairs}`);
  console.log(`  Paired:         ${p.pairs}  (${p.droppedNoEmbedding} dropped no-embedding, ${p.droppedNoQuality} dropped no-quality)`);
  console.log('');
  if (p.error) {
    console.log(`  ${p.error}`);
    console.log('');
    return;
  }
  console.log(`  Calibrator buckets after PAV: ${p.bucketCount}`);
  console.log(`  In-sample MAE: ${p.maeBefore.toFixed(4)} → ${p.maeAfter.toFixed(4)} (improvement ${(p.maeBefore - p.maeAfter).toFixed(4)})`);
  console.log('');
  console.log('  Sample transform (input → output):');
  for (const [x, y] of p.sampleCurve) {
    console.log(`    ${x.toFixed(2)} → ${y.toFixed(4)}`);
  }
  console.log('');
  if (p.dryRun) {
    console.log('  --dry-run: not writing.');
  } else if (p.written) {
    console.log(`  Wrote: ${p.written}`);
    console.log('  To use in production, point CLAUDE_FLOW_ROUTER_CALIBRATOR_PATH at it,');
    console.log('  OR atomically rename over the bundled calibrator after validation.');
  }
  console.log('');
}

if (!existsSync(ARGS.in)) {
  emit({ error: `trajectory file not found at ${ARGS.in}`, input: ARGS.in, pairs: 0, minPairs: ARGS.minPairs });
  process.exit(1);
}
if (!existsSync(ARGS.artifact)) {
  emit({ error: `KRR artifact not found at ${ARGS.artifact}`, input: ARGS.in, pairs: 0, minPairs: ARGS.minPairs });
  process.exit(1);
}

// Parse trajectory.
const lines = readFileSync(ARGS.in, 'utf8').split('\n').filter(l => l.trim().length > 0);
const decisions = new Map();
const outcomes = new Map();
for (const l of lines) {
  try {
    const r = JSON.parse(l);
    if (r.type === 'decision' && Array.isArray(r.embedding) && r.embedding.length > 0) {
      decisions.set(r.task_hash, r);
    } else if (r.type === 'outcome' && typeof r.quality === 'number' && r.model_id) {
      outcomes.set(r.task_hash, r);
    }
  } catch { /* skip */ }
}

// Load KRR.
const krrJson = JSON.parse(readFileSync(ARGS.artifact, 'utf8'));
const trained = mh.TrainedRouter.fromJSON(krrJson);
const validModelIds = new Set(krrJson.candidates.map(c => c.id));

// Build (predicted, observed) pairs.
const pairs = [];
let droppedNoEmbedding = 0, droppedNoQuality = 0, droppedNoMatch = 0, droppedUnknownModel = 0;
for (const [hash, dec] of decisions) {
  const out = outcomes.get(hash);
  if (!out) { droppedNoMatch++; continue; }
  if (typeof out.quality !== 'number') { droppedNoQuality++; continue; }
  if (!validModelIds.has(out.model_id)) { droppedUnknownModel++; continue; }
  try {
    const predicted = trained.predict(out.model_id, dec.embedding);
    if (!Number.isFinite(predicted)) continue;
    pairs.push([predicted, out.quality]);
  } catch { /* */ }
}

if (pairs.length < ARGS.minPairs) {
  emit({
    error: `only ${pairs.length} pairs available; need ≥ ${ARGS.minPairs} for a meaningful fit. Set --min-pairs to override.`,
    input: ARGS.in, artifact: ARGS.artifact, minPairs: ARGS.minPairs,
    pairs: pairs.length, droppedNoEmbedding, droppedNoQuality, droppedNoMatch, droppedUnknownModel,
  });
  process.exit(0);
}

// Fit.
const calibrator = IsotonicCalibrator.fit(pairs);

// In-sample MAE before/after the new calibrator.
let maeBefore = 0, maeAfter = 0;
for (const [p, o] of pairs) {
  maeBefore += Math.abs(p - o);
  maeAfter += Math.abs(calibrator.transform(p) - o);
}
maeBefore /= pairs.length;
maeAfter /= pairs.length;

const sampleCurve = [];
for (let i = 0; i <= 10; i++) {
  const x = i / 10;
  sampleCurve.push([x, calibrator.transform(x)]);
}

const payload = {
  input: ARGS.in,
  artifact: ARGS.artifact,
  minPairs: ARGS.minPairs,
  pairs: pairs.length,
  droppedNoEmbedding, droppedNoQuality, droppedNoMatch, droppedUnknownModel,
  bucketCount: calibrator.bucketCount,
  maeBefore: Math.round(maeBefore * 10000) / 10000,
  maeAfter: Math.round(maeAfter * 10000) / 10000,
  sampleCurve,
  dryRun: ARGS.dryRun,
  written: ARGS.dryRun ? null : ARGS.out,
};

if (!ARGS.dryRun) {
  writeFileSync(ARGS.out, JSON.stringify(calibrator.toJSON()));
}

emit(payload);
