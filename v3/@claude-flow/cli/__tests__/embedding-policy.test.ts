/**
 * Embedding policy — "no more stubs" enforcement (RUFLO_REQUIRE_REAL_EMBEDDINGS).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { requireRealEmbeddings, enforceNoStub } from '../src/memory/embedding-policy.js';

const KEY = 'RUFLO_REQUIRE_REAL_EMBEDDINGS';
afterEach(() => { delete process.env[KEY]; });

describe('embedding policy (no-stub strict mode)', () => {
  it('is off by default — enforceNoStub is a no-op (degrade allowed)', () => {
    delete process.env[KEY];
    expect(requireRealEmbeddings()).toBe(false);
    expect(() => enforceNoStub('x')).not.toThrow();
  });

  it('when strict, a hash last-resort THROWS loudly instead of returning a stub', () => {
    for (const v of ['1', 'true', 'strict', 'on']) {
      process.env[KEY] = v;
      expect(requireRealEmbeddings()).toBe(true);
      expect(() => enforceNoStub('neural-tools.generateEmbedding')).toThrow(/no-stub.*real embeddings required/i);
    }
  });
});
