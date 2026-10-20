import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HNSWIndex, isHnswlibAvailable } from 'agentdb';
import { AgentDBBackend } from './agentdb-backend.js';
import { createDefaultEntry } from './types.js';

const nativeAvailable = await isHnswlibAvailable();
const required = process.env.RUFLO_REQUIRE_NATIVE_HNSW === '1';
const vector = (...values: number[]) => new Float32Array(values);
const entry = (id: string, embedding: Float32Array, namespace = 'test') =>
  ({ ...createDefaultEntry({ key: id, content: id, namespace }), id, embedding });

// A normal install can omit the optional native addon. The verification job
// sets RUFLO_REQUIRE_NATIVE_HNSW=1 so absence is a failure, never a silent skip.
describe.skipIf(!nativeAvailable && !required)('AgentDBBackend real native HNSW', () => {
  let backend: AgentDBBackend;

  beforeEach(async () => {
    expect(nativeAvailable).toBe(true);
    vi.stubEnv('AGENTDB_DISABLE_TRANSFORMERS', '1');
    backend = new AgentDBBackend({
      dbPath: ':memory:',
      vectorDimension: 3,
      vectorBackend: 'hnswlib',
      embeddingGenerator: async (content) =>
        content === 'changed' ? vector(0, 1, 0) : vector(1, 0, 0),
    });
    await backend.initialize();
    expect(backend.isAvailable()).toBe(true);
  });

  afterEach(async () => {
    await backend?.shutdown();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('builds and searches the real export without asking for an imaginary controller', async () => {
    const nativeSearch = vi.spyOn(HNSWIndex.prototype, 'search');
    const getController = vi.spyOn(backend.getAgentDB(), 'getController');
    const errors = vi.spyOn(console, 'error');
    await backend.bulkInsert([
      entry('east', vector(1, 0, 0)),
      entry('near-east', vector(0.9, 0.1, 0)),
      entry('north', vector(0, 1, 0)),
      entry('west', vector(-1, 0, 0)),
    ]);
    const results = await backend.search(vector(1, 0, 0), { k: 2 });
    expect(results.map((r) => r.entry.id)).toEqual(['east', 'near-east']);
    expect(results[0]).toMatchObject({ score: 1, distance: 0 });
    expect(results[1].score).toBeCloseTo(0.993883734, 6);
    expect(nativeSearch).toHaveBeenCalledOnce();
    expect(getController).not.toHaveBeenCalledWith('hnsw');
    expect(errors.mock.calls.some(([message]) => String(message).includes('HNSW search failed'))).toBe(false);
    expect((await backend.getStats()).hnswStats?.vectorCount).toBe(4);
    expect((await backend.healthCheck()).components.index.status).toBe('healthy');
  });

  it('reuses a built index, but rebuilds on append, replacement, update and deletion', async () => {
    const build = vi.spyOn(HNSWIndex.prototype, 'buildIndex');
    await backend.store(entry('a', vector(1, 0, 0)));
    await backend.store(entry('b', vector(0.9, 0.1, 0)));
    await backend.search(vector(1, 0, 0), { k: 1 });
    await backend.search(vector(1, 0, 0), { k: 1 });
    expect(build).toHaveBeenCalledTimes(1);
    await backend.store(entry('c', vector(0, 0, 1)));
    expect((await backend.search(vector(0, 0, 1), { k: 1 }))[0].entry.id).toBe('c');
    await backend.store(entry('a', vector(-1, 0, 0), 'moved'));
    expect(await backend.getByKey('test', 'a')).toBeNull();
    expect((await backend.search(vector(1, 0, 0), { k: 1 }))[0].entry.id).toBe('b');
    await backend.update('b', { content: 'changed' });
    expect((await backend.search(vector(0, 1, 0), { k: 1 }))[0].entry.id).toBe('b');
    await backend.delete('b');
    const results = await backend.search(vector(0, 1, 0), { k: 99 });
    expect(results.map((r) => r.entry.id).sort()).toEqual(['a', 'c']);
    expect(new Set(results.map((r) => r.entry.id)).size).toBe(2);
    expect((await backend.getStats()).hnswStats?.vectorCount).toBe(2);
    expect(build).toHaveBeenCalledTimes(5);
  });

  it('clears the last point and rebuilds from entries on same-instance reinitialize', async () => {
    await backend.store(entry('a', vector(1, 0, 0)));
    await backend.search(vector(1, 0, 0), { k: 1 });
    await backend.clearNamespace('test');
    expect(await backend.search(vector(1, 0, 0), { k: 1 })).toEqual([]);
    expect((await backend.getStats()).hnswStats).toBeUndefined();
    await backend.store(entry('loaded', vector(0, 1, 0)));
    await backend.shutdown();
    expect((await backend.getStats()).hnswStats).toBeUndefined();
    await backend.initialize();
    expect((await backend.search(vector(0, 1, 0), { k: 1 }))[0].entry.id).toBe('loaded');
  });

  it('keeps filtered top-k exact and honors zero thresholds', async () => {
    const search = vi.spyOn(HNSWIndex.prototype, 'search');
    await backend.bulkInsert([
      entry('outside-1', vector(1, 0, 0), 'other'),
      entry('outside-2', vector(0.99, 0.01, 0), 'other'),
      entry('inside', vector(0.8, 0.2, 0)),
      entry('opposite', vector(-1, 0, 0)),
    ]);
    const filtered = await backend.search(vector(1, 0, 0), {
      k: 1, filters: { type: 'semantic', namespace: 'test', limit: 1 },
    });
    expect(filtered.map((r) => r.entry.id)).toEqual(['inside']);
    expect(search).not.toHaveBeenCalled();
    const threshold = await backend.search(vector(1, 0, 0), { k: 10, threshold: 0 });
    expect(threshold.map((r) => r.entry.id)).not.toContain('opposite');
    expect(search).toHaveBeenCalledOnce();
  });

  it('uses native search for semantic queries without filtering constraints', async () => {
    const search = vi.spyOn(HNSWIndex.prototype, 'search');
    await backend.store(entry('a', vector(1, 0, 0)));
    expect((await backend.query({
      type: 'semantic', embedding: vector(1, 0, 0), limit: 1,
    }))[0].id).toBe('a');
    expect(search).toHaveBeenCalledOnce();
  });

  it('keeps default expiry eligibility consistent with exact semantic search', async () => {
    const search = vi.spyOn(HNSWIndex.prototype, 'search');
    await backend.store({ ...entry('expired', vector(1, 0, 0)), expiresAt: Date.now() - 1 });
    await backend.store(entry('live', vector(0.9, 0.1, 0)));
    const query = { type: 'semantic' as const, embedding: vector(1, 0, 0), limit: 1 };
    expect((await backend.query(query)).map((r) => r.id)).toEqual(['live']);
    expect(search).not.toHaveBeenCalled();
    expect((await backend.query({ ...query, includeExpired: true })).map((r) => r.id)).toEqual(['expired']);
    await backend.delete('expired');
    expect((await backend.query(query)).map((r) => r.id)).toEqual(['live']);
    expect(search).toHaveBeenCalledOnce();
    await backend.update('live', { expiresAt: Date.now() - 1 });
    expect(await backend.query(query)).toEqual([]);
    // Replacing a TTL entry with an entry without expiry restores native use.
    await backend.store(entry('live', vector(0.9, 0.1, 0)));
    expect((await backend.query(query)).map((r) => r.id)).toEqual(['live']);
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('owns indexed vectors instead of exposing mutable input or result aliases', async () => {
    const a = entry('a', vector(1, 0, 0));
    const b = entry('b', vector(0, 1, 0));
    await backend.bulkInsert([a, b]);
    const east = () => backend.search(vector(1, 0, 0), { k: 1 });
    expect((await east())[0].entry.id).toBe('a');
    a.embedding.set([-1, 0, 0]);
    b.embedding.set([1, 0, 0]);
    a.expiresAt = 0;
    (await backend.get('a'))!.embedding!.set([-1, 0, 0]);
    (await east())[0].entry.embedding!.set([-1, 0, 0]);
    (await backend.query({ type: 'exact', key: 'a', limit: 1 }))[0].embedding!.set([-1, 0, 0]);
    const result = await east();
    expect(result[0]).toMatchObject({ entry: { id: 'a' }, score: 1 });
    expect((await backend.query({ type: 'semantic', embedding: vector(1, 0, 0), limit: 1 }))[0].id).toBe('a');
    await backend.delete('b');
    const updated = await backend.update('a', { content: 'changed' });
    updated!.embedding!.set([0, -1, 0]);
    expect((await backend.search(vector(0, 1, 0), { k: 1 }))[0].score).toBe(1);
  });

  it('normalizes extreme finite values before native cosine search', async () => {
    await backend.bulkInsert([
      entry('huge', vector(3e38, 1e38, 0)),
      entry('tiny', vector(0, 1e-38, 0)),
      entry('other', vector(0, 0, 1)),
    ]);
    expect((await backend.search(vector(3e38, 1e38, 0), { k: 1 }))[0].entry.id).toBe('huge');
    expect((await backend.search(vector(0, 1e-38, 0), { k: 1 }))[0].entry.id).toBe('tiny');
  });

  it('rejects unsafe native tuning without constructing an index', async () => {
    await backend.shutdown();
    backend = new AgentDBBackend({
      dbPath: ':memory:', vectorDimension: 3, hnswM: 0,
    });
    await backend.initialize();
    const build = vi.spyOn(HNSWIndex.prototype, 'buildIndex');
    await backend.store(entry('a', vector(1, 0, 0)));
    expect((await backend.search(vector(1, 0, 0), { k: 1 }))[0].entry.id).toBe('a');
    expect(build).not.toHaveBeenCalled();
    expect((await backend.getStats()).hnswStats).toBeUndefined();
  });

  it('serializes per-query ef changes across concurrent native searches', async () => {
    await backend.store(entry('a', vector(1, 0, 0)));
    await backend.search(vector(1, 0, 0), { k: 1 });
    const original = HNSWIndex.prototype.search;
    const observed: number[] = [];
    vi.spyOn(HNSWIndex.prototype, 'search').mockImplementation(async function (this: HNSWIndex, ...args) {
      await Promise.resolve();
      observed.push(this.getStats().efSearch);
      return original.apply(this, args);
    });
    await Promise.all([
      backend.search(vector(1, 0, 0), { k: 1, ef: 20 }),
      backend.search(vector(1, 0, 0), { k: 1, ef: 200 }),
    ]);
    expect(observed).toEqual([20, 200]);
  });

  it('handles empty, oversized-k, zero vectors and mismatched dimensions safely', async () => {
    expect(await backend.search(vector(1, 0, 0), { k: 1 })).toEqual([]);
    await backend.store(entry('zero', vector(0, 0, 0)));
    const results = await backend.search(vector(1, 0, 0), { k: 100 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ score: 0, distance: 1 });
    expect(await backend.search(vector(1, 0, 0), { k: 0 })).toEqual([]);
    await backend.store(entry('legacy-dimension', vector(1, 0)));
    const legacy = await backend.search(vector(1, 0), { k: 2 });
    expect(legacy.some((r) => r.entry.id === 'legacy-dimension')).toBe(true);
    expect((await backend.getStats()).hnswStats).toBeUndefined();
  });

  it('falls back after native build failure, without retrying on every query', async () => {
    const build = vi.spyOn(HNSWIndex.prototype, 'buildIndex').mockRejectedValueOnce(new Error('native unavailable'));
    await backend.store(entry('a', vector(1, 0, 0)));
    for (let i = 0; i < 2; i++) {
      expect((await backend.search(vector(1, 0, 0), { k: 1 }))[0].entry.id).toBe('a');
    }
    expect(build).toHaveBeenCalledOnce();
    expect((await backend.getStats()).hnswStats).toBeUndefined();
    expect((await backend.healthCheck()).components.index.status).toBe('degraded');
  });

  it('falls back after native search failure and stops advertising a live index', async () => {
    const search = vi.spyOn(HNSWIndex.prototype, 'search').mockRejectedValueOnce(new Error('native failure'));
    await backend.store(entry('a', vector(1, 0, 0)));
    for (let i = 0; i < 2; i++) {
      expect((await backend.search(vector(1, 0, 0), { k: 1 }))[0].entry.id).toBe('a');
    }
    expect(search).toHaveBeenCalledOnce();
    expect((await backend.getStats()).hnswStats).toBeUndefined();
  });

  it('rejects snapshots invalidated during asynchronous index construction', async () => {
    const original = HNSWIndex.prototype.buildIndex;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const build = vi.spyOn(HNSWIndex.prototype, 'buildIndex').mockImplementationOnce(async function (this: HNSWIndex, ...args) {
      await gate;
      return original.apply(this, args);
    });
    await backend.store(entry('old', vector(1, 0, 0)));
    const pending = backend.search(vector(1, 0, 0), { k: 1 });
    await vi.waitFor(() => expect(build).toHaveBeenCalledOnce());
    await backend.delete('old');
    await backend.store(entry('new', vector(0.9, 0.1, 0)));
    release();
    expect((await pending).map((r) => r.entry.id)).toEqual(['new']);
    expect((await backend.search(vector(1, 0, 0), { k: 1 }))[0].entry.id).toBe('new');
  });

  it('snapshots query vectors before asynchronous native construction', async () => {
    const original = HNSWIndex.prototype.buildIndex;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const build = vi.spyOn(HNSWIndex.prototype, 'buildIndex').mockImplementationOnce(async function (this: HNSWIndex, ...args) {
      await gate;
      return original.apply(this, args);
    });
    await backend.store(entry('a', vector(1, 0, 0)));
    await backend.store(entry('b', vector(0, 1, 0)));
    const query = vector(1, 0, 0);
    const pending = backend.search(query, { k: 1 });
    await vi.waitFor(() => expect(build).toHaveBeenCalledOnce());
    query.fill(Number.NaN);
    release();
    expect((await pending)[0]).toMatchObject({ entry: { id: 'a' }, score: 1, distance: 0 });
  });
});

describe('AgentDBBackend explicit non-native mode', () => {
  it('uses exact fallback under forceWasm with no HNSW capability claim', async () => {
    vi.stubEnv('AGENTDB_DISABLE_TRANSFORMERS', '1');
    const search = vi.spyOn(HNSWIndex.prototype, 'search');
    const backend = new AgentDBBackend({ dbPath: ':memory:', forceWasm: true, vectorDimension: 3 });
    try {
      await backend.initialize();
      await backend.store(entry('a', vector(1, 0, 0)));
      expect((await backend.search(vector(1, 0, 0), { k: 1 }))[0].entry.id).toBe('a');
      expect(search).not.toHaveBeenCalled();
      expect((await backend.getStats()).hnswStats).toBeUndefined();
      expect((await backend.healthCheck()).components.index.status).toBe('degraded');
    } finally {
      await backend.shutdown();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });
});
