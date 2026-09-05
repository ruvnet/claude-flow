// Calibration check for the cost-optimal router (ADR-149 iter 21).
//
// WHY: `looQuality` from trainRouter() tells us avg fit quality, but not WHERE
// the KRR is miscalibrated. A router that predicts every model at 0.5 has
// looQuality 0.5 but is useless — every cost-optimal decision is a coin flip.
// What we actually need to know:
//
//   1. Are predicted scores close to observed scores? (Brier / MAE)
//   2. When the router says "0.8", does the model actually deliver 0.8?
//      (Expected Calibration Error — ECE)
//   3. Which models / tiers are most miscalibrated? (per-model / per-tier MAE)
//
// METHOD: Leave-one-out cross-validation on the seed corpus. For each of
// the 40 rows, train KRR on the other 39, then predict scores for the
// held-out row's embedding across every candidate. Compare predicted vs
// observed score-per-model.
//
// USAGE
//   node scripts/calibration-check.mjs                       # raw KRR baseline
//   node scripts/calibration-check.mjs --corpus other.json   # custom corpus
//   node scripts/calibration-check.mjs --format human        # readable tables
//
//   --- iter 23 — calibrator validation ---
//   node scripts/calibration-check.mjs --calibrator path.json
//       Apply a pre-trained calibrator to LOO-CV predictions. IN-SAMPLE if
//       the calibrator was fit on this corpus (informational only — does
//       NOT validate generalization).
//
//   node scripts/calibration-check.mjs --validate-calibrator
//       Leave-one-out validation of the calibrator itself: for each row,
//       fit calibrator on pairs from the OTHER 39 rows and apply to this
//       row's predictions. Properly out-of-sample. Use this to decide
//       whether to default-on CLAUDE_FLOW_ROUTER_CALIBRATE.
//
// Exits 0 on success, 1 on I/O error.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mh from '@metaharness/router';
import { IsotonicCalibrator } from '../v3/@claude-flow/cli/dist/src/ruvector/router-calibrator.js';
// iter 35 — single source of truth for prices.
import { blendedPrice } from '../v3/@claude-flow/cli/dist/src/ruvector/model-prices.js';

const ARGS = (() => {
  const a = {
    corpus: resolve('v3/@claude-flow/cli/assets/model-router/seed-rows.json'),
    format: 'json',
    bins: 10,
    calibrator: null,         // path to pre-trained calibrator JSON (in-sample apply)
    validateCalibrator: false, // out-of-sample LOO validation of calibrator
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--corpus') a.corpus = process.argv[++i];
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--bins') a.bins = parseInt(process.argv[++i], 10);
    else if (v === '--calibrator') a.calibrator = process.argv[++i];
    else if (v === '--validate-calibrator') a.validateCalibrator = true;
  }
  return a;
})();

if (!existsSync(ARGS.corpus)) {
  console.error(`[calibration] corpus not found at ${ARGS.corpus}`);
  process.exit(1);
}
const rows = JSON.parse(readFileSync(ARGS.corpus, 'utf8'));
const candidates = Object.keys(rows[0].scores);
const prices = Object.fromEntries(candidates.map(m => [m, blendedPrice(m)]));

// --- LOO-CV: collect (predicted, observed, rowIdx, tier, model) tuples ---
const t0 = performance.now();
const predictions = []; // {model, predicted, observed, tier, rowIdx}
for (let i = 0; i < rows.length; i++) {
  const heldOut = rows[i];
  const trainRows = rows.filter((_, j) => j !== i);
  const { router } = mh.trainRouter(trainRows, prices, {
    qualityBar: 0.25,
    lambdas: [1e-4, 1e-3, 1e-2, 1e-1, 1e0],
  });
  for (const model of candidates) {
    const predicted = router.predict(model, heldOut.embedding);
    const observed = heldOut.scores[model];
    if (observed != null && Number.isFinite(predicted)) {
      predictions.push({ model, predicted, observed, tier: heldOut.tier, rowIdx: i });
    }
  }
}
const cvMs = performance.now() - t0;

// --- iter 23 — optional calibration ---
// Three variants of `predictions` may be evaluated:
//   1. raw — always
//   2. calibrated (in-sample) — when --calibrator <path> is supplied
//   3. calibrated (LOO) — when --validate-calibrator is supplied
// Each variant is a list with the same shape; metrics are computed on each.
const variants = { raw: predictions };

if (ARGS.calibrator) {
  if (!existsSync(ARGS.calibrator)) {
    console.error(`[calibration] --calibrator path ${ARGS.calibrator} not found`);
    process.exit(1);
  }
  const calJson = JSON.parse(readFileSync(ARGS.calibrator, 'utf8'));
  const cal = IsotonicCalibrator.fromJSON(calJson);
  variants['calibrated_in_sample'] = predictions.map(p => ({ ...p, predicted: cal.transform(p.predicted) }));
}

