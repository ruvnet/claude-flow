#!/usr/bin/env node
/**
 * Smoke test for scripts/audit-supply-chain.mjs.
 *
 * Runs the audit and confirms:
 *  - It exits 0 (current accepted-findings keep the bar)
 *  - The five layers all execute
 *  - JSON output is parseable
 *
 * Run via:  node scripts/__tests__/audit-supply-chain.test.mjs
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPT = join(REPO_ROOT, 'scripts', 'audit-supply-chain.mjs');

function run(args = []) {
  try {
    return {
      stdout: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_ROOT }),
      code: 0,
    };
  } catch (err) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      code: err.status ?? 1,
    };
  }
}

console.log('test: full audit returns 0 on current accepted state');
{
  const r = run();
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}. stdout:\n${r.stdout}`);
  assert.match(r.stdout, /\[1\/5\] CVE audit/);
  assert.match(r.stdout, /\[2\/5\] Lockfile integrity/);
  assert.match(r.stdout, /\[3\/5\] Top-level allowlist/);
  assert.match(r.stdout, /\[4\/5\] Typosquat reject/);
  assert.match(r.stdout, /\[5\/5\] Publisher trust snapshot/);
  assert.match(r.stdout, /OK: no hard-fail findings\./);
  console.log('  pass');
}

console.log('test: --json output is parseable');
{
  const r = run(['--json']);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}`);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed.cve));
  assert.ok(Array.isArray(parsed.lockfile));
  assert.ok(Array.isArray(parsed.allowlist));
  assert.ok(Array.isArray(parsed.typosquat));
  assert.ok(Array.isArray(parsed.publisherTrust));
  console.log('  pass');
}

console.log('test: --scope cve runs only the CVE pass');
{
  const r = run(['--scope', 'cve']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\[1\/5\] CVE audit/);
  assert.doesNotMatch(r.stdout, /\[2\/5\] Lockfile integrity/);
  console.log('  pass');
}

console.log('test: --scope allowlist runs only the allowlist pass');
{
  const r = run(['--scope', 'allowlist']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\[3\/5\] Top-level allowlist/);
  assert.doesNotMatch(r.stdout, /\[1\/5\] CVE audit/);
  console.log('  pass');
}

console.log('test: --scope typosquat runs only the typosquat pass');
{
  const r = run(['--scope', 'typosquat']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /\[4\/5\] Typosquat reject/);
  console.log('  pass');
}

console.log('\nall supply-chain audit tests passed');
