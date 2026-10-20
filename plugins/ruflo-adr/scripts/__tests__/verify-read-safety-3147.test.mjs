import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const verify = resolve(dirname(fileURLToPath(import.meta.url)), '../verify.mjs');

function runVerifier(mode, format = 'json', extraEnv = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ruflo-adr-verify-'));
  const bin = join(root, 'bin');
  const project = join(root, 'project');
  const calls = join(root, 'calls.jsonl');
  mkdirSync(bin);
  mkdirSync(project);
  if (mode !== 'spawn-error') {
    const fake = join(bin, 'npx');
    writeFileSync(fake, `#!${process.execPath}
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
const ns = args.find((a) => a.startsWith('--namespace='))?.split('=')[1];
const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || 20);
appendFileSync(process.env.FAKE_CALLS, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
if (process.env.FAKE_MODE === 'nonzero' && ns === 'adr-patterns') {
  console.error('database unreadable'); process.exit(7);
}
if (process.env.FAKE_MODE === 'malformed' && ns === 'adr-patterns') {
  console.log('warning\\n[]'); process.exit(0);
}
if (process.env.FAKE_MODE === 'nonarray' && ns === 'adr-patterns') {
  console.log('{}'); process.exit(0);
}
if (process.env.FAKE_MODE === 'badrow' && ns === 'adr-patterns') {
  console.log('[{}]'); process.exit(0);
}
if (process.env.FAKE_MODE === 'wrongns' && ns === 'adr-patterns') {
  console.log(JSON.stringify([{ key: 'ADR-001', namespace: 'other' }])); process.exit(0);
}
if (process.env.FAKE_MODE === 'signal' && ns === 'adr-patterns') process.kill(process.pid, 'SIGTERM');
if (process.env.FAKE_MODE === 'timeout' && ns === 'adr-patterns') {
  setTimeout(() => {}, 10_000);
}
let rows = [];
if (process.env.FAKE_MODE === 'late-cycle') {
  rows = ns === 'adr-patterns'
    ? Array.from({ length: 30 }, (_, i) => ({ key: 'ADR-' + String(i + 1).padStart(3, '0'), namespace: ns }))
    : [
      ...Array.from({ length: 25 }, (_, i) => ({ key: 'related:ADR-001->ADR-' + String(i + 2).padStart(3, '0'), namespace: ns })),
      { key: 'supersedes:ADR-025->ADR-026', namespace: ns },
      { key: 'supersedes:ADR-026->ADR-025', namespace: ns },
    ];
}
if (process.env.FAKE_MODE === 'over-cap' && ns === 'adr-patterns') {
  rows = Array.from({ length: 10_001 }, (_, i) => ({ key: 'ADR-' + i, namespace: ns }));
}
if (process.env.FAKE_MODE === 'bad-edge' && ns === 'adr-edges') {
  rows = [{ key: 'broken edge', namespace: ns }];
}
console.log(JSON.stringify(rows.slice(0, limit)));
`);
    chmodSync(fake, 0o755);
  }
  const result = spawnSync(process.execPath, [verify], {
    cwd: root,
    env: {
      ...process.env,
      PATH: mode === 'spawn-error' ? bin : `${bin}:${process.env.PATH || ''}`,
      ADR_ROOT: project,
      VERIFY_FORMAT: format,
      FAKE_MODE: mode,
      FAKE_CALLS: calls,
      // #3558: pin the npx shim — a built checkout or an installed ruflo on
      // PATH would otherwise be preferred over it (lib/ruflo-cli.mjs).
      RUFLO_PLUGIN_SKIP_LOCAL_CLI: '1',
      RUFLO_PLUGIN_SKIP_PATH_CLI: '1',
      ...extraEnv,
    },
    encoding: 'utf8',
    timeout: 10_000,
  });
  const callLog = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse) : [];
  const canonicalProject = realpathSync(project);
  rmSync(root, { recursive: true, force: true });
  assert.equal(result.error, undefined);
  return { ...result, calls: callLog, project: canonicalProject };
}

test('a successful, complete empty graph remains valid and uses the writer CLI and ADR_ROOT', () => {
  const result = runVerifier('empty', 'json', { CLI_CORE: '1' });
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.adrCount, 0);
  assert.equal(report.edgeCount, 0);
  assert.equal(result.calls.length, 2);
  for (const call of result.calls) {
    assert.equal(call.cwd, result.project);
    assert.equal(call.args[0], '@claude-flow/cli@latest');
    assert.ok(call.args.includes('--limit=10001'));
  }
});

for (const format of ['json', 'markdown']) {
  test(`${format}: a failed read cannot certify an empty graph`, () => {
    const result = runVerifier('nonzero', format);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /adr-patterns/);
    assert.match(result.stdout, /database unreadable/);
    assert.doesNotMatch(result.stdout, /ADRs in adr-patterns/);
    if (format === 'json') {
      const report = JSON.parse(result.stdout);
      assert.equal(report.readErrors[0].namespace, 'adr-patterns');
      assert.equal(report.adrCount, undefined);
    }
  });
}

for (const mode of ['spawn-error', 'signal', 'timeout', 'malformed', 'nonarray', 'badrow', 'wrongns', 'over-cap', 'bad-edge']) {
  test(`${mode} is an incomplete or invalid read, never a healthy graph`, () => {
    const result = runVerifier(mode, 'json', mode === 'timeout' ? { ADR_VERIFY_TIMEOUT_MS: '100' } : {});
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.ok(report.readErrors.length > 0);
    assert.equal(report.adrCount, undefined);
  });
}

test('a supersede cycle beyond the CLI default 20 rows is detected', () => {
  const result = runVerifier('late-cycle');
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.adrCount, 30);
  assert.equal(report.edgeCount, 27);
  assert.ok(report.cycles.length >= 1);
});
