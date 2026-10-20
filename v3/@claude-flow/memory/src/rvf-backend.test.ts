/**
 * RvfBackend — #4279 regression guard.
 *
 * The backend used to try `@ruvector/rvf` first and, had that ever succeeded,
 * skip `loadFromDisk()` and later overwrite `databasePath` with only the
 * entries written since startup. The native branch is gone; these tests pin
 * that a reopen always reloads the snapshot, even when an `@ruvector/rvf`
 * whose factories succeed is importable.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { RvfBackend } from './rvf-backend.js';
import { createDefaultEntry } from './types.js';

const rvfFactories = vi.hoisted(() => ({
  create: vi.fn(async () => ({ close: async () => {} })),
  open: vi.fn(async () => ({ close: async () => {} })),
}));

// Stand-in whose static factories and instance open() all succeed, so the
// old init would have taken the native branch.
vi.mock('@ruvector/rvf', () => {
  class MockRvfDb {
    static create = rvfFactories.create;
    static open = rvfFactories.open;
    async open(): Promise<void> {}
    async close(): Promise<void> {}
  }
  return { RvfDatabase: MockRvfDb };
});

const DIM = 8;

function vec(seed: number): Float32Array {
  const out = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) out[i] = Math.sin(seed * 7 + i);
  return out;
}

function entry(key: string, seed: number) {
  return { ...createDefaultEntry({ key, content: `content ${key}`, namespace: 'ns' }), embedding: vec(seed) };
}

describe('RvfBackend (#4279)', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-mem-rvf-4279-'));
    dbPath = path.join(dir, 'memory.rvf');
    rvfFactories.create.mockClear();
    rvfFactories.open.mockClear();
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  function backend(): RvfBackend {
    return new RvfBackend({ databasePath: dbPath, dimensions: DIM, autoPersistInterval: 0 });
  }

  it('reloads existing entries on reopen and keeps them on the next persist', async () => {
    const first = backend();
    await first.initialize();
    await first.store(entry('a', 1));
    await first.store(entry('b', 2));
    await first.shutdown();

    const second = backend();
    await second.initialize();
    expect(await second.count()).toBe(2);
    expect((await second.getByKey('ns', 'a'))?.content).toBe('content a');

    await second.store(entry('c', 3));
    await second.shutdown();

    const raw = fs.readFileSync(dbPath);
    expect(raw.subarray(0, 4).toString('latin1')).toBe('RVF\0');

    const third = backend();
    await third.initialize();
    expect(await third.count()).toBe(3);
    const hits = await third.search(vec(2), { k: 1 });
    expect(hits[0]?.entry.key).toBe('b');
    await third.shutdown();
  });

  it('never opens a native @ruvector/rvf store', async () => {
    const b = backend();
    await b.initialize();
    await b.store(entry('a', 1));
    await b.shutdown();

    expect(rvfFactories.create).not.toHaveBeenCalled();
    expect(rvfFactories.open).not.toHaveBeenCalled();
  });

  it('reports a healthy index without recommending @ruvector/rvf', async () => {
    const b = backend();
    await b.initialize();
    const health = await b.healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.components.index.status).toBe('healthy');
    expect(health.recommendations.join(' ')).not.toContain('@ruvector/rvf');
    await b.shutdown();
  });
});
