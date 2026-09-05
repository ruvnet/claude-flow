// Train a post-hoc isotonic calibrator for the KRR router (ADR-149 iter 22).
//
// METHOD: leave-one-out CV on the seed corpus — for each row, train KRR on
// the other 39 rows, predict all 7 candidates' scores for the held-out
// embedding, collect (predicted, observed) pairs. Fit IsotonicCalibrator
// via PAV. Write to JSON next to the bundled KRR artifact.
//
// USAGE
//   node scripts/train-calibrator.mjs                       # bundled seed
//   node scripts/train-calibrator.mjs --corpus other.json   # custom corpus
//   node scripts/train-calibrator.mjs --dry-run             # don't write
//
// Exits 0 on success, 1 on I/O error.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mh from '@metaharness/router';
import { IsotonicCalibrator } from '../v3/@claude-flow/cli/dist/src/ruvector/router-calibrator.js';
// iter 35 — single source of truth for prices.
import { blendedPrice } from '../v3/@claude-flow/cli/dist/src/ruvector/model-prices.js';

const ARGS = (() => {
  const a = {
    corpus: resolve('v3/@claude-flow/cli/assets/model-router/seed-rows.json'),
    out: resolve('v3/@claude-flow/cli/assets/model-router/seed-router.calibrator.json'),
    dryRun: false,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--corpus') a.corpus = process.argv[++i];
    else if (v === '--out') a.out = process.argv[++i];
    else if (v === '--dry-run') a.dryRun = true;
    else if (v === '--per-tier') a.perTier = true;     // iter 25 — also write tier-specific calibrators
  }
  return a;
})();

if (!existsSync(ARGS.corpus)) {
  console.error(`[calibrate] corpus not found at ${ARGS.corpus}`);
  process.exit(1);
}

const rows = JSON.parse(readFileSync(ARGS.corpus, 'utf8'));
const candidates = Object.keys(rows[0].scores);
const prices = Object.fromEntries(candidates.map(m => [m, blendedPrice(m)]));

console.log(`[calibrate] corpus: ${ARGS.corpus} (${rows.length} rows, ${candidates.length} candidates)`);

// --- LOO-CV: collect (pred, obs, tier) tuples across all rows × candidates. ---
const t0 = performance.now();
const pairsByTier = { cheap: [], mid: [], strong: [] };
const allPairs = []; // [pred, obs] — for the unified calibrator
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
      allPairs.push([predicted, observed]);
      if (heldOut.tier && pairsByTier[heldOut.tier]) {
        pairsByTier[heldOut.tier].push([predicted, observed]);
      }
    }
  }
}
const cvMs = performance.now() - t0;
// Back-compat alias: scripts/older readers expect `pairs`.
const pairs = allPairs;

// --- Fit isotonic calibrator. ---
const t1 = performance.now();
const calibrator = IsotonicCalibrator.fit(pairs);
const fitMs = performance.now() - t1;

// Quick MAE check: before vs after on the training pairs themselves
// (in-sample; the LOO already provides the OOS signal).
let maeBefore = 0, maeAfter = 0;
for (const [p, o] of pairs) {
  maeBefore += Math.abs(p - o);
  maeAfter += Math.abs(calibrator.transform(p) - o);
}
maeBefore /= pairs.length;
maeAfter /= pairs.length;

console.log(`[calibrate] LOO-CV ${cvMs.toFixed(0)}ms → ${pairs.length} (pred,obs) pairs`);
console.log(`[calibrate] fit ${fitMs.toFixed(1)}ms → ${calibrator.bucketCount} buckets after PAV`);
console.log(`[calibrate] MAE in-sample: ${maeBefore.toFixed(4)} → ${maeAfter.toFixed(4)} (improvement ${(maeBefore - maeAfter).toFixed(4)})`);

// Sample lookup table (10 evenly-spaced points across [0,1]) for visual sanity.
console.log('');
console.log('[calibrate] Sample transform (input → output):');
for (let i = 0; i <= 10; i++) {
  const x = i / 10;
  console.log(`  ${x.toFixed(2)} → ${calibrator.transform(x).toFixed(4)}`);
}
console.log('');

if (ARGS.dryRun) {
  console.log('[calibrate] --dry-run: not writing');
  process.exit(0);
}

const json = calibrator.toJSON();
writeFileSync(ARGS.out, JSON.stringify(json));
console.log(`[calibrate] wrote ${ARGS.out} (${JSON.stringify(json).length} bytes, ${json.buckets.length} buckets)`);

// --- iter 25 — per-tier calibrators ---
// Mid-tier OOS ECE after the unified calibrator (iter 23 measurement)
// was 0.178 — much worse than overall 0.033. A single curve can't capture
// tier-specific bias. Fit one calibrator per tier (cheap/mid/strong), keyed
// by the query's complexity bucket at lookup time (matches iter 16's
// per-bucket KRR specialists).
if (ARGS.perTier) {
  // Map: corpus tier label → bucket label used by the bandit + neural router.
  const tierToBucket = { cheap: 'low', mid: 'med', strong: 'high' };
  for (const [tier, bucket] of Object.entries(tierToBucket)) {
    const tierPairs = pairsByTier[tier];
    const tierOut = ARGS.out.replace(/\.calibrator\.json$/, `.calibrator.${bucket}.json`);
    if (tierPairs.length < 3) {
      console.log(`[calibrate] ${bucket}: only ${tierPairs.length} pairs — skipping (need ≥3 for meaningful PAV).`);
      continue;
    }
    const cal = IsotonicCalibrator.fit(tierPairs);
    // In-sample MAE check on the tier subset.
    let mB = 0, mA = 0;
    for (const [p, o] of tierPairs) { mB += Math.abs(p - o); mA += Math.abs(cal.transform(p) - o); }
    mB /= tierPairs.length; mA /= tierPairs.length;
    if (ARGS.dryRun) {
      console.log(`[calibrate] ${bucket}: ${tierPairs.length} pairs, ${cal.bucketCount} buckets, MAE ${mB.toFixed(4)} → ${mA.toFixed(4)} (dry-run, not writing)`);
    } else {
      const tierJson = cal.toJSON();
      writeFileSync(tierOut, JSON.stringify(tierJson));
      console.log(`[calibrate] ${bucket}: ${tierPairs.length} pairs, ${cal.bucketCount} buckets, MAE ${mB.toFixed(4)} → ${mA.toFixed(4)} → ${tierOut}`);
    }
  }
}

console.log('');
console.log('[calibrate] Default ON since iter 24 — opt out with: export CLAUDE_FLOW_ROUTER_CALIBRATE=0');
