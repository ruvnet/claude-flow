import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, stat, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// Bounded, single-writer consumer composition. SQLite is authoritative; the
// native index is rebuilt from persisted, namespace-scoped embeddings each time.
// This does not assert crash durability or native memory -> RuVector integration.
export async function memoryWorkflow({ mode, databasePath, namespace, input, resolveFrom }) {
  if (!['write', 'retrieve'].includes(mode)) throw new Error('Expected write or retrieve');
  if (typeof namespace !== 'string' || !namespace.trim()) throw new Error('Namespace required');
  if (!resolveFrom) throw new Error('RUFLO_MEMORY_RESOLVE_FROM required');
  const require = createRequire(resolve(resolveFrom));
  const memoryPath = require.resolve('@claude-flow/memory/sqljs-backend');
  const memoryRequire = createRequire(memoryPath);
  const { SqlJsBackend } = await import(pathToFileURL(memoryPath).href);
  const { createDefaultEntry } = await import(pathToFileURL(require.resolve('@claude-flow/memory/types')).href);
  const vectorPath = require.resolve('ruvector');
  const ruvector = require(vectorPath);
  if (ruvector.getImplementationType() !== 'native') throw new Error('Real native RuVector required; stub/RVF is not this proof');
  const versions = {
    memory: JSON.parse(await readFile(join(dirname(memoryPath), '..', 'package.json'))).version,
    ruvector: require('ruvector/package.json').version,
    core: createRequire(vectorPath)('@ruvector/core/package.json').version,
    sqljs: JSON.parse(await readFile(join(dirname(memoryRequire.resolve('sql.js')), '..', 'package.json'))).version,
  };
  const validVector = vector => {
    if (!Array.isArray(vector) || vector.length < 2 || vector.length > 4096 ||
        vector.some(v => !Number.isFinite(v) || !Number.isFinite(Math.fround(v))) ||
        !vector.some(v => Math.fround(v) !== 0)) throw new Error('Expected finite nonzero vector, dimensions 2..4096');
    return Float32Array.from(vector);
  };
  const path = resolve(databasePath);
  if (mode === 'retrieve') {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Persisted database required');
    if (info.size > 64 * 1024 * 1024) throw new Error('Starter database exceeds 64 MiB');
    if ((await readFile(path)).subarray(0, 16).toString() !== 'SQLite format 3\0') throw new Error('Invalid SQLite database');
  }
  let entriesToWrite;
  if (mode === 'write') {
    if (!Array.isArray(input?.records) || !input.records.length || input.records.length > 1000) throw new Error('Expected 1..1000 records');
    // Validate the entire batch before opening or mutating the source of truth.
    entriesToWrite = input.records.map(record => {
      if (typeof record?.key !== 'string' || !record.key || typeof record.content !== 'string') throw new Error('Record key and content required');
      return { ...createDefaultEntry({ key: record.key, content: record.content, namespace }), embedding: validVector(record.vector) };
    });
    if (new Set(entriesToWrite.map(e => e.key)).size !== entriesToWrite.length) throw new Error('Duplicate record keys');
    if (new Set(entriesToWrite.map(e => e.embedding.length)).size !== 1) throw new Error('Mixed vector dimensions');
  }
  const memory = new SqlJsBackend({ databasePath: path, autoPersistInterval: 0,
    wasmPath: memoryRequire.resolve('sql.js/dist/sql-wasm.wasm') });
  let folder;
  await memory.initialize();
  try {
    if (mode === 'write') {
      await memory.bulkInsert(entriesToWrite);
      await memory.persist();
      return { mode, versions, implementation: 'native', written: entriesToWrite.length, ids: entriesToWrite.map(e => e.id) };
    }
    const vector = validVector(input.vector);
    const k = input.k ?? 1;
    if (!Number.isInteger(k) || k < 1 || k > 100) throw new Error('k must be 1..100');
    const entries = await memory.query({ type: 'hybrid', namespace, limit: 1001 });
    if (entries.length > 1000) throw new Error('Starter index limit exceeded; use a paginated production adapter');
    if (entries.some(e => !e.embedding || e.embedding.length !== vector.length)) throw new Error('Persisted embedding dimensions do not match query');
    for (const entry of entries) validVector(Array.from(entry.embedding));
    folder = await mkdtemp(join(tmpdir(), 'ruflo-memory-index-'));
    const index = new ruvector.VectorDb({ dimensions: vector.length, distanceMetric: 'Cosine',
      storagePath: join(folder, 'index.db'), hnswConfig: { m: 16, efConstruction: 100, efSearch: 100, maxElements: 1000 } });
    for (const entry of entries) await index.insert({ id: entry.id, vector: entry.embedding });
    if (await index.len() !== entries.length) throw new Error('Vector insertion count mismatch');
    const hits = entries.length ? await index.search({ vector, k: Math.min(k, entries.length) }) : [];
    const allowed = new Set(entries.map(e => e.id));
    const results = [];
    for (const hit of hits) {
      if (!allowed.has(hit.id) || !Number.isFinite(hit.score)) throw new Error('Invalid vector result');
      const entry = await memory.get(hit.id);
      if (!entry || entry.namespace !== namespace) throw new Error('Vector result has no matching scoped memory');
      results.push({ id: entry.id, key: entry.key, content: entry.content, namespace: entry.namespace, score: hit.score });
    }
    return { mode, versions, implementation: 'native', indexed: entries.length, results };
  } finally {
    await memory.shutdown();
    if (folder) await rm(folder, { recursive: true, force: true });
  }
}
