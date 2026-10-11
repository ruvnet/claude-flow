import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonMemoryBackend } from '../v3/@claude-flow/cli-core/src/memory/json-backend.ts';
test('invalid entries containers are rejected before replacing the memory file', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'json-envelope-')); const path = join(dir, 'memory.json');
 try { for (const entries of [[], 'invalid', null]) { const content = JSON.stringify({ version: 1, backend: 'json', entries }); writeFileSync(path, content); const b = new JsonMemoryBackend({ path }); await assert.rejects(b.store('new', 'value'), /entries must be a JSON object/); assert.equal(readFileSync(path, 'utf8'), content); } } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('valid empty entries containers support normal persistence', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'json-envelope-')); const path = join(dir, 'memory.json');
 try { writeFileSync(path, JSON.stringify({ version: 1, backend: 'json', entries: {} })); const b = new JsonMemoryBackend({ path }); await b.store('new', 'value'); assert.equal((await b.retrieve('new')).value, 'value'); } finally { rmSync(dir, { recursive: true, force: true }); }
});
