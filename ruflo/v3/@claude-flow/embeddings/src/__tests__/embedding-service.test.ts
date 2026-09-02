/**
 * Tests for EmbeddingService
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createEmbeddingService,
  MockEmbeddingService,
  cosineSimilarity,
  euclideanDistance,
  dotProduct,
  computeSimilarity,
} from '../index.js';

describe('EmbeddingService', () => {
  describe('MockEmbeddingService', () => {
    let service: MockEmbeddingService;

    beforeEach(() => {
      service = new MockEmbeddingService({ provider: 'mock', dimensions: 128 });
    });

    it('should generate embeddings with correct dimensions', async () => {
      const result = await service.embed('Hello, world!');
      expect(result.embedding).toHaveLength(128);
    });

    it('should generate deterministic embeddings for same text', async () => {
      const result1 = await service.embed('test text');
      const result2 = await service.embed('test text');

      // Mock service should be deterministic
      expect(Array.from(result1.embedding)).toEqual(Array.from(result2.embedding));
    });

    it('should handle batch embeddings', async () => {
      const texts = ['text1', 'text2', 'text3'];
      const results = await service.embedBatch(texts);

      expect(results.embeddings).toHaveLength(3);
      // Each embedding should have correct dimensions
      results.embeddings.forEach((emb) => {
        expect(emb.length).toBe(128);
      });
    });
  });

  describe('createEmbeddingService', () => {
    it('should create mock service', () => {
      const service = createEmbeddingService({
        provider: 'mock',
        dimensions: 64,
      });

      expect(service).toBeInstanceOf(MockEmbeddingService);
    });
  });
});

describe('Similarity Functions', () => {
  const vec1 = new Float32Array([1, 0, 0]);
  const vec2 = new Float32Array([1, 0, 0]);
  const vec3 = new Float32Array([0, 1, 0]);
  const vec4 = new Float32Array([-1, 0, 0]);

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1);
    });

    it('should return 0 for orthogonal vectors', () => {
      expect(cosineSimilarity(vec1, vec3)).toBeCloseTo(0);
    });

    it('should return -1 for opposite vectors', () => {
      expect(cosineSimilarity(vec1, vec4)).toBeCloseTo(-1);
    });
  });

  describe('euclideanDistance', () => {
    it('should return 0 for identical vectors', () => {
      expect(euclideanDistance(vec1, vec2)).toBeCloseTo(0);
    });

    it('should return sqrt(2) for unit orthogonal vectors', () => {
      expect(euclideanDistance(vec1, vec3)).toBeCloseTo(Math.sqrt(2));
    });

    it('should return 2 for opposite unit vectors', () => {
      expect(euclideanDistance(vec1, vec4)).toBeCloseTo(2);
    });
  });

  describe('dotProduct', () => {
    it('should return 1 for identical unit vectors', () => {
      expect(dotProduct(vec1, vec2)).toBeCloseTo(1);
    });

    it('should return 0 for orthogonal vectors', () => {
      expect(dotProduct(vec1, vec3)).toBeCloseTo(0);
    });

    it('should return -1 for opposite unit vectors', () => {
      expect(dotProduct(vec1, vec4)).toBeCloseTo(-1);
    });
  });

  describe('computeSimilarity', () => {
    it('should use cosine metric by default', () => {
      const result = computeSimilarity(vec1, vec2);
      expect(result.metric).toBe('cosine');
      expect(result.score).toBeCloseTo(1);
    });

    it('should support euclidean metric', () => {
      const result = computeSimilarity(vec1, vec3, 'euclidean');
      expect(result.metric).toBe('euclidean');
      expect(result.score).toBeCloseTo(Math.sqrt(2));
    });

    it('should support dot product metric', () => {
      const result = computeSimilarity(vec1, vec4, 'dot');
      expect(result.metric).toBe('dot');
      expect(result.score).toBeCloseTo(-1);
    });
  });
});
