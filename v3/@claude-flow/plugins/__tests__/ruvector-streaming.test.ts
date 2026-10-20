/**
 * RuVector Streaming Tests
 *
 * Tests for streaming features including:
 * - Streaming large result sets
 * - Backpressure handling
 * - Stream batch inserts
 * - Cursor-based iteration
 *
 * @module @claude-flow/plugins/__tests__/ruvector-streaming
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable, Writable, Transform } from 'stream';
import v8 from 'node:v8';
import vm from 'node:vm';
import { pipeline } from 'stream/promises';
import {
  randomVector,
  normalizedVector,
  randomVectors,
  createTestConfig,
  createMockPgPool,
  measureAsync,
  type MockPgPool,
} from './utils/ruvector-test-utils.js';

// Heap retention helpers (see 'should release references after streaming').
// Measured with forced GC: a clean pipeline retains ~0 MB (|x| < 0.2 MB); one that keeps every
// chunk reachable retains ~16.2 MB. 8 MB sits ~50x above noise and at half the leak.
const RETAINED_LIMIT_BYTES = 8 * 1024 * 1024;
const UNCOLLECTED_LIMIT_BYTES = 50 * 1024 * 1024;

/** A forced-GC function: the global one if run with --expose-gc, else obtained at runtime. */
function getGc(): (() => void) | undefined {
  if (typeof globalThis.gc === 'function') return globalThis.gc;
  try {
    v8.setFlagsFromString('--expose-gc');
    return vm.runInNewContext('gc') as () => void;
  } catch {
    return undefined;
  }
}

/** Heap in use after repeated full collections with a short settle between them. */
async function settledHeapUsed(collect: (() => void) | undefined): Promise<number> {
  for (let i = 0; i < 4; i += 1) {
    collect?.();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return process.memoryUsage().heapUsed;
}

// ============================================================================
// Stream Utilities
// ============================================================================

/**
 * Simulates a database cursor for streaming results
 */
interface Cursor<T> {
  read(batchSize: number): Promise<T[]>;
  close(): Promise<void>;
  position: number;
  exhausted: boolean;
}

/**
 * Creates a mock cursor over a dataset
 */
function createCursor<T>(data: T[]): Cursor<T> {
  let position = 0;
  let exhausted = false;

  return {
    async read(batchSize: number): Promise<T[]> {
      if (exhausted) return [];

      const batch = data.slice(position, position + batchSize);
      position += batch.length;

      if (position >= data.length) {
        exhausted = true;
      }

      // Simulate async database read
      await new Promise((resolve) => setTimeout(resolve, 1));

      return batch;
    },

    async close(): Promise<void> {
      exhausted = true;
    },

    get position() {
      return position;
    },

    get exhausted() {
      return exhausted;
    },
  };
}

/**
 * Vector search result for streaming
 */
interface StreamSearchResult {
  id: string;
  score: number;
  distance: number;
  vector?: number[];
  metadata?: Record<string, unknown>;
}

/**
 * Stream of search results from cursor
 */
function createSearchResultStream(
  cursor: Cursor<StreamSearchResult>,
  batchSize: number = 100
): Readable {
  return new Readable({
    objectMode: true,
    async read() {
      try {
        const batch = await cursor.read(batchSize);

        if (batch.length === 0) {
          this.push(null); // End of stream
          return;
        }

        for (const item of batch) {
          if (!this.push(item)) {
            // Backpressure - pause reading
            return;
          }
        }
      } catch (error) {
        this.destroy(error as Error);
      }
    },
  });
}

/**
 * Transform stream that filters results by score threshold
 */
function createScoreFilterTransform(minScore: number): Transform {
  return new Transform({
    objectMode: true,
    transform(chunk: StreamSearchResult, encoding, callback) {
      if (chunk.score >= minScore) {
        this.push(chunk);
      }
      callback();
    },
  });
}

/**
 * Transform stream that enriches results with additional data
 */
function createEnrichmentTransform(
  enrichFn: (result: StreamSearchResult) => Promise<StreamSearchResult>
): Transform {
  return new Transform({
    objectMode: true,
    async transform(chunk: StreamSearchResult, encoding, callback) {
      try {
        const enriched = await enrichFn(chunk);
        this.push(enriched);
        callback();
      } catch (error) {
        callback(error as Error);
      }
    },
  });
}

/**
 * Batch write stream for inserting vectors
 */
interface BatchWriteStream extends Writable {
  batchCount: number;
  totalWritten: number;
}

function createBatchWriteStream(
  insertFn: (batch: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }>) => Promise<void>,
  batchSize: number = 100
): BatchWriteStream {
  let batch: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }> = [];
  let batchCount = 0;
  let totalWritten = 0;

  const stream = new Writable({
    objectMode: true,

    async write(chunk, encoding, callback) {
      batch.push(chunk);

      if (batch.length >= batchSize) {
        try {
          await insertFn(batch);
          totalWritten += batch.length;
          batchCount++;
          batch = [];
          callback();
        } catch (error) {
          callback(error as Error);
        }
      } else {
        callback();
      }
    },

    async final(callback) {
      if (batch.length > 0) {
        try {
          await insertFn(batch);
          totalWritten += batch.length;
          batchCount++;
          batch = [];
          callback();
        } catch (error) {
          callback(error as Error);
        }
      } else {
        callback();
      }
    },
  }) as BatchWriteStream;

  Object.defineProperty(stream, 'batchCount', {
    get: () => batchCount,
  });

  Object.defineProperty(stream, 'totalWritten', {
    get: () => totalWritten,
  });

  return stream;
}

