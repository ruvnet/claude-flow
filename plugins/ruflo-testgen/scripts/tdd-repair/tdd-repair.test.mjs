// node:test — run: node --test plugins/ruflo-testgen/scripts/tdd-repair/tdd-repair.test.mjs
// A fake `claude` on PATH stands in for the headless repair agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'tdd-repair.mjs');
const TEST_SRC = 'const f=require("./src");if(f()!==2)process.exit(1);\n';

function fixture(fakeClaudeBody) {
  const root = mkdtempSync(join(tmpdir(), 'tdd-repair-'));
  const repo = join(root, 'repo');
  const bin = join(root, 'bin');
  mkdirSync(repo); mkdirSync(bin);
  writeFileSync(join(repo, 'src.js'), 'module.exports=()=>1;\n');
  writeFileSync(join(repo, 't.js'), TEST_SRC);
  const git = (...a) => spawnSync('git', a, { cwd: repo });
  git('init', '-q'); git('config', 'user.email', 'a@b.c'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'init');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\n${fakeClaudeBody}\necho '{"result":"ok","usage":{"cost_usd":0.01}}'\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const run = () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--repo', repo, '--test', 't.js', '--test-command', 'node t.js', '--confirm'], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, encoding: 'utf8',
    });
    return { status: r.status, json: JSON.parse(r.stdout) };
  };
  return { repo, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('an attempt that edits the test is restored and does not count as a repair', { skip: process.platform === 'win32' }, () => {
  const f = fixture("printf 'process.exit(0);\\n' > t.js");
  try {
    const { status, json } = f.run();
    assert.equal(json.success, false);
    assert.equal(json.data.reason, 'test-file-modified');
    assert.equal(status, 1);
    assert.equal(readFileSync(join(f.repo, 't.js'), 'utf8'), TEST_SRC);
  } finally { f.cleanup(); }
});

test('a real fix to the source is accepted', { skip: process.platform === 'win32' }, () => {
  const f = fixture("printf 'module.exports=()=>2;\\n' > src.js");
  try {
    const { status, json } = f.run();
    assert.equal(json.success, true);
    assert.equal(status, 0);
    assert.equal(readFileSync(join(f.repo, 't.js'), 'utf8'), TEST_SRC);
  } finally { f.cleanup(); }
});
