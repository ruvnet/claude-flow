/**
 * Core utility tests for @claude-flow/embeddings
 * Tests chunking, normalization, and hyperbolic without heavy deps
 */

import { describe, it, expect } from 'vitest';

// Import only lightweight utilities - not embedding-service
import {
  chunkText,
  estimateTokens,
} from '../src/chunking.js';

import {
  l2Normalize,
  l2Norm,
  isNormalized,
} from '../src/normalization.js';

import {
  euclideanToPoincare,
  isInPoincareBall,
} from '../src/hyperbolic.js';

describe('Chunking', () => {
  it('chunks text into multiple parts', () => {
    const text = 'Hello world. This is a test. Another sentence here.';
    const result = chunkText(text, { maxChunkSize: 30, strategy: 'character' });
    expect(result.totalChunks).toBeGreaterThan(1);
  });

  it('estimates tokens correctly', () => {
    expect(estimateTokens('Hello world')).toBe(3);
  });

  it('returns original text for short input', () => {
    const result = chunkText('Short', { maxChunkSize: 100 });
    expect(result.totalChunks).toBe(1);
  });
});

describe('Normalization', () => {
  it('L2 normalize creates unit vector', () => {
    const vec = new Float32Array([3, 4, 0]);
    const normalized = l2Normalize(vec);
    expect(l2Norm(normalized)).toBeCloseTo(1, 5);
  });

  it('isNormalized detects normalized vectors', () => {
    const vec = new Float32Array([3, 4, 0]);
    expect(isNormalized(vec)).toBe(false);
    expect(isNormalized(l2Normalize(vec))).toBe(true);
  });
});

describe('Hyperbolic', () => {
  it('euclideanToPoincare stays in ball', () => {
    const vec = new Float32Array([0.5, 0.3, 0.2]);
    const poincare = euclideanToPoincare(vec);
    expect(isInPoincareBall(poincare)).toBe(true);
  });

  it('origin maps to origin', () => {
    const origin = new Float32Array([0, 0, 0]);
    const poincare = euclideanToPoincare(origin);
    expect(Array.from(poincare).every(v => Math.abs(v) < 1e-10)).toBe(true);
  });
});
