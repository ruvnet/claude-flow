import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, randomInt } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { memoryWorkflow } from '../lib/ecosystem-memory-workflow.mjs';

const resolveFrom = process.env.RUFLO_MEMORY_RESOLVE_FROM;
const harnessResolveFrom = process.env.RUFLO_HARNESS_RESOLVE_FROM;
const skip = (!resolveFrom || !harnessResolveFrom) && process.env.RUFLO_REQUIRE_HARNESS !== '1';
const script = fileURLToPath(new URL('../examples/persistent-agent-memory-v1.mjs', import.meta.url));
const hash = text => createHash('sha256').update(text).digest('hex');
const versions = { memory: '3.0.5', ruvector: '0.2.41', core: '0.1.33', sqljs: '1.15.0' };
function worker(databasePath, namespace, mode, input, allowExecution = true, env = {}) {
  return spawnSync(process.execPath, [script, '--worker'], { input: JSON.stringify({ mode, databasePath, namespace, input, allowExecution }),
    encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024, env: { ...process.env, NODE_TEST_CONTEXT: '', ...env } });
}
function report(child) {
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.equal(result.harnessVersion, '0.2.0'); assert.equal(result.receiptsValid, true);
  assert.equal(result.totalCostUsd, 0); assert.equal(result.llmUsed, false);
  return result;
}
async function fixture(run) {
  assert.ok(resolveFrom, 'RUFLO_MEMORY_RESOLVE_FROM required');
  assert.ok(harnessResolveFrom, 'RUFLO_HARNESS_RESOLVE_FROM required');
  const directory = await mkdtemp(join(tmpdir(), 'agent-memory-test-'));
  try { await run(join(directory, 'memory.sqlite')); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
test('real HarnessKernel executes, persists, restarts and consumes native vector-retrieved task output', { skip }, async t => fixture(async database => {
  const values = [randomInt(1, 1000), randomInt(1, 1000), randomInt(1, 1000)], expectedValue = values[0] + values[1] + values[2];
  const first = report(worker(database, 'project-a', 'first', { values, expectedValue }));
  assert.equal(first.taskSuccess, true); assert.deepEqual(first.versions, versions);
  assert.deepEqual(first.invocations, ['sum-inputs']); assert.deepEqual(first.operations, [{ operation: 'write' }]);
  const second = report(worker(database, 'project-a', 'second', { discount: 7, expectedValue: expectedValue - 7, expectedDigest: hash(JSON.stringify(values)) }));
  assert.equal(second.taskSuccess, true); assert.deepEqual(second.versions, versions); assert.notEqual(first.pid, second.pid);
  assert.deepEqual(second.operations, [{ operation: 'retrieve', indexed: 2 }, { operation: 'write' }]);
  assert.equal(second.result.value, expectedValue - 7); assert.equal(second.retrievedRecord.key, 'first-result');
  assert.deepEqual(second.result.sourceRecord, { id: second.retrievedRecord.id, version: 1 });
  const persisted = await memoryWorkflow({ mode: 'retrieve', databasePath: database, namespace: 'project-a', resolveFrom, input: { vector: [0, 0, 1] } });
  assert.equal(persisted.results[0].key, 'second-result'); assert.deepEqual(JSON.parse(persisted.results[0].content), second.result);
  t.diagnostic(JSON.stringify({ firstPid: first.pid, secondPid: second.pid, firstMs: first.elapsedMs, secondMs: second.elapsedMs, versions, harness: '0.2.0', taskSuccess: true }));
}));
test('default-deny policy invokes no worker and never changes persisted memory', { skip }, async () => fixture(async database => {
  report(worker(database, 'p', 'first', { values: [1, 2, 3], expectedValue: 6 }));
  const before = hash(await readFile(database));
  const denied = report(worker(database, 'p', 'first', { values: [9, 8, 7], expectedValue: 24 }, false));
  assert.equal(denied.taskSuccess, false); assert.deepEqual(denied.invocations, []); assert.deepEqual(denied.operations, []);
  assert.equal(denied.steps[0].status, 'gated'); assert.equal(hash(await readFile(database)), before);
}));
test('failed fixed-oracle verification does not persist output or retry the local task', { skip }, async () => fixture(async database => {
  report(worker(database, 'p', 'first', { values: [1, 2, 3], expectedValue: 6 }));
  const before = hash(await readFile(database));
  const rejected = report(worker(database, 'p', 'first', { values: [9, 8, 7], expectedValue: 999 }));
  assert.equal(rejected.taskSuccess, false); assert.deepEqual(rejected.invocations, ['sum-inputs']); assert.deepEqual(rejected.operations, []);
  assert.deepEqual(rejected.steps, [{ status: 'failed', attempts: 0 }]); assert.equal(hash(await readFile(database)), before);
}));
test('restart refuses absent or wrong-namespace results and invalid bounded inputs', { skip }, async () => fixture(async database => {
  const secondInput = { discount: 1, expectedValue: 5, expectedDigest: hash('[1,2,3]') };
  assert.equal(worker(database, 'p', 'second', secondInput).status, 1);
  await assert.rejects(readFile(database), { code: 'ENOENT' });
  assert.match(worker(database, 'p', 'first', { values: [1, 2, -1], expectedValue: 2 }).stderr, /bounded nonnegative integers/);
  report(worker(database, 'p', 'first', { values: [1, 2, 3], expectedValue: 6 }));
  const before = hash(await readFile(database));
  const wrong = worker(database, 'other-project', 'second', secondInput);
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /Persisted first task result not found/);
  assert.equal(hash(await readFile(database)), before);
}));
test('missing installed resolver, duplicate task writes and second-task oracle failures preserve state', { skip }, async () => fixture(async database => {
  const initial = { values: [1, 2, 3], expectedValue: 6 };
  assert.equal(worker(database, 'p', 'first', initial, true, { RUFLO_HARNESS_RESOLVE_FROM: '' }).status, 1);
  assert.equal(worker(database, 'p', 'first', initial, true, { RUFLO_MEMORY_RESOLVE_FROM: '' }).status, 1);
  await assert.rejects(readFile(database), { code: 'ENOENT' });
  report(worker(database, 'p', 'first', initial));
  const before = hash(await readFile(database));
  const duplicate = worker(database, 'p', 'first', initial);
  assert.equal(duplicate.status, 1); assert.match(duplicate.stderr, /Record key already exists/);
  assert.equal(hash(await readFile(database)), before);
  const rejected = report(worker(database, 'p', 'second', { discount: 1, expectedValue: 999, expectedDigest: hash('[1,2,3]') }));
  assert.equal(rejected.taskSuccess, false); assert.deepEqual(rejected.invocations, ['use-saved-total']);
  assert.deepEqual(rejected.operations, [{ operation: 'retrieve', indexed: 2 }]);
  assert.equal(hash(await readFile(database)), before);
}));
test('second-task policy denial may retrieve but invokes no worker and never writes memory', { skip }, async () => fixture(async database => {
  report(worker(database, 'p', 'first', { values: [1, 2, 3], expectedValue: 6 }));
  const before = hash(await readFile(database));
  const denied = report(worker(database, 'p', 'second', { discount: 1, expectedValue: 5, expectedDigest: hash('[1,2,3]') }, false));
  assert.equal(denied.taskSuccess, false); assert.deepEqual(denied.invocations, []);
  assert.deepEqual(denied.operations, [{ operation: 'retrieve', indexed: 2 }]);
  assert.equal(denied.steps[0].status, 'gated'); assert.equal(hash(await readFile(database)), before);
}));
test('second-task wrong source digest rejects an otherwise correct result without writing', { skip }, async () => fixture(async database => {
  report(worker(database, 'p', 'first', { values: [1, 2, 3], expectedValue: 6 }));
  const before = hash(await readFile(database));
  const rejected = report(worker(database, 'p', 'second', { discount: 1, expectedValue: 5, expectedDigest: hash('wrong-source') }));
  assert.equal(rejected.taskSuccess, false); assert.deepEqual(rejected.invocations, ['use-saved-total']);
  assert.deepEqual(rejected.operations, [{ operation: 'retrieve', indexed: 2 }]);
  assert.equal(hash(await readFile(database)), before);
}));
test('unqualified memory version is rejected before import or mutation using isolated metadata fixture', { skip }, async () => fixture(async database => {
  report(worker(database, 'p', 'first', { values: [1, 2, 3], expectedValue: 6 }));
  const before = hash(await readFile(database));
  // Synthetic metadata only tests the guard; it is not an interoperability or
  // release fixture. Real installed source remains untouched.
  const directory = await mkdtemp(join(tmpdir(), 'agent-version-guard-'));
  try {
    const consumer = createRequire(resolve(resolveFrom));
    const fakeMemory = join(directory, 'node_modules', '@claude-flow', 'memory');
    await mkdir(join(fakeMemory, 'dist'), { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"private":true}');
    await writeFile(join(fakeMemory, 'package.json'), JSON.stringify({ name: '@claude-flow/memory', version: '0.0.0-unqualified', type: 'module', exports: { './sqljs-backend': './dist/sqljs-backend.js' } }));
    await writeFile(join(fakeMemory, 'dist', 'sqljs-backend.js'), "throw new Error('Unqualified backend must never import');\n");
    await symlink(dirname(dirname(consumer.resolve('ruvector'))), join(directory, 'node_modules', 'ruvector'), 'dir');
    const memoryRequire = createRequire(consumer.resolve('@claude-flow/memory/sqljs-backend'));
    await symlink(dirname(dirname(memoryRequire.resolve('sql.js'))), join(directory, 'node_modules', 'sql.js'), 'dir');
    const rejected = worker(database, 'p', 'first', { values: [3, 4, 5], expectedValue: 12 }, true,
      { RUFLO_MEMORY_RESOLVE_FROM: join(directory, 'package.json') });
    assert.equal(rejected.status, 1); assert.match(rejected.stderr, /Unqualified memory dependency versions/);
    assert.doesNotMatch(rejected.stderr, /Unqualified backend must never import/);
    assert.equal(hash(await readFile(database)), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
}));
test('versioned starter completes two separate task processes and saved-result verification', { skip }, () => {
  assert.ok(resolveFrom && harnessResolveFrom, 'Both installed consumer resolvers required');
  const child = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024, env: process.env });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(child.stdout.trim().split('\n').at(-1));
  assert.equal(result.taskSuccess, true); assert.equal(result.finalIndexed, 3);
  assert.notEqual(result.first.pid, result.second.pid); assert.equal(result.llmUsed, false);
});
