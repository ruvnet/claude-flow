/**
 * Database Provider Tests - Cross-Platform Compatibility
 *
 * Tests for platform-aware database selection and fallback mechanisms
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, getPlatformInfo, getAvailableProviders } from './database-provider.js';
import { generateMemoryId, createDefaultEntry } from './types.js';
import { unlinkSync, existsSync } from 'node:fs';

describe('DatabaseProvider', () => {
  const testDbPath = './test-database-provider.db';

  beforeEach(() => {
    // Ensure clean state before each test
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  afterEach(() => {
    // Cleanup test database
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Platform Detection', () => {
    it('should detect platform information', () => {
      const info = getPlatformInfo();

      expect(info).toHaveProperty('os');
      expect(info).toHaveProperty('isWindows');
      expect(info).toHaveProperty('isMacOS');
      expect(info).toHaveProperty('isLinux');
      expect(info).toHaveProperty('recommendedProvider');

      // Should recommend sql.js on Windows, better-sqlite3 on Unix
      if (info.isWindows) {
        expect(info.recommendedProvider).toBe('sql.js');
      } else {
        expect(info.recommendedProvider).toBe('better-sqlite3');
      }
    });
  });

  describe('Provider Availability', () => {
    it('should check available providers', async () => {
      const available = await getAvailableProviders();

      expect(available).toHaveProperty('betterSqlite3');
      expect(available).toHaveProperty('sqlJs');
      expect(available).toHaveProperty('json');

      // JSON backend should always be available
      expect(available.json).toBe(true);
    });
  });

  describe('Automatic Provider Selection', () => {
    it('should create database with auto provider selection', async () => {
      const db = await createDatabase(':memory:');

      expect(db).toBeDefined();
      await expect(db.count()).resolves.toBe(0);

      await db.shutdown();
    });

    it('should create persistent database with auto provider', async () => {
      const db = await createDatabase(testDbPath);

      expect(db).toBeDefined();

      // Store test entry
      const entry = createDefaultEntry({
        key: 'test-key',
        content: 'test content',
        namespace: 'test',
      });

      const countBefore = await db.count('test');
      await db.store(entry);
      await expect(db.count('test')).resolves.toBe(countBefore + 1);

      await db.shutdown();
    });
  });

  describe('Explicit Provider Selection', () => {
    it('should create database with sql.js provider', async () => {
      const available = await getAvailableProviders();

      if (!available.sqlJs) {
        console.log('sql.js not available, skipping test');
        return;
      }

      const db = await createDatabase(':memory:', {
        provider: 'sql.js',
        verbose: false,
      });

      expect(db).toBeDefined();

      // Test basic operations
      const entry = createDefaultEntry({
        key: 'sqljs-test',
        content: 'testing sql.js backend',
        namespace: 'test',
      });

      await db.store(entry);
      await expect(db.count()).resolves.toBe(1);

      const retrieved = await db.get(entry.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe('sqljs-test');

      await db.shutdown();
    });

    it('should create database with better-sqlite3 provider', async () => {
      const available = await getAvailableProviders();

      if (!available.betterSqlite3) {
        console.log('better-sqlite3 not available, skipping test');
        return;
      }

      const db = await createDatabase(':memory:', {
        provider: 'better-sqlite3',
        verbose: false,
      });

      expect(db).toBeDefined();

      // Test basic operations
      const entry = createDefaultEntry({
        key: 'sqlite-test',
        content: 'testing better-sqlite3 backend',
        namespace: 'test',
      });

      await db.store(entry);
      await expect(db.count()).resolves.toBe(1);

      const retrieved = await db.get(entry.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe('sqlite-test');

      await db.shutdown();
    });

    it('should create database with JSON provider', async () => {
      const db = await createDatabase(testDbPath, {
        provider: 'json',
        verbose: false,
      });

      expect(db).toBeDefined();

      // Test basic operations
      const entry = createDefaultEntry({
        key: 'json-test',
        content: 'testing JSON backend',
        namespace: 'test',
      });

      await db.store(entry);
      await expect(db.count()).resolves.toBe(1);

      const retrieved = await db.get(entry.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe('json-test');

      await db.shutdown();
    });

    // ADR-125 Phase 2 — new 'hybrid' and 'agentdb' provider cases
    it('should create database with hybrid provider returning a HybridBackend', async () => {
      const { HybridBackend } = await import('./hybrid-backend.js');
      const db = await createDatabase(':memory:', {
        provider: 'hybrid',
        verbose: false,
      });

      expect(db).toBeDefined();
      expect(db).toBeInstanceOf(HybridBackend);

      // Basic CRUD smoke
      const entry = createDefaultEntry({
        key: 'hybrid-test',
        content: 'testing hybrid backend',
        namespace: 'test',
      });

      await db.store(entry);
      const retrieved = await db.get(entry.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe('hybrid-test');

      await db.shutdown();
    });

    it('should create database with agentdb provider returning an AgentDBBackend', async () => {
      const { AgentDBBackend } = await import('./agentdb-backend.js');
      const db = await createDatabase(':memory:', {
        provider: 'agentdb',
        verbose: false,
      });

      expect(db).toBeDefined();
      expect(db).toBeInstanceOf(AgentDBBackend);

      // Basic CRUD smoke
      const entry = createDefaultEntry({
        key: 'agentdb-test',
        content: 'testing agentdb backend',
        namespace: 'test',
      });

      await db.store(entry);
      const retrieved = await db.get(entry.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.key).toBe('agentdb-test');

      await db.shutdown();
    });
  });

  describe('Cross-Platform Functionality', () => {
    it('should handle CRUD operations consistently across providers', async () => {
      const available = await getAvailableProviders();
      const providers: Array<'better-sqlite3' | 'sql.js' | 'json'> = [];

      if (available.betterSqlite3) providers.push('better-sqlite3');
      if (available.sqlJs) providers.push('sql.js');
      providers.push('json'); // Always available

      for (const provider of providers) {
        const db = await createDatabase(':memory:', { provider });

        // Create
        const entry = createDefaultEntry({
          key: `test-${provider}`,
          content: `testing ${provider}`,
          namespace: 'cross-platform',
          tags: ['test', provider],
        });

        await db.store(entry);

        // Read
        const retrieved = await db.get(entry.id);
        expect(retrieved).toBeDefined();
        expect(retrieved?.key).toBe(`test-${provider}`);
        expect(retrieved?.tags).toContain(provider);

        // Update
        const updated = await db.update(entry.id, {
          content: `updated ${provider}`,
        });
        expect(updated).toBeDefined();
        expect(updated?.content).toBe(`updated ${provider}`);

        // Query
        const results = await db.query({
          type: 'hybrid',
          namespace: 'cross-platform',
          limit: 10,
        });
        expect(results.length).toBe(1);
        expect(results[0].key).toBe(`test-${provider}`);

        // Delete
        const deleted = await db.delete(entry.id);
        expect(deleted).toBe(true);

        await expect(db.count()).resolves.toBe(0);

        await db.shutdown();
      }
    });

    it('should handle namespace operations across providers', async () => {
      const db = await createDatabase(':memory:');

      // Create entries in different namespaces
      const entries = [
        createDefaultEntry({ key: 'entry1', content: 'content1', namespace: 'ns1' }),
        createDefaultEntry({ key: 'entry2', content: 'content2', namespace: 'ns1' }),
        createDefaultEntry({ key: 'entry3', content: 'content3', namespace: 'ns2' }),
      ];

      for (const entry of entries) {
        await db.store(entry);
      }

      // List namespaces
      const namespaces = await db.listNamespaces();
      expect(namespaces).toContain('ns1');
      expect(namespaces).toContain('ns2');

      // Count by namespace
      await expect(db.count('ns1')).resolves.toBe(2);
      await expect(db.count('ns2')).resolves.toBe(1);

      // Clear namespace
      const cleared = await db.clearNamespace('ns1');
      expect(cleared).toBe(2);
      await expect(db.count('ns1')).resolves.toBe(0);
      await expect(db.count('ns2')).resolves.toBe(1);

      await db.shutdown();
    });

    it('should handle bulk operations across providers', async () => {
      const db = await createDatabase(':memory:');

      // Bulk insert
      const entries = Array.from({ length: 10 }, (_, i) =>
        createDefaultEntry({
          key: `bulk-${i}`,
          content: `content ${i}`,
          namespace: 'bulk-test',
        })
      );

      await db.bulkInsert(entries);
      await expect(db.count('bulk-test')).resolves.toBe(10);

      // Bulk delete
      const idsToDelete = entries.slice(0, 5).map((e) => e.id);
      const deletedCount = await db.bulkDelete(idsToDelete);
      expect(deletedCount).toBe(5);
      await expect(db.count('bulk-test')).resolves.toBe(5);

      await db.shutdown();
    });
  });

  describe('Health Check', () => {
    it('should perform health check', async () => {
      const db = await createDatabase(':memory:');

      const health = await db.healthCheck();

      expect(health).toHaveProperty('status');
      expect(health).toHaveProperty('components');
      expect(health).toHaveProperty('timestamp');
      expect(health).toHaveProperty('issues');
      expect(health).toHaveProperty('recommendations');

      expect(health.components).toHaveProperty('storage');
      expect(health.components).toHaveProperty('index');
      expect(health.components).toHaveProperty('cache');

      await db.shutdown();
    });
  });

  describe('Statistics', () => {
    it('should provide backend statistics', async () => {
      const db = await createDatabase(':memory:');

      // Add some test data
      const entries = [
        createDefaultEntry({ key: 'stat1', content: 'content1', namespace: 'stats', type: 'semantic' }),
        createDefaultEntry({ key: 'stat2', content: 'content2', namespace: 'stats', type: 'episodic' }),
        createDefaultEntry({ key: 'stat3', content: 'content3', namespace: 'stats', type: 'semantic' }),
      ];

      for (const entry of entries) {
        await db.store(entry);
      }

      const stats = await db.getStats();

      expect(stats).toHaveProperty('totalEntries');
      expect(stats).toHaveProperty('entriesByNamespace');
      expect(stats).toHaveProperty('entriesByType');
      expect(stats).toHaveProperty('memoryUsage');
      expect(stats).toHaveProperty('avgQueryTime');

      expect(stats.totalEntries).toBe(3);

      await db.shutdown();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing entries gracefully', async () => {
      const db = await createDatabase(':memory:');

      const entry = await db.get('non-existent-id');
      expect(entry).toBeNull();

      const byKey = await db.getByKey('non-existent-ns', 'non-existent-key');
      expect(byKey).toBeNull();

      await db.shutdown();
    });

    it('should handle empty queries', async () => {
      const db = await createDatabase(':memory:');

      const results = await db.query({
        type: 'hybrid',
        limit: 10,
      });

      expect(results).toEqual([]);

      await db.shutdown();
    });
  });
});
