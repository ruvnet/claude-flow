// Cost-ceiling hyperparameter tuning from recorded trajectories (ADR-149 iter 40).
//
// Iter 29 added a quality-best-under-budget selector mode keyed on
// CLAUDE_FLOW_ROUTER_COST_CEILING_USD_PER_MTOK. Iter 39 tuned the cost-
// optimal mode's qualityBar from trajectory data; this iter does the
// same for cost-ceiling.
//
// METHOD:
//   1. Read trajectory JSONL — get decisions with stored embeddings (iter 17).
//   2. Load bundled KRR + iter-25 per-tier calibrators (same stack production uses).
//   3. For each decision: predict per-model quality.
//   4. For each ceiling candidate (default $1, $5, $10, $20, $50, $100, $250):
//        a. Filter candidates whose blended price ≤ ceiling.
//        b. Pick the highest predicted-quality among affordable (iter 29 mode).
//           If none fit, fall back to the cheapest available (matches iter 29
//           "better something than nothing" policy).
//        c. Compute hypothetical cost via outcome.tokens × MODEL_PRICES.
//        d. Track avg predicted quality + which models get picked.
//   5. Emit a Pareto frontier table.
//
// USAGE
//   node scripts/tune-cost-ceiling.mjs
//   node scripts/tune-cost-ceiling.mjs --ceilings 5,20,50,200
//   node scripts/tune-cost-ceiling.mjs --since 7d --format json
//
// LIMITATION (same as iter 39):
//   We use KRR-predicted quality as the simulated quality signal; we
//   never observe counterfactual outcome quality from on-policy data.
//   The frontier is "what would the router PICK at ceiling X" not
//   "what quality would each decision DELIVER at ceiling X".

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
    // Defaults span the bundled model price range: Ling ($0.10) → Opus ($240).
    ceilings: '1,5,10,20,50,100,250',
    since: null,
    format: 'table',
    noCalibrate: false,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--in') a.in = process.argv[++i];
    else if (v === '--artifact') a.artifact = process.argv[++i];
    else if (v === '--ceilings') a.ceilings = process.argv[++i];
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
  console.log(`Cost-ceiling tuning — ADR-149 iter 40 (iter 29 selector)`);
  console.log('─'.repeat(72));
  console.log(`  Input:          ${p.input}`);
  if (p.since) console.log(`  Time window:    since ${p.since}`);
  console.log(`  Decisions:      ${p.decisions} with stored embeddings + tokens`);
  console.log(`  Calibration:    ${p.calibrationApplied ? 'ON (iter 25 unified+per-tier)' : 'OFF (--no-calibrate)'}`);
  console.log('');
  if (p.decisions === 0) {
    console.log('  No decisions with stored embeddings AND paired outcome tokens.');
    console.log('');
    return;
  }
  console.log(`  Pareto frontier (highest predicted quality among candidates ≤ ceiling):`);
  console.log('    ceiling$/Mtok  totalCostUsd  avgPredQuality  pickedDistribution');
  for (const row of p.frontier) {
    const dist = Object.entries(row.pickedDistribution).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m}=${n}`).join(' ');
    console.log(`    ${('$' + row.ceiling.toFixed(2)).padStart(13)}  $${row.totalCostUsd.toFixed(6).padStart(11)}  ${row.avgPredQuality.toFixed(4).padStart(14)}  ${dist}`);
  }
  console.log('');
  console.log('  Recommendations:');
  console.log(`    Lowest cost:     ceiling=$${p.recommend.lowestCost.ceiling.toFixed(2)}  $${p.recommend.lowestCost.cost.toFixed(6)}  avgPredQ=${p.recommend.lowestCost.predQ.toFixed(4)}`);
  console.log(`    Highest predQ:   ceiling=$${p.recommend.highestPredQ.ceiling.toFixed(2)}  $${p.recommend.highestPredQ.cost.toFixed(6)}  avgPredQ=${p.recommend.highestPredQ.predQ.toFixed(4)}`);
  console.log(`    Best $/predQ:    ceiling=$${p.recommend.bestRatio.ceiling.toFixed(2)}  $${p.recommend.bestRatio.cost.toFixed(6)}  avgPredQ=${p.recommend.bestRatio.predQ.toFixed(4)}  ratio=${p.recommend.bestRatio.ratio.toFixed(6)}`);
  console.log('');
}

// --- Load trajectory (same shape as iter 39) ---
if (!existsSync(ARGS.in)) {
  emit({ error: `trajectory file not found at ${ARGS.in}`, input: ARGS.in });
  process.exit(1);
}
const lines = readFileSync(ARGS.in, 'utf8').split('\n').filter(l => l.trim().length > 0);
const decisions = new Map();
const outcomes = new Map();
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
const paired = [];
for (const [hash, dec] of decisions) {
  const out = outcomes.get(hash);
  if (out?.tokens) paired.push({ dec, out });
}

// --- Load KRR + calibrators (same as iter 39) ---
if (!existsSync(ARGS.artifact)) {
  emit({ error: `KRR artifact not found at ${ARGS.artifact}`, input: ARGS.in });
  process.exit(1);
}
const krrJson = JSON.parse(readFileSync(ARGS.artifact, 'utf8'));
const trained = mh.TrainedRouter.fromJSON(krrJson);
const candidates = krrJson.candidates.map(c => ({ id: c.id, blendedPrice: blendedPrice(c.id) }));

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

// --- Sweep ceiling values ---
const ceilings = ARGS.ceilings.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);

const frontier = [];
for (const ceiling of ceilings) {
  let totalCost = 0, totalPredQ = 0, pickedCount = 0;
  const pickedDist = {};
  for (const { dec, out } of paired) {
    const bucket = dec.complexity < 0.34 ? 'low' : dec.complexity < 0.67 ? 'med' : 'high';
    const cal = calByBucket[bucket] ?? unifiedCal;
    const preds = candidates.map(c => {
      const raw = trained.predict(c.id, dec.embedding);
      const q = cal ? cal.transform(raw) : raw;
      return { id: c.id, q, price: c.blendedPrice };
    });
    // Cost-ceiling selection (iter 29): filter by price, pick highest quality.
    const affordable = preds.filter(p => p.price <= ceiling);
    let pick;
    if (affordable.length > 0) {
      pick = [...affordable].sort((a, b) => b.q - a.q)[0];
    } else {
      // No candidate ≤ ceiling → fall back to cheapest (matches iter 29 policy).
      pick = [...preds].sort((a, b) => a.price - b.price)[0];
    }
    if (!pick) continue;
    const hypotheticalCost = costUsd(pick.id, out.tokens.input, out.tokens.output);
    totalCost += hypotheticalCost;
    totalPredQ += pick.q;
    pickedCount++;
    pickedDist[pick.id] = (pickedDist[pick.id] ?? 0) + 1;
  }
  frontier.push({
    ceiling,
    totalCostUsd: Math.round(totalCost * 1_000_000) / 1_000_000,
    avgPredQuality: pickedCount > 0 ? Math.round((totalPredQ / pickedCount) * 10000) / 10000 : 0,
    pickedDistribution: pickedDist,
    picks: pickedCount,
  });
}

let lowestCost = null, highestPredQ = null, bestRatio = null;
for (const r of frontier) {
  if (lowestCost === null || r.totalCostUsd < lowestCost.cost) lowestCost = { ceiling: r.ceiling, cost: r.totalCostUsd, predQ: r.avgPredQuality };
  if (highestPredQ === null || r.avgPredQuality > highestPredQ.predQ) highestPredQ = { ceiling: r.ceiling, cost: r.totalCostUsd, predQ: r.avgPredQuality };
  if (r.totalCostUsd > 0 && r.avgPredQuality > 0) {
    const ratio = r.totalCostUsd / r.avgPredQuality;
    if (bestRatio === null || ratio < bestRatio.ratio) bestRatio = { ceiling: r.ceiling, cost: r.totalCostUsd, predQ: r.avgPredQuality, ratio };
  }
}

emit({
  input: ARGS.in,
  since: ARGS.since,
  decisions: paired.length,
  candidates: candidates.length,
  calibrationApplied,
  ceilings,
  frontier,
  recommend: { lowestCost, highestPredQ, bestRatio },
});
