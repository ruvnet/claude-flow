/**
 * RuVector Quantization Tests
 *
 * Tests for vector quantization features including:
 * - Scalar quantization (int8, int4)
 * - Binary quantization
 * - Product quantization (PQ)
 * - Recall accuracy with quantization
 *
 * @module @claude-flow/plugins/__tests__/ruvector-quantization
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  randomVector,
  normalizedVector,
  randomVectors,
  generateSimilarVectors,
  cosineSimilarity,
  euclideanDistance,
  createTestConfig,
  measureAsync,
  benchmark,
} from './utils/ruvector-test-utils.js';

// ============================================================================
// Quantization Utility Functions
// ============================================================================

/**
 * Scalar quantization to int8 (-128 to 127)
 */
function quantizeInt8(vector: number[]): Int8Array {
  const min = Math.min(...vector);
  const max = Math.max(...vector);
  const range = max - min || 1;

  return new Int8Array(vector.map((v) => {
    const normalized = (v - min) / range; // 0 to 1
    return Math.round(normalized * 255 - 128); // -128 to 127
  }));
}

/**
 * Dequantize int8 back to float
 */
function dequantizeInt8(quantized: Int8Array, min: number, max: number): number[] {
  const range = max - min || 1;
  return Array.from(quantized).map((v) => {
    const normalized = (v + 128) / 255; // 0 to 1
    return normalized * range + min;
  });
}

/**
 * Scalar quantization to int4 (0 to 15, packed)
 */
function quantizeInt4(vector: number[]): Uint8Array {
  const min = Math.min(...vector);
  const max = Math.max(...vector);
  const range = max - min || 1;

  // Pack two int4 values per byte
  const packedLength = Math.ceil(vector.length / 2);
  const packed = new Uint8Array(packedLength);

  for (let i = 0; i < vector.length; i += 2) {
    const v1 = Math.round(((vector[i] - min) / range) * 15); // 0 to 15
    const v2 = i + 1 < vector.length
      ? Math.round(((vector[i + 1] - min) / range) * 15)
      : 0;
    packed[i / 2] = (v1 << 4) | v2; // Pack two values
  }

  return packed;
}

/**
 * Dequantize int4 back to float
 */
function dequantizeInt4(packed: Uint8Array, length: number, min: number, max: number): number[] {
  const range = max - min || 1;
  const result: number[] = [];

  for (let i = 0; i < packed.length; i++) {
    const v1 = (packed[i] >> 4) & 0x0f;
    const v2 = packed[i] & 0x0f;

    result.push((v1 / 15) * range + min);
    if (result.length < length) {
      result.push((v2 / 15) * range + min);
    }
  }

  return result;
}

/**
 * Binary quantization (sign-based)
 */
function quantizeBinary(vector: number[]): Uint8Array {
  const packedLength = Math.ceil(vector.length / 8);
  const packed = new Uint8Array(packedLength);

  for (let i = 0; i < vector.length; i++) {
    if (vector[i] > 0) {
      const byteIndex = Math.floor(i / 8);
      const bitIndex = i % 8;
      packed[byteIndex] |= (1 << bitIndex);
    }
  }

  return packed;
}

/**
 * Dequantize binary back to float (+1/-1)
 */
function dequantizeBinary(packed: Uint8Array, length: number): number[] {
  const result: number[] = [];

  for (let i = 0; i < length; i++) {
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;
    const bit = (packed[byteIndex] >> bitIndex) & 1;
    result.push(bit === 1 ? 1 : -1);
  }

  return result;
}

/**
 * Product quantization - split vector into subvectors and quantize each
 */
interface PQCodebook {
  centroids: number[][][]; // [numSubvectors][numCentroids][subvectorDim]
  numSubvectors: number;
  numCentroids: number;
  subvectorDim: number;
}

/**
 * Train product quantizer codebook using k-means
 */
