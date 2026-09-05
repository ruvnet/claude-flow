#!/usr/bin/env node
// redblue.mjs — wrapper around `@metaharness/redblue` for LLM red/blue testing.
//
// ADR-150 sibling-package integration: `@metaharness/redblue` runs an
// adversarial red-team → judge → blue-team patch loop against an LLM
// target you own. Upstream README: packages/redblue#readme on
// github.com/ruvnet/agent-harness-generator.
//
// SAFETY (enforced by upstream `src/config/safety.ts`, NOT this wrapper):
//   - no real credentials (`allow_real_credentials:true` = load-time error)
//   - no live external targets (validateTarget() rejects non-loopback)
//   - no shell, no arbitrary network, no eval
//   - sensitive outputs redacted before storage
//   - `max_cost_usd` / `max_runtime_minutes` / `max_tests` cap every run
//
// USAGE
//   node scripts/redblue.mjs init                         # write redblue.yaml
//   node scripts/redblue.mjs run --mock-judge --tests 10  # $0 marker-fixture path
//   node scripts/redblue.mjs run --tests 50 --patch       # real judge (needs OPENROUTER_API_KEY)
//   node scripts/redblue.mjs attack prompt --count 5      # preview attacks
//   node scripts/redblue.mjs patch --mock-judge           # baseline → patch → retest delta
//   node scripts/redblue.mjs report --in report.json      # render summary
//
// EXIT CODES
//   0  ran OK (or degraded — redblue not available)
//   1  --alert-on-fail and overall verdict was FAIL (after patch retest)
//   2  config / argv error
//
// REPORT FORMAT
//   `run` / `patch` write a JSON report to --out (default: ./redblue-report.json).
//   We re-emit it on stdout when --format json so MCP tools can parse it
//   without round-tripping through disk. Markdown rendering is delegated
//   to `redblue report` upstream.

import { runRedblue, emitRedblueDegradedJsonAndExit } from './_redblue.mjs';
import { existsSync, readFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const VALID_SUBCOMMANDS = new Set(['init', 'run', 'patch', 'attack', 'report']);
const VALID_ATTACK_FAMILIES = new Set(['prompt', 'tools', 'data', 'all']);

const ARGS = (() => {
  const a = {
    sub: null,
    // shared
    config: null,
    out: null,
    inPath: null,
    format: 'json',
    // run/patch
    tests: null,
    patch: false,
    mockJudge: false,
    alertOnFail: false,
    // attack
    family: null,
    count: null,
    // budget overrides (forwarded only when set)
    maxCostUsd: null,
    maxRuntimeMinutes: null,
    timeoutMs: null,
  };
  const argv = process.argv.slice(2);
  if (argv.length === 0) return a;
  a.sub = argv[0];
  for (let i = 1; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--config') a.config = argv[++i];
    else if (v === '--out') a.out = argv[++i];
    else if (v === '--in') a.inPath = argv[++i];
    else if (v === '--format') a.format = argv[++i];
    else if (v === '--tests') a.tests = parseInt(argv[++i], 10);
    else if (v === '--patch') a.patch = true;
    else if (v === '--mock-judge') a.mockJudge = true;
    else if (v === '--alert-on-fail') a.alertOnFail = true;
    else if (v === '--count') a.count = parseInt(argv[++i], 10);
    else if (v === '--max-cost-usd') a.maxCostUsd = parseFloat(argv[++i]);
    else if (v === '--max-runtime-minutes') a.maxRuntimeMinutes = parseFloat(argv[++i]);
    else if (v === '--timeout-ms') a.timeoutMs = parseInt(argv[++i], 10);
    else if (v === '--help' || v === '-h') a.sub = 'help';
    else if (!v.startsWith('-') && a.sub === 'attack' && !a.family) a.family = v;
    // any other unknown flag — pass through to upstream redblue
    else if (v.startsWith('--')) {
      // forward unknown flags verbatim so we don't bottleneck new redblue features
      a._passthrough = a._passthrough || [];
      a._passthrough.push(v);
      // peek for next-token value (only consume if it's not another flag)
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        a._passthrough.push(next);
        i++;
      }
    }
  }
  return a;
})();