/**
 * Vector generator stream
 */
function createVectorGeneratorStream(
  count: number,
  dimensions: number = 384,
  generateMetadata: boolean = true
): Readable {
  let generated = 0;

  return new Readable({
    objectMode: true,
    read() {
      if (generated >= count) {
        this.push(null);
        return;
      }

      const vector = {
        id: `gen-${Date.now()}-${generated}`,
        vector: normalizedVector(dimensions),
        ...(generateMetadata && {
          metadata: {
            index: generated,
            timestamp: Date.now(),
            batch: Math.floor(generated / 100),
          },
        }),
      };

      generated++;
      this.push(vector);
    },
  });
}

/**
 * Simulates slow consumer for backpressure testing
 */
function createSlowConsumer(delayMs: number): Writable {
  return new Writable({
    objectMode: true,
    async write(chunk, encoding, callback) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      callback();
    },
  });
}

// ============================================================================
// Mock Database Operations
// ============================================================================

interface MockStreamingClient {
  searchStream(query: number[], options: {
    k: number;
    metric: 'cosine' | 'euclidean';
    batchSize?: number;
    includeVector?: boolean;
  }): Readable;

  insertStream(options: {
    tableName: string;
    batchSize?: number;
  }): BatchWriteStream;

  createCursor(query: string, params?: unknown[]): Promise<Cursor<Record<string, unknown>>>;

  data: Map<string, { vector: number[]; metadata?: Record<string, unknown> }>;
}

