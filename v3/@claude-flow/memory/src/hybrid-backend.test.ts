/**
 * Tests for HybridBackend (ADR-009)
 *
 * Verifies that the hybrid backend correctly routes queries between
 * SQLite (structured) and AgentDB (semantic) backends.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HybridBackend } from './hybrid-backend.js';
import { MemoryEntry, createDefaultEntry } from './types.js';

describe('HybridBackend - ADR-009', () => {
  let backend: HybridBackend;

  // Mock embedding generator for testing
  const mockEmbedding = async (text: string): Promise<Float32Array> => {
    // Simple mock: convert text to numbers
    const arr = new Float32Array(128);
    for (let i = 0; i < Math.min(text.length, 128); i++) {
      arr[i] = text.charCodeAt(i) / 255;
    }
    return arr;
  };

  beforeEach(async () => {
    backend = new HybridBackend({
      sqlite: {
        databasePath: ':memory:', // In-memory for testing
        verbose: false,
      },
      agentdb: {
        vectorDimension: 128,
      },
      embeddingGenerator: mockEmbedding,
      dualWrite: true,
    });

    await backend.initialize();
  });

  afterEach(async () => {
    await backend.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize both backends', async () => {
      const health = await backend.healthCheck();
      expect(['healthy', 'degraded']).toContain(health.status);
      expect(health.components.storage).toBeDefined();
      expect(health.components.index).toBeDefined();
      expect(health.components.cache).toBeDefined();
    });
  });

  describe('Store Operations', () => {
    it('should store entries in both backends (dual-write)', async () => {
      const entry = createDefaultEntry({
        key: 'test-key',
        content: 'Test content for dual write',
        namespace: 'test',
      });

      await backend.store(entry);

      // Verify in SQLite
      const fromSQLite = await backend.getSQLiteBackend().get(entry.id);
      expect(fromSQLite).toBeDefined();
      expect(fromSQLite?.key).toBe('test-key');

      // Verify in AgentDB
      const fromAgentDB = await backend.getAgentDBBackend().get(entry.id);
      expect(fromAgentDB).toBeDefined();
      expect(fromAgentDB?.key).toBe('test-key');
    });

    it('should handle bulk inserts', async () => {
      const entries = Array.from({ length: 10 }, (_, i) =>
        createDefaultEntry({
          key: `bulk-${i}`,
          content: `Bulk content ${i}`,
          namespace: 'bulk-test',
        })
      );

      await backend.bulkInsert(entries);

      const count = await backend.count('bulk-test');
      expect(count).toBe(10);
    });
  });

  describe('Exact Match Queries (SQLite)', () => {
    beforeEach(async () => {
      // Insert test data
      await backend.store(
        createDefaultEntry({
          key: 'user-123',
          content: 'User data for testing',
          namespace: 'users',
        })
      );
    });

    it('should route exact key queries to SQLite', async () => {
      const result = await backend.getByKey('users', 'user-123');
      expect(result).toBeDefined();
      expect(result?.key).toBe('user-123');
    });

    it('should handle prefix queries via SQLite', async () => {
      await backend.store(
        createDefaultEntry({
          key: 'user-456',
          content: 'Another user',
          namespace: 'users',
        })
      );

      const results = await backend.queryStructured({
        namespace: 'users',
        keyPrefix: 'user-',
        limit: 10,
      });

      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.every((r) => r.key.startsWith('user-'))).toBe(true);
    });
  });

  describe('Semantic Search (AgentDB)', () => {
    beforeEach(async () => {
      // Insert test data with semantic content
      await backend.store(
        createDefaultEntry({
          key: 'doc-1',
          content: 'Authentication and authorization patterns',
          namespace: 'docs',
          tags: ['security', 'auth'],
        })
      );

      await backend.store(
        createDefaultEntry({
          key: 'doc-2',
          content: 'Database optimization techniques',
          namespace: 'docs',
          tags: ['performance', 'database'],
        })
      );

      await backend.store(
        createDefaultEntry({
          key: 'doc-3',
          content: 'Secure authentication methods',
          namespace: 'docs',
          tags: ['security', 'auth'],
        })
      );
    });

    it('should perform semantic search via AgentDB', async () => {
      const results = await backend.querySemantic({
        content: 'authentication security',
        k: 5,
        threshold: 0.1, // Low threshold for simple mock embeddings
      });

      expect(results.length).toBeGreaterThan(0);
      // Should find docs about authentication
      const hasAuthDoc = results.some((r) => r.content.includes('Authentication'));
      expect(hasAuthDoc).toBe(true);
    });

    it('should support semantic search with filters', async () => {
      const results = await backend.querySemantic({
        content: 'security patterns',
        k: 10,
        filters: {
          type: 'semantic',
          tags: ['security'],
          limit: 10,
        },
      });

      expect(results.every((r) => r.tags.includes('security'))).toBe(true);
    });
  });

  describe('Hybrid Queries', () => {
    beforeEach(async () => {
      // Insert diverse test data
      for (let i = 0; i < 5; i++) {
        await backend.store(
          createDefaultEntry({
            key: `hybrid-${i}`,
            content: `Content about ${i % 2 === 0 ? 'authentication' : 'database'} topic ${i}`,
            namespace: 'hybrid-test',
            tags: i % 2 === 0 ? ['auth'] : ['db'],
          })
        );
      }
    });

    it('should combine semantic and structured queries (union)', async () => {
      const results = await backend.queryHybrid({
        semantic: {
          content: 'authentication',
          k: 3,
        },
        structured: {
          namespace: 'hybrid-test',
          keyPrefix: 'hybrid-',
          limit: 5,
        },
        combineStrategy: 'union',
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.namespace === 'hybrid-test')).toBe(true);
    });

    it('should support semantic-first strategy', async () => {
      const results = await backend.queryHybrid({
        semantic: {
          content: 'database',
          k: 2,
        },
        structured: {
          namespace: 'hybrid-test',
          limit: 3,
        },
        combineStrategy: 'semantic-first',
      });

      expect(results.length).toBeGreaterThan(0);
      // First results should be from semantic search
    });
  });

  describe('Weighted Union Fusion (Dream Cycle 2026-08-28)', () => {
    // Before this fix, `queryHybrid`'s 'union' strategy computed `weights`
    // and then never consumed it (combineUnion was a plain dedup, no score
    // math) — this suite proves `weights` now actually controls ordering.
    const QUERY_CONTENT = 'authentication token verification';

    beforeEach(async () => {
      // Explicit, distinct `createdAt` values (rather than relying on wall-clock
      // gaps between two `store()` calls, which can tie at millisecond
      // resolution) so SQLiteBackend's `ORDER BY created_at DESC` deterministically
      // ranks 'fusion-struct-fav' first in structured results.
      // 'fusion-sem-fav' content closely matches QUERY_CONTENT → ranks BEFORE
      // 'struct-fav' in semantic (AgentDB cosine) results. Opposite ranks in
      // each arm is what makes the weight-sensitivity assertions below
      // meaningful (same-order ranks in both arms couldn't distinguish a real
      // weighted fusion from any dedup that happens to prefer one arm).
      const semFav = createDefaultEntry({
        key: 'fusion-sem-fav',
        content: 'authentication token verification flow',
        namespace: 'fusion-test',
      });
      semFav.createdAt = 1000;
      await backend.store(semFav);

      // Content deliberately shares nothing with QUERY_CONTENT → ranks
      // AFTER 'fusion-sem-fav' in semantic results.
      const structFav = createDefaultEntry({
        key: 'fusion-struct-fav',
        content: 'zzz totally unrelated filler xyz 12345',
        namespace: 'fusion-test',
      });
      structFav.createdAt = 2000; // strictly newer → ranks FIRST under created_at DESC
      await backend.store(structFav);
    });

    async function fusedTopKey(weights: { semantic: number; structured: number }) {
      const results = await backend.queryHybrid({
        semantic: {
          content: QUERY_CONTENT,
          k: 5,
          threshold: 0.01, // low: let both entries pass so both arms are populated
          filters: { namespace: 'fusion-test' },
        },
        structured: {
          namespace: 'fusion-test',
          keyPrefix: 'fusion-',
          limit: 5,
        },
        combineStrategy: 'union',
        weights,
      });
      expect(results.length).toBe(2); // sanity: both entries present in the fused union
      return results[0].key;
    }

    it('heavily semantic-weighted fusion ranks the semantically-closer entry first', async () => {
      expect(await fusedTopKey({ semantic: 1, structured: 0.01 })).toBe('fusion-sem-fav');
    });

    it('heavily structured-weighted fusion ranks the more-recently-stored entry first', async () => {
      expect(await fusedTopKey({ semantic: 0.01, structured: 1 })).toBe('fusion-struct-fav');
    });

    it('still returns the full deduped union when weights are omitted (regression guard)', async () => {
      const results = await backend.queryHybrid({
        semantic: {
          content: QUERY_CONTENT,
          k: 5,
          threshold: 0.01,
          filters: { namespace: 'fusion-test' },
        },
        structured: {
          namespace: 'fusion-test',
          keyPrefix: 'fusion-',
          limit: 5,
        },
        combineStrategy: 'union',
      });
      const keys = results.map((r) => r.key).sort();
      expect(keys).toEqual(['fusion-sem-fav', 'fusion-struct-fav']);
    });
  });

  describe('CRUD Operations', () => {
    let testEntry: MemoryEntry;

    beforeEach(async () => {
      testEntry = createDefaultEntry({
        key: 'crud-test',
        content: 'Original content',
        namespace: 'test',
      });
      await backend.store(testEntry);
    });

    it('should update entries in both backends', async () => {
      const updated = await backend.update(testEntry.id, {
        content: 'Updated content',
        tags: ['updated'],
      });

      expect(updated).toBeDefined();
      expect(updated?.content).toBe('Updated content');
      expect(updated?.tags).toContain('updated');

      // Verify in SQLite
      const fromSQLite = await backend.getSQLiteBackend().get(testEntry.id);
      expect(fromSQLite?.content).toBe('Updated content');

      // Verify in AgentDB
      const fromAgentDB = await backend.getAgentDBBackend().get(testEntry.id);
      expect(fromAgentDB?.content).toBe('Updated content');
    });

    it('should delete entries from both backends', async () => {
      const deleted = await backend.delete(testEntry.id);
      expect(deleted).toBe(true);

      const fromSQLite = await backend.getSQLiteBackend().get(testEntry.id);
      expect(fromSQLite).toBeNull();

      const fromAgentDB = await backend.getAgentDBBackend().get(testEntry.id);
      expect(fromAgentDB).toBeNull();
    });
  });

  describe('Namespace Operations', () => {
    beforeEach(async () => {
      await backend.store(
        createDefaultEntry({
          key: 'ns1-key',
          content: 'Namespace 1 content',
          namespace: 'ns1',
        })
      );
      await backend.store(
        createDefaultEntry({
          key: 'ns2-key',
          content: 'Namespace 2 content',
          namespace: 'ns2',
        })
      );
    });

    it('should list all namespaces', async () => {
      const namespaces = await backend.listNamespaces();
      expect(namespaces).toContain('ns1');
      expect(namespaces).toContain('ns2');
    });

    it('should count entries per namespace', async () => {
      const ns1Count = await backend.count('ns1');
      const ns2Count = await backend.count('ns2');

      expect(ns1Count).toBe(1);
      expect(ns2Count).toBe(1);
    });

    it('should clear namespace in both backends', async () => {
      const deleted = await backend.clearNamespace('ns1');
      expect(deleted).toBe(1);

      const ns1Count = await backend.count('ns1');
      expect(ns1Count).toBe(0);

      const ns2Count = await backend.count('ns2');
      expect(ns2Count).toBe(1);
    });
  });

  describe('Statistics', () => {
    it('should provide combined statistics', async () => {
      // Add some test data
      for (let i = 0; i < 5; i++) {
        await backend.store(
          createDefaultEntry({
            key: `stats-${i}`,
            content: `Stats content ${i}`,
            namespace: 'stats',
          })
        );
      }

      const stats = await backend.getStats();
      expect(stats.totalEntries).toBeGreaterThanOrEqual(5);
      expect(stats.entriesByNamespace['stats']).toBe(5);
      expect(stats.hnswStats).toBeDefined();
      expect(stats.cacheStats).toBeDefined();
    });
  });

  describe('Health Check', () => {
    it('should report healthy status for both backends', async () => {
      const health = await backend.healthCheck();
      expect(['healthy', 'degraded']).toContain(health.status);
      expect(health.components.storage).toBeDefined();
      expect(['healthy', 'degraded']).toContain(health.components.storage.status);
      expect(health.components.index).toBeDefined();
      expect(health.components.cache).toBeDefined();
    });
  });

  describe('Query Routing', () => {
    it('should auto-route semantic queries to AgentDB', async () => {
      await backend.store(
        createDefaultEntry({
          key: 'route-test',
          content: 'Routing test content',
          namespace: 'routing',
        })
      );

      const results = await backend.query({
        type: 'semantic',
        content: 'routing test',
        limit: 5,
      });

      // Verify we got some results
      expect(results).toBeDefined();
    });

    it('should auto-route exact queries to SQLite', async () => {
      await backend.store(
        createDefaultEntry({
          key: 'exact-test',
          content: 'Exact match test',
          namespace: 'routing',
        })
      );

      const results = await backend.query({
        type: 'exact',
        key: 'exact-test',
        namespace: 'routing',
        limit: 1,
      });

      // Verify we got the exact result
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].key).toBe('exact-test');
    });
  });
});