function printHelp() {
  console.log('npx ruflo metaharness redblue <subcommand> [options]');
  console.log('');
  console.log('Subcommands:');
  console.log('  init                       Write a sample redblue.yaml config');
  console.log('  run                        Run red-team → judge → (optional --patch → retest) → report');
  console.log('  patch                      Baseline → blue-team patch → retest delta');
  console.log('  attack <prompt|tools|data|all>   Preview generated attack test cases (no target call)');
  console.log('  report                     Render an existing report.json as markdown');
  console.log('');
  console.log('Common options:');
  console.log('  --config <path>            Config YAML (default: redblue.yaml in cwd)');
  console.log('  --out <path>               Output path for run/patch (default: ./redblue-report.json)');
  console.log('  --in <path>                Input report path (for `report` subcommand)');
  console.log('  --tests N                  How many test cases (run/patch)');
  console.log('  --patch                    After baseline run, apply blue-team patches and retest');
  console.log('  --mock-judge               $0 TEST-ONLY marker fixture — for CI / offline');
  console.log('  --alert-on-fail            Exit 1 when overall post-patch verdict is FAIL');
  console.log('  --format json|markdown     Output format (default: json)');
  console.log('  --max-cost-usd N           Override config max_cost_usd');
  console.log('  --max-runtime-minutes N    Override config max_runtime_minutes');
  console.log('  --timeout-ms N             Subprocess hard timeout (default: 120000)');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/redblue.mjs init');
  console.log('  node scripts/redblue.mjs run --mock-judge --tests 10');
  console.log('  node scripts/redblue.mjs run --tests 50 --patch  # needs OPENROUTER_API_KEY');
  console.log('  node scripts/redblue.mjs attack prompt --count 3');
  console.log('');
  console.log('SAFETY: upstream redblue enforces no-creds, no-live-targets, no-shell,');
  console.log('no-eval at load time (src/config/safety.ts). This wrapper does not relax');
  console.log('those — it only forwards argv with shell:false.');
}

function buildUpstreamArgs() {
  switch (ARGS.sub) {
    case 'init': {
      const out = ARGS.out ?? null;
      return ['init', ...(out ? ['--out', out] : [])];
    }
    case 'run': {
      const a = ['run'];
      if (ARGS.config) a.push('--config', ARGS.config);
      if (ARGS.tests !== null && Number.isFinite(ARGS.tests)) a.push('--tests', String(ARGS.tests));
      if (ARGS.patch) a.push('--patch');
      if (ARGS.mockJudge) a.push('--mock-judge');
      if (ARGS.out) a.push('--out', ARGS.out);
      return a;
    }
    case 'patch': {
      const a = ['patch'];
      if (ARGS.config) a.push('--config', ARGS.config);
      if (ARGS.mockJudge) a.push('--mock-judge');
      if (ARGS.out) a.push('--out', ARGS.out);
      return a;
    }
    case 'attack': {
      if (!ARGS.family || !VALID_ATTACK_FAMILIES.has(ARGS.family)) {
        console.error(`redblue: --attack family must be one of ${[...VALID_ATTACK_FAMILIES].join('|')} (got: ${ARGS.family ?? 'none'})`);
        process.exit(2);
      }
      const a = ['attack', ARGS.family];
      if (ARGS.count !== null && Number.isFinite(ARGS.count)) a.push('--count', String(ARGS.count));
      return a;
    }
    case 'report': {
      if (!ARGS.inPath) {
        console.error('redblue: report requires --in <path>');
        process.exit(2);
      }
      return ['report', '--in', ARGS.inPath];
    }
    default:
      console.error(`redblue: unknown subcommand "${ARGS.sub}". Valid: ${[...VALID_SUBCOMMANDS].join(', ')}`);
      process.exit(2);
  }
}

