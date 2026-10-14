import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonMemoryBackend } from '../v3/@claude-flow/cli-core/src/memory/json-backend.ts';
async function fixture(run) { const dir = mkdtempSync(join(tmpdir(), 'json-memory-')); const path = join(dir, 'memory.json'); try { await run(new JsonMemoryBackend({ path }), path); } finally { rmSync(dir, { recursive: true, force: true }); } }
test('stored values and tags do not alias caller inputs', async () => fixture(async b => {
 const value = { text: 'original' }, tags = ['original']; await b.store('key', value, { tags }); value.text = 'changed'; tags.push('changed'); const entry = await b.retrieve('key'); assert.deepEqual(entry.value, { text: 'original' }); assert.deepEqual(entry.tags, ['original']);
}));
test('query result mutation cannot change persisted memory', async () => fixture(async b => {
 await b.store('key', { text: 'original' }); const rows = await b.list(); rows[0].value.text = 'changed'; assert.deepEqual((await b.retrieve('key')).value, { text: 'original' });
}));
test('serialization failure cannot create a phantom cached entry', async () => fixture(async (b, path) => {
 await b.store('old', 'preserved'); const before = readFileSync(path, 'utf8'); const circular = {}; circular.self = circular; await assert.rejects(b.store('failed', circular)); assert.equal(readFileSync(path, 'utf8'), before); assert.equal(await b.retrieve('failed'), null); assert.equal((await b.retrieve('old')).value, 'preserved');
}));
