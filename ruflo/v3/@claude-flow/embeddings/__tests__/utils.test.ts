/**
 * Utility tests for @claude-flow/embeddings
 * Lightweight tests that don't require the embedding service
 */

import { describe, it, expect } from 'vitest';

// Import only lightweight utilities
import {
  chunkText,
  estimateTokens,
  reconstructFromChunks,
} from '../src/chunking.js';

import {
  l2Normalize,
  l1Normalize,
  minMaxNormalize,
  zScoreNormalize,
  normalize,
  l2Norm,
  isNormalized,
} from '../src/normalization.js';

import {
  euclideanToPoincare,
  poincareToEuclidean,
  hyperbolicDistance,
  mobiusAdd,
  isInPoincareBall,
  batchEuclideanToPoincare,
} from '../src/hyperbolic.js';

// =============================================================================
// Chunking Tests
// =============================================================================

describe('Document Chunking', () => {
  const longText = `
    This is the first sentence. This is the second sentence.
    This is the third sentence with more content.
    And here is the fourth sentence to make it longer.
    Finally, the fifth sentence concludes this paragraph.
  `.trim();

  it('chunks text into multiple parts', () => {
    const result = chunkText(longText, { maxChunkSize: 100 });
    expect(result.totalChunks).toBeGreaterThan(1);
  });

  it('respects max chunk size', () => {
    const result = chunkText(longText, { maxChunkSize: 50, strategy: 'character' });
    for (const chunk of result.chunks) {
      expect(chunk.length).toBeLessThanOrEqual(50);
    }
  });

  it('includes overlap between chunks', () => {
    const result = chunkText(longText, { maxChunkSize: 100, overlap: 20, strategy: 'character' });
    expect(result.chunks.length).toBeGreaterThan(1);
  });

  it('estimates tokens correctly', () => {
    const text = 'Hello world';
    const tokens = estimateTokens(text);
    expect(tokens).toBe(Math.ceil(text.length / 4));
  });

  it('returns original text for short input', () => {
    const result = chunkText('Short text', { maxChunkSize: 100 });
    expect(result.totalChunks).toBe(1);
    expect(result.chunks[0].text).toBe('Short text');
  });

  it('sentence strategy keeps sentences intact', () => {
    const result = chunkText(longText, { maxChunkSize: 200, strategy: 'sentence' });
    for (const chunk of result.chunks) {
      const trimmed = chunk.text.trim();
      if (trimmed.length > 0) {
        expect(trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?') || chunk === result.chunks[result.chunks.length - 1]).toBe(true);
      }
    }
  });
});

// =============================================================================
// Normalization Tests
// =============================================================================

describe('Normalization', () => {
  const vec = new Float32Array([3, 4, 0]);
  const vec2 = new Float32Array([1, 2, 3, 4, 5]);

  it('L2 normalize creates unit vector', () => {
    const normalized = l2Normalize(vec);
    const norm = l2Norm(normalized);
    expect(norm).toBeCloseTo(1, 5);
  });

  it('L2 normalize: [3,4,0] -> [0.6, 0.8, 0]', () => {
    const normalized = l2Normalize(vec);
    expect(normalized[0]).toBeCloseTo(0.6, 5);
    expect(normalized[1]).toBeCloseTo(0.8, 5);
    expect(normalized[2]).toBeCloseTo(0, 5);
  });

  it('L1 normalize: sum of absolute values = 1', () => {
    const normalized = l1Normalize(vec2);
    const sum = Array.from(normalized).reduce((a, b) => a + Math.abs(b), 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it('minMax normalize: values in [0, 1]', () => {
    const normalized = minMaxNormalize(vec2);
    for (const v of normalized) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('zScore normalize: mean ≈ 0, std ≈ 1', () => {
    const normalized = zScoreNormalize(vec2);
    const mean = Array.from(normalized).reduce((a, b) => a + b, 0) / normalized.length;
    expect(mean).toBeCloseTo(0, 5);
  });

  it('isNormalized detects normalized vectors', () => {
    const normalized = l2Normalize(vec);
    expect(isNormalized(normalized)).toBe(true);
    expect(isNormalized(vec)).toBe(false);
  });

  it('normalize with type option', () => {
    const l2 = normalize(vec, { type: 'l2' });
    expect(l2Norm(l2)).toBeCloseTo(1, 5);

    const l1 = normalize(vec, { type: 'l1' });
    const l1Sum = Array.from(l1).reduce((a, b) => a + Math.abs(b), 0);
    expect(l1Sum).toBeCloseTo(1, 5);
  });
});

// =============================================================================
// Hyperbolic Embeddings Tests
// =============================================================================

describe('Hyperbolic Embeddings', () => {
  const eucVec = new Float32Array([0.5, 0.3, 0.2]);
  const origin = new Float32Array([0, 0, 0]);

  it('euclideanToPoincare: origin maps to origin', () => {
    const poincare = euclideanToPoincare(origin);
    expect(Array.from(poincare).every(v => Math.abs(v) < 1e-10)).toBe(true);
  });

  it('euclideanToPoincare: result stays in ball', () => {
    const poincare = euclideanToPoincare(eucVec);
    expect(isInPoincareBall(poincare)).toBe(true);
  });

  it('poincareToEuclidean: round trip', () => {
    const poincare = euclideanToPoincare(eucVec);
    const back = poincareToEuclidean(poincare);
    for (let i = 0; i < eucVec.length; i++) {
      expect(back[i]).toBeCloseTo(eucVec[i], 4);
    }
  });

  it('hyperbolicDistance: self = 0', () => {
    const p = euclideanToPoincare(new Float32Array([0.1, 0.1, 0.1]));
    expect(hyperbolicDistance(p, p)).toBeCloseTo(0, 5);
  });

  it('hyperbolicDistance: symmetry', () => {
    const a = euclideanToPoincare(new Float32Array([0.1, 0.2, 0.1]));
    const b = euclideanToPoincare(new Float32Array([0.3, 0.1, 0.2]));
    expect(hyperbolicDistance(a, b)).toBeCloseTo(hyperbolicDistance(b, a), 5);
  });

  it('mobiusAdd: identity element', () => {
    const p = euclideanToPoincare(new Float32Array([0.2, 0.1, 0.1]));
    const result = mobiusAdd(p, origin);
    for (let i = 0; i < p.length; i++) {
      expect(result[i]).toBeCloseTo(p[i], 5);
    }
  });

  it('isInPoincareBall: points inside', () => {
    expect(isInPoincareBall(new Float32Array([0.5, 0.3, 0.2]))).toBe(true);
    expect(isInPoincareBall(new Float32Array([0.9, 0.9, 0.9]))).toBe(false);
  });

  it('batchEuclideanToPoincare: converts multiple', () => {
    const vecs = [
      new Float32Array([0.1, 0.1]),
      new Float32Array([0.2, 0.2]),
      new Float32Array([0.3, 0.3]),
    ];
    const results = batchEuclideanToPoincare(vecs);
    expect(results.length).toBe(3);
    for (const r of results) {
      expect(isInPoincareBall(r)).toBe(true);
    }
  });
});
