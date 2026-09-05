#!/usr/bin/env node
// score.mjs — `cost-style` wrapper around `metaharness score <path>`.
//
// Returns the 5-dimension scorecard (harnessFit / compileConfidence /
// taskCoverage / toolSafety / memoryUsefulness) + estCostPerRunUsd +
// scaffoldReady boolean. Reads-only; no side effects.
//
// USAGE
//   node scripts/score.mjs                          # current dir
//   node scripts/score.mjs --path <dir>             # specific dir
//   node scripts/score.mjs --alert-on-fit-below 70  # exit 1 if harnessFit < 70
//   node scripts/score.mjs --format json
//
// EXIT CODES
//   0  scored OK (or degraded — MetaHarness not available)
//   1  --alert-on-fit-below threshold breached
//   2  config error or scoring failure

import { runMetaharness, emitDegradedJsonAndExit } from './_harness.mjs';

const ARGS = (() => {
  const a = { path: '.', format: 'json', alertFitBelow: null };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--path') a.path = process.argv[++i];
    else if (v === '--alert-on-fit-below') a.alertFitBelow = parseFloat(process.argv[++i]);
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function main() {
  const r = runMetaharness(['score', ARGS.path]);
  if (r.degraded) {
    emitDegradedJsonAndExit(r.reason);
    return;
  }
  if (r.exitCode !== 0 || !r.json) {
    console.error(`score: metaharness exited ${r.exitCode}`);
    if (r.stderr) console.error(r.stderr.slice(0, 400));
    process.exit(2);
  }
  const payload = { ...r.json, durationMs: r.durationMs };

  if (ARGS.alertFitBelow !== null) {
    if (!isFinite(ARGS.alertFitBelow)) {
      console.error(`score: --alert-on-fit-below must be a finite number`);
      process.exit(2);
    }
    payload.alert = {
      threshold: ARGS.alertFitBelow,
      triggered: typeof payload.harnessFit === 'number' && payload.harnessFit < ARGS.alertFitBelow,
      reason: typeof payload.harnessFit === 'number' && payload.harnessFit < ARGS.alertFitBelow
        ? `harnessFit ${payload.harnessFit} < ${ARGS.alertFitBelow}`
        : `harnessFit ${payload.harnessFit ?? 'unknown'} ≥ ${ARGS.alertFitBelow} — OK`,
    };
  }

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# harness-score — ${payload.repo || ARGS.path}`);
    console.log('');
    console.log(`| Dimension | Value |`);
    console.log(`|---|---:|`);
    console.log(`| harnessFit | ${payload.harnessFit ?? '—'} |`);
    console.log(`| compileConfidence | ${payload.compileConfidence ?? '—'} |`);
    console.log(`| taskCoverage | ${payload.taskCoverage ?? '—'} |`);
    console.log(`| toolSafety | ${payload.toolSafety ?? '—'} |`);
    console.log(`| memoryUsefulness | ${payload.memoryUsefulness ?? '—'} |`);
    console.log(`| estCostPerRunUsd | $${payload.estCostPerRunUsd ?? '—'} |`);
    console.log(`| recommendedMode | ${payload.recommendedMode ?? '—'} |`);
    console.log(`| archetype | ${payload.archetype ?? '—'} |`);
    console.log(`| template | ${payload.template ?? '—'} |`);
    console.log(`| scaffoldReady | ${payload.scaffoldReady ?? '—'} |`);
    console.log(`| hardConstraints | ${payload.hardConstraints ?? '—'} |`);
    console.log(`| **duration** | ${payload.durationMs}ms |`);
    console.log('');
    if (payload.alert) {
      if (payload.alert.triggered) {
        console.log(`⚠ **ALERT**: ${payload.alert.reason}`);
      } else {
        console.log(`✓ ${payload.alert.reason}`);
      }
      console.log('');
    }
  }

  if (payload.alert?.triggered) process.exit(1);
}

main();