function main() {
  if (!ARGS.sub || ARGS.sub === 'help' || ARGS.sub === '--help' || ARGS.sub === '-h') {
    printHelp();
    process.exit(0);
  }
  if (!VALID_SUBCOMMANDS.has(ARGS.sub)) {
    console.error(`redblue: unknown subcommand "${ARGS.sub}". Valid: ${[...VALID_SUBCOMMANDS].join(', ')}`);
    process.exit(2);
  }

  // For `run` and `patch` we want the report JSON in our hands even when
  // the caller didn't pass --out (so MCP tools can read it back from stdout).
  let synthOut = null;
  if ((ARGS.sub === 'run' || ARGS.sub === 'patch') && !ARGS.out) {
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-redblue-'));
    synthOut = join(dir, 'report.json');
    ARGS.out = synthOut;
  }

  const upstreamArgs = buildUpstreamArgs();
  if (ARGS._passthrough?.length) upstreamArgs.push(...ARGS._passthrough);

  const r = runRedblue(upstreamArgs, { timeoutMs: ARGS.timeoutMs ?? undefined });

  if (r.degraded) {
    if (synthOut && existsSync(synthOut)) {
      try { unlinkSync(synthOut); } catch { /* ignore */ }
    }
    emitRedblueDegradedJsonAndExit(r.reason);
    return;
  }

  // Pass through stderr (progress) when format=markdown so users see it live
  if (ARGS.format === 'markdown' && r.stderr) {
    process.stderr.write(r.stderr);
  }

  // For run/patch: read the report we asked redblue to write.
  let payload = null;
  if (ARGS.sub === 'run' || ARGS.sub === 'patch') {
    const reportPath = resolve(ARGS.out);
    if (existsSync(reportPath)) {
      try {
        payload = JSON.parse(readFileSync(reportPath, 'utf-8'));
      } catch (e) {
        console.error(`redblue: failed to parse report at ${reportPath}: ${e instanceof Error ? e.message : String(e)}`);
        if (synthOut) { try { unlinkSync(synthOut); } catch { /* ignore */ } }
        process.exit(2);
      }
    }
  }

  // Decorate every payload with our own metadata + the safety boundary
  // reminder so consumers always see "this was capability-contained".
  const enriched = payload && typeof payload === 'object' ? {
    ...payload,
    _ruflo: {
      subcommand: ARGS.sub,
      mockJudge: ARGS.mockJudge,
      durationMs: r.durationMs,
      safetyBoundary: 'enforced-by-upstream-redblue (no creds, no live targets, no shell, no eval)',
    },
  } : payload;

  // Determine overall verdict for --alert-on-fail (post-patch run only).
  // redblue reports include a `verdict` or `gate` field; we treat absence
  // as "no data → no alert" rather than erroring.
  let alertTriggered = false;
  if (ARGS.alertOnFail && enriched && typeof enriched === 'object') {
    const v = (enriched.verdict || enriched.gate || enriched.status || '').toString().toUpperCase();
    if (v.includes('FAIL')) alertTriggered = true;
  }

  if (ARGS.format === 'json') {
    if (enriched !== null) {
      console.log(JSON.stringify(enriched, null, 2));
    } else {
      // init / attack / report subcommands — forward upstream stdout verbatim
      // (it's already markdown/yaml). Wrap in a tiny JSON envelope.
      console.log(JSON.stringify({
        subcommand: ARGS.sub,
        ok: r.exitCode === 0,
        durationMs: r.durationMs,
        stdout: r.stdout,
        _ruflo: { safetyBoundary: 'enforced-by-upstream-redblue' },
      }, null, 2));
    }
  } else {
    // markdown / passthrough
    if (r.stdout) process.stdout.write(r.stdout);
    if (enriched && typeof enriched === 'object') {
      console.log('');
      console.log('---');
      console.log('## redblue report (parsed)');
      console.log('```json');
      console.log(JSON.stringify(enriched, null, 2));
      console.log('```');
    }
  }

  // Clean up synthetic temp file
  if (synthOut && existsSync(synthOut)) {
    try { unlinkSync(synthOut); } catch { /* ignore */ }
  }

  if (alertTriggered) process.exit(1);
  if (r.exitCode !== 0) process.exit(r.exitCode);
}

main();
