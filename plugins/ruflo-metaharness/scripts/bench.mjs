#!/usr/bin/env node
// bench.mjs — wrapper around `metaharness-darwin bench <create|verify>`.
//
// Bench suites are JSON files describing a corpus of (input, expected-output)
// tasks. `evolve --bench <suite.json>` scores each variant against the
// corpus instead of (or in addition to) the project's test command, which
// lets you evolve a harness against a fixed evaluation set independent of
// the repo's natural tests. `bench create` scaffolds a suite from a repo;
// `bench verify` checks a suite parses and every task is well-formed.
//
// USAGE
//   node scripts/bench.mjs --op create --repo .              # scaffold suite.json from current dir
//   node scripts/bench.mjs --op create --repo . --out /tmp/foo.json
//   node scripts/bench.mjs --op verify --suite /tmp/foo.json
//
// EXIT CODES
//   0  ok (or degraded — Darwin not available)
//   1  --op verify and any task malformed
//   2  config error or upstream invocation failure

import { runDarwin, emitDarwinDegradedJsonAndExit } from './_darwin.mjs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ARGS = (() => {
  const a = { op: null, repo: '.', suite: null, out: null, format: 'json' };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--op') a.op = process.argv[++i];
    else if (v === '--repo') a.repo = process.argv[++i];
    else if (v === '--suite') a.suite = process.argv[++i];
    else if (v === '--out') a.out = process.argv[++i];
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function safetyChecks() {
  if (!['create', 'verify'].includes(ARGS.op)) {
    console.error('bench: --op must be create|verify');
    process.exit(2);
  }
  if (ARGS.op === 'create' && !existsSync(resolve(ARGS.repo))) {
    console.error(`bench: --repo path does not exist: ${ARGS.repo}`);
    process.exit(2);
  }
  if (ARGS.op === 'verify' && !ARGS.suite) {
    console.error('bench: --suite is required for verify');
    process.exit(2);
  }
  if (ARGS.op === 'verify' && !existsSync(resolve(ARGS.suite))) {
    console.error(`bench: --suite path does not exist: ${ARGS.suite}`);
    process.exit(2);
  }
}

function main() {
  safetyChecks();

  const cliArgs = ARGS.op === 'create'
    ? ['bench', 'create', resolve(ARGS.repo), ...(ARGS.out ? ['--out', resolve(ARGS.out)] : [])]
    : ['bench', 'verify', resolve(ARGS.suite)];

  const r = runDarwin(cliArgs, { timeoutMs: 60_000 });

  if (r.degraded) {
    emitDarwinDegradedJsonAndExit(r.reason);
    return;
  }

  if (r.exitCode !== 0 && r.exitCode !== 1) {
    const payload = {
      success: false,
      data: { exitCode: r.exitCode, stderrTail: r.stderr.slice(-400) },
      generatedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(2);
  }

  const payload = {
    success: r.exitCode === 0,
    data: {
      op: ARGS.op,
      ...(r.json ?? { stdoutTail: r.stdout.slice(-2000) }),
      durationMs: r.durationMs,
    },
    generatedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(payload, null, 2));
  process.exit(r.exitCode);
}

main();
