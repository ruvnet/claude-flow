import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const from = process.env.RUFLO_MEMORY_RESOLVE_FROM;
const skip = !from && process.env.RUFLO_MEMORY_REQUIRED !== '1';
const versions = { memory: '3.0.5', ruvector: '0.2.41', core: '0.1.33', sqljs: '1.15.0' };
const record = (key, vector = [1, 0, 0], content = `saved ${key}`) => ({ key, content, vector });
function child(mode, database, namespace, input) {
  // Explicit test-only old-source selection; production CLI has no override.
  return spawnSync(process.execPath, [process.env.RUFLO_MEMORY_CLI_TEST_PATH || 'scripts/ecosystem-memory.mjs', mode, database, namespace], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    env: { ...process.env, NODE_TEST_CONTEXT: '' },
  });
}
function passed(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.deepEqual(report.versions, versions); assert.equal(report.implementation, 'native');
  return report;
}
async function fixture(t) {
  assert.ok(from, 'RUFLO_MEMORY_RESOLVE_FROM required');
  const folder = await mkdtemp(join(tmpdir(), 'memory-lifecycle-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  return join(folder, 'memory.sqlite');
}
const read = (database, namespace = 'project-a', vector = [1, 0, 0], k = 10) => passed(child('retrieve', database, namespace, { vector, k }));
const fence = entry => ({ key: entry.key, expectedId: entry.id, expectedVersion: entry.version });
async function rejectedUnchanged(database, mode, namespace, input, message) {
  const before = await readFile(database), result = child(mode, database, namespace, input);
  assert.equal(result.status, 1, result.stdout + result.stderr); assert.match(result.stderr, message);
  assert.deepEqual(await readFile(database), before, 'rejected mutation must not publish any bytes');
}

test('real update and delete survive restart with correct vector ranking, stable identity and namespace isolation', { skip }, async t => {
  const database = await fixture(t), content = `updated only by updater: ${randomUUID()}`;
  const writer = passed(child('write', database, 'project-a', { records: [record('target'), record('distractor', [0.8, 0.2, 0])] }));
  passed(child('write', database, 'project-b', { records: [record('target', [1, 0, 0], 'other namespace')] }));
  const original = read(database).results[0], other = read(database, 'project-b').results[0];
  assert.equal(original.id, writer.ids[0]); assert.equal(original.version, 1);
  const updater = passed(child('update', database, 'project-a', { records: [{ ...record('target', [0, 0, 1], content), ...fence(original), id: other.id, namespace: 'project-b', version: 999 }] }));
  assert.equal(updater.updated, 1); assert.equal(updater.persistence.committed, true);
  const updated = read(database, 'project-a', [0, 0, 1]).results[0];
  assert.equal(updated.content, content); assert.equal(updated.id, original.id); assert.equal(updated.version, 2);
  assert.equal(read(database).results[0].key, 'distractor', 'old vector must not remain in rebuilt index');
  assert.deepEqual(read(database, 'project-b').results[0], other);
  await rejectedUnchanged(database, 'update', 'project-a', { records: [{ ...record('target'), ...fence(original) }] }, /conflict/);
  await rejectedUnchanged(database, 'delete', 'project-a', { records: [fence(original)] }, /conflict/);
  const deleter = passed(child('delete', database, 'project-a', { records: [fence(updated)] }));
  assert.equal(deleter.deleted, 1); assert.equal(deleter.persistence.committed, true);
  const after = read(database, 'project-a', [0, 0, 1]);
  assert.equal(after.indexed, 1); assert.deepEqual(after.results.map(r => r.key), ['distractor']);
  assert.deepEqual(read(database, 'project-a', [0, 0, 1]).results, after.results);
  assert.deepEqual(read(database, 'project-b').results[0], other);
  t.diagnostic(JSON.stringify({ versions, platform: process.platform, arch: process.arch, writeMs: writer.elapsedMs, updateMs: updater.elapsedMs, deleteMs: deleter.elapsedMs, taskSuccess: true, generatedSemanticEmbeddings: false }));
});

test('cross-batch dimensional mismatch rejects before publishing and preserves retrievability', { skip }, async t => {
  const database = await fixture(t);
  passed(child('write', database, 'project-a', { records: [record('original')] }));
  await rejectedUnchanged(database, 'write', 'project-a', { records: [record('bad', [1, 0])] }, /dimensions/);
  assert.deepEqual(read(database).results.map(r => r.key), ['original']);
});

test('duplicate existing keys require explicit update rather than silently replacing saved identity', { skip }, async t => {
  const database = await fixture(t);
  passed(child('write', database, 'project-a', { records: [record('original')] }));
  const original = read(database).results[0];
  await rejectedUnchanged(database, 'write', 'project-a', { records: [record('original', [0, 1, 0], 'replacement')] }, /already exists/);
  assert.deepEqual(read(database).results[0], original);
});

test('missing, cross-namespace, stale and invalid mutation batches leave the entire database unchanged', { skip }, async t => {
  const database = await fixture(t);
  passed(child('write', database, 'project-a', { records: [record('a'), record('b')] }));
  passed(child('write', database, 'project-b', { records: [record('foreign')] }));
  const a = read(database).results.find(r => r.key === 'a'), foreign = read(database, 'project-b').results[0];
  const update = { ...record('a', [0, 1, 0]), ...fence(a) };
  for (const mode of ['update', 'delete']) {
    await rejectedUnchanged(database, mode, 'project-a', { records: [update, { ...record('missing'), expectedId: 'missing', expectedVersion: 1 }] }, /not found/);
    await rejectedUnchanged(database, mode, 'project-a', { records: [update, { ...record('foreign'), ...fence(foreign) }] }, /not found/);
    await rejectedUnchanged(database, mode, 'project-a', { records: [{ ...update, expectedVersion: 2 }] }, /conflict/);
    await rejectedUnchanged(database, mode, 'project-a', { records: [{ ...update, expectedId: 'wrong' }] }, /conflict/);
    await rejectedUnchanged(database, mode, 'project-a', { records: [{ ...update, expectedId: '' }] }, /expectedId/);
    await rejectedUnchanged(database, mode, 'project-a', { records: [{ ...update, expectedVersion: Number.MAX_SAFE_INTEGER }] }, /expectedVersion/);
    await rejectedUnchanged(database, mode, 'project-a', { records: [update, update] }, /Duplicate record keys/);
  }
  await rejectedUnchanged(database, 'update', 'project-a', { records: [{ ...update, vector: [1, 0] }] }, /dimensions/);
  assert.equal(read(database).results.find(r => r.key === 'a').content, 'saved a');
});

test('record identity prevents stale update or delete after deletion and recreation of the same key', { skip }, async t => {
  const database = await fixture(t);
  passed(child('write', database, 'project-a', { records: [record('same')] }));
  const old = read(database).results[0];
  passed(child('delete', database, 'project-a', { records: [fence(old)] }));
  passed(child('write', database, 'project-a', { records: [record('same', [1, 0, 0], 'recreated')] }));
  const current = read(database).results[0];
  assert.notEqual(current.id, old.id); assert.equal(current.version, old.version);
  for (const mode of ['update', 'delete']) await rejectedUnchanged(database, mode, 'project-a', { records: [{ ...record('same'), ...fence(old) }] }, /identity\/version conflict/);
  assert.deepEqual(read(database).results[0], current);
});

test('namespace capacity includes prior writes; explicit deletion frees capacity', { skip }, async t => {
  const database = await fixture(t);
  const seed = passed(child('write', database, 'project-a', { records: Array.from({ length: 1000 }, (_, i) => record(`k${i}`)) }));
  await rejectedUnchanged(database, 'write', 'project-a', { records: [record('overflow')] }, /namespace limit/);
  passed(child('delete', database, 'project-a', { records: [{ key: 'k0', expectedId: seed.ids[0], expectedVersion: 1 }] }));
  passed(child('write', database, 'project-a', { records: [record('replacement')] }));
  assert.equal(read(database, 'project-a', [1, 0, 0], 1).indexed, 1000);
});

test('update and delete require existing state and never create a missing database', { skip }, async t => {
  const database = await fixture(t);
  for (const mode of ['update', 'delete']) {
    const result = child(mode, database, 'project-a', { records: [{ ...record('absent'), expectedId: 'absent', expectedVersion: 1 }] });
    assert.equal(result.status, 1); assert.match(result.stderr, /ENOENT/);
    await assert.rejects(readFile(database), { code: 'ENOENT' });
  }
});

test('expired persisted keys remain protected from implicit replacement', { skip }, async t => {
  const database = await fixture(t);
  const seed = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const require = createRequire(process.env.RUFLO_MEMORY_RESOLVE_FROM);
    const backendPath = require.resolve('@claude-flow/memory/sqljs-backend');
    const { SqlJsBackend } = await import(pathToFileURL(backendPath));
    const { createDefaultEntry } = await import(pathToFileURL(require.resolve('@claude-flow/memory/types')));
    const backend = new SqlJsBackend({ databasePath: process.argv[1], autoPersistInterval: 0, wasmPath: createRequire(backendPath).resolve('sql.js/dist/sql-wasm.wasm') });
    await backend.initialize();
    try { await backend.store({ ...createDefaultEntry({ key: 'expired', content: 'historical', namespace: 'project-a' }), embedding: Float32Array.from([1, 0, 0]), expiresAt: 1 }); }
    finally { await backend.shutdown(); }
  `, database], { encoding: 'utf8', timeout: 20000, env: { ...process.env, NODE_TEST_CONTEXT: '' } });
  assert.equal(seed.status, 0, seed.stdout + seed.stderr);
  assert.equal(read(database).indexed, 0);
  await rejectedUnchanged(database, 'write', 'project-a', { records: [record('expired')] }, /already exists/);
});

test('versioned v2 starter completes six real operations in independent processes', { skip }, () => {
  assert.ok(from, 'RUFLO_MEMORY_RESOLVE_FROM required');
  const result = spawnSync(process.execPath, ['scripts/examples/persistent-memory-lifecycle-v2.mjs'], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024, env: { ...process.env, NODE_TEST_CONTEXT: '' },
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(report.taskSuccess, true); assert.equal(report.operations, 6); assert.deepEqual(report.versions, versions);
  // Check the demonstrated process sequence as well as the example's assertions.
  assert.deepEqual(report.steps.map(s => s.mode), ['write', 'retrieve', 'update', 'retrieve', 'delete', 'retrieve']);
  assert.equal(new Set(report.steps.map(s => s.pid)).size, 6);
});
