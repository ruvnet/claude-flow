#!/usr/bin/env node
// test-health-integration — runtime integration test for cost-health.
//
// The iter-75 bug (BUDGET_QUIET=1 silently swallowing HARD_STOP) was a
// classic test-pyramid gap: each subcheck's smoke contract passed
// (anomaly.mjs / burn.mjs / budget.mjs each correctly exit 1 on alert),
// but the COMPOSITE behavior was wrong — cost-health spawned budget.mjs
// with BUDGET_QUIET=1 and budget.mjs returned exit 0 in that mode.
//
// Structural source-grep smoke can detect the pattern in one file, but
// can't validate the cross-script contract. This runtime test exercises
// the composite end-to-end with synthetic fixtures and asserts each
// subcheck's signal correctly reaches cost-health's exit code.
//
// USAGE
//   node scripts/test-health-integration.mjs              # default
//   TEST_HEALTH_KEEP_FIXTURE=1 node scripts/test-health-integration.mjs
//                                                         # leave .swarm intact for debugging
//
// EXIT CODES
//   0  all assertions passed
//   1  at least one assertion failed
//   2  fixture setup error (likely CLI unavailable in CI)

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnNpxSync } from './_npx.mjs';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const HEALTH = join(SCRIPTS_DIR, 'health.mjs');
const BUDGET = join(SCRIPTS_DIR, 'budget.mjs');
const NS = 'cost-tracking';

let passed = 0, failed = 0;
const failures = [];

function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}`);
    failures.push(label);
    failed++;
  }
}

function memStore(cwd, key, valueObj) {
  const r = spawnNpxSync([
    '-y', '@claude-flow/cli@latest', 'memory', 'store',
    '--namespace', NS, '--key', key,
    '--value', JSON.stringify(valueObj),
  ], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    const detail = r.error?.message || r.stderr?.trim() || `exit status ${r.status}`;
    console.error(`  → npx memory store failed: ${detail}`);
  }
  return r.status === 0;
}

function memInit(cwd) {
  const r = spawnNpxSync([
    '-y', '@claude-flow/cli@latest', 'memory', 'init',
  ], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    const detail = r.error?.message || r.stderr?.trim() || `exit status ${r.status}`;
    console.error(`  → npx memory init failed: ${detail}`);
  }
  return r.status === 0;
}

function runHealth(cwd) {
  return new Promise((resolve) => {
    const p = spawn('node', [HEALTH, '--format', 'json'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    p.on('close', (code) => {
      let json = null;
      const m = /\{[\s\S]*\}/.exec(stdout);
      if (m) { try { json = JSON.parse(m[0]); } catch {} }
      resolve({ exitCode: code, json });
    });
  });
}

function runBudget(cwd, subcommand, ...extra) {
  const r = spawnSync('node', [BUDGET, subcommand, ...extra], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8',
  });
  return r.status;
}

async function main() {
  const fixture = mkdtempSync(join(tmpdir(), 'cost-health-test-'));
  mkdirSync(join(fixture, '.swarm'), { recursive: true });
  console.log(`# cost-health integration test (fixture: ${fixture})\n`);

  // -----------------------------------------------------------------------
  // Case 1: empty namespace → cost-health overall OK, exit 0.
  // Validates each subcheck handles empty input gracefully (the iter-75 fix
  // CI step is exactly this case, but for a clean cwd).
  // -----------------------------------------------------------------------
  console.log('Case 1: empty namespace');
  {
    // Use a fresh subdir so .swarm doesn't share state with later cases.
    const cwd = join(fixture, 'case-1-empty');
    mkdirSync(join(cwd, '.swarm'), { recursive: true });
    const r = await runHealth(cwd);
    if (!r.json) {
      console.error('  → no JSON output; CLI likely unavailable');
      process.exit(2);
    }
    assert(r.exitCode === 0, 'empty input → exit 0');
    assert(r.json.overall.ok === true, 'empty input → overall.ok === true');
  }

  // -----------------------------------------------------------------------
  // Case 2: budget HARD_STOP → cost-health overall ⚠, exit 1.
  // EXACT REGRESSION TARGET FOR ITER 75. If budget.mjs ever again
  // short-circuits process.exit(1) when BUDGET_QUIET=1 is set, this
  // assertion fails.
  // -----------------------------------------------------------------------
  console.log('Case 2: budget HARD_STOP via BUDGET_QUIET=1');
  {
    const cwd = join(fixture, 'case-2-hardstop');
    mkdirSync(join(cwd, '.swarm'), { recursive: true });
    if (!memInit(cwd)) { console.error('  → fixture initialization failed'); process.exit(2); }
    // 5 sessions × $0.10 = $0.50 spend
    for (let i = 0; i < 5; i++) {
      const ts = new Date(Date.now() - (i + 2) * 86_400_000).toISOString();
      const ok = memStore(cwd, `session-baseline-${i}`, {
        sessionId: `baseline-${i}`, capturedAt: ts,
        total_cost_usd: 0.10, messageCount: 5, byModel: {},
      });
      if (!ok) { console.error('  → fixture write failed'); process.exit(2); }
    }
    // Set $0.20 budget → 250% utilization → HARD_STOP
    if (runBudget(cwd, 'set', '0.20') !== 0) {
      console.error('  → budget set failed');
      process.exit(2);
    }
    const r = await runHealth(cwd);
    if (!r.json) { console.error('  → no JSON output'); process.exit(2); }
    assert(r.exitCode === 1, 'HARD_STOP → exit 1 (iter-75 regression target)');
    assert(r.json.overall.ok === false, 'HARD_STOP → overall.ok === false');
    const budgetCheck = r.json.checks.find((c) => c.name === 'budget');
    assert(budgetCheck && budgetCheck.exitCode === 1,
      'subcheck budget exit code propagated as 1 (was bypassed by BUDGET_QUIET=1 in iter 75)');
  }

  // -----------------------------------------------------------------------
  // Case 3: subcheck skip flag honored.
  // -----------------------------------------------------------------------
  console.log('Case 3: --skip flag honored');
  {
    const cwd = join(fixture, 'case-3-skip');
    mkdirSync(join(cwd, '.swarm'), { recursive: true });
    const p = spawn('node', [HEALTH, '--format', 'json', '--skip', 'burn,projection'], {
      cwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    p.stdout.on('data', (d) => { stdout += d.toString(); });
    const exitCode = await new Promise((res) => p.on('close', res));
    const m = /\{[\s\S]*\}/.exec(stdout);
    const json = m ? JSON.parse(m[0]) : null;
    assert(json && json.checks.length === 2,
      `--skip burn,projection → only 2 checks ran (budget+anomaly), got ${json?.checks?.length}`);
    assert(json && json.config.skipped.includes('burn') && json.config.skipped.includes('projection'),
      'config.skipped reflects CLI args');
  }

  // Cleanup
  if (process.env.TEST_HEALTH_KEEP_FIXTURE !== '1') {
    try {
      rmSync(fixture, { recursive: true, force: true });
    } catch (error) {
      // Windows can retain a transient AgentDB handle after the npx child
      // exits. Fixture cleanup must not hide a completed contract test.
      if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error;
      console.warn(`  → fixture cleanup deferred: ${error.message}`);
    }
  } else {
    console.log(`\n(fixture kept at ${fixture})`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('test-health-integration crashed:', e.message || e);
  process.exit(2);
});
