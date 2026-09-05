// QualityBar hyperparameter tuning from recorded trajectories (ADR-149 iter 39).
//
// The router's cost-optimal selector picks the cheapest candidate whose
// predicted quality ≥ qualityBar. The bar is currently set via
// CLAUDE_FLOW_ROUTER_QUALITY_BAR (default 0.50). Which value is best for
// a given workload? This script answers from existing data.
//
// METHOD:
//   1. Read trajectory JSONL — get decisions with stored embeddings (iter 17).
//   2. Load the bundled KRR (+ per-bucket specialists + per-tier calibrators
//      iter 25). This is the SAME stack production uses, so predictions match
//      what the live router would say.
//   3. For each decision: predict per-model qualities for the stored embedding.
//   4. For each qualityBar candidate (default 0.3..0.9 step 0.05):
//        a. Simulate the selector — which model would have been picked at
//           this bar?
//        b. Compute hypothetical cost using the outcome's stored token counts
//           (iter 31) and MODEL_PRICES (iter 31).
//        c. Track the average PREDICTED quality of the picks (proxy for
//           outcome quality — we don't have counterfactual outcomes).
//   5. Emit a Pareto frontier table.
//
// USAGE:
//   node scripts/tune-quality-bar.mjs                  # bundled KRR + .swarm/...jsonl
//   node scripts/tune-quality-bar.mjs --since 7d       # last week of data
//   node scripts/tune-quality-bar.mjs --bars 0.3,0.5,0.7,0.9
//   node scripts/tune-quality-bar.mjs --format json    # pipe-friendly
//
// LIMITATION: we use KRR-predicted quality as the quality signal at
// candidate bars, not measured outcome quality. The simulation is honest
// about "what the router WOULD have picked" at each bar; the quality
// number is what the router WOULD HAVE EXPECTED at each bar — not
// observed counterfactual quality (which we never see, since we only
// dispatched one model). This is a fundamental limit of offline policy
// evaluation from on-policy data.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mh from '@metaharness/router';
import { blendedPrice, costUsd } from '../v3/@claude-flow/cli/dist/src/ruvector/model-prices.js';
import { IsotonicCalibrator } from '../v3/@claude-flow/cli/dist/src/ruvector/router-calibrator.js';

const ARGS = (() => {
  const a = {
    in: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? resolve('.swarm', 'model-router-trajectories.jsonl'),
    artifact: resolve('v3/@claude-flow/cli/assets/model-router/seed-router.krr.json'),
    calibratorDir: resolve('v3/@claude-flow/cli/assets/model-router'),
    bars: '0.30,0.35,0.40,0.45,0.50,0.55,0.60,0.65,0.70,0.75,0.80,0.85,0.90',
    since: null,
    format: 'table',
    noCalibrate: false,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--in') a.in = process.argv[++i];
    else if (v === '--artifact') a.artifact = process.argv[++i];
    else if (v === '--bars') a.bars = process.argv[++i];
    else if (v === '--since') a.since = process.argv[++i];
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--no-calibrate') a.noCalibrate = true;
  }
  return a;
})();

function emit(payload) {
  if (ARGS.format === 'json') console.log(JSON.stringify(payload, null, 2));
  else printTable(payload);
}

