#!/usr/bin/env node
// A disposable, versioned consumer example: every operation runs in a new process.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

if (!process.env.RUFLO_MEMORY_RESOLVE_FROM) throw new Error('RUFLO_MEMORY_RESOLVE_FROM required');
const directory = await mkdtemp(join(tmpdir(), 'ruflo-memory-v2-'));
const database = join(directory, 'memory.sqlite'), cli = fileURLToPath(new URL('../ecosystem-memory.mjs', import.meta.url));
const namespace = 'starter-v2', steps = [];
function call(mode, input) {
  const child = spawnSync(process.execPath, [cli, mode, database, namespace], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024,
    env: { ...process.env, NODE_TEST_CONTEXT: '' },
  });
  assert.equal(child.status, 0, child.stdout + child.stderr);
  const result = JSON.parse(child.stdout.trim().split('\n').at(-1));
  steps.push({ mode, pid: result.pid, elapsedMs: result.elapsedMs }); return result;
}
try {
  const initial = `original ${randomUUID()}`, revised = `revised ${randomUUID()}`;
  const writer = call('write', { records: [{ key: 'decision', content: initial, vector: [1, 0, 0] }] });
  const original = call('retrieve', { vector: [1, 0, 0] }).results[0];
  assert.equal(original.content, initial); assert.equal(original.id, writer.ids[0]); assert.equal(original.version, 1);
  call('update', { records: [{ key: original.key, expectedId: original.id, expectedVersion: original.version, content: revised, vector: [0, 1, 0] }] });
  const updated = call('retrieve', { vector: [0, 1, 0] }).results[0];
  assert.equal(updated.content, revised); assert.equal(updated.id, original.id); assert.equal(updated.version, 2);
  call('delete', { records: [{ key: updated.key, expectedId: updated.id, expectedVersion: updated.version }] });
  const empty = call('retrieve', { vector: [0, 1, 0] });
  assert.equal(empty.indexed, 0); assert.deepEqual(empty.results, []);
  assert.equal(new Set(steps.map(s => s.pid)).size, steps.length);
  console.log(JSON.stringify({ starter: 'persistent-memory-lifecycle-v2', versions: writer.versions, taskSuccess: true, operations: steps.length, steps, generatedSemanticEmbeddings: false, secureErasure: false }));
} finally {
  // Only this example's own disposable directory; never an existing user database.
  await rm(directory, { recursive: true, force: true });
}
