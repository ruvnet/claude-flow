/**
 * Simple Node.js test for @claude-flow/embeddings utilities
 * Uses Node's native test runner to avoid vitest memory issues
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Import directly from compiled dist
import {
  chunkText,
  estimateTokens,
} from '../dist/chunking.js';

import {
  l2Normalize,
  l1Normalize,
  minMaxNormalize,
  zScoreNormalize,
  l2Norm,
  isNormalized,
} from '../dist/normalization.js';

import {
  euclideanToPoincare,
  poincareToEuclidean,
  hyperbolicDistance,
  mobiusAdd,
  isInPoincareBall,
  batchEuclideanToPoincare,
} from '../dist/hyperbolic.js';

import {
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  MockEmbeddingService,
} from '../dist/embedding-service.js';

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

  test('chunks text into multiple parts', () => {
    const result = chunkText(longText, { maxChunkSize: 100 });
    assert.ok(result.totalChunks > 1);
  });

  test('respects max chunk size', () => {
    const result = chunkText(longText, { maxChunkSize: 50, strategy: 'character' });
    for (const chunk of result.chunks) {
      assert.ok(chunk.length <= 50);
    }
  });

  test('estimates tokens correctly', () => {
    const text = 'Hello world';
    const tokens = estimateTokens(text);
    assert.equal(tokens, Math.ceil(text.length / 4));
  });

  test('returns original text for short input', () => {
    const result = chunkText('Short text', { maxChunkSize: 100 });
    assert.equal(result.totalChunks, 1);
    assert.equal(result.chunks[0].text, 'Short text');
  });
});

// =============================================================================
// Normalization Tests
// =============================================================================

describe('Normalization', () => {
  const vec = new Float32Array([3, 4, 0]);
  const vec2 = new Float32Array([1, 2, 3, 4, 5]);

  test('L2 normalize creates unit vector', () => {
    const normalized = l2Normalize(vec);
    const norm = l2Norm(normalized);
    assert.ok(Math.abs(norm - 1) < 1e-5);
  });

  test('L2 normalize: [3,4,0] -> [0.6, 0.8, 0]', () => {
    const normalized = l2Normalize(vec);
    assert.ok(Math.abs(normalized[0] - 0.6) < 1e-5);
    assert.ok(Math.abs(normalized[1] - 0.8) < 1e-5);
    assert.ok(Math.abs(normalized[2]) < 1e-5);
  });

  test('L1 normalize: sum of absolute values = 1', () => {
    const normalized = l1Normalize(vec2);
    let sum = 0;
    for (const v of normalized) sum += Math.abs(v);
    assert.ok(Math.abs(sum - 1) < 1e-5);
  });

  test('minMax normalize: values in [0, 1]', () => {
    const normalized = minMaxNormalize(vec2);
    for (const v of normalized) {
      assert.ok(v >= 0 && v <= 1);
    }
  });

  test('zScore normalize: mean ≈ 0', () => {
    const normalized = zScoreNormalize(vec2);
    let sum = 0;
    for (const v of normalized) sum += v;
    const mean = sum / normalized.length;
    assert.ok(Math.abs(mean) < 1e-5);
  });

  test('isNormalized detects normalized vectors', () => {
    const normalized = l2Normalize(vec);
    assert.ok(isNormalized(normalized));
    assert.ok(!isNormalized(vec));
  });
});

// =============================================================================
// Hyperbolic Tests
// =============================================================================

describe('Hyperbolic Embeddings', () => {
  const eucVec = new Float32Array([0.5, 0.3, 0.2]);
  const origin = new Float32Array([0, 0, 0]);

  test('euclideanToPoincare: origin maps to origin', () => {
    const poincare = euclideanToPoincare(origin);
    assert.ok(Array.from(poincare).every(v => Math.abs(v) < 1e-10));
  });

  test('euclideanToPoincare: result stays in ball', () => {
    const poincare = euclideanToPoincare(eucVec);
    assert.ok(isInPoincareBall(poincare));
  });

  test('poincareToEuclidean: round trip', () => {
    const poincare = euclideanToPoincare(eucVec);
    const back = poincareToEuclidean(poincare);
    for (let i = 0; i < eucVec.length; i++) {
      assert.ok(Math.abs(back[i] - eucVec[i]) < 1e-4);
    }
  });

  test('hyperbolicDistance: self = 0', () => {
    const p = euclideanToPoincare(new Float32Array([0.1, 0.1, 0.1]));
    assert.ok(Math.abs(hyperbolicDistance(p, p)) < 1e-5);
  });

  test('hyperbolicDistance: symmetry', () => {
    const a = euclideanToPoincare(new Float32Array([0.1, 0.2, 0.1]));
    const b = euclideanToPoincare(new Float32Array([0.3, 0.1, 0.2]));
    assert.ok(Math.abs(hyperbolicDistance(a, b) - hyperbolicDistance(b, a)) < 1e-5);
  });

  test('mobiusAdd: identity element', () => {
    const p = euclideanToPoincare(new Float32Array([0.2, 0.1, 0.1]));
    const result = mobiusAdd(p, origin);
    for (let i = 0; i < p.length; i++) {
      assert.ok(Math.abs(result[i] - p[i]) < 1e-5);
    }
  });

  test('isInPoincareBall: points inside/outside', () => {
    assert.ok(isInPoincareBall(new Float32Array([0.5, 0.3, 0.2])));
    assert.ok(!isInPoincareBall(new Float32Array([0.9, 0.9, 0.9])));
  });

  test('batchEuclideanToPoincare: converts multiple', () => {
    const vecs = [
      new Float32Array([0.1, 0.1]),
      new Float32Array([0.2, 0.2]),
      new Float32Array([0.3, 0.3]),
    ];
    const results = batchEuclideanToPoincare(vecs);
    assert.equal(results.length, 3);
    for (const r of results) {
      assert.ok(isInPoincareBall(r));
    }
  });
});

// =============================================================================
// Similarity Tests
// =============================================================================

describe('Similarity Functions', () => {
  const vecA = new Float32Array([1, 0, 0]);
  const vecB = new Float32Array([0, 1, 0]);
  const vecC = new Float32Array([1, 0, 0]);

  test('cosine similarity: identical vectors = 1', () => {
    assert.ok(Math.abs(cosineSimilarity(vecA, vecC) - 1) < 1e-5);
  });

  test('cosine similarity: orthogonal vectors = 0', () => {
    assert.ok(Math.abs(cosineSimilarity(vecA, vecB)) < 1e-5);
  });

  test('euclidean distance: same vectors = 0', () => {
    assert.ok(Math.abs(euclideanDistance(vecA, vecC)) < 1e-5);
  });

  test('euclidean distance: orthogonal unit vectors', () => {
    assert.ok(Math.abs(euclideanDistance(vecA, vecB) - Math.sqrt(2)) < 1e-5);
  });

  test('dot product: orthogonal = 0', () => {
    assert.ok(Math.abs(dotProduct(vecA, vecB)) < 1e-5);
  });

  test('dot product: same unit vector = 1', () => {
    assert.ok(Math.abs(dotProduct(vecA, vecC) - 1) < 1e-5);
  });
});

// =============================================================================
// MockEmbeddingService Tests
// =============================================================================

describe('MockEmbeddingService', async () => {
  test('generates embeddings with correct dimensions', async () => {
    const service = new MockEmbeddingService({ dimensions: 384 });
    const result = await service.embed('test text');
    assert.ok(result.embedding instanceof Float32Array);
    assert.equal(result.embedding.length, 384);
  });

  test('generates deterministic embeddings for same text', async () => {
    const service = new MockEmbeddingService({ dimensions: 384 });
    const result1 = await service.embed('hello world');
    const result2 = await service.embed('hello world');
    assert.deepEqual(Array.from(result1.embedding), Array.from(result2.embedding));
  });

  test('generates different embeddings for different text', async () => {
    const service = new MockEmbeddingService({ dimensions: 384 });
    const result1 = await service.embed('hello');
    const result2 = await service.embed('world');
    assert.notDeepEqual(Array.from(result1.embedding), Array.from(result2.embedding));
  });

  test('caches results', async () => {
    const service = new MockEmbeddingService({ dimensions: 384 });
    await service.embed('cached text');
    const result = await service.embed('cached text');
    assert.ok(result.cached);
  });

  test('batch embedding works correctly', async () => {
    const service = new MockEmbeddingService({ dimensions: 384 });
    const texts = ['one', 'two', 'three'];
    const result = await service.embedBatch(texts);
    assert.equal(result.embeddings.length, 3);
    assert.equal(result.embeddings[0].length, 384);
  });
});

console.log('All tests completed!');
