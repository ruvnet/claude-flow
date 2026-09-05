/**
 * Phase 3 — Persistent HNSW (ADR-125)
 *
 * Verifies that:
 * - `HNSWIndex.serialize()` / `deserialize()` round-trip correctly.
 * - `MemoryService` close → reopen on the same dbPath recovers all entries
 *   AND the HNSW index (Acceptance Criterion #3).
 * - A corrupt sidecar emits `health.persistence = 'corrupt'` and the service
 *   falls back to fresh state without throwing.
 * - Snapshot-every-N triggers a sidecar mtime update once the threshold is hit.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { HNSWIndex } from './hnsw-index.js';
import { MemoryService } from './index.js';
import { createDefaultEntry } from './types.js';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cf-mem-phase3-'));
}

function cleanupDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

function randomVec(dim: number, seed: number): Float32Array {
  const out = new Float32Array(dim);
  let s = seed;
  for (let i = 0; i < dim; i++) {
    // xorshift32 for deterministic values
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    out[i] = ((s | 0) / 2 ** 31);
  }
  return out;
}

describe('Phase 3 — HNSWIndex.serialize / deserialize', () => {
  it('round-trips an empty index', () => {
    const idx = new HNSWIndex({ dimensions: 8, M: 4, efConstruction: 10, metric: 'cosine' });
    const buf = idx.serialize();
    const restored = HNSWIndex.deserialize(buf);
    expect(restored.size).toBe(0);
  });

  it('round-trips a populated index and preserves neighbor sets', async () => {
    const idx = new HNSWIndex({ dimensions: 16, M: 4, efConstruction: 20, metric: 'cosine' });
    for (let i = 0; i < 32; i++) {
      await idx.addPoint(`id-${i}`, randomVec(16, i + 1));
    }
    expect(idx.size).toBe(32);

    const buf = idx.serialize();
    const restored = HNSWIndex.deserialize(buf);
    expect(restored.size).toBe(32);

    // Same query → same top-k ordering
    const query = randomVec(16, 999);
    const beforeResults = await idx.search(query, 5);
    const afterResults = await restored.search(query, 5);
    expect(afterResults.map(r => r.id)).toEqual(beforeResults.map(r => r.id));
  });

  it('rejects buffers without the magic header', () => {
    const bad = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    expect(() => HNSWIndex.deserialize(bad)).toThrow(/magic header/);
  });

  it('rejects truncated payloads', () => {
    const idx = new HNSWIndex({ dimensions: 4, M: 2, efConstruction: 4, metric: 'cosine' });
    const buf = idx.serialize();
    // Truncate before nodeCount
    const truncated = buf.slice(0, 6);
    expect(() => HNSWIndex.deserialize(truncated)).toThrow();
  });
});

describe('Phase 3 — MemoryService snapshot + restore', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkTmpDir();
    dbPath = path.join(dir, 'mem.db');
  });

  afterEach(() => {
    cleanupDir(dir);
  });

  it('Acceptance Criterion #3 — restarts recover entries AND HNSW index', async () => {
    // Phase A: populate
    const dim = 16;
    let restoredStatus: any = null;
    const svc1 = new MemoryService({
      dimensions: dim,
      persistenceEnabled: true,
      persistencePath: dbPath,
      snapshotInterval: 0, // disable interval-based snapshots — only close() flushes
      embeddingGenerator: async (text: string) => randomVec(dim, hashStr(text)),
    });
    await svc1.initialize();

    // Capture neighbors for verification
    const inserted: Array<{ id: string; embedding: Float32Array }> = [];
    for (let i = 0; i < 100; i++) {
      const entry = createDefaultEntry({
        key: `k-${i}`,
        content: `entry ${i}`,
        namespace: 'phase3',
      });
      entry.embedding = randomVec(dim, i + 1);
      await svc1.store(entry);
      inserted.push({ id: entry.id, embedding: entry.embedding });
    }

    // Capture HNSW neighbors against a fixed query vector BEFORE close.
    const queryVec = randomVec(dim, 7777);
    const beforeNeighbors = await svc1.search(queryVec, { k: 10 });

    await svc1.close();

    // Phase B: reopen — should restore both entries and HNSW.
    const svc2 = new MemoryService({
      dimensions: dim,
      persistenceEnabled: true,
      persistencePath: dbPath,
      snapshotInterval: 0,
      embeddingGenerator: async (text: string) => randomVec(dim, hashStr(text)),
    });
    svc2.getAdapter().on('persistence:loaded', (ev: any) => { restoredStatus = ev; });
    await svc2.initialize();

    expect(restoredStatus).not.toBeNull();
    expect(restoredStatus.status).toBe('restored');
    expect(restoredStatus.count).toBe(100);

    // Same query → same neighbors after restore (no rebuild log expected).
    const afterNeighbors = await svc2.search(queryVec, { k: 10 });
    expect(afterNeighbors.map(r => r.entry.id)).toEqual(beforeNeighbors.map(r => r.entry.id));

    await svc2.close();
  });

  it('emits health.persistence = "corrupt" on tampered sidecar; falls back to fresh', async () => {
    // Phase A: populate + close to create sidecars
    const dim = 8;
    const svc1 = new MemoryService({
      dimensions: dim,
      persistenceEnabled: true,
      persistencePath: dbPath,
      snapshotInterval: 0,
    });
    await svc1.initialize();
    for (let i = 0; i < 5; i++) {
      const entry = createDefaultEntry({ key: `k-${i}`, content: `x-${i}` });
      entry.embedding = randomVec(dim, i + 1);
      await svc1.store(entry);
    }
    await svc1.close();

    const hnswSidecar = `${dbPath}.hnsw`;
    expect(fs.existsSync(hnswSidecar)).toBe(true);

    // Mutate the magic header byte
    const buf = fs.readFileSync(hnswSidecar);
    buf[0] = 0xFF;
    fs.writeFileSync(hnswSidecar, buf);

    // Reopen — should detect corruption and start fresh, without throwing.
    let loadedEvent: any = null;
    const svc2 = new MemoryService({
      dimensions: dim,
      persistenceEnabled: true,
      persistencePath: dbPath,
      snapshotInterval: 0,
    });
    svc2.getAdapter().on('persistence:loaded', (ev: any) => { loadedEvent = ev; });
    await svc2.initialize();

    expect(loadedEvent).not.toBeNull();
    expect(loadedEvent.status).toBe('corrupt');
    // Fresh state: count should be zero
    expect(await svc2.count()).toBe(0);
    await svc2.close();
  });

  it('snapshot-every-N triggers a sidecar write after the threshold is hit', async () => {
    const dim = 8;
    const N = 3;
    const svc = new MemoryService({
      dimensions: dim,
      persistenceEnabled: true,
      persistencePath: dbPath,
      snapshotInterval: N,
    });
    await svc.initialize();

    const hnswSidecar = `${dbPath}.hnsw`;
    expect(fs.existsSync(hnswSidecar)).toBe(false);

    // First N-1 stores should NOT flush a snapshot.
    for (let i = 0; i < N - 1; i++) {
      const entry = createDefaultEntry({ key: `pre-${i}`, content: `c-${i}` });
      entry.embedding = randomVec(dim, i + 1);
      await svc.store(entry);
    }
    expect(fs.existsSync(hnswSidecar)).toBe(false);

    // The Nth store should fire saveSnapshot — await one event-loop turn so
    // the fire-and-forget save() promise resolves.
    const saved = new Promise<void>((resolve) => {
      svc.getAdapter().once('persistence:saved', () => resolve());
    });
    const triggerEntry = createDefaultEntry({ key: 'trigger', content: 'trigger' });
    triggerEntry.embedding = randomVec(dim, 999);
    await svc.store(triggerEntry);
    await saved;

    expect(fs.existsSync(hnswSidecar)).toBe(true);
    await svc.close();
  });
});

// Cheap deterministic string hash for the test embedder.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) + 1;
}
