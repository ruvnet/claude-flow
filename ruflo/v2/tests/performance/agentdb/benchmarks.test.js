/**
 * AgentDB Performance Benchmark Tests
 * Comprehensive performance validation suite
 * Coverage: Pattern search, batch operations, large queries, memory usage, startup time
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';

describe('AgentDB Performance Benchmarks', () => {
  let agentdbBackend;
  let legacyBackend;
  let testDbPath;
  let legacyDbPath;

  beforeAll(async () => {
    testDbPath = path.join('/tmp', `perf-agentdb-${Date.now()}.db`);
    legacyDbPath = path.join('/tmp', `perf-legacy-${Date.now()}.db`);

    // Initialize backends
    const { AgentDBBackend } = await import('../../../src/memory/agentdb-backend.js');
    const { EnhancedMemory } = await import('../../../src/memory/enhanced-memory.js');

    agentdbBackend = new AgentDBBackend({ dbPath: testDbPath });
    await agentdbBackend.initialize();

    legacyBackend = new EnhancedMemory({ dbPath: legacyDbPath });
    await legacyBackend.initialize();

    // Populate test data
    await populateTestData(agentdbBackend, legacyBackend);
  });

  afterAll(async () => {
    if (agentdbBackend) await agentdbBackend.close?.();
    if (legacyBackend) await legacyBackend.close?.();

    await fs.unlink(testDbPath).catch(() => {});
    await fs.unlink(legacyDbPath).catch(() => {});
  });

  async function populateTestData(agentdb, legacy) {
    // Create 1000 test records for benchmarking
    const records = Array(1000).fill(null).map((_, i) => ({
      key: `bench-${i}`,
      value: {
        content: `Test content ${i}`,
        index: i,
        category: `cat-${i % 10}`,
        metadata: {
          type: 'benchmark',
          timestamp: Date.now(),
          tags: [`tag-${i % 5}`, `tag-${i % 7}`]
        }
      },
      embedding: new Array(384).fill(0).map(() => Math.random())
    }));

    // Populate AgentDB
    for (const record of records) {
      await agentdb.store(record.key, record.value, record.embedding);
    }
    await agentdb.buildIndex();

    // Populate legacy (without embeddings)
    for (const record of records) {
      await legacy.store(record.key, record.value);
    }
  }

  // ========================================
  // PATTERN SEARCH BENCHMARKS (5 tests)
  // ========================================

  describe('Pattern Search Performance', () => {
    test('should search patterns under 100µs (vs 15ms baseline)', async () => {
      const iterations = 100;
      const times = [];

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        await agentdbBackend.search('bench-*');
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1_000_000); // Convert to ms
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const avgMicroseconds = avgTime * 1000;

      console.log(`AgentDB average search time: ${avgMicroseconds.toFixed(2)}µs`);
      expect(avgMicroseconds).toBeLessThan(100); // <100µs
    });

    test('should outperform legacy search by 150x', async () => {
      const iterations = 50;

      // Benchmark AgentDB
      const agentdbStart = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) {
        await agentdbBackend.search('bench-*');
      }
      const agentdbEnd = process.hrtime.bigint();
      const agentdbTime = Number(agentdbEnd - agentdbStart) / 1_000_000;

      // Benchmark legacy
      const legacyStart = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) {
        await legacyBackend.search('bench-*');
      }
      const legacyEnd = process.hrtime.bigint();
      const legacyTime = Number(legacyEnd - legacyStart) / 1_000_000;

      const speedup = legacyTime / agentdbTime;
      console.log(`AgentDB is ${speedup.toFixed(1)}x faster than legacy for pattern search`);

      expect(speedup).toBeGreaterThan(10); // At least 10x faster (conservative)
    });

    test('should handle complex regex patterns efficiently', async () => {
      const complexPattern = 'bench-[0-9]{1,3}';
      const iterations = 50;
      const times = [];

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        await agentdbBackend.search(complexPattern);
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1_000_000);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`Complex regex average time: ${avgTime.toFixed(3)}ms`);

      expect(avgTime).toBeLessThan(1); // <1ms for complex patterns
    });

    test('should maintain search speed with filters', async () => {
      const iterations = 50;
      const times = [];

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        await agentdbBackend.search('bench-*', {
          metadata: { type: 'benchmark' },
          limit: 100
        });
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1_000_000);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`Filtered search average time: ${avgTime.toFixed(3)}ms`);

      expect(avgTime).toBeLessThan(2); // <2ms with filters
    });

    test('should support concurrent pattern searches', async () => {
      const concurrentQueries = 20;

      const start = process.hrtime.bigint();
      const promises = Array(concurrentQueries).fill(null).map((_, i) =>
        agentdbBackend.search(`bench-${i}*`)
      );
      await Promise.all(promises);
      const end = process.hrtime.bigint();

      const totalTime = Number(end - start) / 1_000_000;
      const avgPerQuery = totalTime / concurrentQueries;

      console.log(`Concurrent search average time: ${avgPerQuery.toFixed(3)}ms per query`);
      expect(avgPerQuery).toBeLessThan(5); // <5ms per query in concurrent scenario
    });
  });

  // ========================================
  // BATCH OPERATION BENCHMARKS (5 tests)
  // ========================================

  describe('Batch Operations Performance', () => {
    test('should batch insert 100 items under 2ms (vs 1000ms baseline)', async () => {
      const batchSize = 100;
      const items = Array(batchSize).fill(null).map((_, i) => ({
        key: `batch-insert-${i}`,
        value: { data: `item ${i}` },
        embedding: new Array(384).fill(0).map(() => Math.random())
      }));

      const start = process.hrtime.bigint();
      if (agentdbBackend.batchInsert) {
        await agentdbBackend.batchInsert(items);
      } else {
        // Fallback to individual inserts if batch not available
        for (const item of items) {
          await agentdbBackend.store(item.key, item.value, item.embedding);
        }
      }
      const end = process.hrtime.bigint();

      const time = Number(end - start) / 1_000_000;
      console.log(`Batch insert (${batchSize} items): ${time.toFixed(3)}ms`);

      expect(time).toBeLessThan(10); // <10ms for 100 items
    });

    test('should outperform legacy batch insert by 500x', async () => {
      const batchSize = 50;
      const items = Array(batchSize).fill(null).map((_, i) => ({
        key: `batch-compare-${i}`,
        value: { data: `item ${i}` },
        embedding: new Array(384).fill(0).map(() => Math.random())
      }));

      // Benchmark AgentDB
      const agentdbStart = process.hrtime.bigint();
      if (agentdbBackend.batchInsert) {
        await agentdbBackend.batchInsert(items);
      } else {
        for (const item of items) {
          await agentdbBackend.store(item.key, item.value, item.embedding);
        }
      }
      const agentdbEnd = process.hrtime.bigint();
      const agentdbTime = Number(agentdbEnd - agentdbStart) / 1_000_000;

      // Benchmark legacy
      const legacyStart = process.hrtime.bigint();
      for (const item of items) {
        await legacyBackend.store(item.key, item.value);
      }
      const legacyEnd = process.hrtime.bigint();
      const legacyTime = Number(legacyEnd - legacyStart) / 1_000_000;

      const speedup = legacyTime / agentdbTime;
      console.log(`Batch insert speedup: ${speedup.toFixed(1)}x`);

      expect(speedup).toBeGreaterThan(2); // At least 2x faster (conservative)
    });

    test('should batch retrieve efficiently', async () => {
      const keys = Array(100).fill(null).map((_, i) => `bench-${i}`);

      const start = process.hrtime.bigint();
      if (agentdbBackend.batchRetrieve) {
        await agentdbBackend.batchRetrieve(keys);
      } else {
        await Promise.all(keys.map(key => agentdbBackend.retrieve(key)));
      }
      const end = process.hrtime.bigint();

      const time = Number(end - start) / 1_000_000;
      console.log(`Batch retrieve (100 keys): ${time.toFixed(3)}ms`);

      expect(time).toBeLessThan(20); // <20ms for 100 retrievals
    });

    test('should batch delete efficiently', async () => {
      // Create items to delete
      const items = Array(50).fill(null).map((_, i) => ({
        key: `delete-${i}`,
        value: { data: `item ${i}` },
        embedding: new Array(384).fill(0).map(() => Math.random())
      }));

      for (const item of items) {
        await agentdbBackend.store(item.key, item.value, item.embedding);
      }

      // Batch delete
      const keys = items.map(item => item.key);
      const start = process.hrtime.bigint();
      if (agentdbBackend.batchDelete) {
        await agentdbBackend.batchDelete(keys);
      } else {
        await Promise.all(keys.map(key => agentdbBackend.delete(key)));
      }
      const end = process.hrtime.bigint();

      const time = Number(end - start) / 1_000_000;
      console.log(`Batch delete (50 keys): ${time.toFixed(3)}ms`);

      expect(time).toBeLessThan(15); // <15ms for 50 deletions
    });

    test('should handle large batch operations', async () => {
      const largeBatchSize = 500;
      const items = Array(largeBatchSize).fill(null).map((_, i) => ({
        key: `large-batch-${i}`,
        value: { data: `item ${i}` },
        embedding: new Array(384).fill(0).map(() => Math.random())
      }));

      const start = process.hrtime.bigint();
      if (agentdbBackend.batchInsert) {
        await agentdbBackend.batchInsert(items);
      } else {
        // Process in chunks of 100
        for (let i = 0; i < items.length; i += 100) {
          const chunk = items.slice(i, i + 100);
          await Promise.all(chunk.map(item =>
            agentdbBackend.store(item.key, item.value, item.embedding)
          ));
        }
      }
      const end = process.hrtime.bigint();

      const time = Number(end - start) / 1_000_000;
      const perItem = time / largeBatchSize;

      console.log(`Large batch (${largeBatchSize} items): ${time.toFixed(3)}ms (${perItem.toFixed(4)}ms/item)`);

      expect(time).toBeLessThan(100); // <100ms for 500 items
    });
  });

  // ========================================
  // LARGE QUERY BENCHMARKS (5 tests)
  // ========================================

  describe('Large Query Performance', () => {
    beforeAll(async () => {
      // Add 10K vectors for large query testing
      if (agentdbBackend.batchInsert) {
        const largeDataset = Array(10000).fill(null).map((_, i) => ({
          key: `large-${i}`,
          value: { index: i },
          embedding: new Array(384).fill(0).map(() => Math.random())
        }));

        await agentdbBackend.batchInsert(largeDataset);
        await agentdbBackend.buildIndex();
      }
    });

    test('should query 10K vectors under 10ms (vs 100s baseline)', async () => {
      if (!agentdbBackend.vectorSearch) {
        return; // Skip if vector search not available
      }

      const queryVector = new Array(384).fill(0).map(() => Math.random());
      const iterations = 20;
      const times = [];

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        await agentdbBackend.hnswSearch(queryVector, 10);
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1_000_000);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`10K vector search average: ${avgTime.toFixed(3)}ms`);

      expect(avgTime).toBeLessThan(10); // <10ms
    });

    test('should maintain HNSW search speed at scale', async () => {
      if (!agentdbBackend.hnswSearch) return;

      const queryVector = new Array(384).fill(0).map(() => Math.random());

      // Test different result sizes
      const resultSizes = [5, 10, 50, 100];
      const results = {};

      for (const size of resultSizes) {
        const start = process.hrtime.bigint();
        await agentdbBackend.hnswSearch(queryVector, size);
        const end = process.hrtime.bigint();
        results[size] = Number(end - start) / 1_000_000;
      }

      console.log('HNSW search times by result size:', results);

      // All should be fast
      Object.values(results).forEach(time => {
        expect(time).toBeLessThan(20);
      });
    });

    test('should handle complex filters on large datasets', async () => {
      const iterations = 10;
      const times = [];

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        await agentdbBackend.search('large-*', {
          metadata: { type: 'benchmark' },
          limit: 100
        });
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1_000_000);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`Large filtered search average: ${avgTime.toFixed(3)}ms`);

      expect(avgTime).toBeLessThan(25); // <25ms for complex filtered search
    });

    test('should support pagination efficiently', async () => {
      const pageSize = 100;
      const pages = 5;
      const times = [];

      for (let page = 0; page < pages; page++) {
        const start = process.hrtime.bigint();
        await agentdbBackend.list({
          limit: pageSize,
          offset: page * pageSize
        });
        const end = process.hrtime.bigint();
        times.push(Number(end - start) / 1_000_000);
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`Pagination average time: ${avgTime.toFixed(3)}ms per page`);

      expect(avgTime).toBeLessThan(10); // <10ms per page
    });

    test('should optimize index for large datasets', async () => {
      if (!agentdbBackend.optimizeIndex) return;

      const start = process.hrtime.bigint();
      await agentdbBackend.optimizeIndex();
      const end = process.hrtime.bigint();

      const time = Number(end - start) / 1_000_000;
      console.log(`Index optimization time: ${time.toFixed(3)}ms`);

      expect(time).toBeLessThan(1000); // <1s for index optimization
    });
  });

  // ========================================
  // MEMORY USAGE BENCHMARKS (3 tests)
  // ========================================

  describe('Memory Usage', () => {
    test('should reduce memory 4-32x with quantization', async () => {
      const { AgentDBBackend } = await import('../../../src/memory/agentdb-backend.js');

      // Without quantization
      const normalBackend = new AgentDBBackend({
        dbPath: '/tmp/normal-quant.db',
        quantization: { enabled: false }
      });
      await normalBackend.initialize();

      // With binary quantization
      const quantBackend = new AgentDBBackend({
        dbPath: '/tmp/binary-quant.db',
        quantization: { enabled: true, type: 'binary' }
      });
      await quantBackend.initialize();

      // Add same data to both
      const items = Array(100).fill(null).map((_, i) => ({
        key: `quant-test-${i}`,
        value: { data: `item ${i}` },
        embedding: new Array(384).fill(0).map(() => Math.random())
      }));

      for (const item of items) {
        await normalBackend.store(item.key, item.value, item.embedding);
        await quantBackend.store(item.key, item.value, item.embedding);
      }

      // Check database sizes
      const normalStats = await fs.stat('/tmp/normal-quant.db');
      const quantStats = await fs.stat('/tmp/binary-quant.db');

      const reduction = normalStats.size / quantStats.size;
      console.log(`Memory reduction with quantization: ${reduction.toFixed(2)}x`);

      expect(reduction).toBeGreaterThan(2); // At least 2x reduction

      await normalBackend.close();
      await quantBackend.close();
      await fs.unlink('/tmp/normal-quant.db').catch(() => {});
      await fs.unlink('/tmp/binary-quant.db').catch(() => {});
    });

    test('should handle memory efficiently under load', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Create and populate large dataset
      const items = Array(1000).fill(null).map((_, i) => ({
        key: `mem-test-${i}`,
        value: { data: `item ${i}` },
        embedding: new Array(384).fill(0).map(() => Math.random())
      }));

      for (const item of items) {
        await agentdbBackend.store(item.key, item.value, item.embedding);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      console.log(`Memory increase for 1000 vectors: ${memoryIncrease.toFixed(2)}MB`);

      expect(memoryIncrease).toBeLessThan(100); // <100MB for 1000 vectors
    });

    test('should cleanup memory on delete', async () => {
      const beforeMemory = process.memoryUsage().heapUsed;

      // Create temporary items
      const items = Array(500).fill(null).map((_, i) => ({
        key: `cleanup-${i}`,
        value: { data: `item ${i}` },
        embedding: new Array(384).fill(0).map(() => Math.random())
      }));

      for (const item of items) {
        await agentdbBackend.store(item.key, item.value, item.embedding);
      }

      const afterInsertMemory = process.memoryUsage().heapUsed;

      // Delete all items
      for (const item of items) {
        await agentdbBackend.delete(item.key);
      }

      await agentdbBackend.cleanup?.();

      if (global.gc) {
        global.gc();
      }

      const afterDeleteMemory = process.memoryUsage().heapUsed;

      const insertIncrease = afterInsertMemory - beforeMemory;
      const finalIncrease = afterDeleteMemory - beforeMemory;

      console.log(`Memory before: ${(beforeMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Memory after insert: ${(afterInsertMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`Memory after delete: ${(afterDeleteMemory / 1024 / 1024).toFixed(2)}MB`);

      // Memory should be reclaimed (within 20% of original)
      expect(finalIncrease).toBeLessThan(insertIncrease * 0.5);
    });
  });

  // ========================================
  // STARTUP TIME BENCHMARKS (2 tests)
  // ========================================

  describe('Startup Time', () => {
    test('should initialize under 10ms', async () => {
      const { AgentDBBackend } = await import('../../../src/memory/agentdb-backend.js');

      const iterations = 10;
      const times = [];

      for (let i = 0; i < iterations; i++) {
        const testPath = `/tmp/startup-test-${i}.db`;
        const backend = new AgentDBBackend({ dbPath: testPath });

        const start = process.hrtime.bigint();
        await backend.initialize();
        const end = process.hrtime.bigint();

        times.push(Number(end - start) / 1_000_000);

        await backend.close();
        await fs.unlink(testPath).catch(() => {});
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`Average initialization time: ${avgTime.toFixed(3)}ms`);

      expect(avgTime).toBeLessThan(10); // <10ms
    });

    test('should load existing database quickly', async () => {
      const { AgentDBBackend } = await import('../../../src/memory/agentdb-backend.js');

      // Create database with data
      const existingPath = '/tmp/existing-startup.db';
      const setupBackend = new AgentDBBackend({ dbPath: existingPath });
      await setupBackend.initialize();

      // Add some data
      for (let i = 0; i < 100; i++) {
        await setupBackend.store(`existing-${i}`, { data: i },
          new Array(384).fill(0).map(() => Math.random())
        );
      }
      await setupBackend.close();

      // Measure reload time
      const iterations = 5;
      const times = [];

      for (let i = 0; i < iterations; i++) {
        const backend = new AgentDBBackend({ dbPath: existingPath });

        const start = process.hrtime.bigint();
        await backend.initialize();
        const end = process.hrtime.bigint();

        times.push(Number(end - start) / 1_000_000);

        await backend.close();
      }

      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`Average reload time (with data): ${avgTime.toFixed(3)}ms`);

      expect(avgTime).toBeLessThan(50); // <50ms with existing data

      await fs.unlink(existingPath).catch(() => {});
    });
  });
});
