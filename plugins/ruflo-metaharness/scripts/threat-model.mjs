#!/usr/bin/env node
// threat-model.mjs — wrapper around `harness threat-model <path>`.
//
// USAGE
//   node scripts/threat-model.mjs --path . --fail-on high --format json

import { runHarness, emitDegradedJsonAndExit } from './_harness.mjs';

const SEVERITY_RANK = { clean: 0, low: 1, medium: 2, high: 3 };

const ARGS = (() => {
  const a = { path: '.', format: 'json', failOn: 'high' };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--path') a.path = process.argv[++i];
    else if (v === '--fail-on') a.failOn = String(process.argv[++i] || 'high').toLowerCase();
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function main() {
  if (!SEVERITY_RANK.hasOwnProperty(ARGS.failOn)) {
    console.error(`threat-model: --fail-on must be one of clean|low|medium|high`);
    process.exit(2);
  }
  const r = runHarness(['threat-model', ARGS.path]);
  if (r.degraded) { emitDegradedJsonAndExit(r.reason); return; }
  // ponytail: upstream `harness threat-model` exits 2 for a HIGH verdict
  // (shellAccess || policyDefaultDeny===false || secretsReachable) — that is
  // a valid finding, NOT a crash. Only treat exit codes outside {0,1,2} as
  // real failures. Deriving the alert from payload.worst (below) means the
  // exit code never carried severity anyway. Pre-fix this guard bailed on
  // exit 2 and discarded the JSON stdout upstream DID emit → oia-audit saw
  // json:null → no findings. (#2750)
  if (r.exitCode !== 0 && r.exitCode !== 1 && r.exitCode !== 2) {
    console.error(`threat-model: harness exited ${r.exitCode}`);
    if (r.stderr) console.error(r.stderr.slice(0, 400));
    process.exit(2);
  }
  const payload = r.json ?? { rawStdout: r.stdout.slice(0, 400) };
  const worst = String(payload?.worst || 'clean').toLowerCase();
  const threshold = SEVERITY_RANK[ARGS.failOn];
  const triggered = SEVERITY_RANK[worst] >= threshold && threshold > 0;
  const alert = {
    threshold: ARGS.failOn, worst, triggered,
    reason: triggered
      ? `worst=${worst} at or above ${ARGS.failOn}`
      : `worst=${worst} below ${ARGS.failOn} — OK`,
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify({ ...payload, durationMs: r.durationMs, alert }, null, 2));
  } else {
    console.log(`# harness threat-model — ${ARGS.path}`);
    console.log('');
    console.log(`Worst severity: ${worst}`);
    console.log(`Findings: ${(payload?.findings || []).length}`);
    console.log('');
    console.log(alert.triggered ? `⚠ **ALERT**: ${alert.reason}` : `✓ ${alert.reason}`);
  }

  if (alert.triggered) process.exit(1);
}

main();
