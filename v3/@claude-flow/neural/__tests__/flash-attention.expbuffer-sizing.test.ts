/**
 * Regression test for a Dream Cycle 2026-08-15 finding: FlashAttention's
 * cpuOptimizedAttention() sized its internal expBuffer off `useTopK` alone
 * (numK > 32), but the branch it actually takes is gated by
 * `useTopK && numK > 128`. For 32 < numK <= 128 the code fell through to the
 * "simple" full-softmax path and read `exps[ki]` for ki up to numK-1 from a
 * buffer sized only to `topK` (<=96, and as low as 16) — Float32Array reads
 * past `.length` return `undefined`, so `weight = exps[ki] * invSum` became
 * NaN and every output element for every query in that range was corrupted,
 * silently (no throw, no NaN check anywhere in the call chain).
 *
 * See docs/dream-cycle/2026-08-15-performance-sota.md and
 * docs/dream-cycle/evidence/2026-08-15-performance/ for the full evaluation
 * receipt, independent repro, and bounded Darwin exploration of alternative
 * fixes that led to the shipped fix below.
 */

import { describe, it, expect } from 'vitest';
import { FlashAttention } from '../src/flash-attention.js';

function makeVectors(count: number, dim: number, seedOffset: number): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const v = new Float32Array(dim);
    for (let d = 0; d < dim; d++) {
      v[d] = Math.sin(seedOffset + i * dim + d) * 0.5;
    }
    out.push(v);
  }
  return out;
}

function hasNonFinite(vectors: Float32Array[]): boolean {
  return vectors.some((v) => v.some((x) => !Number.isFinite(x)));
}

describe('FlashAttention.cpuOptimizedAttention — expBuffer sizing (2026-08-15 fix)', () => {
  it('produces finite output across the full previously-buggy 33..128 key range', () => {
    for (const numKeys of [33, 48, 64, 96, 100, 128]) {
      const fa = new FlashAttention({ dimensions: 32 });
      const Q = makeVectors(4, 32, 1);
      const K = makeVectors(numKeys, 32, 2);
      const V = makeVectors(numKeys, 32, 3);

      const output = fa.attention(Q, K, V).output;

      expect(hasNonFinite(output), `numKeys=${numKeys} produced non-finite output`).toBe(false);
    }
  });

  it('matches exact (naive) attention closely in the fixed range — the "simple path" is a full softmax, not an approximation', () => {
    const fa = new FlashAttention({ dimensions: 32, useCPUOptimizations: false });
    const faOptimized = new FlashAttention({ dimensions: 32 });
    const Q = makeVectors(4, 32, 10);
    const K = makeVectors(64, 32, 20);
    const V = makeVectors(64, 32, 30);

    // useCPUOptimizations:false + numK*numQ<=1024 threshold won't reliably hit
    // naiveAttention via the public API for this size, so exercise the exact
    // benchmark() path instead, which now reports rmse directly.
    const result = faOptimized.benchmark(64, 32, 2);
    expect(Number.isFinite(result.rmse)).toBe(true);
    expect(result.rmse).toBeLessThan(0.01);
  });

  it('is unaffected for numK <= 32 and numK > 128 (no regression outside the buggy range)', () => {
    for (const numKeys of [8, 32, 129, 256]) {
      const fa = new FlashAttention({ dimensions: 32 });
      const Q = makeVectors(4, 32, 100);
      const K = makeVectors(numKeys, 32, 200);
      const V = makeVectors(numKeys, 32, 300);

      const output = fa.attention(Q, K, V).output;
      expect(hasNonFinite(output), `numKeys=${numKeys} unexpectedly produced non-finite output`).toBe(false);
    }
  });

  it('topKFraction defaults to 0.12, preserving pre-existing behavior for callers that do not configure it', () => {
    const fa = new FlashAttention();
    expect(fa.getConfig().topKFraction).toBe(0.12);
  });
});
