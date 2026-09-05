/**
 * Regression guard for #2727 dream-cycle IB+VQ-inspired message
 * compressor (v1 MVP — TF-IDF sparsification with must-preserve span
 * extraction; v2 will land a real VQ codec).
 *
 * Compressor must:
 *   1. Preserve code fences, inline code, URLs, and file paths verbatim.
 *   2. Reduce size when budgetTokens < original tokens.
 *   3. Reassemble kept sentences in original order (not score order).
 *   4. Report accurate stats.
 */

import { describe, it, expect } from 'vitest';
import { compressMessage, estimateTokens } from '../src/swarm/message-compressor.js';

const LONG_MESSAGE = [
  'The authentication module is currently unstable under high concurrency.',
  'When more than 20 concurrent sessions attempt token refresh, the JWT verifier throws.',
  'We think this is a race condition in the token cache eviction path.',
  'The relevant file is src/auth/jwt-verifier.ts and it uses the JWT library from npm.',
  'A code excerpt: ```ts\nconst t = verify(token, PUBLIC_KEY);\n```',
  'You can reproduce by running the load test at https://internal.example.com/loadtest/jwt.',
  'The problem does not appear with fewer than 10 concurrent sessions.',
  'We suspect the LRU cache does not lock on concurrent writes.',
  'One workaround is to switch to a mutex-protected cache implementation.',
  'The impact is that under peak load, roughly 3% of auth requests fail.',
  'Failed requests return a 500 with a generic error message.',
  'Users see a login prompt again which resets their session.',
  'The failure rate is unacceptable for production traffic.',
  'We need to prioritize this fix in the current sprint.',
  'The estimated engineering time is two person-days.',
].join(' ');

describe('#2727 message compressor', () => {
  it('preserves a code fence verbatim in the output', () => {
    const r = compressMessage(LONG_MESSAGE, { budgetTokens: 100 });
    expect(r.compressed).toContain('```ts');
    expect(r.compressed).toContain('verify(token, PUBLIC_KEY)');
    expect(r.stats.preservedSpans).toBeGreaterThan(0);
  });

  it('preserves URLs verbatim', () => {
    const r = compressMessage(LONG_MESSAGE, { budgetTokens: 100 });
    expect(r.compressed).toContain('https://internal.example.com/loadtest/jwt');
  });

  it('preserves file paths verbatim', () => {
    const r = compressMessage(LONG_MESSAGE, { budgetTokens: 100 });
    expect(r.compressed).toContain('src/auth/jwt-verifier.ts');
  });

  it('reduces token count when budget is < original', () => {
    const r = compressMessage(LONG_MESSAGE, { budgetTokens: 80 });
    expect(r.stats.compressedTokens).toBeLessThan(r.stats.originalTokens);
    expect(r.stats.compressionRatio).toBeLessThan(1);
  });

  it('reports accurate sentence counts', () => {
    const r = compressMessage(LONG_MESSAGE, { budgetTokens: 60 });
    expect(r.stats.sentencesTotal).toBeGreaterThan(5);
    expect(r.stats.sentencesKept).toBeGreaterThan(0);
    expect(r.stats.sentencesKept).toBeLessThanOrEqual(r.stats.sentencesTotal);
  });

  it('reassembles kept sentences in original order (not score order)', () => {
    const src = [
      'A quick short intro.',
      'This is the load-bearing middle sentence that mentions authentication and JWT and race.',
      'A trailing note.',
    ].join(' ');
    const r = compressMessage(src, { budgetTokens: 40 });
    // If kept, "quick short intro" must appear before "trailing note" (order preserved).
    if (r.compressed.includes('quick short intro') && r.compressed.includes('trailing note')) {
      const introIdx = r.compressed.indexOf('quick short intro');
      const trailIdx = r.compressed.indexOf('trailing note');
      expect(introIdx).toBeLessThan(trailIdx);
    }
  });

  it('is a no-op when budget already exceeds original size', () => {
    const short = 'Just a short handoff message with no compression needed.';
    const r = compressMessage(short, { budgetTokens: 1000 });
    expect(r.compressed).toContain('short handoff message');
    expect(r.stats.compressionRatio).toBeGreaterThanOrEqual(0.9);
  });

  it('estimateTokens matches the ~4-chars-per-token rule', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('honors mode=keyword vs mode=sentence (may produce different outputs)', () => {
    const rk = compressMessage(LONG_MESSAGE, { budgetTokens: 60, mode: 'keyword' });
    const rs = compressMessage(LONG_MESSAGE, { budgetTokens: 60, mode: 'sentence' });
    // Both should be under the original size (main invariant).
    expect(rk.stats.compressionRatio).toBeLessThan(1);
    expect(rs.stats.compressionRatio).toBeLessThan(1);
  });
});