if (ARGS.validateCalibrator) {
  // For each held-out row idx: fit calibrator on pairs from OTHER rows,
  // apply to this row's pairs. This is the only out-of-sample test of the
  // calibrator's generalization.
  const t1 = performance.now();
  const calibrated = [];
  for (let i = 0; i < rows.length; i++) {
    const trainPairs = predictions
      .filter(p => p.rowIdx !== i)
      .map(p => [p.predicted, p.observed]);
    const cal = IsotonicCalibrator.fit(trainPairs);
    for (const p of predictions.filter(p => p.rowIdx === i)) {
      calibrated.push({ ...p, predicted: cal.transform(p.predicted) });
    }
  }
  variants['calibrated_loo'] = calibrated;
  console.error(`[calibration] LOO calibrator validation: ${(performance.now() - t1).toFixed(0)}ms`);

  // iter 26 — per-tier OOS validation. For each held-out row i: collect
  // OTHER rows whose tier matches row i's tier, fit a tier-specific
  // calibrator on those pairs, apply ONLY to row i's pairs. Mirrors the
  // iter 25 production path (bucket-specialist KRR wrapped with bucket-
  // matched calibrator) but with proper out-of-sample isolation. If
  // per-tier OOS beats unified OOS, iter 25's specialization was justified.
  const t2 = performance.now();
  const perTier = [];
  for (let i = 0; i < rows.length; i++) {
    const heldOutTier = rows[i].tier;
    if (!heldOutTier) continue;
    const trainPairs = predictions
      .filter(p => p.rowIdx !== i && p.tier === heldOutTier)
      .map(p => [p.predicted, p.observed]);
    if (trainPairs.length < 3) {
      // Not enough same-tier data to fit a calibrator — fall back to identity
      // (this matches the iter 25 production behavior: missing tier file →
      // unified fallback).
      for (const p of predictions.filter(p => p.rowIdx === i)) perTier.push({ ...p });
      continue;
    }
    const cal = IsotonicCalibrator.fit(trainPairs);
    for (const p of predictions.filter(p => p.rowIdx === i)) {
      perTier.push({ ...p, predicted: cal.transform(p.predicted) });
    }
  }
  variants['calibrated_loo_per_tier'] = perTier;
  console.error(`[calibration] LOO per-tier calibrator validation: ${(performance.now() - t2).toFixed(0)}ms`);
}

// --- Aggregate metrics ---
const n = predictions.length;

function brierAndMae(rows) {
  let brier = 0, mae = 0;
  for (const r of rows) {
    brier += (r.predicted - r.observed) ** 2;
    mae += Math.abs(r.predicted - r.observed);
  }
  return { brier: brier / rows.length, mae: mae / rows.length, count: rows.length };
}

// Expected Calibration Error: bin predictions, compare bin-avg-predicted to
// bin-avg-observed, weighted by bin size.
function ece(rows, nBins) {
  if (rows.length === 0) return { ece: 0, bins: [] };
  const bins = Array.from({ length: nBins }, () => ({ sumPred: 0, sumObs: 0, count: 0 }));
  for (const r of rows) {
    const idx = Math.min(nBins - 1, Math.max(0, Math.floor(r.predicted * nBins)));
    bins[idx].sumPred += r.predicted;
    bins[idx].sumObs += r.observed;
    bins[idx].count += 1;
  }
  let weightedGap = 0;
  const report = [];
  for (let i = 0; i < nBins; i++) {
    const b = bins[i];
    if (b.count === 0) {
      report.push({ bin: i, range: [i / nBins, (i + 1) / nBins], count: 0, avgPredicted: null, avgObserved: null, gap: null });
      continue;
    }
    const avgPred = b.sumPred / b.count;
    const avgObs = b.sumObs / b.count;
    const gap = Math.abs(avgPred - avgObs);
    weightedGap += (b.count / rows.length) * gap;
    report.push({
      bin: i,
      range: [i / nBins, (i + 1) / nBins],
      count: b.count,
      avgPredicted: avgPred,
      avgObserved: avgObs,
      gap,
    });
  }
  return { ece: weightedGap, bins: report };
}

function computeMetrics(preds) {
  const overall = brierAndMae(preds);
  const overallEce = ece(preds, ARGS.bins);
  const perTier = {};
  for (const tier of ['cheap', 'mid', 'strong']) {
    const subset = preds.filter(p => p.tier === tier);
    if (subset.length > 0) {
      perTier[tier] = { ...brierAndMae(subset), ece: ece(subset, ARGS.bins).ece };
    }
  }
  const perModel = {};
  for (const model of candidates) {
    const subset = preds.filter(p => p.model === model);
    if (subset.length > 0) {
      perModel[model] = { ...brierAndMae(subset), ece: ece(subset, ARGS.bins).ece };
    }
  }
  const verdict =
    overallEce.ece < 0.05 ? 'well-calibrated' :
    overallEce.ece < 0.10 ? 'mildly-miscalibrated' :
    overallEce.ece < 0.15 ? 'noticeably-miscalibrated' :
    'poorly-calibrated';
  return { overall: { ...overall, ece: overallEce.ece }, perTier, perModel, reliabilityBins: overallEce.bins, verdict };
}

