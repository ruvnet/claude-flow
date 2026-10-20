// node --test tests/check-status-forwarding.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { check, violation } from '../scripts/check-status-forwarding.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/status-forwarding', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/check-status-forwarding.mjs', import.meta.url));
const allow = JSON.parse(readFileSync(new URL('../scripts/status-forwarding.allow.json', import.meta.url), 'utf8'));

test('the real tree forwards no status file into model context', () => {
  const { bad, sinks } = check(ROOT, allow);
  assert.ok(sinks > 0, 'scanned zero context-bearing modules');
  assert.deepEqual(bad, []);
});

test('the console only reads status files for display: its readers attach no model context', () => {
  // Proof for the empty allowlist: every console module that names a -mod/ path has no sink, so none needs an entry.
  for (const f of ['data/mods.ts', 'data/files.ts', 'data/agentdb-mod.ts', 'data/snapshot.ts', 'views/mods.ts']) {
    const src = readFileSync(`${ROOT}/plugins/ruflo-console/hooks/${f}`, 'utf8');
    assert.equal(violation(src), null, f);
    assert.doesNotMatch(src, /\b(?:context|instructions|additionalContext)\s*:/, `${f} attaches model context`);
  }
});

test('the bad fixture fails: context plus a neighbour status read', () => {
  const { bad } = check(FIXTURE, {});
  assert.equal(bad.length, 1);
  assert.match(bad[0].file, /ruflo-bad\/hooks\/register\.ts$/);
  const r = spawnSync(process.execPath, [SCRIPT, '--root', FIXTURE], { encoding: 'utf8' });
  assert.equal(r.status, 1);
});

test('an allowlist entry silences the fixture', () => {
  assert.deepEqual(check(FIXTURE, { 'ruflo-bad/hooks/register.ts': 'test' }).bad, []);
});

test('own-status writers and display readers are not flagged', () => {
  assert.equal(violation("import { STATUS_PATH } from './status'\nawait $.fs.write(STATUS_PATH, x)\nreturn { context: [a] }\nawait $.fs.read(p)"), null);
  assert.equal(violation("await $.fs.read('.claude-flow/x-mod/status.json')"), null); // no sink
  assert.match(violation("return { instructions: s }\nawait $.fs.read(`${r}/.claude-flow/x-mod/status.json`)"), /status-file path/);
});

test('an empty tree fails loud', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', ROOT + '/tests/fixtures/none'], { encoding: 'utf8' });
  assert.equal(r.status, 3);
});
