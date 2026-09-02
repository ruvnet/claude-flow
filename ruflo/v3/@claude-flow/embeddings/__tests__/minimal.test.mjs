/**
 * Minimal tests - no heavy deps
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Only import lightweight utilities
import {
  chunkText,
  estimateTokens,
} from '../dist/chunking.js';

import {
  l2Normalize,
  l2Norm,
  isNormalized,
} from '../dist/normalization.js';

import {
  euclideanToPoincare,
  isInPoincareBall,
} from '../dist/hyperbolic.js';

describe('Chunking', () => {
  test('chunks text', () => {
    const result = chunkText('Hello world. This is a test.', { maxChunkSize: 15, strategy: 'character' });
    assert.ok(result.totalChunks > 0);
  });

  test('estimates tokens', () => {
    assert.equal(estimateTokens('Hello world'), 3);
  });
});

describe('Normalization', () => {
  test('L2 normalize', () => {
    const vec = new Float32Array([3, 4, 0]);
    const normalized = l2Normalize(vec);
    assert.ok(Math.abs(l2Norm(normalized) - 1) < 1e-5);
  });

  test('isNormalized', () => {
    const vec = new Float32Array([3, 4, 0]);
    assert.ok(!isNormalized(vec));
    assert.ok(isNormalized(l2Normalize(vec)));
  });
});

describe('Hyperbolic', () => {
  test('euclideanToPoincare stays in ball', () => {
    const vec = new Float32Array([0.5, 0.3, 0.2]);
    const poincare = euclideanToPoincare(vec);
    assert.ok(isInPoincareBall(poincare));
  });
});

console.log('Minimal tests completed!');