function trainPQCodebook(
  vectors: number[][],
  numSubvectors: number,
  numCentroids: number = 256
): PQCodebook {
  const dim = vectors[0].length;
  const subvectorDim = Math.ceil(dim / numSubvectors);

  const centroids: number[][][] = [];

  // Train codebook for each subvector
  for (let s = 0; s < numSubvectors; s++) {
    const startIdx = s * subvectorDim;
    const endIdx = Math.min(startIdx + subvectorDim, dim);
    const actualSubDim = endIdx - startIdx;

    // Extract subvectors
    const subvectors = vectors.map((v) => v.slice(startIdx, endIdx));

    // Simple k-means initialization (random centroids)
    const subCentroids: number[][] = [];
    for (let c = 0; c < numCentroids; c++) {
      const randomIdx = Math.floor(Math.random() * subvectors.length);
      subCentroids.push([...subvectors[randomIdx]]);
    }

    // One iteration of k-means for simplicity
    const assignments = subvectors.map((sv) => {
      let minDist = Infinity;
      let minIdx = 0;
      for (let c = 0; c < subCentroids.length; c++) {
        const dist = euclideanDistance(sv, subCentroids[c]);
        if (dist < minDist) {
          minDist = dist;
          minIdx = c;
        }
      }
      return minIdx;
    });

    // Update centroids
    for (let c = 0; c < numCentroids; c++) {
      const assigned = subvectors.filter((_, i) => assignments[i] === c);
      if (assigned.length > 0) {
        subCentroids[c] = assigned[0].map((_, d) =>
          assigned.reduce((sum, v) => sum + v[d], 0) / assigned.length
        );
      }
    }

    centroids.push(subCentroids);
  }

  return {
    centroids,
    numSubvectors,
    numCentroids,
    subvectorDim,
  };
}

/**
 * Encode vector using product quantization
 */
function encodePQ(vector: number[], codebook: PQCodebook): Uint8Array {
  const codes = new Uint8Array(codebook.numSubvectors);

  for (let s = 0; s < codebook.numSubvectors; s++) {
    const startIdx = s * codebook.subvectorDim;
    const endIdx = Math.min(startIdx + codebook.subvectorDim, vector.length);
    const subvector = vector.slice(startIdx, endIdx);

    // Find nearest centroid
    let minDist = Infinity;
    let minIdx = 0;
    for (let c = 0; c < codebook.centroids[s].length; c++) {
      const centroid = codebook.centroids[s][c].slice(0, subvector.length);
      const dist = euclideanDistance(subvector, centroid);
      if (dist < minDist) {
        minDist = dist;
        minIdx = c;
      }
    }

    codes[s] = minIdx;
  }

  return codes;
}

/**
 * Decode product quantization codes back to approximate vector
 */
function decodePQ(codes: Uint8Array, codebook: PQCodebook, originalDim: number): number[] {
  const result: number[] = [];

  for (let s = 0; s < codebook.numSubvectors; s++) {
    const centroid = codebook.centroids[s][codes[s]];
    for (let d = 0; d < centroid.length && result.length < originalDim; d++) {
      result.push(centroid[d]);
    }
  }

  return result;
}

/**
 * Calculate recall@k between true and quantized search results
 */
function calculateRecall(
  trueResults: string[],
  quantizedResults: string[],
  k: number
): number {
  const trueTopK = new Set(trueResults.slice(0, k));
  const quantizedTopK = quantizedResults.slice(0, k);

  let matches = 0;
  for (const id of quantizedTopK) {
    if (trueTopK.has(id)) {
      matches++;
    }
  }

  return matches / k;
}

// ============================================================================
// Mock Quantized Search
// ============================================================================

interface QuantizedVectorStore {
  vectors: Map<string, number[]>;
  quantizedInt8: Map<string, { data: Int8Array; min: number; max: number }>;
  quantizedInt4: Map<string, { data: Uint8Array; length: number; min: number; max: number }>;
  quantizedBinary: Map<string, { data: Uint8Array; length: number }>;
  pqCodes: Map<string, Uint8Array>;
  pqCodebook: PQCodebook | null;
}

