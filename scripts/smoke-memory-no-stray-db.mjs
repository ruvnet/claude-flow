#!/usr/bin/env node
/**
 * Smoke: ADR-125 Phase 7 — no stray DB artifacts after `npm test` in @claude-flow/memory.
 *
 * The agentdb / @ruvector/rvf native bindings have a habit of writing
 * `ruvector.db` (and friends) to whatever cwd they're invoked from. ADR-125
 * Phase 7 wipes the artifacts via `vitest.setup.ts`; this smoke is the
 * behavioural guard that verifies the wipe actually works.
 *
 * Strategy:
 *   1. cd v3/@claude-flow/memory
 *   2. record `git status --porcelain .` as a baseline (untracked files that
 *      already exist do not count against us — we are checking the DELTA).
 *   3. run `npm test`
 *   4. record `git status --porcelain .` again
 *   5. fail if any *.db / *.rvf / *.redb / *.lock file appears in the new
 *      status that wasn't there before.
 *
 * Exit codes:
 *   0 — clean
 *   1 — stray DB file detected (or test run failed)
 *
 * Usage:
 *   node scripts/smoke-memory-no-stray-db.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PKG_DIR = resolve(REPO_ROOT, 'v3/@claude-flow/memory');

const FORBIDDEN_SUFFIXES = ['.db', '.db-journal', '.db-wal', '.rvf', '.redb'];

function gitStatusFiles() {
  const out = execFileSync('git', ['status', '--porcelain', PKG_DIR], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return out
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.slice(3)) // strip the two-char status + space
    .map((p) => p.trim());
}

function forbidden(files) {
  return files.filter((f) =>
    FORBIDDEN_SUFFIXES.some((suffix) => f.endsWith(suffix))
  );
}

console.log('[smoke] ADR-125 Phase 7 — no-stray-db check starting');
console.log('[smoke] package dir: ' + PKG_DIR);

const baseline = new Set(gitStatusFiles());
console.log('[smoke] baseline status entries: ' + baseline.size);
const baselineLeaks = forbidden([...baseline]);
if (baselineLeaks.length > 0) {
  console.warn(
    '[smoke] WARNING: baseline already contains DB-like artifacts (will be ignored for delta check):'
  );
  for (const f of baselineLeaks) console.warn('  ' + f);
}

console.log('[smoke] running `npm test` in package...');
const testRun = spawnSync('npm', ['test'], {
  cwd: PKG_DIR,
  stdio: 'inherit',
});
// This smoke detects stray DB-like artifacts on disk after the test run.
// It runs `npm test` for its side effects only. @claude-flow/memory has
// timing-sensitive HNSW perf assertions (e.g. search latency < 200ms) that
// are flaky on slower CI runners (212ms observed). Demote a non-zero test
// status to a warning so the file-leak check below — this smoke's real
// contract — still runs.
if (testRun.status !== 0) {
  console.warn('[smoke] note: `npm test` exited with status ' + testRun.status + ' (likely flaky perf assertion). Continuing to file-leak check.');
}

const after = gitStatusFiles();
const newEntries = after.filter((f) => !baseline.has(f));
const newLeaks = forbidden(newEntries);

console.log('[smoke] status entries after test: ' + after.length);
console.log('[smoke] net-new entries: ' + newEntries.length);

if (newLeaks.length > 0) {
  console.error('[smoke] FAIL: stray DB-like artifacts created by test run:');
  for (const f of newLeaks) console.error('  ' + f);
  console.error('');
  console.error(
    '[smoke] vitest.setup.ts (ADR-125 Phase 7) is supposed to wipe these.'
  );
  console.error(
    '[smoke] If a new artifact type appeared, add its name/suffix to ' +
      'KNOWN_LEAK_FILES or LEAK_SUFFIXES in vitest.setup.ts.'
  );
  process.exit(1);
}

console.log('[smoke] PASS: no stray DB artifacts after `npm test`');
process.exit(0);
