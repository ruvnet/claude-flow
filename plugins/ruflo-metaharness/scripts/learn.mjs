#!/usr/bin/env node
// learn.mjs — wrapper around `metaharness learn` (upstream ADR-235, metaharness@0.3.0).
//
// GEPA learning run: optimizes a harness genome against a SWE-bench-style
// slice manifest. $0 DRY-RUN BY DEFAULT — upstream only spends (model calls,
// Docker sandboxes) when --run is passed, and we forward that flag verbatim
// so the spend opt-in stays explicit at every layer.
//
// CHECKOUT PRECONDITION (upstream design, not a bug)
// ==================================================
// The learning harness (GEPA + SWE-bench + Docker) is too heavy to ship in
// the npm package, so `metaharness learn` requires a local clone of the
// metaharness repo, located via $METAHARNESS_REPO or by running inside the
// clone. When the checkout is absent we emit a structured
// `{status: "checkout-required"}` payload and exit 0 — the script ran as
// designed and told the agent what to do next. This is distinct from
// `degraded: true` (npm package absent). The managed-service path (gateway-
// side learn jobs, no checkout) is upstream's ADR-235 follow-up.
//
// USAGE
//   node scripts/learn.mjs --host claude-code --model haiku --slice slices/lite.json
//   node scripts/learn.mjs --repo ~/src/metaharness --host codex --model gpt-5-mini --slice s.json --run
//
// EXIT CODES
//   0  learn completed (or dry-run report, or degraded, or checkout-required)
//   1  --alert-on-fail and the learn run reported failure
//   2  config error (bad arg)

import { existsSync } from 'node:fs';
import { runMetaharnessAsync, emitDegradedJsonAndExit } from './_harness.mjs';

const ARGS = (() => {
  const a = {
    host: null,
    model: null,
    slice: null,
    repo: null,
    run: false,
    alertOnFail: false,
    format: 'json',
    timeoutMs: null,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--host') a.host = process.argv[++i];
    else if (v === '--model') a.model = process.argv[++i];
    else if (v === '--slice') a.slice = process.argv[++i];
    else if (v === '--repo') a.repo = process.argv[++i];
    else if (v === '--run') a.run = true;
    else if (v === '--alert-on-fail') a.alertOnFail = true;
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--timeout-ms') a.timeoutMs = parseInt(process.argv[++i], 10);
  }
  return a;
})();

const CHECKOUT_RX = /requires a metaharness repo checkout/i;

function defaultTimeoutMs() {
  // Dry-run resolves the slice manifest + prices the run without spending —
  // bounded by repo scan, not model calls. Real runs (--run) are dominated
  // by model calls × slice size; callers should pass --timeout-ms matched
  // to their slice. 10 min is a floor for small slices, not a budget.
  return ARGS.run ? 600_000 : 120_000;
}

async function main() {
  if (ARGS.repo && !existsSync(ARGS.repo)) {
    console.error(`learn: --repo path does not exist: ${ARGS.repo}`);
    process.exit(2);
  }

  const cliArgs = ['learn'];
  if (ARGS.host) cliArgs.push('--host', ARGS.host);
  if (ARGS.model) cliArgs.push('--model', ARGS.model);
  if (ARGS.slice) cliArgs.push('--slice', ARGS.slice);
  if (ARGS.run) cliArgs.push('--run');

  const r = await runMetaharnessAsync(cliArgs, {
    // learn emits a human-readable report; --json support is not guaranteed
    // across 0.3.x, so we don't inject it and parse leniently instead.
    json: false,
    timeoutMs: ARGS.timeoutMs ?? defaultTimeoutMs(),
    env: ARGS.repo ? { METAHARNESS_REPO: ARGS.repo } : {},
  });

  if (r.degraded) emitDegradedJsonAndExit(r.reason);

  const combined = `${r.stdout}\n${r.stderr}`;
  if (CHECKOUT_RX.test(combined)) {
    console.log(JSON.stringify({
      status: 'checkout-required',
      hint: 'git clone https://github.com/ruvnet/metaharness.git, then re-run with '
        + '--repo /path/to/metaharness (or set METAHARNESS_REPO). The learning '
        + 'harness (GEPA + SWE-bench + Docker) is not shipped in the npm package.',
      dryRun: !ARGS.run,
      durationMs: r.durationMs,
    }, null, 2));
    process.exit(0);
  }

  // Lenient JSON extraction — grab the last {...} block if one exists.
  let json = null;
  const matches = [...r.stdout.matchAll(/\{[\s\S]*?\}/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    try { json = JSON.parse(matches[i][0]); break; } catch { /* try previous */ }
  }

  const out = {
    status: r.exitCode === 0 ? 'ok' : 'failed',
    dryRun: !ARGS.run,
    exitCode: r.exitCode,
    report: json,
    // When upstream emits no JSON, the raw report is still the deliverable.
    rawReport: json ? undefined : r.stdout.slice(0, 20_000),
    durationMs: r.durationMs,
  };
  console.log(JSON.stringify(out, null, 2));

  if (ARGS.alertOnFail && r.exitCode !== 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(`learn: ${e?.message ?? e}`);
  process.exit(2);
});
