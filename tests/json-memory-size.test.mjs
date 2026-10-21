import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonMemoryBackend } from '../v3/@claude-flow/cli-core/src/memory/json-backend.ts';
for (const value of ['plain ASCII', '東京🙂'.repeat(100)]) test(`sizeBytes matches actual UTF-8 file size for ${value.slice(0, 8)}`, async () => {
 const dir = mkdtempSync(join(tmpdir(), 'json-size-')); const path = join(dir, 'memory.json');
 try { const b = new JsonMemoryBackend({ path }); await b.store('key', value); assert.equal((await b.stats()).sizeBytes, statSync(path).size); } finally { rmSync(dir, { recursive: true, force: true }); }
});
