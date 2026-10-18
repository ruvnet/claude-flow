import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { withMemorySnapshot } from './ecosystem-memory-snapshot.mjs';

// Bounded, single-writer consumer composition. SQLite is authoritative; the
// native index is rebuilt from persisted, namespace-scoped embeddings each time.
// Snapshot isolation prevents reader shutdown from overwriting newer commits.
// Atomic replacement is not a power-loss or native package durability guarantee.
export async function memoryWorkflow({ mode, databasePath, namespace, input, resolveFrom, checkpoint }) {
  if (!['write', 'retrieve', 'update', 'delete'].includes(mode)) throw new Error('Expected write, retrieve, update or delete');
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
    if (!Array.isArray(vector) || vector.length < 2 || vector.length > 4096) throw new Error('Expected finite nonzero vector, dimensions 2..4096');
    // Array#some skips holes, but Float32Array.from turns them into NaN.
    // Snapshot every element before validation so sparse direct-API inputs
    // cannot publish an embedding that makes later retrieval fail.
    const values = Array.from(vector);
    if (values.some(v => !Number.isFinite(v) || !Number.isFinite(Math.fround(v))) ||
        !values.some(v => Math.fround(v) !== 0)) throw new Error('Expected finite nonzero vector, dimensions 2..4096');
    return Float32Array.from(values);
  };
  const vector = mode === 'retrieve' ? validVector(input?.vector) : null;
  const k = input?.k ?? 1;
  if (mode === 'retrieve' && (!Number.isInteger(k) || k < 1 || k > 100)) throw new Error('k must be 1..100');
  let entriesToWrite;
  if (mode !== 'retrieve') {
    if (!Array.isArray(input?.records) || !input.records.length || input.records.length > 1000) throw new Error('Expected 1..1000 records');
    // Validate the entire batch before opening or mutating the source of truth.
    entriesToWrite = input.records.map(record => {
      if (typeof record?.key !== 'string' || !record.key) throw new Error('Record key required');
      if (mode !== 'write' && (!Number.isSafeInteger(record.expectedVersion) || record.expectedVersion < 1 || record.expectedVersion >= Number.MAX_SAFE_INTEGER)) throw new Error('expectedVersion must be a positive safe integer below MAX_SAFE_INTEGER');
      if (mode !== 'write' && (typeof record.expectedId !== 'string' || !record.expectedId)) throw new Error('expectedId required');
      if (mode === 'delete') return { key: record.key, expectedVersion: record.expectedVersion, expectedId: record.expectedId };
      if (typeof record.content !== 'string') throw new Error('Record content required');
      return { ...createDefaultEntry({ key: record.key, content: record.content, namespace }), embedding: validVector(record.vector), expectedVersion: record.expectedVersion, expectedId: record.expectedId };
    });
    if (new Set(entriesToWrite.map(e => e.key)).size !== entriesToWrite.length) throw new Error('Duplicate record keys');
    if (mode !== 'delete' && new Set(entriesToWrite.map(e => e.embedding.length)).size !== 1) throw new Error('Mixed vector dimensions');
  }
  return withMemorySnapshot({ databasePath, write: mode !== 'retrieve', requireExisting: mode === 'update' || mode === 'delete', checkpoint }, async workingPath => {
  const memory = new SqlJsBackend({ databasePath: workingPath, autoPersistInterval: 0,
    wasmPath: memoryRequire.resolve('sql.js/dist/sql-wasm.wasm') });
  let folder;
  await memory.initialize();
  try {
    if (mode !== 'retrieve') {
      // Include expired rows: they still occupy the backend's unique key index.
      // Preflight the entire batch under the writer lease before any mutation.
      const existing = await memory.query({ type: 'hybrid', namespace, includeExpired: true, limit: 1001 });
      if (existing.length > 1000) throw new Error('Starter namespace limit exceeded; use a paginated production adapter');
      if (existing.some(e => e.namespace !== namespace)) throw new Error('Mutation query escaped namespace');
      const byKey = new Map(existing.map(e => [e.key, e]));
      if (byKey.size !== existing.length) throw new Error('Ambiguous persisted keys');
      for (const entry of entriesToWrite) {
        const target = byKey.get(entry.key);
        if (mode === 'write') {
          if (target) throw new Error('Record key already exists; use explicit update');
        } else {
          if (!target) throw new Error('Record key not found in namespace');
          if (target.id !== entry.expectedId || target.version !== entry.expectedVersion) throw new Error('Record identity/version conflict; retrieve current state before retrying');
        }
      }
      if (mode === 'write' && existing.length + entriesToWrite.length > 1000) throw new Error('Starter namespace limit exceeded; maximum 1000 records');
      if (mode !== 'delete') {
        const dimensions = entriesToWrite[0].embedding.length;
        for (const entry of existing) {
          if (!entry.embedding || entry.embedding.length !== dimensions) throw new Error('Persisted embedding dimensions do not match mutation');
          validVector(Array.from(entry.embedding));
        }
      }
      const ids = [], records = [];
      if (mode === 'write') {
        await memory.bulkInsert(entriesToWrite);
        ids.push(...entriesToWrite.map(e => e.id));
      } else {
        for (const entry of entriesToWrite) {
          const target = byKey.get(entry.key);
          if (mode === 'update') {
            // Never forward caller-controlled ID, namespace or arbitrary metadata.
            const updated = await memory.update(target.id, { content: entry.content, embedding: entry.embedding });
            if (!updated || updated.id !== target.id || updated.namespace !== namespace || updated.key !== entry.key || updated.version !== entry.expectedVersion + 1) throw new Error('Backend update contract mismatch');
            records.push({ key: updated.key, id: updated.id, version: updated.version });
          } else {
            // 3.0.5 get(missingId) can return a truthy empty row; scoped query
            // is the inspected backend's reliable absence check.
            if (!await memory.delete(target.id) || (await memory.query({ type: 'hybrid', namespace, key: entry.key, includeExpired: true, limit: 1 })).length) throw new Error('Backend delete contract mismatch');
            records.push({ key: entry.key, id: target.id, deletedVersion: target.version });
          }
        }
      }
      await memory.persist();
      return mode === 'write'
        ? { mode, versions, implementation: 'native', written: entriesToWrite.length, ids }
        : { mode, versions, implementation: 'native', [mode === 'update' ? 'updated' : 'deleted']: records.length, records };
    }
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
      results.push({ id: entry.id, key: entry.key, content: entry.content, namespace: entry.namespace, version: entry.version, score: hit.score });
    }
    return { mode, versions, implementation: 'native', indexed: entries.length, results };
  } finally {
    try { await memory.shutdown(); }
    finally { if (folder) await rm(folder, { recursive: true, force: true }); }
  }
  });
}
