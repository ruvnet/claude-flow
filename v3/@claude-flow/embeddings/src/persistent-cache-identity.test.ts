import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PersistentEmbeddingCache } from './persistent-cache.js';
const dirs: string[] = [];
const caches: PersistentEmbeddingCache[] = [];
afterEach(async () => {
  for (const cache of caches.splice(0)) await cache.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function create(dbPath: string) {
  const cache = new PersistentEmbeddingCache({ dbPath });
  caches.push(cache);
  return cache;
}
describe('persistent embedding text identity', () => {
  it('keeps equal-length FNV collisions distinct across writes and reopening', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-cache-identity-'));
    dirs.push(dir);
    const path = join(dir, 'embeddings.sqlite');
    const cache = create(path);
    await cache.set('0004hiu', new Float32Array([1, 2]));
    expect(await cache.get('000b0yd')).toBeNull();
    await cache.set('000b0yd', new Float32Array([3, 4]));
    expect(Array.from((await cache.get('0004hiu'))!)).toEqual([1, 2]);
    expect(Array.from((await cache.get('000b0yd'))!)).toEqual([3, 4]);
    await cache.close();
    const reopened = create(path);
    expect(Array.from((await reopened.get('0004hiu'))!)).toEqual([1, 2]);
    expect(Array.from((await reopened.get('000b0yd'))!)).toEqual([3, 4]);
  });
  it('preserves distinct JavaScript code units for lone surrogate inputs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ruflo-cache-surrogate-'));
    dirs.push(dir);
    const cache = create(join(dir, 'embeddings.sqlite'));
    await cache.set('\ud800', new Float32Array([1]));
    expect(await cache.get('\ud801')).toBeNull();
    await cache.set('\ud801', new Float32Array([2]));
    expect(Array.from((await cache.get('\ud800'))!)).toEqual([1]);
    expect(Array.from((await cache.get('\ud801'))!)).toEqual([2]);
  });
});
