#!/usr/bin/env node
// genome.mjs — wrapper around `metaharness genome <path>`.
//
// Returns the 7-section readiness report: repo_type / agent_topology /
// risk_score / mcp_surface / test_confidence / publish_readiness +
// verdict (ready | needs-work | blocked). Reads-only.
//
// USAGE
//   node scripts/genome.mjs
//   node scripts/genome.mjs --path <dir> --alert-on-risk-above 0.5 --format json
//
// EXIT CODES
//   0  OK
//   1  --alert-on-risk-above threshold breached
//   2  config error or genome failure

import { runMetaharness, emitDegradedJsonAndExit } from './_harness.mjs';

const ARGS = (() => {
  const a = { path: '.', format: 'json', alertRiskAbove: null };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--path') a.path = process.argv[++i];
    else if (v === '--alert-on-risk-above') a.alertRiskAbove = parseFloat(process.argv[++i]);
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function main() {
  const r = runMetaharness(['genome', ARGS.path]);
  if (r.degraded) { emitDegradedJsonAndExit(r.reason); return; }
  // metaharness genome uses exit code as a verdict channel (0=ready, 1=needs-work,
  // 2=blocked) — only a missing/unparseable payload is a real wrapper failure.
  if (!r.json) {
    console.error(`genome: metaharness exited ${r.exitCode}`);
    if (r.stderr) console.error(r.stderr.slice(0, 400));
    process.exit(2);
  }
  // iter 112 — generatedAt for consistency with other --format json outputs
  const payload = { ...r.json, path: ARGS.path, durationMs: r.durationMs,
    generatedAt: new Date().toISOString() };

  if (ARGS.alertRiskAbove !== null) {
    if (!isFinite(ARGS.alertRiskAbove)) {
      console.error(`genome: --alert-on-risk-above must be a finite number`);
      process.exit(2);
    }
    payload.alert = {
      threshold: ARGS.alertRiskAbove,
      triggered: typeof payload.risk_score === 'number' && payload.risk_score > ARGS.alertRiskAbove,
      reason: typeof payload.risk_score === 'number' && payload.risk_score > ARGS.alertRiskAbove
        ? `risk_score ${payload.risk_score} > ${ARGS.alertRiskAbove}`
        : `risk_score ${payload.risk_score ?? 'unknown'} ≤ ${ARGS.alertRiskAbove} — OK`,
    };
  }

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# harness-genome — ${ARGS.path}`);
    console.log('');
    console.log(`| Section | Value |`);
    console.log(`|---|---|`);
    console.log(`| repo_type | ${payload.repo_type ?? '—'} |`);
    console.log(`| agent_topology | ${(payload.agent_topology || []).join(', ') || '—'} |`);
    console.log(`| risk_score | ${payload.risk_score ?? '—'} |`);
    console.log(`| mcp_surface | ${payload.mcp_surface ?? '—'} |`);
    console.log(`| test_confidence | ${payload.test_confidence ?? '—'} |`);
    console.log(`| publish_readiness | ${payload.publish_readiness ?? '—'} |`);
    console.log(`| **duration** | ${payload.durationMs}ms |`);
    console.log('');
    if (payload.alert) {
      console.log(payload.alert.triggered ? `⚠ **ALERT**: ${payload.alert.reason}` : `✓ ${payload.alert.reason}`);
      console.log('');
    }
  }

  if (payload.alert?.triggered) process.exit(1);
}

main();
