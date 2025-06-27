import { SQLiteMemoryBackend } from '@/memory/backends/sqlite';
import { createTestDatabase, dbTestHelpers } from '@test/helpers/database-utils';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('SQLiteMemoryBackend', () => {
  let backend: SQLiteMemoryBackend;
  let db: Database.Database;
  const testDir = join(process.cwd(), 'test-memory');
  const testDbPath = join(testDir, 'test-memory.db');
  
  beforeEach(() => {
    // Ensure test directory exists
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    
    backend = new SQLiteMemoryBackend(testDbPath);
    backend.initialize();
    
    // Get database instance for verification
    db = (backend as any).db;
  });
  
  afterEach(async () => {
    await backend.close();
    
    // Clean up test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  describe('initialization', () => {
    it('should create database file', () => {
      expect(existsSync(testDbPath)).toBe(true);
    });
    
    it('should create memory table', () => {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='memory'"
      ).all();
      
      expect(tables).toHaveLength(1);
    });
    
    it('should create indexes', () => {
      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_memory%'"
      ).all();
      
      expect(indexes.length).toBeGreaterThanOrEqual(2);
    });
    
    it('should handle re-initialization gracefully', () => {
      expect(() => backend.initialize()).not.toThrow();
    });
  });
  
  describe('set', () => {
    it('should store simple value', async () => {
      await backend.set('test-key', 'test-value');
      
      const stored = db.prepare('SELECT * FROM memory WHERE key = ?').get('test-key');
      expect(stored).toBeDefined();
      expect(JSON.parse(stored.value)).toBe('test-value');
    });
    
    it('should store complex objects', async () => {
      const complexValue = {
        name: 'Test Object',
        nested: {
          array: [1, 2, 3],
          boolean: true,
          null: null
        },
        date: new Date().toISOString()
      };
      
      await backend.set('complex-key', complexValue);
      
      const retrieved = await backend.get('complex-key');
      expect(retrieved).toEqual(complexValue);
    });
    
    it('should store with TTL', async () => {
      const ttl = 3600; // 1 hour
      await backend.set('ttl-key', 'ttl-value', { ttl });
      
      const stored = db.prepare('SELECT * FROM memory WHERE key = ?').get('ttl-key');
      expect(stored.expires_at).toBeDefined();
      
      const expiryTime = new Date(stored.expires_at).getTime();
      const expectedExpiry = Date.now() + (ttl * 1000);
      expect(expiryTime).toBeCloseTo(expectedExpiry, -3); // Within 1 second
    });
    
    it('should update existing key', async () => {
      await backend.set('update-key', 'original');
      await backend.set('update-key', 'updated');
      
      const value = await backend.get('update-key');
      expect(value).toBe('updated');
      
      // Should not create duplicate entries
      const count = db.prepare('SELECT COUNT(*) as count FROM memory WHERE key = ?')
        .get('update-key').count;
      expect(count).toBe(1);
    });
    
    it('should store with metadata', async () => {
      const metadata = {
        source: 'test-suite',
        version: 1,
        tags: ['test', 'metadata']
      };
      
      await backend.set('meta-key', 'meta-value', { metadata });
      
      const stored = db.prepare('SELECT * FROM memory WHERE key = ?').get('meta-key');
      expect(JSON.parse(stored.metadata)).toEqual(metadata);
    });
    
    it('should handle concurrent sets', async () => {
      const promises = Array(10).fill(null).map((_, i) => 
        backend.set(`concurrent-${i}`, `value-${i}`)
      );
      
      await Promise.all(promises);
      
      const count = db.prepare('SELECT COUNT(*) as count FROM memory WHERE key LIKE ?')
        .get('concurrent-%').count;
      expect(count).toBe(10);
    });
  });
  
  describe('get', () => {
    beforeEach(async () => {
      // Seed test data
      await backend.set('existing-key', 'existing-value');
      await backend.set('object-key', { data: 'object-value' });
    });
    
    it('should retrieve existing key', async () => {
      const value = await backend.get('existing-key');
      expect(value).toBe('existing-value');
    });
    
    it('should return null for non-existent key', async () => {
      const value = await backend.get('non-existent');
      expect(value).toBeNull();
    });
    
    it('should deserialize objects', async () => {
      const value = await backend.get('object-key');
      expect(value).toEqual({ data: 'object-value' });
    });
    
    it('should not return expired values', async () => {
      // Set with 1 second TTL
      await backend.set('expire-test', 'should-expire', { ttl: 1 });
      
      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const value = await backend.get('expire-test');
      expect(value).toBeNull();
    });
    
    it('should update access count', async () => {
      await backend.get('existing-key');
      await backend.get('existing-key');
      
      const stored = db.prepare('SELECT access_count FROM memory WHERE key = ?')
        .get('existing-key');
      expect(stored.access_count).toBe(2);
    });
    
    it('should update last accessed time', async () => {
      const firstAccess = db.prepare('SELECT last_accessed FROM memory WHERE key = ?')
        .get('existing-key').last_accessed;
      
      await new Promise(resolve => setTimeout(resolve, 10));
      await backend.get('existing-key');
      
      const secondAccess = db.prepare('SELECT last_accessed FROM memory WHERE key = ?')
        .get('existing-key').last_accessed;
      
      expect(new Date(secondAccess).getTime()).toBeGreaterThan(new Date(firstAccess).getTime());
    });
  });
  
  describe('delete', () => {
    beforeEach(async () => {
      await backend.set('delete-key', 'delete-value');
    });
    
    it('should delete existing key', async () => {
      const result = await backend.delete('delete-key');
      expect(result).toBe(true);
      
      const value = await backend.get('delete-key');
      expect(value).toBeNull();
    });
    
    it('should return false for non-existent key', async () => {
      const result = await backend.delete('non-existent');
      expect(result).toBe(false);
    });
    
    it('should handle concurrent deletes', async () => {
      // Create multiple keys
      const keys = Array(5).fill(null).map((_, i) => `del-${i}`);
      await Promise.all(keys.map(key => backend.set(key, 'value')));
      
      // Delete concurrently
      const results = await Promise.all(keys.map(key => backend.delete(key)));
      
      expect(results.every(r => r === true)).toBe(true);
      
      // Verify all deleted
      const remaining = await Promise.all(keys.map(key => backend.get(key)));
      expect(remaining.every(v => v === null)).toBe(true);
    });
  });
  
  describe('has', () => {
    beforeEach(async () => {
      await backend.set('check-key', 'check-value');
    });
    
    it('should return true for existing key', async () => {
      const exists = await backend.has('check-key');
      expect(exists).toBe(true);
    });
    
    it('should return false for non-existent key', async () => {
      const exists = await backend.has('non-existent');
      expect(exists).toBe(false);
    });
    
    it('should return false for expired key', async () => {
      await backend.set('expire-check', 'value', { ttl: 1 });
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const exists = await backend.has('expire-check');
      expect(exists).toBe(false);
    });
  });
  
  describe('clear', () => {
    beforeEach(async () => {
      // Add multiple entries
      await Promise.all([
        backend.set('clear-1', 'value-1'),
        backend.set('clear-2', 'value-2'),
        backend.set('clear-3', 'value-3')
      ]);
    });
    
    it('should remove all entries', async () => {
      await backend.clear();
      
      const count = db.prepare('SELECT COUNT(*) as count FROM memory').get().count;
      expect(count).toBe(0);
    });
    
    it('should return cleared count', async () => {
      const cleared = await backend.clear();
      expect(cleared).toBe(3);
    });
  });
  
  describe('keys', () => {
    beforeEach(async () => {
      await Promise.all([
        backend.set('prefix:key1', 'value1'),
        backend.set('prefix:key2', 'value2'),
        backend.set('other:key3', 'value3'),
        backend.set('prefix:key4', 'value4', { ttl: 1 })
      ]);
    });
    
    it('should return all keys', async () => {
      const keys = await backend.keys();
      expect(keys).toHaveLength(4);
      expect(keys).toContain('prefix:key1');
      expect(keys).toContain('other:key3');
    });
    
    it('should filter keys by pattern', async () => {
      const keys = await backend.keys('prefix:*');
      expect(keys).toHaveLength(3);
      expect(keys.every(k => k.startsWith('prefix:'))).toBe(true);
    });
    
    it('should not include expired keys', async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const keys = await backend.keys('prefix:*');
      expect(keys).toHaveLength(2);
      expect(keys).not.toContain('prefix:key4');
    });
  });
  
  describe('values', () => {
    beforeEach(async () => {
      await Promise.all([
        backend.set('val1', 'string-value'),
        backend.set('val2', { type: 'object' }),
        backend.set('val3', [1, 2, 3])
      ]);
    });
    
    it('should return all values', async () => {
      const values = await backend.values();
      expect(values).toHaveLength(3);
      expect(values).toContainEqual('string-value');
      expect(values).toContainEqual({ type: 'object' });
      expect(values).toContainEqual([1, 2, 3]);
    });
  });
  
  describe('entries', () => {
    beforeEach(async () => {
      await Promise.all([
        backend.set('entry1', 'value1'),
        backend.set('entry2', 'value2')
      ]);
    });
    
    it('should return key-value pairs', async () => {
      const entries = await backend.entries();
      expect(entries).toHaveLength(2);
      expect(entries).toContainEqual(['entry1').toBe( 'value1']);
      expect(entries).toContainEqual(['entry2').toBe( 'value2']);
    });
  });
  
  describe('size', () => {
    it('should return correct size', async () => {
      expect(await backend.size()).toBe(0);
      
      await backend.set('size1', 'value1');
      expect(await backend.size()).toBe(1);
      
      await backend.set('size2', 'value2');
      expect(await backend.size()).toBe(2);
      
      await backend.delete('size1');
      expect(await backend.size()).toBe(1);
    });
    
    it('should not count expired entries', async () => {
      await backend.set('perm', 'permanent');
      await backend.set('temp', 'temporary', { ttl: 1 });
      
      expect(await backend.size()).toBe(2);
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      expect(await backend.size()).toBe(1);
    });
  });
  
  describe('cleanup', () => {
    beforeEach(async () => {
      const now = Date.now();
      
      // Add mix of expired and valid entries
      await Promise.all([
        backend.set('valid1', 'value'),
        backend.set('valid2', 'value'),
        backend.set('expired1', 'value', { ttl: -1 }), // Already expired
        backend.set('expired2', 'value', { ttl: -1 })  // Already expired
      ]);
      
      // Manually set expiration times in the past
      db.prepare('UPDATE memory SET expires_at = ? WHERE key LIKE ?')
        .run(new Date(now - 3600000).toISOString(), 'expired%');
    });
    
    it('should remove expired entries', async () => {
      const removed = await backend.cleanup();
      expect(removed).toBe(2);
      
      const remaining = await backend.keys();
      expect(remaining).toHaveLength(2);
      expect(remaining).toContain('valid1');
      expect(remaining).toContain('valid2');
    });
  });
  
  describe('transaction support', () => {
    it('should handle transactions', async () => {
      const keys = Array(5).fill(null).map((_, i) => `tx-${i}`);
      
      try {
        await backend.transaction(async () => {
          for (const key of keys) {
            await backend.set(key, `value-${key}`);
          }
          
          // Simulate error in transaction
          throw new Error('Transaction error');
        });
      } catch (error) {
        // Expected error
      }
      
      // No keys should exist due to rollback
      const existing = await Promise.all(keys.map(key => backend.has(key)));
      expect(existing.every(exists => exists === false)).toBe(true);
    });
    
    it('should commit successful transactions', async () => {
      const result = await backend.transaction(async () => {
        await backend.set('tx-success-1', 'value1');
        await backend.set('tx-success-2', 'value2');
        return 'success';
      });
      
      expect(result).toBe('success');
      expect(await backend.get('tx-success-1')).toBe('value1');
      expect(await backend.get('tx-success-2')).toBe('value2');
    });
  });
  
  describe('search functionality', () => {
    beforeEach(async () => {
      await Promise.all([
        backend.set('user:1', { name: 'John Doe', email: 'john@example.com' }),
        backend.set('user:2', { name: 'Jane Smith', email: 'jane@example.com' }),
        backend.set('config:api', { endpoint: 'https://api.example.com' }),
        backend.set('cache:result', { data: 'cached search results' })
      ]);
    });
    
    it('should search by value content', async () => {
      const results = await backend.search('example.com');
      expect(results).toHaveLength(3); // Both users and config
    });
    
    it('should search case-insensitive', async () => {
      const results = await backend.search('JOHN');
      expect(results).toHaveLength(1);
      expect(results[0].key).toBe('user:1');
    });
  });
  
  describe('performance', () => {
    it('should handle large values efficiently', async () => {
      const largeObject = {
        data: Array(1000).fill(null).map((_, i) => ({
          id: i,
          value: `value-${i}`,
          nested: { deep: { data: 'x'.repeat(100) } }
        }))
      };
      
      const start = Date.now();
      await backend.set('large-object', largeObject);
      const setTime = Date.now() - start;
      
      const getStart = Date.now();
      const retrieved = await backend.get('large-object');
      const getTime = Date.now() - getStart;
      
      expect(retrieved).toEqual(largeObject);
      expect(setTime).toBeLessThan(100); // Should be fast
      expect(getTime).toBeLessThan(50);  // Retrieval should be faster
    });
    
    it('should handle many keys efficiently', async () => {
      const start = Date.now();
      
      // Insert 1000 keys
      const promises = Array(1000).fill(null).map((_, i) => 
        backend.set(`perf-${i}`, { index: i, data: 'x'.repeat(100) })
      );
      
      await Promise.all(promises);
      const insertTime = Date.now() - start;
      
      // Query performance
      const queryStart = Date.now();
      const keys = await backend.keys('perf-*');
      const queryTime = Date.now() - queryStart;
      
      expect(keys).toHaveLength(1000);
      expect(insertTime).toBeLessThan(5000); // 5 seconds for 1000 inserts
      expect(queryTime).toBeLessThan(100);   // Query should be fast
    });
  });
  
  describe('error handling', () => {
    it('should handle database errors gracefully', async () => {
      // Close database to simulate error
      await backend.close();
      
      await expect(backend.get('any-key')).rejects.toThrow();
      await expect(backend.set('any-key').toBe( 'value')).rejects.toThrow();
    });
    
    it('should handle invalid JSON gracefully', async () => {
      // Manually insert invalid JSON
      db.prepare('INSERT INTO memory (key, value, type) VALUES (?, ?, ?)')
        .run('invalid-json', '{invalid json', 'string');
      
      await expect(backend.get('invalid-json')).rejects.toThrow(/JSON/);
    });
  });
});
