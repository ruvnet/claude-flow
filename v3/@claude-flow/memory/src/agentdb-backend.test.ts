/**
 * AgentDB Backend Tests
 *
 * Tests for agentdb@2.0.0-alpha.3.4 integration with V3 memory system
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentDBBackend } from './agentdb-backend.js';
import { createDefaultEntry } from './types.js';

describe('AgentDBBackend', () => {
  let backend: AgentDBBackend;

  beforeEach(async () => {
    backend = new AgentDBBackend({
      dbPath: ':memory:',
      namespace: 'test',
      vectorDimension: 384,
    });
    await backend.initialize();
  });

  afterEach(async () => {
    await backend.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      expect(backend).toBeDefined();
    });

    it('should handle missing agentdb gracefully', async () => {
      const fallbackBackend = new AgentDBBackend();
      await fallbackBackend.initialize();

      // Should still work with in-memory fallback
      expect(fallbackBackend).toBeDefined();

      await fallbackBackend.shutdown();
    });
  });

  describe('Basic CRUD Operations', () => {
    it('should store and retrieve entries', async () => {
      const entry = createDefaultEntry({
        key: 'test-key',
        content: 'Test content',
        type: 'episodic',
      });

      await backend.store(entry);

      const retrieved = await backend.get(entry.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe('Test content');
    });

    it('should get entry by key', async () => {
      const entry = createDefaultEntry({
        key: 'unique-key',
        content: 'Unique content',
        namespace: 'test',
      });

      await backend.store(entry);

      const retrieved = await backend.getByKey('test', 'unique-key');
      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe('Unique content');
    });

    it('should update entries', async () => {
      const entry = createDefaultEntry({
        key: 'update-test',
        content: 'Original content',
      });

      await backend.store(entry);
      const originalVersion = entry.version;

      const updated = await backend.update(entry.id, {
        content: 'Updated content',
      });

      expect(updated?.content).toBe('Updated content');
      expect(updated?.version).toBe(originalVersion + 1);
    });

    it('should delete entries', async () => {
      const entry = createDefaultEntry({
        key: 'delete-test',
        content: 'To be deleted',
      });

      await backend.store(entry);

      const deleted = await backend.delete(entry.id);
      expect(deleted).toBe(true);

      const retrieved = await backend.get(entry.id);
      expect(retrieved).toBeNull();
    });

    it('should delete an entry that exists only in AgentDB, not the in-memory cache (fresh-instance parity with get())', async () => {
      const entry = createDefaultEntry({
        key: 'persisted-only-delete',
        content: 'Only on disk',
      });

      await backend.store(entry);
      // Simulate what a second, independent AgentDBBackend instance pointed at
      // the same dbPath would see: the row is persisted in AgentDB, but this
      // instance's in-memory cache has never heard of it.
      (backend as unknown as { entries: Map<string, unknown> }).entries.clear();

      // get() already falls back to AgentDB on a cache miss -- confirms the
      // row really is persisted before asserting delete()'s behavior on it.
      expect(await backend.get(entry.id)).not.toBeNull();

      const deleted = await backend.delete(entry.id);
      expect(deleted).toBe(true);
      expect(await backend.get(entry.id)).toBeNull();
    });

    it('should update an entry that exists only in AgentDB, not the in-memory cache (fresh-instance parity with get())', async () => {
      const entry = createDefaultEntry({
        key: 'persisted-only-update',
        content: 'Original content',
      });

      await backend.store(entry);
      (backend as unknown as { entries: Map<string, unknown> }).entries.clear();

      expect(await backend.get(entry.id)).not.toBeNull();

      const updated = await backend.update(entry.id, { content: 'Updated content' });
      expect(updated?.content).toBe('Updated content');

      const retrieved = await backend.get(entry.id);
      expect(retrieved?.content).toBe('Updated content');
    });

    it('should leave an in-memory cache miss with no persisted row as a true no-op (negative control)', async () => {
      expect(await backend.delete('never-stored-id')).toBe(false);
      expect(await backend.update('never-stored-id', { content: 'x' })).toBeNull();
    });
  });

  describe('Query Operations', () => {
    beforeEach(async () => {
      // Insert test data
      await backend.store(
        createDefaultEntry({
          key: 'entry-1',
          content: 'First entry',
          namespace: 'test',
          tags: ['tag1', 'tag2'],
        })
      );

      await backend.store(
        createDefaultEntry({
          key: 'entry-2',
          content: 'Second entry',
          namespace: 'test',
          tags: ['tag2', 'tag3'],
        })
      );

      await backend.store(
        createDefaultEntry({
          key: 'entry-3',
          content: 'Third entry',
          namespace: 'other',
          tags: ['tag1'],
        })
      );
    });

    it('should query by namespace', async () => {
      const results = await backend.query({
        type: 'hybrid',
        namespace: 'test',
        limit: 10,
      });

      expect(results.length).toBe(2);
    });

    it('should query by exact key', async () => {
      const results = await backend.query({
        type: 'exact',
        namespace: 'test',
        key: 'entry-1',
        limit: 10,
      });

      expect(results.length).toBe(1);
      expect(results[0].content).toBe('First entry');
    });

    it('should query by prefix', async () => {
      const results = await backend.query({
        type: 'prefix',
        keyPrefix: 'entry-',
        limit: 10,
      });

      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('should query by tags', async () => {
      const results = await backend.query({
        type: 'tag',
        tags: ['tag2'],
        limit: 10,
      });

      expect(results.length).toBe(2);
    });
  });

  describe('Vector Search', () => {
    it('should perform brute-force search when agentdb unavailable', async () => {
      const entry = createDefaultEntry({
        key: 'vector-test',
        content: 'Vector content',
      });

      // Create a fake embedding
      entry.embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      await backend.store(entry);

      const queryEmbedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);

      const results = await backend.search(queryEmbedding, { k: 5 });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entry.id).toBe(entry.id);
    });

    it('should handle semantic queries', async () => {
      const entry = createDefaultEntry({
        key: 'semantic-test',
        content: 'Semantic content',
      });

      entry.embedding = new Float32Array([0.5, 0.5, 0.5, 0.5]);

      await backend.store(entry);

      const results = await backend.query({
        type: 'semantic',
        embedding: new Float32Array([0.5, 0.5, 0.5, 0.5]),
        limit: 5,
      });

      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Bulk Operations', () => {
    it('should bulk insert entries', async () => {
      const entries = [
        createDefaultEntry({ key: 'bulk-1', content: 'Bulk 1' }),
        createDefaultEntry({ key: 'bulk-2', content: 'Bulk 2' }),
        createDefaultEntry({ key: 'bulk-3', content: 'Bulk 3' }),
      ];

      await backend.bulkInsert(entries);

      const count = await backend.count();
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('should bulk delete entries', async () => {
      const entries = [
        createDefaultEntry({ key: 'delete-1', content: 'Delete 1' }),
        createDefaultEntry({ key: 'delete-2', content: 'Delete 2' }),
      ];

      await backend.bulkInsert(entries);

      const ids = entries.map((e) => e.id);
      const deleted = await backend.bulkDelete(ids);

      expect(deleted).toBe(2);
    });
  });

  describe('Statistics and Health', () => {
    it('should provide backend statistics', async () => {
      await backend.store(
        createDefaultEntry({ key: 'stats-test', content: 'Stats content' })
      );

      const stats = await backend.getStats();

      expect(stats.totalEntries).toBeGreaterThan(0);
      expect(stats.avgQueryTime).toBeGreaterThanOrEqual(0);
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });

    it('should perform health checks', async () => {
      const health = await backend.healthCheck();

      expect(health.status).toBeDefined();
      expect(['healthy', 'degraded', 'unhealthy']).toContain(health.status);
      expect(health.components).toBeDefined();
      expect(health.components.storage).toBeDefined();
      expect(health.components.index).toBeDefined();
      expect(health.components.cache).toBeDefined();
    });
  });

  describe('Namespace Operations', () => {
    beforeEach(async () => {
      await backend.store(
        createDefaultEntry({
          key: 'ns1-entry',
          content: 'NS1',
          namespace: 'namespace1',
        })
      );

      await backend.store(
        createDefaultEntry({
          key: 'ns2-entry',
          content: 'NS2',
          namespace: 'namespace2',
        })
      );
    });

    it('should list namespaces', async () => {
      const namespaces = await backend.listNamespaces();

      expect(namespaces).toContain('namespace1');
      expect(namespaces).toContain('namespace2');
    });

    it('should count entries by namespace', async () => {
      const count = await backend.count('namespace1');
      expect(count).toBe(1);
    });

    it('should clear namespace', async () => {
      const cleared = await backend.clearNamespace('namespace1');
      expect(cleared).toBe(1);

      const count = await backend.count('namespace1');
      expect(count).toBe(0);
    });
  });

  describe('Graceful Degradation', () => {
    it('should work without agentdb package', async () => {
      const fallbackBackend = new AgentDBBackend({
        dbPath: ':memory:',
      });

      await fallbackBackend.initialize();

      const entry = createDefaultEntry({
        key: 'fallback-test',
        content: 'Fallback content',
      });

      await fallbackBackend.store(entry);
      const retrieved = await fallbackBackend.get(entry.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe('Fallback content');

      await fallbackBackend.shutdown();
    });

    it('should indicate availability status', () => {
      expect(typeof backend.isAvailable()).toBe('boolean');
    });
  });
});
