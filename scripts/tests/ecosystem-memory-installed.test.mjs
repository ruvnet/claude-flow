import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const from = process.env.RUFLO_MEMORY_RESOLVE_FROM;
const skip = !from && process.env.RUFLO_MEMORY_REQUIRED !== '1';
const versions = { memory: '3.0.5', ruvector: '0.2.41', core: '0.1.33', sqljs: '1.15.0' };
function child(mode, database, namespace, input, env = {}) {
  return spawnSync(process.execPath, ['scripts/ecosystem-memory.mjs', mode, database, namespace], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    env: { ...process.env, NODE_TEST_CONTEXT: '', ...env },
  });
}
function passed(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.deepEqual(report.versions, versions);
  assert.equal(report.implementation, 'native');
  return report;
}

test('real memory persists across process exits and native RuVector retrieves only scoped saved content', { skip }, async t => {
  assert.ok(from, 'RUFLO_MEMORY_RESOLVE_FROM required');
  const folder = await mkdtemp(join(tmpdir(), 'memory-consumer-'));
  const database = join(folder, 'memory.sqlite');
  const content = `saved only by writer: ${randomUUID()}`;
  try {
    const writer = passed(child('write', database, 'project-a', { records: [
      { key: 'target', content, vector: [0.9, 0.1, 0] },
      { key: 'distractor', content: 'different direction', vector: [0, 1, 0] },
    ] }));
    assert.equal(writer.written, 2);
    assert.equal((await readFile(database)).subarray(0, 16).toString(), 'SQLite format 3\0');
    passed(child('write', database, 'project-b', { records: [{ key: 'private', content: 'other namespace', vector: [1, 0, 0] }] }));
    // Reader is a separate, already-restarted process; receives no content or IDs.
    const reader = passed(child('retrieve', database, 'project-a', { vector: [1, 0, 0], k: 2 }));
    assert.notEqual(reader.pid, writer.pid);
    assert.equal(reader.indexed, 2);
    assert.deepEqual(reader.results.map(r => r.key), ['target', 'distractor']);
    assert.equal(reader.results[0].content, content);
    assert.equal(reader.results[0].id, writer.ids[0]);
    assert.ok(reader.results.every(r => r.namespace === 'project-a'));
    const again = passed(child('retrieve', database, 'project-a', { vector: [1, 0, 0], k: 2 }));
    assert.deepEqual(again.results, reader.results);
    const empty = passed(child('retrieve', database, 'absent-project', { vector: [1, 0, 0] }));
    assert.equal(empty.indexed, 0); assert.deepEqual(empty.results, []);
    t.diagnostic(JSON.stringify({ versions, platform: process.platform, arch: process.arch, node: process.version,
      writeMs: writer.elapsedMs, restartRetrieveMs: reader.elapsedMs, repeatedRetrieveMs: again.elapsedMs,
      databaseBytes: (await readFile(database)).length, taskSuccess: true, crashDurabilityTested: false }));
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('memory workflow rejects missing/corrupt state, invalid dimensions, and missing package resolution', { skip }, async () => {
  assert.ok(from, 'RUFLO_MEMORY_RESOLVE_FROM required');
  const folder = await mkdtemp(join(tmpdir(), 'memory-failure-'));
  const database = join(folder, 'memory.sqlite');
  try {
    const invalidWrite = child('write', database, 'p', { records: [{ key: 'bad', content: 'bad', vector: [0, 0] }] });
    assert.equal(invalidWrite.status, 1);
    await assert.rejects(readFile(database), { code: 'ENOENT' });
    assert.match(child('retrieve', database, 'p', { vector: [1, 0, 0] }).stderr, /ENOENT/);
    const oversized = await open(database, 'wx');
    try { await oversized.truncate(64 * 1024 * 1024 + 1); } finally { await oversized.close(); }
    const bounded = child('retrieve', database, 'p', { vector: [1, 0, 0] });
    assert.equal(bounded.status, 1); assert.match(bounded.stderr, /exceeds 64 MiB/);
    await writeFile(database, 'not a database');
    assert.match(child('retrieve', database, 'p', { vector: [1, 0, 0] }).stderr, /Invalid SQLite/);
    await rm(database);
    passed(child('write', database, 'p', { records: [{ key: 'a', content: 'retained', vector: [1, 0, 0] }] }));
    assert.match(child('retrieve', database, 'p', { vector: [1, 0] }).stderr, /dimensions/);
    assert.match(child('retrieve', database, 'p', { vector: [0, 0, 0] }).stderr, /nonzero vector/);
    assert.match(child('retrieve', database, 'p', { vector: [1, 0, 0] }, { RUFLO_MEMORY_RESOLVE_FROM: '' }).stderr, /RESOLVE_FROM required/);
    const nonNative = child('retrieve', database, 'p', { vector: [1, 0, 0] }, { RUVECTOR_BACKEND: 'rvf' });
    assert.equal(nonNative.status, 1, nonNative.stdout + nonNative.stderr);
    assert.match(nonNative.stderr, /Real native RuVector required|@ruvector\/rvf is not installed/);
    assert.equal(passed(child('retrieve', database, 'p', { vector: [1, 0, 0] })).results[0].content, 'retained');
  } finally { await rm(folder, { recursive: true, force: true }); }
});
