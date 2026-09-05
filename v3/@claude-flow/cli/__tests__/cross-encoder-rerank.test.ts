// Cross-encoder reranker — graceful-degradation tests (ADR-080).
//
// We don't run the actual cross-encoder here (network + 30MB model download
// would make the test suite flaky). Instead we verify the fallback contract:
// when the model can't be loaded the API must still return a well-shaped
// answer (input order preserved, score=0) so callers never break.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  crossEncoderRerank,
  getCrossEncoder,
  getCrossEncoderStatus,
  resetCrossEncoder,
} from '../src/memory/cross-encoder-rerank.js';

describe('crossEncoderRerank — graceful degradation contract', () => {
  beforeEach(() => {
    resetCrossEncoder();
  });

  it('returns input order with score=0 when model name is invalid', async () => {
    // Force the loader to fail by passing a guaranteed-bad model name.
    const ce = await getCrossEncoder('does-not-exist/no-such-model-anywhere');
    expect(ce).toBeNull();

    // Even though the model failed, rerank() must still return a usable
    // ranking — caller falls back to hybrid order.
    const out = await crossEncoderRerank('query', ['doc1', 'doc2', 'doc3']);
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(out.every((r) => r.score === 0)).toBe(true);
  });

  it('respects topK when degraded', async () => {
    resetCrossEncoder();
    // Trigger a failure first
    await getCrossEncoder('does-not-exist/no-such-model-anywhere');
    const out = await crossEncoderRerank('query', ['a', 'b', 'c', 'd', 'e'], 2);
    expect(out).toHaveLength(2);
  });

  it('handles empty doc list', async () => {
    const out = await crossEncoderRerank('query', []);
    expect(out).toEqual([]);
  });

  it('getCrossEncoderStatus reports loaded=false after failed load', async () => {
    resetCrossEncoder();
    await getCrossEncoder('does-not-exist/no-such-model-anywhere');
    const status = getCrossEncoderStatus();
    expect(status.attempted).toBe(true);
    expect(status.loaded).toBe(false);
    expect(status.error).toBeTruthy();
  });

  it('does not retry after a failure (one-shot load policy)', async () => {
    resetCrossEncoder();
    const first = await getCrossEncoder('does-not-exist/no-such-model-anywhere');
    expect(first).toBeNull();
    // Subsequent call should NOT re-attempt — returns null immediately.
    const tStart = Date.now();
    const second = await getCrossEncoder('any-other-name');
    const elapsed = Date.now() - tStart;
    expect(second).toBeNull();
    expect(elapsed).toBeLessThan(50); // No retry; instant return.
  });
});
