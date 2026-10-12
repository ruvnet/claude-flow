#!/usr/bin/env node
/**
 * Fresh-consumer smoke for @claude-flow/shared (#4031, #4089).
 *
 * Installs the PACKED tarball (or a published spec) into an empty directory and exercises it the way a
 * consumer does: plain Node, no vitest, no TypeScript source. It checks that
 *   1. the tarball ships no test files,
 *   2. the package root and its subpaths import on a clean install (zod/express/... are declared),
 *   3. the RVF event log keeps every append across reopen cycles after each damaged-tail shape, and never
 *      accepts an append it cannot read back (an oversized length prefix rejects, or truncates when opted in).
 *
 *   node scripts/smoke-shared-fresh-consumer.mjs                      # pack v3/@claude-flow/shared (must be built)
 *   node scripts/smoke-shared-fresh-consumer.mjs --spec @claude-flow/shared@3.0.4   # a published version
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const specIdx = args.indexOf('--spec');
const spec = specIdx >= 0 ? args[specIdx + 1] : null;
const pkgDir = resolve(args[args.indexOf('--pack') + 1] || 'v3/@claude-flow/shared');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd, a, opts = {}) => execFileSync(cmd, a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const work = mkdtempSync(join(tmpdir(), 'shared-consumer-'));
const failures = [];
const rows = [];
const check = (name, ok, detail = '') => { rows.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures.push(name); };

try {
  let target = spec;
  if (!spec) {
    const dry = JSON.parse(run(npm, ['pack', pkgDir, '--dry-run', '--json']))[0];
    const tests = dry.files.map(f => f.path).filter(p => /(^|\/)__tests__(\/|$)|\.(test|spec)\./.test(p));
    check('tarball ships no test files', tests.length === 0, tests.slice(0, 3).join(', '));
    run(npm, ['pack', pkgDir, '--pack-destination', work, '--silent']);
    target = join(work, readdirSync(work).find(f => f.endsWith('.tgz')));
  }
  const consumer = join(work, 'consumer');
  mkdirSync(consumer);
  run(npm, ['init', '-y', '--silent'], { cwd: consumer });
  run(npm, ['install', target, '--no-audit', '--no-fund', '--ignore-scripts', '--silent'], { cwd: consumer });

  const scenarioFile = join(consumer, 'scenarios.mjs');
  writeFileSync(scenarioFile, `
import { appendFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { RvfEventLog } = await import('@claude-flow/shared/events');
const ev = id => ({ id, aggregateId: 'a', aggregateType: 'T', type: 'C', timestamp: Number(id), version: 0, payload: {} });
const tails = {
  'partial length prefix': Buffer.from([0, 0]),
  'partial payload': Buffer.from([0, 0, 0, 100, 123]),
  'oversized length prefix': Buffer.from('garbage'),
  'complete non-JSON record': Buffer.from([0, 0, 0, 3, 0x61, 0x62, 0x63]),
  'zero fill': Buffer.alloc(16),
};
const out = {};
for (const [name, tail] of Object.entries(tails)) for (const repair of [false, true]) {
  const dir = mkdtempSync(join(tmpdir(), 'rvf-')); const path = join(dir, 'e.rvf'); const cfg = { logPath: path, repairOversizedTail: repair };
  const res = { events: [], rejected: 0, error: null };
  try {
    let log = new RvfEventLog(cfg); await log.initialize(); await log.append(ev('1')); await log.close();
    appendFileSync(path, tail);
    for (const id of ['2', '3']) {
      log = new RvfEventLog(cfg); await log.initialize();
      try { await log.append(ev(id)); } catch { res.rejected++; }
      await log.close();
    }
    log = new RvfEventLog(cfg); await log.initialize();
    res.events = (await log.getEvents('a')).map(e => e.id); await log.close();
  } catch (e) { res.error = String(e && e.message || e); } finally { rmSync(dir, { recursive: true, force: true }); }
  out[name + (repair ? ' [repair]' : '')] = res;
}
console.log(JSON.stringify(out));
`);
  const results = JSON.parse(run('node', [scenarioFile], { cwd: consumer }).trim().split('\n').pop());
  for (const [name, r] of Object.entries(results)) {
    const accepted = r.events.filter(id => id !== '1');
    // A shape must either keep every append readable, or reject it explicitly: never accept silently.
    const silentLoss = r.rejected === 0 && accepted.length < 2;
    const ok = !r.error && !silentLoss && r.events[0] === '1';
    check(`tail: ${name}`, ok, `events=${JSON.stringify(r.events)} rejected=${r.rejected}${r.error ? ' error=' + r.error : ''}`);
  }
  for (const name of ['partial length prefix', 'partial payload', 'complete non-JSON record', 'zero fill', 'oversized length prefix [repair]']) {
    const r = results[name];
    check(`kept both appends: ${name}`, !!r && r.events.join(',') === '1,2,3', r ? JSON.stringify(r.events) : 'missing');
  }
  const oversized = results['oversized length prefix'];
  check('oversized prefix rejects explicitly by default', !!oversized && oversized.rejected === 2 && oversized.events.join(',') === '1');

  for (const entry of ['@claude-flow/shared', '@claude-flow/shared/events', '@claude-flow/shared/core', '@claude-flow/shared/mcp']) {
    try { run('node', ['--input-type=module', '-e', `await import(${JSON.stringify(entry)})`], { cwd: consumer }); check(`clean import ${entry}`, true); }
    catch (e) { check(`clean import ${entry}`, false, String(e.stderr || e.message).split('\n').find(l => /Error|Cannot/.test(l)) || ''); }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(rows.join('\n'));
console.log(failures.length ? `\nFAILED: ${failures.length} check(s)` : '\nall fresh-consumer checks passed');
process.exit(failures.length ? 1 : 0);