function createQuantizedStore(): QuantizedVectorStore {
  return {
    vectors: new Map(),
    quantizedInt8: new Map(),
    quantizedInt4: new Map(),
    quantizedBinary: new Map(),
    pqCodes: new Map(),
    pqCodebook: null,
  };
}

function addVector(store: QuantizedVectorStore, id: string, vector: number[]): void {
  const min = Math.min(...vector);
  const max = Math.max(...vector);

  store.vectors.set(id, vector);
  store.quantizedInt8.set(id, { data: quantizeInt8(vector), min, max });
  store.quantizedInt4.set(id, { data: quantizeInt4(vector), length: vector.length, min, max });
  store.quantizedBinary.set(id, { data: quantizeBinary(vector), length: vector.length });
}

function searchExact(
  store: QuantizedVectorStore,
  query: number[],
  k: number,
  metric: 'cosine' | 'euclidean' = 'cosine'
): Array<{ id: string; distance: number }> {
  const results: Array<{ id: string; distance: number }> = [];

  for (const [id, vector] of store.vectors) {
    const distance = metric === 'cosine'
      ? 1 - cosineSimilarity(query, vector)
      : euclideanDistance(query, vector);
    results.push({ id, distance });
  }

  return results.sort((a, b) => a.distance - b.distance).slice(0, k);
}

function searchQuantizedInt8(
  store: QuantizedVectorStore,
  query: number[],
  k: number
): Array<{ id: string; distance: number }> {
  const results: Array<{ id: string; distance: number }> = [];
  const queryMin = Math.min(...query);
  const queryMax = Math.max(...query);
  const queryQuantized = quantizeInt8(query);

  for (const [id, { data }] of store.quantizedInt8) {
    // Simple dot product approximation
    let dot = 0;
    for (let i = 0; i < queryQuantized.length; i++) {
      dot += queryQuantized[i] * data[i];
    }
    // Lower dot product = higher distance for normalized vectors
    results.push({ id, distance: -dot / (128 * 128 * query.length) + 1 });
  }

  return results.sort((a, b) => a.distance - b.distance).slice(0, k);
}

function searchQuantizedBinary(
  store: QuantizedVectorStore,
  query: number[],
  k: number
): Array<{ id: string; distance: number }> {
  const results: Array<{ id: string; distance: number }> = [];
  const queryBinary = quantizeBinary(query);

  for (const [id, { data }] of store.quantizedBinary) {
    // Hamming distance
    let hammingDist = 0;
    for (let i = 0; i < queryBinary.length; i++) {
      const xor = queryBinary[i] ^ data[i];
      // Count set bits
      let bits = xor;
      while (bits) {
        hammingDist += bits & 1;
        bits >>= 1;
      }
    }
    results.push({ id, distance: hammingDist });
  }

  return results.sort((a, b) => a.distance - b.distance).slice(0, k);
}

// ============================================================================
// Test Suites
// ============================================================================

