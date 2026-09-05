// Quality-gated auto-retrain for the cost-optimal router (ADR-149 iter 20).
//
// THE PROBLEM: iter 17-19 closed the production-data loop, but blindly
// retraining the bundled KRR off every JSONL row would degrade quality.
// Production data is noisy — judge variance, transient model regressions,
// outlier tasks. A naive nightly retrain ratchets quality DOWN over time
// when the corpus is contaminated.
//
// THE GATE: train a CANDIDATE KRR off the union (seed + production) and a
// BASELINE KRR off seed-only. Compare leave-one-out CV quality (looQuality).
// Only swap the bundled artifact if:
//
//   1. paired_count >= MIN_NEW_ROWS (don't retrain off 1 row of data), AND
//   2. candidate.looQuality >= baseline.looQuality + MARGIN
//
// Failure mode coverage:
//   - 0 paired rows → "no production data" exit (success, no swap)
//   - <MIN_NEW_ROWS paired → "below threshold" exit (success, no swap)
//   - candidate < baseline → "regression detected" exit (success, no swap)
//   - candidate ≈ baseline → "no improvement" exit (success, no swap)
//   - candidate > baseline + margin → SWAP (with atomic rename + .bak)
//
// USAGE
//   node scripts/auto-retrain-router.mjs --dry-run            # always-no-swap, prints decision
//   node scripts/auto-retrain-router.mjs                       # swap if gate passes
//   node scripts/auto-retrain-router.mjs --margin 0.01         # tighter improvement bar
//   node scripts/auto-retrain-router.mjs --min-new-rows 50     # require ≥50 production rows
//   CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH=... node scripts/auto-retrain-router.mjs
//
// Exits 0 on every gated outcome (no-swap is success). Exits 1 only on
// I/O errors. JSON report goes to stdout; the decision and reason are in
// the top-level `decision` and `reason` fields.

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdtempSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import * as mh from '@metaharness/router';
import { pairTrajectoryRows } from '../v3/@claude-flow/cli/dist/src/ruvector/router-trajectory.js';
import { IsotonicCalibrator } from '../v3/@claude-flow/cli/dist/src/ruvector/router-calibrator.js';
// iter 35 — single source of truth for prices.
import { blendedPrice } from '../v3/@claude-flow/cli/dist/src/ruvector/model-prices.js';

const ARGS = (() => {
  const a = {
    in: process.env.CLAUDE_FLOW_ROUTER_TRAJECTORY_PATH
      ?? resolve('.swarm', 'model-router-trajectories.jsonl'),
    seedRows: resolve('v3/@claude-flow/cli/assets/model-router/seed-rows.json'),
    artifact: resolve('v3/@claude-flow/cli/assets/model-router/seed-router.krr.json'),
    calibratorPath: resolve('v3/@claude-flow/cli/assets/model-router/seed-router.calibrator.json'),
    margin: 0.005,           // 0.5 percentage points by default
    minNewRows: 10,
    dryRun: false,
    filterSource: null,      // optionally restrict to llm-judge etc.
    skipCalibrator: false,   // iter 27 — by default, refit calibrators on KRR swap
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--in') a.in = process.argv[++i];
    else if (v === '--seed-rows') a.seedRows = process.argv[++i];
    else if (v === '--artifact') a.artifact = process.argv[++i];
    else if (v === '--calibrator') a.calibratorPath = process.argv[++i];
    else if (v === '--margin') a.margin = parseFloat(process.argv[++i]);
    else if (v === '--min-new-rows') a.minNewRows = parseInt(process.argv[++i], 10);
    else if (v === '--dry-run') a.dryRun = true;
    else if (v === '--filter-source') a.filterSource = process.argv[++i];
    else if (v === '--no-calibrator-update') a.skipCalibrator = true;
  }
  return a;
})();

const QUALITY_BAR = 0.25;

function emit(report) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.decision === 'error' ? 1 : 0);
}

function trainKrr(rows, label) {
  if (rows.length < 3) return { ok: false, reason: `${label}: only ${rows.length} rows (KRR needs ≥3 for LOO-CV)` };
  const corpusModels = Object.keys(rows[0].scores);
  const prices = Object.fromEntries(corpusModels.map(m => [m, blendedPrice(m)]));
  const t0 = performance.now();
  const { router, lambda, looQuality } = mh.trainRouter(rows, prices, {
    qualityBar: QUALITY_BAR,
    lambdas: [1e-4, 1e-3, 1e-2, 1e-1, 1e0],
  });
  return { ok: true, router, lambda, looQuality, trainMs: performance.now() - t0, rowCount: rows.length };
}