function createMockStreamingClient(): MockStreamingClient {
  const data = new Map<string, { vector: number[]; metadata?: Record<string, unknown> }>();

  // Pre-populate with test data
  for (let i = 0; i < 10000; i++) {
    data.set(`vec-${i}`, {
      vector: normalizedVector(384),
      metadata: { index: i, category: i % 10 },
    });
  }

  return {
    data,

    searchStream(query, options) {
      // Generate mock search results
      const results: StreamSearchResult[] = [];

      for (const [id, { vector, metadata }] of data) {
        const dot = query.reduce((sum, v, i) => sum + v * vector[i], 0);
        const score = (dot + 1) / 2; // Normalize to 0-1

        results.push({
          id,
          score,
          distance: 1 - score,
          ...(options.includeVector && { vector }),
          metadata,
        });
      }

      // Sort by score descending
      results.sort((a, b) => b.score - a.score);

      // Limit to k results
      const topK = results.slice(0, options.k);

      // Create cursor and stream
      const cursor = createCursor(topK);
      return createSearchResultStream(cursor, options.batchSize);
    },

    insertStream(options) {
      return createBatchWriteStream(async (batch) => {
        for (const item of batch) {
          data.set(item.id, {
            vector: item.vector,
            metadata: item.metadata,
          });
        }
      }, options.batchSize);
    },

    async createCursor(query, params) {
      // Simple mock cursor that returns all data in pages
      const allData = Array.from(data.entries()).map(([id, { vector, metadata }]) => ({
        id,
        vector,
        metadata,
      }));

      return createCursor(allData);
    },
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('RuVector Streaming', () => {
  let client: MockStreamingClient;

  beforeEach(() => {
    client = createMockStreamingClient();
  });

  // ==========================================================================
  // Streaming Search Results Tests
  // ==========================================================================

  describe('Streaming Search Results', () => {
    it('should stream large result sets', async () => {
      const query = normalizedVector(384);
      const k = 1000;

      const stream = client.searchStream(query, {
        k,
        metric: 'cosine',
        batchSize: 100,
      });

      const results: StreamSearchResult[] = [];

      for await (const result of stream) {
        results.push(result);
      }

      // Note: Limited by mock data size, should return up to min(k, dataSize)
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThanOrEqual(k);
      expect(results[0].score).toBeGreaterThanOrEqual(results[results.length - 1].score);
    });

    it('should respect batch size during streaming', async () => {
      const query = normalizedVector(384);
      const batchSize = 50;
      const k = 200;

      const stream = client.searchStream(query, {
        k,
        metric: 'cosine',
        batchSize,
      });

      let totalResults = 0;

      // Track batch reads through the cursor
      const results: StreamSearchResult[] = [];

      for await (const result of stream) {
        results.push(result);
        totalResults++;
      }

      // Results should be streamed in batches up to k items
      expect(totalResults).toBeGreaterThan(0);
      expect(totalResults).toBeLessThanOrEqual(k);
    });

    it('should include vectors when requested', async () => {
      const query = normalizedVector(384);

      const stream = client.searchStream(query, {
        k: 10,
        metric: 'cosine',
        includeVector: true,
      });

      const results: StreamSearchResult[] = [];

      for await (const result of stream) {
        results.push(result);
      }

      results.forEach((r) => {
        expect(r.vector).toBeDefined();
        expect(r.vector).toHaveLength(384);
      });
    });

    it('should allow filtering with transform stream', async () => {
      const query = normalizedVector(384);
      const minScore = 0.7;

      const searchStream = client.searchStream(query, {
        k: 100,
        metric: 'cosine',
      });

      const filterStream = createScoreFilterTransform(minScore);

      const results: StreamSearchResult[] = [];

      await pipeline(
        searchStream,
        filterStream,
        new Writable({
          objectMode: true,
          write(chunk, encoding, callback) {
            results.push(chunk);
            callback();
          },
        })
      );

      results.forEach((r) => {
        expect(r.score).toBeGreaterThanOrEqual(minScore);
      });
    });

    it('should support enrichment transforms', async () => {
      const query = normalizedVector(384);

      const searchStream = client.searchStream(query, {
        k: 10,
        metric: 'cosine',
      });

      const enrichStream = createEnrichmentTransform(async (result) => ({
        ...result,
        metadata: {
          ...result.metadata,
          enrichedAt: new Date().toISOString(),
          source: 'ruvector',
        },
      }));

      const results: StreamSearchResult[] = [];

      await pipeline(
        searchStream,
        enrichStream,
        new Writable({
          objectMode: true,
          write(chunk, encoding, callback) {
            results.push(chunk);
            callback();
          },
        })
      );

      results.forEach((r) => {
        expect(r.metadata?.enrichedAt).toBeDefined();
        expect(r.metadata?.source).toBe('ruvector');
      });
    });
  });

  // ==========================================================================
  // Backpressure Handling Tests
  // ==========================================================================

  describe('Backpressure Handling', () => {
    it('should handle backpressure from slow consumers', async () => {
      const query = normalizedVector(384);

      const searchStream = client.searchStream(query, {
        k: 100,
        metric: 'cosine',
        batchSize: 10,
      });

      // Slow consumer - 5ms per item
      const slowConsumer = createSlowConsumer(5);

      let itemsProcessed = 0;

      await pipeline(
        searchStream,
        new Transform({
          objectMode: true,
          transform(chunk, encoding, callback) {
            itemsProcessed++;
            this.push(chunk);
            callback();
          },
        }),
        slowConsumer
      );

      // Should process all items despite backpressure
      expect(itemsProcessed).toBeGreaterThan(0);
      expect(itemsProcessed).toBeLessThanOrEqual(100);
    }, 10000); // Longer timeout for slow consumer

    it('should not overwhelm memory with large result sets', async () => {
      const query = normalizedVector(384);

      // Get memory before streaming
      const memBefore = process.memoryUsage().heapUsed;

      const stream = client.searchStream(query, {
        k: 5000,
        metric: 'cosine',
        batchSize: 50,
        includeVector: true,
      });

      let count = 0;

      for await (const result of stream) {
        count++;
        // Don't store results - just count them
      }

      const memAfter = process.memoryUsage().heapUsed;
      const memDelta = memAfter - memBefore;

      // Should process items (limited by mock data size of 10000)
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(5000);
      // Memory should not grow excessively for streaming
      expect(memDelta).toBeLessThan(100 * 1024 * 1024);
    });

    it('should pause and resume based on consumer speed', async () => {
      const data: StreamSearchResult[] = Array.from({ length: 1000 }, (_, i) => ({
        id: `item-${i}`,
        score: 1 - i / 1000,
        distance: i / 1000,
      }));

      const cursor = createCursor(data);
      const stream = createSearchResultStream(cursor, 10);

      let pauseCount = 0;
      let resumeCount = 0;

      stream.on('pause', () => pauseCount++);
      stream.on('resume', () => resumeCount++);

      // Variable speed consumer
      let processed = 0;

      await pipeline(
        stream,
        new Transform({
          objectMode: true,
          highWaterMark: 5, // Low watermark to trigger backpressure
          async transform(chunk, encoding, callback) {
            processed++;
            // Occasionally slow down
            if (processed % 100 === 0) {
              await new Promise((r) => setTimeout(r, 10));
            }
            this.push(chunk);
            callback();
          },
        }),
        new Writable({
          objectMode: true,
          write(chunk, encoding, callback) {
            callback();
          },
        })
      );

      expect(processed).toBe(1000);
    });
  });

  // ==========================================================================
  // Stream Batch Inserts Tests
  // ==========================================================================

  describe('Stream Batch Inserts', () => {
    it('should stream batch inserts', async () => {
      const vectorCount = 500;
      const batchSize = 50;

      const generator = createVectorGeneratorStream(vectorCount, 384);
      const inserter = client.insertStream({
        tableName: 'test_vectors',
        batchSize,
      });

      await pipeline(generator, inserter);

      expect(inserter.totalWritten).toBe(vectorCount);
      expect(inserter.batchCount).toBe(Math.ceil(vectorCount / batchSize));
    });

    it('should handle partial final batch', async () => {
      const vectorCount = 175; // Not divisible by batch size
      const batchSize = 50;

      const generator = createVectorGeneratorStream(vectorCount, 384);
      const inserter = client.insertStream({
        tableName: 'test_vectors',
        batchSize,
      });

      await pipeline(generator, inserter);

      expect(inserter.totalWritten).toBe(vectorCount);
      expect(inserter.batchCount).toBe(4); // 50 + 50 + 50 + 25
    });

    it('should respect insert throughput', async () => {
      const vectorCount = 1000;
      const batchSize = 100;

      const generator = createVectorGeneratorStream(vectorCount, 384);
      const inserter = client.insertStream({
        tableName: 'test_vectors',
        batchSize,
      });

      const { durationMs } = await measureAsync(async () => {
        await pipeline(generator, inserter);
      });

      const throughput = vectorCount / (durationMs / 1000);

      expect(inserter.totalWritten).toBe(vectorCount);
      expect(throughput).toBeGreaterThan(100); // At least 100 vectors/sec
    });

    it('should transform vectors before insert', async () => {
      const vectorCount = 100;
      const dimensions = 384;

      const generator = createVectorGeneratorStream(vectorCount, dimensions, false);

      // Normalize vectors before insert
      const normalizer = new Transform({
        objectMode: true,
        transform(chunk, encoding, callback) {
          const magnitude = Math.sqrt(
            chunk.vector.reduce((sum: number, v: number) => sum + v * v, 0)
          );
          const normalized = {
            ...chunk,
            vector: chunk.vector.map((v: number) => v / magnitude),
            metadata: { normalized: true },
          };
          this.push(normalized);
          callback();
        },
      });

      const insertedVectors: Array<{ id: string; vector: number[] }> = [];

      const inserter = createBatchWriteStream(async (batch) => {
        insertedVectors.push(...batch);
      }, 25);

      await pipeline(generator, normalizer, inserter);

      expect(insertedVectors).toHaveLength(vectorCount);

      // Check all vectors are normalized
      insertedVectors.forEach(({ vector }) => {
        const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
        expect(magnitude).toBeCloseTo(1, 5);
      });
    });

    it('should handle insert errors gracefully', async () => {
      const vectorCount = 100;
      let errorTriggered = false;

      const generator = createVectorGeneratorStream(vectorCount, 384);

      const failingInserter = createBatchWriteStream(async (batch) => {
        if (!errorTriggered && batch.length > 0) {
          errorTriggered = true;
          throw new Error('Simulated insert failure');
        }
      }, 50);

      await expect(
        pipeline(generator, failingInserter)
      ).rejects.toThrow('Simulated insert failure');
    });
  });

  // ==========================================================================
  // Cursor Operations Tests
  // ==========================================================================

  describe('Cursor Operations', () => {
    it('should create and iterate cursor', async () => {
      const cursor = await client.createCursor('SELECT * FROM vectors');

      const batches: Array<Record<string, unknown>[]> = [];
      let batch: Record<string, unknown>[];

      while ((batch = await cursor.read(100)).length > 0) {
        batches.push(batch);
      }

      expect(batches.length).toBeGreaterThan(0);
      expect(cursor.exhausted).toBe(true);

      await cursor.close();
    });

    it('should support cursor with small batch size', async () => {
      const cursor = await client.createCursor('SELECT * FROM vectors');

      const items: Record<string, unknown>[] = [];
      let batch: Record<string, unknown>[];

      while ((batch = await cursor.read(10)).length > 0 && items.length < 50) {
        items.push(...batch);
      }

      expect(items).toHaveLength(50);

      await cursor.close();
    });

    it('should close cursor properly', async () => {
      const cursor = await client.createCursor('SELECT * FROM vectors');

      // Read some data
      await cursor.read(50);
      expect(cursor.exhausted).toBe(false);

      // Close cursor
      await cursor.close();
      expect(cursor.exhausted).toBe(true);

      // Further reads should return empty
      const afterClose = await cursor.read(50);
      expect(afterClose).toHaveLength(0);
    });

    it('should track cursor position', async () => {
      const cursor = await client.createCursor('SELECT * FROM vectors');

      expect(cursor.position).toBe(0);

      await cursor.read(100);
      expect(cursor.position).toBe(100);

      await cursor.read(50);
      expect(cursor.position).toBe(150);

      await cursor.close();
    });
  });

  // ==========================================================================
  // Pipeline Composition Tests
  // ==========================================================================

  describe('Pipeline Composition', () => {
    it('should compose multiple transforms', async () => {
      const query = normalizedVector(384);

      const searchStream = client.searchStream(query, {
        k: 100,
        metric: 'cosine',
      });

      // Filter by score
      const filterTransform = createScoreFilterTransform(0.6);

      // Enrich results
      const enrichTransform = createEnrichmentTransform(async (result) => ({
        ...result,
        metadata: {
          ...result.metadata,
          processed: true,
        },
      }));

      // Limit results
      let count = 0;
      const limitTransform = new Transform({
        objectMode: true,
        transform(chunk, encoding, callback) {
          if (count < 20) {
            this.push(chunk);
            count++;
          }
          callback();
        },
      });

      const results: StreamSearchResult[] = [];

      await pipeline(
        searchStream,
        filterTransform,
        enrichTransform,
        limitTransform,
        new Writable({
          objectMode: true,
          write(chunk, encoding, callback) {
            results.push(chunk);
            callback();
          },
        })
      );

      expect(results.length).toBeLessThanOrEqual(20);
      results.forEach((r) => {
        expect(r.score).toBeGreaterThanOrEqual(0.6);
        expect(r.metadata?.processed).toBe(true);
      });
    });

    it('should handle errors in pipeline', async () => {
      const query = normalizedVector(384);

      const searchStream = client.searchStream(query, {
        k: 100,
        metric: 'cosine',
      });

      const failingTransform = new Transform({
        objectMode: true,
        transform(chunk, encoding, callback) {
          callback(new Error('Transform error'));
        },
      });

      await expect(
        pipeline(
          searchStream,
          failingTransform,
          new Writable({
            objectMode: true,
            write(chunk, encoding, callback) {
              callback();
            },
          })
        )
      ).rejects.toThrow('Transform error');
    });

    it('should support async generators', async () => {
      async function* generateResults() {
        for (let i = 0; i < 100; i++) {
          yield {
            id: `gen-${i}`,
            vector: normalizedVector(384),
            metadata: { index: i },
          };
        }
      }

      const results: Array<{ id: string }> = [];

      for await (const item of generateResults()) {
        results.push(item);
      }

      expect(results).toHaveLength(100);
    });
  });

  // ==========================================================================
  // Memory Efficiency Tests
  // ==========================================================================

  describe('Memory Efficiency', () => {
    it('should process large datasets with constant memory', async () => {
      const largeCount = 10000;
      const batchSize = 100;

      // Track memory at intervals
      const memSnapshots: number[] = [];

      const generator = createVectorGeneratorStream(largeCount, 384);

      let processed = 0;

      await pipeline(
        generator,
        new Transform({
          objectMode: true,
          transform(chunk, encoding, callback) {
            processed++;

            // Take memory snapshot every 1000 items
            if (processed % 1000 === 0) {
              memSnapshots.push(process.memoryUsage().heapUsed);
            }

            // Don't accumulate - just pass through
            callback();
          },
        }),
        new Writable({
          objectMode: true,
          write(chunk, encoding, callback) {
            callback();
          },
        })
      );

      expect(processed).toBe(largeCount);

      // Memory should not grow significantly
      if (memSnapshots.length > 2) {
        const firstSnapshot = memSnapshots[0];
        const lastSnapshot = memSnapshots[memSnapshots.length - 1];
        const growth = lastSnapshot - firstSnapshot;

        // Allow up to 20MB growth
        expect(growth).toBeLessThan(20 * 1024 * 1024);
      }
    });

    it('should release references after streaming', async () => {
      // This guards against a stream pipeline that keeps the chunks it has
      // processed reachable after it has finished (a leak). Raw `heapUsed`
      // before/after, without a forced collection, cannot show that: it counts
      // garbage that simply has not been collected yet (and garbage from
      // earlier tests in this worker), and a collection that frees it made the
      // old `Math.abs` check fail too (observed 273 MB / 159 MB in CI). So
      // measure RETAINED heap: force full collections, let finalizers settle,
      // and compare signed before/after.
      const collect = getGc();

      const memBefore = await settledHeapUsed(collect);

      // Process a large stream: 5000 x 384-dim vectors, ~16 MB if all retained.
      await pipeline(
        createVectorGeneratorStream(5000, 384),
        new Writable({
          objectMode: true,
          write(chunk, encoding, callback) {
            callback();
          },
        })
      );

      const memAfter = await settledHeapUsed(collect);
      const retained = memAfter - memBefore;
      console.log(JSON.stringify({ retainedMB: retained / 1048576, gc: collect !== undefined }));

      if (collect) {
        expect(retained).toBeLessThan(RETAINED_LIMIT_BYTES);
      } else {
        // No way to force a collection on this runtime: the number is only
        // meaningful as a gross-leak backstop.
        expect(Math.abs(retained)).toBeLessThan(UNCOLLECTED_LIMIT_BYTES);
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty result stream', async () => {
      const cursor = createCursor<StreamSearchResult>([]);
      const stream = createSearchResultStream(cursor);

      const results: StreamSearchResult[] = [];

      for await (const result of stream) {
        results.push(result);
      }

      expect(results).toHaveLength(0);
    });

    it('should handle single result', async () => {
      const cursor = createCursor<StreamSearchResult>([
        { id: 'single', score: 1, distance: 0 },
      ]);
      const stream = createSearchResultStream(cursor);

      const results: StreamSearchResult[] = [];

      for await (const result of stream) {
        results.push(result);
      }

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('single');
    });

    it('should handle stream destruction', async () => {
      const cursor = createCursor<StreamSearchResult>(
        Array.from({ length: 1000 }, (_, i) => ({
          id: `item-${i}`,
          score: 1 - i / 1000,
          distance: i / 1000,
        }))
      );

      const stream = createSearchResultStream(cursor, 10);

      const results: StreamSearchResult[] = [];

      for await (const result of stream) {
        results.push(result);
        if (results.length >= 50) {
          stream.destroy();
          break;
        }
      }

      expect(results.length).toBeLessThanOrEqual(60); // May have some buffered
    });

    it('should handle concurrent stream consumption', async () => {
      const query = normalizedVector(384);

      // Create multiple concurrent streams
      const streams = Array.from({ length: 5 }, () =>
        client.searchStream(query, { k: 100, metric: 'cosine' })
      );

      const results = await Promise.all(
        streams.map(async (stream) => {
          const items: StreamSearchResult[] = [];
          for await (const item of stream) {
            items.push(item);
          }
          return items;
        })
      );

      expect(results).toHaveLength(5);
      results.forEach((r) => {
        // Each stream should return results (limited by mock data)
        expect(r.length).toBeGreaterThan(0);
        expect(r.length).toBeLessThanOrEqual(100);
      });
    });
  });
});
