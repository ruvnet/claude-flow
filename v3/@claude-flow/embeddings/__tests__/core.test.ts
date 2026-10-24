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

  it('terminates when overlap >= maxChunkSize (character strategy)', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'.repeat(4); // 104 chars
    for (const [maxChunkSize, overlap] of [[30, 50], [50, 50], [10, 10], [1, 5]]) {
      const result = chunkText(text, { maxChunkSize, overlap, strategy: 'character' });
      // Without the guard this loops forever; a bounded count proves termination
      expect(result.totalChunks).toBeGreaterThan(0);
      expect(result.totalChunks).toBeLessThanOrEqual(text.length);
      for (const chunk of result.chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.length).toBeLessThanOrEqual(maxChunkSize);
      }
      // Chunks start in strictly increasing order and cover the whole text
      for (let i = 1; i < result.chunks.length; i++) {
        expect(result.chunks[i].startPos).toBeGreaterThan(result.chunks[i - 1].startPos);
        expect(result.chunks[i].startPos).toBeLessThanOrEqual(result.chunks[i - 1].endPos);
      }
      expect(result.chunks[0].startPos).toBe(0);
      expect(result.chunks[result.chunks.length - 1].endPos).toBe(text.length);
    }
  });

  it('keeps the existing output for a valid overlap (character strategy)', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'; // 26 chars
    const result = chunkText(text, { maxChunkSize: 10, overlap: 3, strategy: 'character' });
    expect(result.chunks.map(c => [c.startPos, c.endPos])).toEqual([
      [0, 10],
      [7, 17],
      [14, 24],
      [21, 26],
    ]);
    expect(result.chunks.map(c => c.text)).toEqual([
      'abcdefghij',
      'hijklmnopq',
      'opqrstuvwx',
      'vwxyz',
    ]);
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