function printTable(p) {
  console.log('');
  console.log(`QualityBar tuning — ADR-149 iter 39`);
  console.log('─'.repeat(72));
  console.log(`  Input:          ${p.input}`);
  if (p.since) console.log(`  Time window:    since ${p.since}`);
  console.log(`  Decisions:      ${p.decisions} with stored embeddings + tokens`);
  console.log(`  Calibration:    ${p.calibrationApplied ? 'ON (iter 25 unified+per-tier)' : 'OFF (--no-calibrate)'}`);
  console.log('');
  if (p.decisions === 0) {
    console.log('  No decisions with stored embeddings AND paired outcome tokens.');
    console.log('  Pre-iter-31 trajectories will lack tokens. Try recording new traffic.');
    console.log('');
    return;
  }
  console.log(`  Pareto frontier (cheapest pick whose predicted quality ≥ bar):`);
  console.log('    qualityBar  totalCostUsd  avgPredQuality  pickedDistribution');
  for (const row of p.frontier) {
    const dist = Object.entries(row.pickedDistribution).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}=${n}`).join(' ');
    console.log(`    ${row.qualityBar.toFixed(2).padStart(10)}  $${row.totalCostUsd.toFixed(6).padStart(11)}  ${row.avgPredQuality.toFixed(4).padStart(14)}  ${dist}`);
  }
  console.log('');
  console.log('  Recommendations:');
  console.log(`    Lowest cost:     bar=${p.recommend.lowestCost.bar.toFixed(2)}  $${p.recommend.lowestCost.cost.toFixed(6)}  avgPredQ=${p.recommend.lowestCost.predQ.toFixed(4)}`);
  console.log(`    Highest predQ:   bar=${p.recommend.highestPredQ.bar.toFixed(2)}  $${p.recommend.highestPredQ.cost.toFixed(6)}  avgPredQ=${p.recommend.highestPredQ.predQ.toFixed(4)}`);
  console.log(`    Best $/predQ:    bar=${p.recommend.bestRatio.bar.toFixed(2)}  $${p.recommend.bestRatio.cost.toFixed(6)}  avgPredQ=${p.recommend.bestRatio.predQ.toFixed(4)}  ratio=${p.recommend.bestRatio.ratio.toFixed(6)}`);
  console.log('');
}

// --- Load trajectory ---
if (!existsSync(ARGS.in)) {
  emit({ error: `trajectory file not found at ${ARGS.in}`, input: ARGS.in });
  process.exit(1);
}
const lines = readFileSync(ARGS.in, 'utf8').split('\n').filter(l => l.trim().length > 0);
const decisions = new Map();          // task_hash → row with embedding
const outcomes = new Map();           // task_hash → outcome row with tokens
let cutoffMs = null;
if (ARGS.since) {
  const m = ARGS.since.match(/^(\d+)([hdmw])$/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000 }[m[2]] ?? 0;
    cutoffMs = Date.now() - n * unitMs;
  }
}
for (const l of lines) {
  try {
    const r = JSON.parse(l);
    if (cutoffMs !== null && Date.parse(r.ts) < cutoffMs) continue;
    if (r.type === 'decision' && Array.isArray(r.embedding) && r.embedding.length > 0) {
      decisions.set(r.task_hash, r);
    } else if (r.type === 'outcome' && r.tokens) {
      outcomes.set(r.task_hash, r);
    }
  } catch { /* skip malformed */ }
}

// Pair them
const paired = [];
for (const [hash, dec] of decisions) {
  const out = outcomes.get(hash);
  if (out && out.tokens) paired.push({ dec, out });
}

// --- Load KRR + calibrators ---
if (!existsSync(ARGS.artifact)) {
  emit({ error: `KRR artifact not found at ${ARGS.artifact}`, input: ARGS.in });
  process.exit(1);
}
const krrJson = JSON.parse(readFileSync(ARGS.artifact, 'utf8'));
const trained = mh.TrainedRouter.fromJSON(krrJson);
const candidates = krrJson.candidates.map(c => ({ id: c.id, blendedPrice: blendedPrice(c.id), pricePer: null }));

// Per-tier calibrators (iter 25)
let unifiedCal = null;
const calByBucket = {};
if (!ARGS.noCalibrate) {
  const unifiedPath = resolve(ARGS.calibratorDir, 'seed-router.calibrator.json');
  if (existsSync(unifiedPath)) {
    try { unifiedCal = IsotonicCalibrator.fromJSON(JSON.parse(readFileSync(unifiedPath, 'utf8'))); }
    catch { /* */ }
  }
  for (const b of ['low', 'med', 'high']) {
    const p = resolve(ARGS.calibratorDir, `seed-router.calibrator.${b}.json`);
    if (existsSync(p)) {
      try { calByBucket[b] = IsotonicCalibrator.fromJSON(JSON.parse(readFileSync(p, 'utf8'))); }
      catch { /* */ }
    }
  }
}
const calibrationApplied = !!unifiedCal || Object.keys(calByBucket).length > 0;

// --- Sweep qualityBar values ---
const bars = ARGS.bars.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n >= 0 && n <= 1).sort();

const frontier = [];
for (const bar of bars) {
  let totalCost = 0;
  let totalPredQ = 0;
  const pickedDist = {};
  for (const { dec, out } of paired) {
    const bucket = dec.complexity < 0.34 ? 'low' : dec.complexity < 0.67 ? 'med' : 'high';
    const cal = calByBucket[bucket] ?? unifiedCal;
    // Predict each candidate's quality, apply calibration if available.
    const preds = candidates.map(c => {
      const raw = trained.predict(c.id, dec.embedding);
      const q = cal ? cal.transform(raw) : raw;
      return { id: c.id, q, price: c.blendedPrice };
    });
    // Cost-optimal selection at THIS bar.
    const clearing = preds.filter(p => p.q >= bar).sort((a, b) => a.price - b.price);
    const pick = clearing[0] ?? [...preds].sort((a, b) => b.q - a.q)[0];
    if (!pick) continue;
    const hypotheticalCost = costUsd(pick.id, out.tokens.input, out.tokens.output);
    totalCost += hypotheticalCost;
    totalPredQ += pick.q;
    pickedDist[pick.id] = (pickedDist[pick.id] ?? 0) + 1;
  }
  const n = paired.length;
  frontier.push({
    qualityBar: bar,
    totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
    avgPredQuality: n > 0 ? Math.round((totalPredQ / n) * 10000) / 10000 : 0,
    pickedDistribution: pickedDist,
  });
}

// --- Recommendations ---
let lowestCost = null, highestPredQ = null, bestRatio = null;
for (const r of frontier) {
  if (lowestCost === null || r.totalCostUsd < lowestCost.cost) lowestCost = { bar: r.qualityBar, cost: r.totalCostUsd, predQ: r.avgPredQuality };
  if (highestPredQ === null || r.avgPredQuality > highestPredQ.predQ) highestPredQ = { bar: r.qualityBar, cost: r.totalCostUsd, predQ: r.avgPredQuality };
  if (r.totalCostUsd > 0) {
    const ratio = r.totalCostUsd / r.avgPredQuality; // lower = better $$/quality
    if (bestRatio === null || ratio < bestRatio.ratio) bestRatio = { bar: r.qualityBar, cost: r.totalCostUsd, predQ: r.avgPredQuality, ratio };
  }
}

emit({
  input: ARGS.in,
  since: ARGS.since,
  decisions: paired.length,
  candidates: candidates.length,
  calibrationApplied,
  bars,
  frontier,
  recommend: { lowestCost, highestPredQ, bestRatio },
});
