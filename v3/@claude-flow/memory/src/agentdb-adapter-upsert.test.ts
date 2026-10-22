/**
 * Dream Cycle 2026-09-18 (memory) — regression tests for AgentDBAdapter.store()
 * same-(namespace,key) idempotency.
 *
 * Baseline bug: store() minted a fresh random id per call (createDefaultEntry ->
 * generateMemoryId()) and never looked up an existing entry under the same
 * (namespace, key) before writing. The prior occupant was left as an orphan:
 * unreachable via getByKey()/keyIndex, but still present in entries/
 * namespaceIndex/tagIndex, and — for embedded entries — still a live point in
 * the HNSW index, so search()/semanticSearch() returned stale duplicates
 * forever. Fixed by evicting the prior (namespace,key) occupant via a shared
 * evictEntry() primitive (also used by delete() and bulkInsert()) before
 * storing the new entry.
 *
 * Post-review hardening (same night): an adversarial human review found two
 * further public-path gaps the first pass missed — bulkInsert() bypassed the
 * same-key dedup entirely, and store() originally evicted the prior occupant
 * BEFORE validating the replacement's embedding, so a rejected addPoint()
 * (dimension mismatch, index full) would delete the old value and still fail,
 * losing data outright. Both are fixed below; the tests in this second block
 * cover exactly the five cases the review asked for.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentDBAdapter } from './agentdb-adapter.js';
import { createDefaultEntry } from './types.js';

function unitVector(dims: number, hotIndex: number): Float32Array {
  const v = new Float32Array(dims);
  v[hotIndex % dims] = 1;
  return v;
}

function allInNamespace(namespace: string) {
  return { type: 'prefix' as const, keyPrefix: '', namespace, limit: 1000 };
}

describe('AgentDBAdapter.store() — same-key upsert idempotency (Dream Cycle 2026-09-18)', () => {
  let adapter: AgentDBAdapter;

  beforeEach(async () => {
    adapter = new AgentDBAdapter({ dimensions: 8, cacheEnabled: true });
    await adapter.initialize();
  });

  it('a second store() under the same (namespace,key) does not leave two entries reachable', async () => {
    const first = createDefaultEntry({ key: 'profile', namespace: 'ns1', content: 'v1' });
    await adapter.store(first);

    const second = createDefaultEntry({ key: 'profile', namespace: 'ns1', content: 'v2' });
    await adapter.store(second);

    expect(first.id).not.toBe(second.id); // ids are independently random, as today

    const byKey = await adapter.getByKey('ns1', 'profile');
    expect(byKey?.content).toBe('v2');

    // The prior occupant must be fully gone, not just unreachable via getByKey.
    const stale = await adapter.get(first.id);
    expect(stale).toBeNull();

    const all = await adapter.query(allInNamespace('ns1'));
    expect(all.filter((e) => e.key === 'profile')).toHaveLength(1);
  });

  it('a second store() under the same (namespace,key) evicts the stale HNSW point, so search() never returns the old content', async () => {
    const first = createDefaultEntry({ key: 'fact', namespace: 'ns1', content: 'stale-fact' });
    first.embedding = unitVector(8, 0);
    await adapter.store(first);

    const second = createDefaultEntry({ key: 'fact', namespace: 'ns1', content: 'fresh-fact' });
    second.embedding = unitVector(8, 0); // same embedding direction, different content/id
    await adapter.store(second);

    const results = await adapter.search(unitVector(8, 0), { k: 10 });
    const contents = results.map((r) => r.entry.content);
    expect(contents).toContain('fresh-fact');
    expect(contents).not.toContain('stale-fact');
    expect(contents.filter((c) => c === 'fresh-fact')).toHaveLength(1);
  });

  it('storing a genuinely new (namespace,key) is unaffected (no eviction, both entries reachable)', async () => {
    const a = createDefaultEntry({ key: 'a', namespace: 'ns1', content: 'A' });
    const b = createDefaultEntry({ key: 'b', namespace: 'ns1', content: 'B' });
    await adapter.store(a);
    await adapter.store(b);

    expect((await adapter.get(a.id))?.content).toBe('A');
    expect((await adapter.get(b.id))?.content).toBe('B');
    expect(await adapter.query(allInNamespace('ns1'))).toHaveLength(2);
  });

  it('the same (namespace,key) in two different namespaces are independent (no cross-namespace eviction)', async () => {
    const a = createDefaultEntry({ key: 'shared', namespace: 'ns1', content: 'from-ns1' });
    const b = createDefaultEntry({ key: 'shared', namespace: 'ns2', content: 'from-ns2' });
    await adapter.store(a);
    await adapter.store(b);

    expect((await adapter.getByKey('ns1', 'shared'))?.content).toBe('from-ns1');
    expect((await adapter.getByKey('ns2', 'shared'))?.content).toBe('from-ns2');
  });
});

describe('AgentDBAdapter same-key upsert — post-review hardening (Dream Cycle 2026-09-18)', () => {
  let adapter: AgentDBAdapter;

  beforeEach(async () => {
    adapter = new AgentDBAdapter({ dimensions: 8, cacheEnabled: true });
    await adapter.initialize();
  });

  it('a replacement rejected by HNSWIndex.addPoint() (dimension mismatch) leaves the prior value intact', async () => {
    const first = createDefaultEntry({ key: 'k', namespace: 'ns1', content: 'original' });
    first.embedding = unitVector(8, 0);
    await adapter.store(first);

    const bad = createDefaultEntry({ key: 'k', namespace: 'ns1', content: 'malformed' });
    bad.embedding = new Float32Array(4); // wrong dimension for this 8-dim adapter

    await expect(adapter.store(bad)).rejects.toThrow(/dimension mismatch/i);

    // The prior value must survive a rejected replacement -- not be deleted
    // and then fail to be replaced (the exact data-loss bug the review found).
    const byKey = await adapter.getByKey('ns1', 'k');
    expect(byKey?.content).toBe('original');
    expect(byKey?.id).toBe(first.id);
    expect(await adapter.get(first.id)).not.toBeNull();
  });

  it('bulkInsert() evicts a duplicate key within the same batch, last entry wins', async () => {
    const loser = createDefaultEntry({ key: 'k', namespace: 'ns1', content: 'first-in-batch' });
    const winner = createDefaultEntry({ key: 'k', namespace: 'ns1', content: 'last-in-batch' });

    await adapter.bulkInsert([loser, winner]);

    const byKey = await adapter.getByKey('ns1', 'k');
    expect(byKey?.content).toBe('last-in-batch');
    expect(byKey?.id).toBe(winner.id);

    expect(await adapter.get(loser.id)).toBeNull();
    expect(await adapter.query(allInNamespace('ns1'))).toHaveLength(1);
  });

  it('bulkInsert() evicts a pre-existing store()d entry that a batch replaces', async () => {
    const preExisting = createDefaultEntry({ key: 'k', namespace: 'ns1', content: 'pre-existing' });
    preExisting.embedding = unitVector(8, 0);
    await adapter.store(preExisting);

    const replacement = createDefaultEntry({ key: 'k', namespace: 'ns1', content: 'from-batch' });
    replacement.embedding = unitVector(8, 0);
    await adapter.bulkInsert([replacement]);

    expect(await adapter.get(preExisting.id)).toBeNull();
    const results = await adapter.search(unitVector(8, 0), { k: 10 });
    const contents = results.map((r) => r.entry.content);
    expect(contents).toContain('from-batch');
    expect(contents).not.toContain('pre-existing');
    expect(await adapter.query(allInNamespace('ns1'))).toHaveLength(1);
  });

  it('a same-key replacement survives a persisted save/reload -- only the winner comes back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentdb-adapter-upsert-'));
    const persistencePath = join(dir, 'store');
    try {
      const first = new AgentDBAdapter({
        dimensions: 8,
        cacheEnabled: true,
        persistenceEnabled: true,
        persistencePath,
      });
      await first.initialize();

      const original = createDefaultEntry({ key: 'k', namespace: 'ns1', content: 'v1' });
      await first.store(original);
      const replacement = createDefaultEntry({ key: 'k', namespace: 'ns1', content: 'v2' });
      await first.store(replacement);
      await first.shutdown(); // persists to disk

      const reloaded = new AgentDBAdapter({
        dimensions: 8,
        cacheEnabled: true,
        persistenceEnabled: true,
        persistencePath,
      });
      await reloaded.initialize(); // loads from disk

      const byKey = await reloaded.getByKey('ns1', 'k');
      expect(byKey?.content).toBe('v2');
      expect(await reloaded.get(original.id)).toBeNull();
      expect(await reloaded.query(allInNamespace('ns1'))).toHaveLength(1);
    } finally {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('KNOWN LIMITATION (disclosed, not fixed tonight): truly concurrent store() calls for the same key can both proceed and leave two reachable entries', async () => {
    // No mutex/lock exists around the keyIndex.get() check + writes. Two
    // store() calls for the same (namespace,key), both parked mid-flight on
    // an embeddingGenerator await and released in the same tick, can each
    // resume and read keyIndex before the other has written to it, so
    // neither evicts the other. A plain setTimeout-based delay does NOT
    // reliably reproduce this: Node drains the microtask queue (including
    // every further await inside one resumed call) before the next timer
    // macrotask runs, so two independently-timed calls tend to fully
    // serialize instead of interleaving at the check (confirmed: an earlier
    // version of this test using setTimeout could not reproduce the gap).
    // Two externally-controlled gates, released back-to-back in the same
    // synchronous tick after both calls are already parked, force the
    // actual interleaving this test needs to demonstrate.
    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>((resolve) => { releaseA = resolve; });
    const gateB = new Promise<void>((resolve) => { releaseB = resolve; });

    const raced = new AgentDBAdapter({
      dimensions: 8,
      cacheEnabled: true,
      embeddingGenerator: (content) => (content === 'from-a' ? gateA : gateB).then(() => unitVector(8, 0)),
    });
    await raced.initialize();

    const a = createDefaultEntry({ key: 'k', namespace: 'ns1', content: 'from-a' });
    const b = createDefaultEntry({ key: 'k', namespace: 'ns1', content: 'from-b' });

    // Both calls run synchronously up to their embeddingGenerator await and
    // are now genuinely parked -- store() hasn't read keyIndex yet for
    // either. Releasing both gates back-to-back interleaves their resumption.
    const pA = raced.store(a);
    const pB = raced.store(b);
    releaseA();
    releaseB();
    await Promise.all([pA, pB]);

    // query()'s prefix search iterates keyIndex, which by construction holds
    // exactly one id per (namespace,key) -- it structurally cannot see an
    // orphan still sitting in `entries` under a different id, so it's the
    // wrong probe here (an earlier version of this test used it and always
    // saw "1", regardless of whether the race actually happened). get(id)
    // against each participant's own id is the correct probe, matching how
    // this file's very first test detects the sequential-case orphan.
    const aStillPresent = (await raced.get(a.id)) !== null;
    const bStillPresent = (await raced.get(b.id)) !== null;
    // Today: both survive concurrently (the bug this test documents) --
    // neither call's isReplacement check saw the other's write in time. If
    // this assertion ever starts failing because only one is still present,
    // the concurrency gap has been fixed -- update this test to assert the
    // fixed behavior instead of loosening it.
    expect([aStillPresent, bStillPresent]).toEqual([true, true]);
  });
});