// --- 1. Read trajectory JSONL (gracefully handle missing file). ---
if (!existsSync(ARGS.in)) {
  emit({
    decision: 'no-data',
    reason: `trajectory file not found at ${ARGS.in}; nothing to retrain on`,
    swapped: false,
    args: ARGS,
  });
}

const trajLines = readFileSync(ARGS.in, 'utf8').split('\n').filter(l => l.trim().length > 0);
const trajRows = [];
let malformed = 0;
for (const l of trajLines) {
  try { trajRows.push(JSON.parse(l)); } catch { malformed++; }
}

// --- 2. Pair + filter. ---
const { pairs: rawPairs, stats } = pairTrajectoryRows(trajRows);
let pairs = rawPairs;
if (ARGS.filterSource) pairs = pairs.filter(p => p.source === ARGS.filterSource);
const corpusRows = pairs.map(p => ({ task: p.task, embedding: p.embedding, scores: p.scores, tier: p.tier }));

if (corpusRows.length < ARGS.minNewRows) {
  emit({
    decision: 'below-threshold',
    reason: `only ${corpusRows.length} paired production rows < min-new-rows=${ARGS.minNewRows}`,
    swapped: false,
    paired: corpusRows.length,
    minNewRows: ARGS.minNewRows,
    stats,
    malformed,
    args: ARGS,
  });
}

// --- 3. Load seed corpus + union (production wins on task-text collision). ---
if (!existsSync(ARGS.seedRows)) {
  emit({ decision: 'error', reason: `seed corpus not found at ${ARGS.seedRows}`, swapped: false, args: ARGS });
}
const seedRows = JSON.parse(readFileSync(ARGS.seedRows, 'utf8'));
const prodTasks = new Set(corpusRows.map(r => r.task));
const seedKept = seedRows.filter(r => !prodTasks.has(r.task));
const unionRows = [...seedKept, ...corpusRows];

// --- 4. Train baseline (seed-only) AND candidate (unioned). ---
const baseline = trainKrr(seedRows, 'baseline');
if (!baseline.ok) emit({ decision: 'error', reason: baseline.reason, swapped: false, args: ARGS });

const candidate = trainKrr(unionRows, 'candidate');
if (!candidate.ok) emit({ decision: 'error', reason: candidate.reason, swapped: false, args: ARGS });

// --- 5. Gate: candidate must beat baseline by MARGIN. ---
const improvement = candidate.looQuality - baseline.looQuality;
const passesGate = improvement >= ARGS.margin;

const report = {
  decision: passesGate ? (ARGS.dryRun ? 'would-swap' : 'swap') : 'no-improvement',
  reason: passesGate
    ? `candidate looQuality ${candidate.looQuality.toFixed(4)} beats baseline ${baseline.looQuality.toFixed(4)} by ${improvement.toFixed(4)} ≥ margin ${ARGS.margin}`
    : `candidate looQuality ${candidate.looQuality.toFixed(4)} did not beat baseline ${baseline.looQuality.toFixed(4)} by margin ${ARGS.margin} (delta=${improvement.toFixed(4)})`,
  swapped: false,
  paired: corpusRows.length,
  seedRows: seedRows.length,
  unionRows: unionRows.length,
  baseline: { lambda: baseline.lambda, looQuality: baseline.looQuality, trainMs: baseline.trainMs },
  candidate: { lambda: candidate.lambda, looQuality: candidate.looQuality, trainMs: candidate.trainMs },
  improvement,
  margin: ARGS.margin,
  stats,
  malformed,
  args: ARGS,
};

