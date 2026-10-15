import { afterEach, describe, it, expect } from 'vitest';
import { CacheManager } from './cache-manager.js';
const caches: CacheManager<string>[] = [];
afterEach(() => {
  for (const cache of caches.splice(0)) cache.shutdown();
});
describe('stateful cache invalidation patterns', () => {
  it.each([/article/g, /article/y])(
    'invalidates every matching entry with %s',
    (pattern) => {
      const cache = new CacheManager<string>();
      caches.push(cache);
      cache.set('article-one', 'old result one');
      cache.set('article-two', 'old result two');
      cache.set('article-three', 'old result three');
      cache.set('unrelated', 'valid');
      expect(cache.invalidatePattern(pattern)).toBe(3);
      expect(cache.keys()).toEqual(['unrelated']);
    },
  );
  it('preserves the caller pattern cursor instead of skipping the first key', () => {
    const cache = new CacheManager<string>();
    caches.push(cache);
    cache.set('article-one', 'old');
    const pattern = /article/g;
    pattern.lastIndex = 4;
    expect(cache.invalidatePattern(pattern)).toBe(1);
    expect(pattern.lastIndex).toBe(4);
  });
  it('accepts a frozen non-global pattern without mutating its cursor', () => {
    const cache = new CacheManager<string>();
    caches.push(cache);
    cache.set('article-one', 'old');
    const pattern = Object.freeze(/article/);
    expect(cache.invalidatePattern(pattern)).toBe(1);
    expect(pattern.lastIndex).toBe(0);
  });
});