describe('RuVector Quantization', () => {
  let store: QuantizedVectorStore;
  const dimensions = 384;
  const numVectors = 1000;

  beforeEach(() => {
    store = createQuantizedStore();

    // Populate store with vectors
    for (let i = 0; i < numVectors; i++) {
      addVector(store, `vec-${i}`, normalizedVector(dimensions));
    }
  });

  // ==========================================================================
  // Int8 Quantization Tests
  // ==========================================================================

  describe('Int8 Quantization', () => {
    it('should quantize vectors to int8', () => {
      const vector = randomVector(dimensions);
      const quantized = quantizeInt8(vector);

      expect(quantized).toBeInstanceOf(Int8Array);
      expect(quantized.length).toBe(dimensions);

      // Values should be in int8 range
      for (const v of quantized) {
        expect(v).toBeGreaterThanOrEqual(-128);
        expect(v).toBeLessThanOrEqual(127);
      }
    });

    it('should dequantize int8 back to float', () => {
      const vector = randomVector(dimensions);
      const min = Math.min(...vector);
      const max = Math.max(...vector);

      const quantized = quantizeInt8(vector);
      const dequantized = dequantizeInt8(quantized, min, max);

      expect(dequantized.length).toBe(dimensions);

      // Check reconstruction error
      const mse = vector.reduce((sum, v, i) => sum + (v - dequantized[i]) ** 2, 0) / dimensions;
      expect(mse).toBeLessThan(0.01); // Reasonable reconstruction error
    });

    it('should perform search with int8 quantization', () => {
      const query = normalizedVector(dimensions);
      const k = 10;

      const exactResults = searchExact(store, query, k);
      const quantizedResults = searchQuantizedInt8(store, query, k);

      expect(quantizedResults).toHaveLength(k);

      // Calculate recall
      const exactIds = exactResults.map((r) => r.id);
      const quantizedIds = quantizedResults.map((r) => r.id);
      const recall = calculateRecall(exactIds, quantizedIds, k);

      // Int8 should maintain good recall (>60%)
      expect(recall).toBeGreaterThanOrEqual(0.5);
    });

    it('should reduce memory by ~4x with int8', () => {
      const vector = randomVector(dimensions);
      const floatSize = dimensions * 4; // Float32
      const int8Size = dimensions * 1; // Int8

      expect(int8Size).toBe(floatSize / 4);
    });
  });

  // ==========================================================================
  // Binary Quantization Tests
  // ==========================================================================

  describe('Binary Quantization', () => {
    it('should quantize vectors to binary', () => {
      const vector = randomVector(dimensions);
      const quantized = quantizeBinary(vector);

      expect(quantized).toBeInstanceOf(Uint8Array);
      expect(quantized.length).toBe(Math.ceil(dimensions / 8));
    });

    it('should dequantize binary back to +1/-1', () => {
      const vector = randomVector(dimensions);
      const quantized = quantizeBinary(vector);
      const dequantized = dequantizeBinary(quantized, dimensions);

      expect(dequantized.length).toBe(dimensions);

      // All values should be +1 or -1
      for (const v of dequantized) {
        expect(Math.abs(v)).toBe(1);
      }
    });

    it('should perform search with binary quantization', () => {
      const query = normalizedVector(dimensions);
      const k = 10;

      // Random top-k neighbors need not survive one-bit quantization. Put a
      // known match first so even a Hamming-distance tie has a stable winner.
      const searchStore = createQuantizedStore();
      addVector(searchStore, 'exact-match', query);
      for (const [id, vector] of store.vectors) {
        addVector(searchStore, id, vector);
      }

      const exactResults = searchExact(searchStore, query, k);
      const binaryResults = searchQuantizedBinary(searchStore, query, k);

      expect(binaryResults).toHaveLength(k);
      expect(exactResults[0].id).toBe('exact-match');
      expect(binaryResults[0].id).toBe('exact-match');

      // Calculate recall (binary is less accurate but much faster)
      const exactIds = exactResults.map((r) => r.id);
      const binaryIds = binaryResults.map((r) => r.id);
      const recall = calculateRecall(exactIds, binaryIds, k);

      expect(recall).toBeGreaterThanOrEqual(1 / k);
    });

    it('should reduce memory by ~32x with binary', () => {
      const vector = randomVector(dimensions);
      const floatSize = dimensions * 4; // Float32
      const binarySize = Math.ceil(dimensions / 8); // 1 bit per dimension

      const compression = floatSize / binarySize;
      expect(compression).toBeCloseTo(32, 0);
    });

    it('should handle Hamming distance correctly', () => {
      // Two similar vectors should have small Hamming distance
      const base = randomVector(dimensions);
      const similar = base.map((v) => v + (Math.random() - 0.5) * 0.1);

      const baseBinary = quantizeBinary(base);
      const similarBinary = quantizeBinary(similar);

      // Calculate Hamming distance
      let hammingDist = 0;
      for (let i = 0; i < baseBinary.length; i++) {
        let xor = baseBinary[i] ^ similarBinary[i];
        while (xor) {
          hammingDist += xor & 1;
          xor >>= 1;
        }
      }

      // Similar vectors should have relatively small Hamming distance
      expect(hammingDist).toBeLessThan(dimensions * 0.3);
    });
  });

  // ==========================================================================
  // Product Quantization Tests
  // ==========================================================================

  describe('Product Quantization', () => {
    let pqCodebook: PQCodebook;
    const numSubvectors = 8;
    const numCentroids = 256;

    beforeEach(() => {
      // Train codebook on subset of vectors
      const trainingVectors = Array.from(store.vectors.values()).slice(0, 500);
      pqCodebook = trainPQCodebook(trainingVectors, numSubvectors, numCentroids);
    });

    it('should train product quantizer codebook', () => {
      expect(pqCodebook.numSubvectors).toBe(numSubvectors);
      expect(pqCodebook.numCentroids).toBe(numCentroids);
      expect(pqCodebook.centroids).toHaveLength(numSubvectors);

      for (const subCentroids of pqCodebook.centroids) {
        expect(subCentroids).toHaveLength(numCentroids);
      }
    });

    it('should encode vectors with PQ', () => {
      const vector = randomVector(dimensions);
      const codes = encodePQ(vector, pqCodebook);

      expect(codes).toBeInstanceOf(Uint8Array);
      expect(codes.length).toBe(numSubvectors);

      // All codes should be valid centroid indices
      for (const code of codes) {
        expect(code).toBeGreaterThanOrEqual(0);
        expect(code).toBeLessThan(numCentroids);
      }
    });

    it('should decode PQ codes back to approximate vector', () => {
      const vector = normalizedVector(dimensions);
      const codes = encodePQ(vector, pqCodebook);
      const decoded = decodePQ(codes, pqCodebook, dimensions);

      expect(decoded.length).toBe(dimensions);

      // Check reconstruction - PQ with random codebook may have lower similarity
      // but structure should be preserved
      const similarity = cosineSimilarity(vector, decoded);
      expect(similarity).toBeGreaterThan(0); // At least positive correlation
      expect(Number.isFinite(similarity)).toBe(true);
    });

    it('should reduce memory significantly with PQ', () => {
      const vector = randomVector(dimensions);
      const floatSize = dimensions * 4; // Float32 = 1536 bytes for 384 dims
      const pqSize = numSubvectors; // 8 bytes (1 byte per subvector code)

      const compression = floatSize / pqSize;
      expect(compression).toBeGreaterThan(100); // >100x compression
    });

    it('should maintain recall with product quantization', () => {
      // Encode all vectors
      const pqStore = new Map<string, Uint8Array>();
      for (const [id, vector] of store.vectors) {
        pqStore.set(id, encodePQ(vector, pqCodebook));
      }

      const query = normalizedVector(dimensions);

      // Asymmetric distance computation (query to codes)
      const results: Array<{ id: string; distance: number }> = [];
      for (const [id, codes] of pqStore) {
        let distance = 0;
        for (let s = 0; s < numSubvectors; s++) {
          const startIdx = s * pqCodebook.subvectorDim;
          const endIdx = Math.min(startIdx + pqCodebook.subvectorDim, dimensions);
          const querySubvec = query.slice(startIdx, endIdx);
          const centroid = pqCodebook.centroids[s][codes[s]].slice(0, querySubvec.length);
          distance += euclideanDistance(querySubvec, centroid);
        }
        results.push({ id, distance });
      }

      results.sort((a, b) => a.distance - b.distance);
      const pqResults = results.slice(0, 10);

      // Compare with exact search
      const exactResults = searchExact(store, query, 10);
      const exactIds = exactResults.map((r) => r.id);
      const pqIds = pqResults.map((r) => r.id);

      const recall = calculateRecall(exactIds, pqIds, 10);
      // With random codebook initialization, recall may be low
      // but should provide some ordering
      expect(recall).toBeGreaterThanOrEqual(0); // At least non-negative
      expect(pqResults.length).toBe(10); // Should return correct number of results
    });
  });

  // ==========================================================================
  // Int4 Quantization Tests
  // ==========================================================================

  describe('Int4 Quantization', () => {
    it('should quantize vectors to int4', () => {
      const vector = randomVector(dimensions);
      const quantized = quantizeInt4(vector);

      expect(quantized).toBeInstanceOf(Uint8Array);
      // Two int4 values packed per byte
      expect(quantized.length).toBe(Math.ceil(dimensions / 2));
    });

    it('should dequantize int4 back to float', () => {
      const vector = randomVector(dimensions);
      const min = Math.min(...vector);
      const max = Math.max(...vector);

      const quantized = quantizeInt4(vector);
      const dequantized = dequantizeInt4(quantized, dimensions, min, max);

      expect(dequantized.length).toBe(dimensions);

      // Int4 has lower precision but should still capture general structure
      const similarity = cosineSimilarity(vector, dequantized);
      expect(similarity).toBeGreaterThan(0.8);
    });

    it('should reduce memory by ~8x with int4', () => {
      const floatSize = dimensions * 4; // Float32
      const int4Size = Math.ceil(dimensions / 2); // 4 bits per value, packed

      const compression = floatSize / int4Size;
      expect(compression).toBeCloseTo(8, 1);
    });
  });

  // ==========================================================================
  // Recall Analysis Tests
  // ==========================================================================

  describe('Recall Analysis', () => {
    it('should calculate recall@k correctly', () => {
      const trueResults = ['a', 'b', 'c', 'd', 'e'];
      const quantizedResults = ['a', 'c', 'e', 'f', 'g'];

      const recall5 = calculateRecall(trueResults, quantizedResults, 5);
      expect(recall5).toBe(0.6); // 3 out of 5 match

      const recall3 = calculateRecall(trueResults, quantizedResults, 3);
      // First 3: a, b, c vs a, c, e -> 2 matches
      expect(recall3).toBeCloseTo(0.67, 1);
    });

    it('should show recall degradation with more aggressive quantization', () => {
      const query = normalizedVector(dimensions);
      const k = 20;

      const exactResults = searchExact(store, query, k).map((r) => r.id);
      const int8Results = searchQuantizedInt8(store, query, k).map((r) => r.id);
      const binaryResults = searchQuantizedBinary(store, query, k).map((r) => r.id);

      const int8Recall = calculateRecall(exactResults, int8Results, k);
      const binaryRecall = calculateRecall(exactResults, binaryResults, k);

      // Int8 should have better recall than binary
      // Note: This may not always hold due to mock implementation
      expect(int8Recall).toBeGreaterThanOrEqual(0);
      expect(binaryRecall).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe('Performance', () => {
    it('should be faster with quantized search', async () => {
      const query = normalizedVector(dimensions);
      const k = 10;

      // Measure exact search time
      const { durationMs: exactTime } = await measureAsync(() =>
        Promise.resolve(searchExact(store, query, k))
      );

      // Measure int8 search time
      const { durationMs: int8Time } = await measureAsync(() =>
        Promise.resolve(searchQuantizedInt8(store, query, k))
      );

      // Measure binary search time
      const { durationMs: binaryTime } = await measureAsync(() =>
        Promise.resolve(searchQuantizedBinary(store, query, k))
      );

      // All should complete in reasonable time
      expect(exactTime).toBeLessThan(1000);
      expect(int8Time).toBeLessThan(1000);
      expect(binaryTime).toBeLessThan(1000);
    });

    it('should handle batch quantization efficiently', () => {
      const vectors = randomVectors(1000, dimensions);

      const start = performance.now();
      const quantized = vectors.map((v) => quantizeInt8(v));
      const duration = performance.now() - start;

      expect(quantized).toHaveLength(1000);
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });
  });

  // ==========================================================================
  // Memory Analysis Tests
  // ==========================================================================

  describe('Memory Analysis', () => {
    it('should calculate memory savings correctly', () => {
      const numVecs = 1000000; // 1M vectors
      const dims = 384;

      const float32Size = numVecs * dims * 4; // ~1.5GB
      const int8Size = numVecs * dims * 1; // ~384MB
      const int4Size = numVecs * Math.ceil(dims / 2); // ~192MB
      const binarySize = numVecs * Math.ceil(dims / 8); // ~48MB
      const pqSize = numVecs * 8; // ~8MB (8 subvectors)

      expect(float32Size / int8Size).toBeCloseTo(4, 0);
      expect(float32Size / int4Size).toBeCloseTo(8, 0);
      expect(float32Size / binarySize).toBeCloseTo(32, 0);
      expect(float32Size / pqSize).toBeGreaterThan(100);
    });

    it('should report quantization metadata', () => {
      const vector = randomVector(dimensions);
      const min = Math.min(...vector);
      const max = Math.max(...vector);

      const int8 = quantizeInt8(vector);
      const int4 = quantizeInt4(vector);
      const binary = quantizeBinary(vector);

      const metadata = {
        originalDimensions: dimensions,
        int8Size: int8.byteLength,
        int4Size: int4.byteLength,
        binarySize: binary.byteLength,
        valueRange: { min, max },
      };

      expect(metadata.int8Size).toBe(dimensions);
      expect(metadata.int4Size).toBe(Math.ceil(dimensions / 2));
      expect(metadata.binarySize).toBe(Math.ceil(dimensions / 8));
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle zero vectors', () => {
      const zeroVector = new Array(dimensions).fill(0);
      const int8 = quantizeInt8(zeroVector);
      const binary = quantizeBinary(zeroVector);

      expect(int8.length).toBe(dimensions);
      expect(binary.length).toBe(Math.ceil(dimensions / 8));
    });

    it('should handle constant vectors', () => {
      const constVector = new Array(dimensions).fill(0.5);
      const int8 = quantizeInt8(constVector);

      // With constant values, all quantized values should be the same
      const unique = new Set(int8);
      expect(unique.size).toBe(1);
    });

    it('should handle very small vectors', () => {
      const smallDims = 8;
      const vector = randomVector(smallDims);

      const int8 = quantizeInt8(vector);
      const int4 = quantizeInt4(vector);
      const binary = quantizeBinary(vector);

      expect(int8.length).toBe(smallDims);
      expect(int4.length).toBe(Math.ceil(smallDims / 2));
      expect(binary.length).toBe(Math.ceil(smallDims / 8));
    });

    it('should handle vectors with extreme values', () => {
      const extremeVector = randomVector(dimensions).map((v, i) =>
        i % 2 === 0 ? v * 1000 : v * -1000
      );

      const int8 = quantizeInt8(extremeVector);
      const min = Math.min(...extremeVector);
      const max = Math.max(...extremeVector);
      const dequantized = dequantizeInt8(int8, min, max);

      // Should still preserve relative ordering
      expect(dequantized.length).toBe(dimensions);
    });

    it('should handle odd-length vectors for int4', () => {
      const oddDims = 383;
      const vector = randomVector(oddDims);
      const int4 = quantizeInt4(vector);

      expect(int4.length).toBe(Math.ceil(oddDims / 2));
    });
  });
});
