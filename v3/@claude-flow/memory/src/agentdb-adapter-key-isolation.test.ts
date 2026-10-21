/** Regression coverage for #3358: distinct namespace/key tuples must not evict each other. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentDBAdapter, type AgentDBAdapterConfig } from './agentdb-adapter.js';
import { MemoryConsolidator } from './consolidator.js';
import { createDefaultEntry, type MemoryEntry } from './types.js';

const vector = () => Float32Array.of(1, 0, 0, 0, 0, 0, 0, 0);
function pair(): [MemoryEntry, MemoryEntry] {
  const a = createDefaultEntry({ namespace: 'team:alice', key: 'profile', content: 'Alice profile' });
  const b = createDefaultEntry({ namespace: 'team', key: 'alice:profile', content: 'Other profile' });
  a.embedding = vector();
  b.embedding = vector();
  return [a, b];
}

const adapters: AgentDBAdapter[] = [];
const directories: string[] = [];
async function open(config: Partial<AgentDBAdapterConfig> = {}) {
  const adapter = new AgentDBAdapter({ dimensions: 8, cacheEnabled: true, ...config });
  adapters.push(adapter);
  await adapter.initialize();
  return adapter;
}
function persistence() {
  const dir = mkdtempSync(join(tmpdir(), 'memory-key-isolation-'));
  directories.push(dir);
  return { persistenceEnabled: true, persistencePath: join(dir, 'store') };
}
async function expectPair(adapter: AgentDBAdapter, a: MemoryEntry, b: MemoryEntry) {
  expect((await adapter.get(a.id))?.id).toBe(a.id);
  expect((await adapter.get(b.id))?.id).toBe(b.id);
  expect((await adapter.getByKey(a.namespace, a.key))?.id).toBe(a.id);
  expect((await adapter.getByKey(b.namespace, b.key))?.id).toBe(b.id);
  expect((await adapter.search(vector(), { k: 10 })).map(r => r.entry.id).sort()).toEqual([a.id, b.id].sort());
  for (const entry of [a, b]) {
    expect((await adapter.query({ type: 'prefix', namespace: entry.namespace, keyPrefix: '', limit: 10 })).map(e => e.id)).toEqual([entry.id]);
    expect((await adapter.query({ type: 'exact', namespace: entry.namespace, key: entry.key, limit: 10 })).map(e => e.id)).toEqual([entry.id]);
  }
}

afterEach(async () => {
  for (const adapter of adapters.splice(0)) await adapter.shutdown();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('namespace/key isolation (#3358)', () => {
  it.each(['scalar', 'batch', 'pre-existing then batch'] as const)('preserves colliding legacy tuples through %s writes', async (mode) => {
    const adapter = await open();
    const [a, b] = pair();
    if (mode === 'batch') await adapter.bulkInsert([a, b]);
    else {
      await adapter.store(a);
      if (mode === 'scalar') await adapter.store(b);
      else await adapter.bulkInsert([b]);
    }
    await expectPair(adapter, a, b);
  });

  it.each(['scalar', 'batch'] as const)('still replaces an identical tuple through %s writes without deleting the neighboring tuple', async (mode) => {
    const adapter = await open();
    const [a, b] = pair();
    await adapter.store(a);
    await adapter.store(b);
    const replacement = createDefaultEntry({ namespace: a.namespace, key: a.key, content: 'Updated Alice profile' });
    replacement.embedding = vector();
    if (mode === 'scalar') await adapter.store(replacement);
    else await adapter.bulkInsert([replacement]);
    expect(await adapter.get(a.id)).toBeNull();
    await expectPair(adapter, replacement, b);
  });

  it.each(['delete', 'bulkDelete', 'clearNamespace'] as const)('%s removes only the requested tuple and clears its lookup', async (mode) => {
    const adapter = await open();
    const [a, b] = pair();
    await adapter.bulkInsert([a, b]);
    if (mode === 'delete') await adapter.delete(a.id);
    else if (mode === 'bulkDelete') await adapter.bulkDelete([a.id]);
    else await adapter.clearNamespace(a.namespace);
    expect(await adapter.get(a.id)).toBeNull();
    expect(await adapter.getByKey(a.namespace, a.key)).toBeNull();
    expect((await adapter.getByKey(b.namespace, b.key))?.id).toBe(b.id);
    expect((await adapter.search(vector(), { k: 10 })).map(r => r.entry.id)).toEqual([b.id]);
  });

  it('matches prefixes against raw keys, including quotes, slashes and Unicode', async () => {
    const adapter = await open();
    const namespace = 'team:"\\雪';
    const matching = createDefaultEntry({ namespace, key: '"\\雪:profile', content: 'matching' });
    const otherKey = createDefaultEntry({ namespace, key: 'elsewhere', content: 'other key' });
    const otherNamespace = createDefaultEntry({ namespace: `${namespace}:child`, key: matching.key, content: 'other namespace' });
    await adapter.bulkInsert([matching, otherKey, otherNamespace]);
    expect((await adapter.getByKey(namespace, matching.key))?.id).toBe(matching.id);
    expect((await adapter.query({ type: 'prefix', namespace, keyPrefix: '"\\雪:', limit: 10 })).map(e => e.id)).toEqual([matching.id]);
  });

  it('preserves both tuples and subsequent same-tuple replacement across restarts', async () => {
    const config = persistence();
    const first = await open(config);
    const [a, b] = pair();
    await first.bulkInsert([a, b]);
    await first.shutdown();
    const reloaded = await open(config);
    await expectPair(reloaded, a, b);
    const replacement = createDefaultEntry({ namespace: a.namespace, key: a.key, content: 'Updated Alice profile' });
    replacement.embedding = vector();
    await reloaded.store(replacement);
    await reloaded.shutdown();
    const again = await open(config);
    expect(await again.get(a.id)).toBeNull();
    await expectPair(again, replacement, b);
  });

  it.each(['delete', 'bulkDelete'] as const)('loads v1 colliding keys and preserves the saved winner when %s removes a stale duplicate', async (mode) => {
    const config = persistence();
    const first = await open(config);
    const [a, b] = pair();
    const winner = createDefaultEntry({ namespace: 'dup', key: 'duplicate', content: 'winner' });
    const stale = createDefaultEntry({ namespace: 'dup', key: 'temporary', content: 'stale' });
    // Persisted entry order must not accidentally choose the intended winner.
    winner.id = 'a-winner';
    stale.id = 'z-stale';
    await first.bulkInsert([a, b, winner, stale]);
    await first.shutdown();

    const metaPath = `${config.persistencePath}.meta.json`;
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.version = 1;
    meta.entries.find((e: MemoryEntry) => e.id === stale.id).key = winner.key;
    // An authentic v1 index could only retain B for the colliding pair,
    // while same-tuple orphans remained in entries under distinct IDs.
    meta.keyIndex = { 'team:alice:profile': b.id, 'dup:duplicate': winner.id };
    writeFileSync(metaPath, JSON.stringify(meta));

    const reloaded = await open(config);
    await expectPair(reloaded, a, b);
    expect((await reloaded.getByKey('dup', 'duplicate'))?.id).toBe(winner.id);
    expect((await reloaded.get(stale.id))?.id).toBe(stale.id);
    if (mode === 'delete') await reloaded.delete(stale.id);
    else await reloaded.bulkDelete([stale.id]);
    expect(await reloaded.get(stale.id)).toBeNull();
    expect((await reloaded.getByKey('dup', 'duplicate'))?.id).toBe(winner.id);
    await reloaded.shutdown();
    expect(JSON.parse(readFileSync(metaPath, 'utf8')).version).toBe(2);
    const again = await open(config);
    await expectPair(again, a, b);
    expect((await again.getByKey('dup', 'duplicate'))?.id).toBe(winner.id);
  });

  it.each(['sweep', 'dedup'] as const)('clears the encoded lookup during consolidator %s', async (mode) => {
    const adapter = await open();
    const [a, b] = pair();
    if (mode === 'sweep') a.expiresAt = Date.now() - 1000;
    else {
      a.content = b.content;
      a.updatedAt = 1;
      b.updatedAt = 2;
    }
    await adapter.bulkInsert([a, b]);
    const consolidator = new MemoryConsolidator({ getAdapter: () => adapter } as any, { similarityThreshold: 1 });
    if (mode === 'sweep') expect((await consolidator.sweepExpired()).removed).toBe(1);
    else expect((await consolidator.dedup('keep-newest')).merged).toBe(1);
    // Both values were cached on insert; a stale keyIndex pointer would
    // incorrectly return the removed entry from cache even after cleanup.
    expect(await adapter.getByKey(a.namespace, a.key)).toBeNull();
    expect((await adapter.getByKey(b.namespace, b.key))?.id).toBe(b.id);
    expect((await adapter.search(vector(), { k: 10 })).map(r => r.entry.id)).toEqual([b.id]);
  });
});