const variantMetrics = {};
for (const [name, preds] of Object.entries(variants)) {
  variantMetrics[name] = computeMetrics(preds);
}

const report = {
  corpus: ARGS.corpus,
  rows: rows.length,
  candidates: candidates.length,
  predictions: n,
  cvMs: Math.round(cvMs),
  variants: variantMetrics,
  // Back-compat: top-level fields mirror the 'raw' variant for callers that
  // pre-date iter 23 and parse the flat shape.
  overall: variantMetrics.raw.overall,
  perTier: variantMetrics.raw.perTier,
  perModel: variantMetrics.raw.perModel,
  reliabilityBins: variantMetrics.raw.reliabilityBins,
  verdict: variantMetrics.raw.verdict,
};

if (ARGS.format === 'json') {
  console.log(JSON.stringify(report, null, 2));
} else {
  const variantNames = Object.keys(variantMetrics);
  console.log('');
  console.log(`Calibration check — ${ARGS.corpus}`);
  console.log('─'.repeat(72));
  console.log(`  corpus rows:        ${rows.length}`);
  console.log(`  candidates:         ${candidates.length}`);
  console.log(`  LOO-CV predictions: ${n}  (${cvMs.toFixed(0)}ms)`);
  console.log(`  variants:           ${variantNames.join(', ')}`);
  console.log('');

  // Comparison table when more than one variant is present.
  if (variantNames.length > 1) {
    console.log('  Variant comparison (lower is better):');
    console.log('    ' + 'variant'.padEnd(24) + '  MAE     Brier   ECE     verdict');
    for (const name of variantNames) {
      const m = variantMetrics[name].overall;
      console.log(`    ${name.padEnd(24)}  ${m.mae.toFixed(4)}  ${m.brier.toFixed(4)}  ${m.ece.toFixed(4)}  ${variantMetrics[name].verdict}`);
    }
    // Headline delta vs raw for each non-raw variant.
    const rawM = variantMetrics.raw.overall;
    console.log('');
    console.log('  Deltas vs raw (negative = improvement):');
    for (const name of variantNames) {
      if (name === 'raw') continue;
      const m = variantMetrics[name].overall;
      console.log(`    ${name.padEnd(24)}  ΔMAE=${(m.mae - rawM.mae).toFixed(4)}  ΔBrier=${(m.brier - rawM.brier).toFixed(4)}  ΔECE=${(m.ece - rawM.ece).toFixed(4)}`);
    }
    console.log('');
  }

  // Detailed breakdown for the LAST variant (most-informative when present).
  const showName = variantNames[variantNames.length - 1];
  const show = variantMetrics[showName];
  console.log(`  Detailed metrics for variant "${showName}":`);
  console.log(`    verdict: ${show.verdict.toUpperCase()}`);
  console.log('');
  console.log('  Overall:');
  console.log(`    MAE:   ${show.overall.mae.toFixed(4)}   (lower is better — 0 = perfect)`);
  console.log(`    Brier: ${show.overall.brier.toFixed(4)}   (lower is better)`);
  console.log(`    ECE:   ${show.overall.ece.toFixed(4)}   (lower is better — <0.05 well-calibrated)`);
  console.log('');
  console.log('  By tier:');
  for (const [t, m] of Object.entries(show.perTier)) {
    console.log(`    ${t.padEnd(7)}  n=${String(m.count).padStart(3)}  MAE=${m.mae.toFixed(4)}  ECE=${m.ece.toFixed(4)}`);
  }
  console.log('');
  console.log('  By model:');
  const ranked = Object.entries(show.perModel).sort((a, b) => a[1].ece - b[1].ece);
  for (const [model, m] of ranked) {
    console.log(`    ${model.padEnd(40)}  n=${String(m.count).padStart(3)}  MAE=${m.mae.toFixed(4)}  ECE=${m.ece.toFixed(4)}`);
  }
  console.log('');
  console.log('  Reliability diagram (bin: avgPred → avgObs, gap):');
  for (const b of show.reliabilityBins) {
    if (b.count === 0) continue;
    const bar = '█'.repeat(Math.min(40, b.count));
    console.log(`    [${b.range[0].toFixed(2)}–${b.range[1].toFixed(2)}]  pred=${b.avgPredicted.toFixed(3)}  obs=${b.avgObserved.toFixed(3)}  gap=${b.gap.toFixed(3)}  n=${b.count}  ${bar}`);
  }
  console.log('');
}
