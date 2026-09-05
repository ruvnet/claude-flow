#!/usr/bin/env node
// mint.mjs — wrapper around `metaharness new <name> --template <id> --host <id>`.
//
// SAFETY (ADR-150 architectural constraint + "executing actions with care"):
//   - Target directory MUST be explicitly specified via --target. Defaults to
//     a temp dir under /tmp/ruflo-mint-<timestamp>/ if not given — never the
//     project root (ruflo behavioral rule "never save to root folder").
//   - --confirm flag required. Without it the script prints a dry-run plan
//     and exits 0 without writing files. This honors the "destructive-action
//     confirmation" pattern in ruflo's CLAUDE.md.
//
// USAGE
//   node scripts/mint.mjs --name my-harness --template vertical:coding --host claude-code
//     # → prints dry-run plan, exits 0
//   node scripts/mint.mjs --name my-harness --template vertical:coding --host claude-code --target /tmp/foo --confirm
//     # → actually scaffolds

import { runMetaharness, emitDegradedJsonAndExit } from './_harness.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';

const ARGS = (() => {
  const a = { name: null, template: null, host: 'claude-code', target: null, confirm: false, format: 'json' };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--name') a.name = process.argv[++i];
    else if (v === '--template') a.template = process.argv[++i];
    else if (v === '--host') a.host = process.argv[++i];
    else if (v === '--target') a.target = process.argv[++i];
    else if (v === '--confirm') a.confirm = true;
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function safetyChecks() {
  if (!ARGS.name) {
    console.error('mint: --name is required');
    process.exit(2);
  }
  if (!ARGS.template) {
    console.error('mint: --template is required (e.g. vertical:coding, minimal)');
    process.exit(2);
  }
  if (!ARGS.target) {
    ARGS.target = resolve(tmpdir(), `ruflo-mint-${Date.now()}-${ARGS.name}`);
  }
  const targetAbs = resolve(ARGS.target);
  const repoRoot = resolve(process.cwd());
  if (targetAbs === repoRoot) {
    console.error(`mint: refusing to write to project root (${repoRoot}). Specify a different --target.`);
    process.exit(2);
  }
  if (targetAbs.startsWith(repoRoot + '/')) {
    console.error(`mint: refusing to write inside the calling repo root. Use a --target outside ${repoRoot}.`);
    process.exit(2);
  }
}

function main() {
  safetyChecks();
  // ADR-150 architectural-constraint #3 (graceful degradation): even the
  // dry-run path must report degraded:true when metaharness is unreachable
  // — otherwise users with no network / proxy block see a happy-looking
  // plan and only hit the failure on --confirm. The no-metaharness-smoke
  // CI gate asserts every script emits a `"degraded"` field in this case.
  const probe = runMetaharness(['--version'], { json: false, timeoutMs: 15_000 });
  if (probe.degraded) { emitDegradedJsonAndExit(probe.reason); return; }
  const plan = {
    action: 'metaharness new',
    name: ARGS.name,
    template: ARGS.template,
    host: ARGS.host,
    target: ARGS.target,
    confirm: ARGS.confirm,
    willWrite: ARGS.confirm,
  };
  if (!ARGS.confirm) {
    if (ARGS.format === 'json') console.log(JSON.stringify({ ...plan, dryRun: true }, null, 2));
    else {
      console.log(`# harness-mint (dry-run)`);
      console.log('');
      for (const [k, v] of Object.entries(plan)) console.log(`- ${k}: ${v}`);
      console.log('');
      console.log('Re-run with `--confirm` to actually scaffold.');
    }
    process.exit(0);
  }
  if (existsSync(ARGS.target)) {
    console.error(`mint: target ${ARGS.target} already exists`);
    process.exit(2);
  }
  // ITER 27 FIX (forward-compatible) — at the time of writing,
  // metaharness@0.1.12 silently ignored the --target flag and wrote
  // to $CWD/<name> instead. Upstream issue #9
  // (ruvnet/agent-harness-generator) was filed + fixed in 0.1.13
  // within ~20 min — but this workaround is intentionally
  // forward-compatible: setting `cwd: dirname(target)` + passing
  // `basename(target)` as <name> produces the same correct landing
  // path on BOTH broken (0.1.12) and fixed (0.1.13+) upstream
  // versions. Keeping it as belt-and-braces against any future
  // regression. See `iter 29` for the verification log.
  const parentDir = dirname(ARGS.target);
  const cliName = basename(ARGS.target);
  mkdirSync(parentDir, { recursive: true });
  const r = runMetaharness(
    ['new', cliName, '--template', ARGS.template, '--host', ARGS.host],
    { json: false, cwd: parentDir, timeoutMs: 180_000 },
  );
  if (r.degraded) { emitDegradedJsonAndExit(r.reason); return; }
  if (r.exitCode !== 0) {
    console.error(`mint: metaharness exited ${r.exitCode}`);
    if (r.stderr) console.error(r.stderr.slice(0, 400));
    process.exit(2);
  }
  const result = { ...plan, exitCode: r.exitCode, durationMs: r.durationMs, ok: true };
  if (ARGS.format === 'json') console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`# harness-mint — done`);
    console.log('');
    for (const [k, v] of Object.entries(result)) console.log(`- ${k}: ${v}`);
  }
}

main();
