import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentEmbeddingCache } from './persistent-cache.js';
const observed = vi.hoisted(() => ({ loads: 0 }));
vi.mock('sql.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sql.js')>();
  return {
    ...actual,
    default: async (...args: Parameters<typeof actual.default>) => {
      observed.loads++;
      return actual.default(...args);
    },
  };
});
const dirs: string[] = [];
const caches: PersistentEmbeddingCache[] = [];
beforeEach(() => {
  observed.loads = 0;
});
afterEach(async () => {
  for (const cache of caches.splice(0)) await cache.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
describe('persistent cache initialization', () => {
  it('uses one real SQLite initialization for concurrent cold callers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-cache-init-'));
    dirs.push(dir);
    const cache = new PersistentEmbeddingCache({
      dbPath: join(dir, 'cache.sqlite'),
    });
    caches.push(cache);
    await Promise.all([
      cache.set('a', new Float32Array([1])),
      cache.set('b', new Float32Array([2])),
      cache.set('c', new Float32Array([3])),
    ]);
    expect(observed.loads).toBe(1);
    expect((await cache.getStats()).size).toBe(3);
    expect(Array.from((await cache.get('a'))!)).toEqual([1]);
    expect(Array.from((await cache.get('b'))!)).toEqual([2]);
    expect(Array.from((await cache.get('c'))!)).toEqual([3]);
  });
});
