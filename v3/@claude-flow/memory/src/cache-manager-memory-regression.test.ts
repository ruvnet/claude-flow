import { afterEach, describe, it, expect } from 'vitest';
import { CacheManager } from './cache-manager.js';
const caches: CacheManager<string>[] = [];
afterEach(() => {
  for (const cache of caches.splice(0)) cache.shutdown();
});
function create(maxMemory = 1000): CacheManager<string> {
  const cache = new CacheManager<string>({ maxMemory });
  caches.push(cache);
  return cache;
}
describe('replacement memory accounting', () => {
  it('accounts for growing and shrinking entries and returns to zero after deletion', () => {
    const cache = create();
    cache.set('a', 'small');
    cache.set('a', 'a larger replacement');
    expect(cache.getStats().memoryUsage).toBe(
      JSON.stringify('a larger replacement').length * 2,
    );
    cache.set('a', 'x');
    expect(cache.getStats().memoryUsage).toBe(6);
    cache.delete('a');
    expect(cache.getStats().memoryUsage).toBe(0);
  });
  it('evicts an older neighbor when a fitting replacement needs room', () => {
    const cache = create(32);
    cache.set('a', '1234');
    cache.set('b', '1234');
    cache.set('a', '1234567890');
    expect(cache.get('a')).toBe('1234567890');
    expect(cache.get('b')).toBeNull();
    expect(cache.getStats().memoryUsage).toBe(24);
  });
  it('skips oversized entries without evicting unrelated valid values or retaining a stale replacement', () => {
    const cache = create(32);
    cache.set('a', 'old');
    cache.set('b', 'valid');
    cache.set('new', 'x'.repeat(100));
    expect(cache.get('a')).toBe('old');
    expect(cache.get('b')).toBe('valid');
    cache.set('a', 'x'.repeat(100));
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe('valid');
    expect(cache.getStats().memoryUsage).toBe(14);
  });
});
