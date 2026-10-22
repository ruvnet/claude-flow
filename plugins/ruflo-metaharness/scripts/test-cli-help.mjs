#!/usr/bin/env node
// Hermetic CLI entry-point checks: no optional tools, network, or real memory writes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = ['audit-list', 'audit-trend', 'bench', 'bench-parse-mcp-scan', 'bench-recordpair-overhead',
  'bench-similarity', 'drift-from-history', 'evolve', 'genome', 'gepa', 'learn', 'mcp-scan', 'mint',
  'oia-audit', 'router-parallel-analyze', 'score', 'security-bench', 'similarity', 'threat-model'];
let root;
let entryDir;
let cwd;
let guard;
before(() => {
  root = mkdtempSync(join(tmpdir(), 'metaharness-help-'));
  entryDir = join(root, 'scripts');
  cwd = join(root, 'workspace');
  mkdirSync(cwd);
  cpSync(dirname(fileURLToPath(import.meta.url)), entryDir, { recursive: true });
  guard = join(root, 'guard.cjs');
  writeFileSync(guard, `
    const cp = require('node:child_process');
    const fs = require('node:fs');
    const append = fs.appendFileSync;
    const blocked = name => (...args) => {
      append(process.env.ATTEMPT_LOG, name + '\\n');
      throw new Error('test blocked side effect: ' + name);
    };
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[name] = blocked(name);
    for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'mkdtempSync', 'renameSync', 'unlinkSync', 'rmSync']) fs[name] = blocked(name);
    require('node:module').syncBuiltinESMExports();
  `);
});
after(() => rmSync(root, { recursive: true, force: true }));

function invoke(script, args) {
  const log = join(root, 'attempts');
  rmSync(log, { force: true });
  const result = spawnSync(process.execPath, ['--require', guard, join(entryDir, script + '.mjs'), ...args], {
    cwd, encoding: 'utf8', timeout: 3000,
    env: { ...process.env, HOME: root, USERPROFILE: root, ATTEMPT_LOG: log, NODE_OPTIONS: '' },
  });
  return { ...result, attempts: existsSync(log) ? readFileSync(log, 'utf8') : '' };
}

for (const script of scripts) {
  for (const flag of ['--help', '-h']) {
    test(`${script} ${flag} prints help before any side effects`, () => {
      const result = invoke(script, [flag]);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Usage:/);
      assert.equal(result.attempts, '', 'no subprocess or write may be attempted');
      assert.deepEqual(readdirSync(cwd), []);
    });
  }
  test(`${script} rejects an unknown flag without running`, () => {
    const result = invoke(script, ['--definitely-unknown']);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Unknown argument/);
    assert.equal(result.attempts, '');
  });
}
for (const args of [['--path'], ['--path', '--dry-run']]) test(`missing option value ${args.join(' ')} does not run`, () => {
  const result = invoke('oia-audit', args);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /requires a value/);
  assert.equal(result.attempts, '');
});
