import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as nodeModule from 'node:module';

function transpile(source) {
  if (typeof nodeModule.stripTypeScriptTypes === 'function') return nodeModule.stripTypeScriptTypes(source);
  // Node 20 has no built-in stripping; use the repository dev dependency.
  const ts = nodeModule.createRequire(import.meta.url)('typescript');
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
}

const source = readFileSync(new URL('../../v3/@claude-flow/cli/src/ruvector/vector-db.ts', import.meta.url), 'utf8');
function runProbe(backend, probe) {
  const dir = mkdtempSync(join(tmpdir(), 'ruflo-vector-adapter-'));
  try {
    // Execute the actual adapter source in an isolated consumer with an async
    // dependency fixture. Only the unrelated embedding policy import is stubbed.
    const js = transpile(source.replace("import { enforceNoStub } from '../memory/embedding-policy.js';", 'const enforceNoStub = () => {};'));
    writeFileSync(join(dir, 'adapter.mjs'), js);
    if (backend) {
      mkdirSync(join(dir, 'node_modules/ruvector'), { recursive: true });
      writeFileSync(join(dir, 'node_modules/ruvector/package.json'), JSON.stringify({ name: 'ruvector', type: 'module', exports: './index.js' }));
      writeFileSync(join(dir, 'node_modules/ruvector/index.js'), backend);
    }
    writeFileSync(join(dir, 'probe.mjs'), `import assert from 'node:assert/strict'; import { createVectorDB, getStatus } from './adapter.mjs'; ${probe}`);
    const result = spawnSync(process.execPath, [join(dir, 'probe.mjs')], { encoding: 'utf8', env: { ...process.env, NODE_PATH: '' } });
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const backend = `export class VectorDB {
 rows = new Map();
 async insert(row) { await new Promise(r => setTimeout(r, 10)); if (row.id === 'bad') throw Error('insert failure'); this.rows.set(row.id, row); }
 async delete(id) { await new Promise(r => setTimeout(r, 10)); if (id === 'bad') throw Error('delete failure'); return this.rows.delete(id); }
 async len() { return this.rows.size; }
 async search() { return [...this.rows.values()].map(row => ({ id: row.id, score: 1, metadata: row.metadata })); }
}`;

test('native async mutations complete before callers continue; errors propagate', () => {
  runProbe(backend, `
    const db = await createVectorDB(2);
    await db.insert(new Float32Array([1, 0]), 'one', { origin: 'consumer' });
    assert.equal(await db.size(), 1);
    assert.equal((await db.search(new Float32Array([1, 0])))[0].metadata.origin, 'consumer');
    await assert.rejects(db.insert(new Float32Array([1, 0]), 'bad'), /insert failure/);
    await assert.rejects(db.remove('bad'), /delete failure/);
    assert.equal(await db.remove('one'), true);
    assert.equal(await db.size(), 0);
    assert.equal(await db.remove('missing'), false);
  `);
});
test('missing native package retains working JS mutations and clear', () => {
  runProbe(null, `
    const db = await createVectorDB(2);
    assert.equal(getStatus().backend, 'fallback');
    await db.insert(new Float32Array([1, 0]), 'one');
    assert.equal(await db.size(), 1);
    assert.equal(await db.remove('missing'), false);
    await db.clear();
    assert.equal(await db.size(), 0);
  `);
});