if (passesGate && !ARGS.dryRun) {
  // --- 6. Atomic swap: write to tmp + backup old → rename. ---
  if (!existsSync(ARGS.artifact)) {
    emit({ ...report, decision: 'error', reason: `artifact path ${ARGS.artifact} does not exist; cannot back up before swap`, swapped: false });
  }
  const tmpDir = mkdtempSync(join(tmpdir(), 'router-retrain-'));
  const tmpArtifact = join(tmpDir, 'seed-router.krr.json');
  writeFileSync(tmpArtifact, JSON.stringify(candidate.router.toJSON()));
  const backupPath = `${ARGS.artifact}.bak`;
  try {
    copyFileSync(ARGS.artifact, backupPath);     // backup current
    renameSync(tmpArtifact, ARGS.artifact);      // atomic-ish replace
    report.swapped = true;
    report.backup = backupPath;
    report.artifactBytes = statSync(ARGS.artifact).size;
  } catch (err) {
    // Restore on failure.
    if (existsSync(backupPath)) {
      try { copyFileSync(backupPath, ARGS.artifact); } catch { /* */ }
    }
    try { unlinkSync(tmpArtifact); } catch { /* */ }
    emit({ ...report, decision: 'error', reason: `swap failed: ${err instanceof Error ? err.message : String(err)}`, swapped: false });
  }

  // --- 7. iter 27 — co-update the calibrator(s) on the NEW KRR. ---
  // Without this, the bundled calibrators are fit against the OLD KRR's
  // LOO predictions, so the moment KRR shifts, the calibrators become
  // stale and over- or under-correct. Refit unified + per-tier in one pass.
  if (!ARGS.skipCalibrator) {
    try {
      const corpusModels = Object.keys(unionRows[0].scores);
      const prices = Object.fromEntries(corpusModels.map(m => [m, blendedPrice(m)]));
      // LOO-CV against the union → collect (pred, obs, tier) pairs.
      const t1 = performance.now();
      const allPairs = [];
      const pairsByTier = { cheap: [], mid: [], strong: [] };
      for (let i = 0; i < unionRows.length; i++) {
        const heldOut = unionRows[i];
        const trainSet = unionRows.filter((_, j) => j !== i);
        if (trainSet.length < 3) continue;
        const { router } = mh.trainRouter(trainSet, prices, {
          qualityBar: 0.25,
          lambdas: [1e-4, 1e-3, 1e-2, 1e-1, 1e0],
        });
        for (const model of corpusModels) {
          const pred = router.predict(model, heldOut.embedding);
          const obs = heldOut.scores[model];
          if (obs != null && Number.isFinite(pred)) {
            allPairs.push([pred, obs]);
            if (heldOut.tier && pairsByTier[heldOut.tier]) pairsByTier[heldOut.tier].push([pred, obs]);
          }
        }
      }
      const cvMs = performance.now() - t1;
      // Fit unified + per-tier.
      const calibratorsWritten = [];
      const tierToBucket = { cheap: 'low', mid: 'med', strong: 'high' };
      const fitOne = (pairs, outPath, label) => {
        if (pairs.length < 3) return { ok: false, label, reason: `only ${pairs.length} pairs` };
        const cal = IsotonicCalibrator.fit(pairs);
        // Atomic write via tmp + rename.
        const tmpCal = join(tmpDir, `cal-${label}.json`);
        writeFileSync(tmpCal, JSON.stringify(cal.toJSON()));
        if (existsSync(outPath)) copyFileSync(outPath, `${outPath}.bak`);
        renameSync(tmpCal, outPath);
        calibratorsWritten.push({ label, path: outPath, buckets: cal.bucketCount, pairs: pairs.length });
        return { ok: true };
      };
      fitOne(allPairs, ARGS.calibratorPath, 'unified');
      // Per-tier path: replace the final `.json` with `.{bucket}.json`. Works
      // for both the bundled `seed-router.calibrator.json` → `…calibrator.low.json`
      // AND for sandbox paths like `/tmp/x.json` → `/tmp/x.low.json`.
      const perTierPath = (bucket) => ARGS.calibratorPath.replace(/\.json$/, `.${bucket}.json`);
      for (const [tier, bucket] of Object.entries(tierToBucket)) {
        fitOne(pairsByTier[tier], perTierPath(bucket), bucket);
      }
      report.calibrators = { swapped: true, cvMs: Math.round(cvMs), written: calibratorsWritten };
    } catch (err) {
      // Calibrator co-update is corrective, not load-bearing. If it fails,
      // the KRR swap already succeeded — record but don't roll back.
      report.calibrators = { swapped: false, error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    report.calibrators = { swapped: false, reason: 'skipped via --no-calibrator-update' };
  }
}

emit(report);
