#!/usr/bin/env node
// Runtime test for research-list.mjs against a fixture (no memory CLI needed).
import { spawnSync } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const run = (...args) => {
  const r = spawnSync(process.execPath, [join(here, 'research-list.mjs'), ...args], { encoding: 'utf-8' });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const fx = join(here, 'fixtures', 'research-records.json');

const all = run('--fixture', fx);
assert.equal(all.version, 1);
assert.deepEqual(all.records.map((r) => r.question), ['newer', 'older'], 'newest first, malformed skipped');
assert.equal(all.records[0].spentUsd, null, 'unknown spend stays null');
assert.equal(all.records[1].findings[0].grade, 'High', 'string-encoded value parsed');
assert.equal(run('--fixture', fx, '--limit', '1').records.length, 1, '--limit honoured');
assert.deepEqual(run('--fixture', join(here, 'fixtures', 'missing.json')), { version: 1, records: [] }, 'missing fixture is empty, not a crash');
console.log('research-list: 5 passed');
