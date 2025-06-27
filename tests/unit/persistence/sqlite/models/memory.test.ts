import { MemoryModel } from '@/persistence/sqlite/models/memory';
import { createTestDatabase, dbTestHelpers } from '@test/helpers/database-utils';
import Database from 'better-sqlite3';

describe('MemoryModel', () => {
  let db: Database.Database;
  let memoryModel: MemoryModel;
  
  beforeEach(() => {
    db = createTestDatabase();
    memoryModel = new MemoryModel(db);
    
    // Create memory table for testing
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'general',
        metadata TEXT,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        access_count INTEGER DEFAULT 0,
        UNIQUE(namespace, key)
      )
    `);
    
    // Create index for efficient lookups
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_memory_namespace_key 
      ON memory(namespace, key)
    `);
  });
  
  afterEach(() => {
    db.close();
  });
  
  describe('create', () => {
    it('should create a new memory entry', () => {
      const memory = {
        id: 'mem-1',
        namespace: 'test',
        key: 'config',
        value: { setting: 'value' },
        type: 'config'
      };
      
      const result = memoryModel.create(memory);
      
      expect(result.changes).toBe(1);
      
      const created = db.prepare('SELECT * FROM memory WHERE id = ?').get('mem-1');
      expect(created).toMatchObject({
        id: 'mem-1',
        namespace: 'test',
        key: 'config',
        value: JSON.stringify({ setting: 'value' }),
        type: 'config',
        access_count: 0
      });
    });
    
    it('should handle memory with metadata', () => {
      const memory = {
        id: 'mem-2',
        namespace: 'agent',
        key: 'state',
        value: { status: 'active' },
        type: 'state',
        metadata: {
          source: 'agent-123',
          priority: 'high',
          tags: ['important', 'persistent']
        }
      };
      
      memoryModel.create(memory);
      
      const created = db.prepare('SELECT * FROM memory WHERE id = ?').get('mem-2');
      const metadata = JSON.parse(created.metadata);
      expect(metadata.source).toBe('agent-123');
      expect(metadata.tags).toContain('important');
    });
    
    it('should handle memory with expiration', () => {
      const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
      
      const memory = {
        id: 'mem-3',
        namespace: 'cache',
        key: 'temp-data',
        value: { data: 'temporary' },
        expires_at: expiresAt
      };
      
      memoryModel.create(memory);
      
      const created = db.prepare('SELECT * FROM memory WHERE id = ?').get('mem-3');
      expect(created.expires_at).toBe(expiresAt);
    });
    
    it('should enforce unique namespace-key constraint', () => {
      const memory1 = {
        id: 'mem-4',
        namespace: 'test',
        key: 'unique-key',
        value: { data: 'first' }
      };
      
      const memory2 = {
        id: 'mem-5',
        namespace: 'test',
        key: 'unique-key',
        value: { data: 'second' }
      };
      
      memoryModel.create(memory1);
      
      expect(() => memoryModel.create(memory2)).toThrow();
    });
    
    it('should allow same key in different namespaces', () => {
      const memory1 = {
        id: 'mem-6',
        namespace: 'namespace1',
        key: 'shared-key',
        value: { data: 'ns1' }
      };
      
      const memory2 = {
        id: 'mem-7',
        namespace: 'namespace2',
        key: 'shared-key',
        value: { data: 'ns2' }
      };
      
      memoryModel.create(memory1);
      memoryModel.create(memory2);
      
      expect(memoryModel.get('namespace1').toBe( 'shared-key').value).toEqual({ data: 'ns1' });
      expect(memoryModel.get('namespace2').toBe( 'shared-key').value).toEqual({ data: 'ns2' });
    });
  });
  
  describe('get', () => {
    beforeEach(() => {
      const memories = [
        { id: 'm1', namespace: 'test', key: 'key1', value: { data: 'value1' } },
        { id: 'm2', namespace: 'test', key: 'key2', value: { data: 'value2' } },
        { id: 'm3', namespace: 'other', key: 'key1', value: { data: 'value3' } }
      ];
      
      memories.forEach(memory => memoryModel.create(memory));
    });
    
    it('should get memory by namespace and key', () => {
      const memory = memoryModel.get('test', 'key1');
      
      expect(memory).toBeDefined();
      expect(memory.namespace).toBe('test');
      expect(memory.key).toBe('key1');
      expect(memory.value).toEqual({ data: 'value1' });
    });
    
    it('should return null for non-existent memory', () => {
      const memory = memoryModel.get('test', 'non-existent');
      
      expect(memory).toBeNull();
    });
    
    it('should increment access count on get', () => {
      const before = memoryModel.get('test', 'key1');
      expect(before.access_count).toBe(1);
      
      const after = memoryModel.get('test', 'key1');
      expect(after.access_count).toBe(2);
    });
    
    it('should update accessed_at timestamp', async () => {
      const first = memoryModel.get('test', 'key1');
      const firstAccessTime = new Date(first.accessed_at).getTime();
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const second = memoryModel.get('test', 'key1');
      const secondAccessTime = new Date(second.accessed_at).getTime();
      
      expect(secondAccessTime).toBeGreaterThan(firstAccessTime);
    });
    
    it('should not return expired memory', () => {
      const expiredMemory = {
        id: 'm-expired',
        namespace: 'cache',
        key: 'expired',
        value: { data: 'old' },
        expires_at: new Date(Date.now() - 3600000).toISOString() // 1 hour ago
      };
      
      memoryModel.create(expiredMemory);
      
      const result = memoryModel.get('cache', 'expired');
      expect(result).toBeNull();
    });
  });
  
  describe('getById', () => {
    beforeEach(() => {
      memoryModel.create({
        id: 'mem-by-id',
        namespace: 'test',
        key: 'test-key',
        value: { data: 'test' }
      });
    });
    
    it('should get memory by ID', () => {
      const memory = memoryModel.getById('mem-by-id');
      
      expect(memory).toBeDefined();
      expect(memory.id).toBe('mem-by-id');
      expect(memory.namespace).toBe('test');
    });
    
    it('should return null for non-existent ID', () => {
      const memory = memoryModel.getById('non-existent');
      
      expect(memory).toBeNull();
    });
  });
  
  describe('getAll', () => {
    beforeEach(() => {
      const memories = [
        { id: 'm1', namespace: 'ns1', key: 'k1', value: { v: 1 }, type: 'config' },
        { id: 'm2', namespace: 'ns1', key: 'k2', value: { v: 2 }, type: 'state' },
        { id: 'm3', namespace: 'ns2', key: 'k1', value: { v: 3 }, type: 'config' },
        { id: 'm4', namespace: 'ns2', key: 'k2', value: { v: 4 }, type: 'cache' },
        {
          id: 'm5',
          namespace: 'ns1',
          key: 'expired',
          value: { v: 5 },
          expires_at: new Date(Date.now() - 3600000).toISOString()
        }
      ];
      
      memories.forEach(memory => memoryModel.create(memory));
    });
    
    it('should get all non-expired memories', () => {
      const all = memoryModel.getAll();
      
      expect(all).toHaveLength(4); // Excludes expired memory
      expect(all.every(m => m.id !== 'm5')).toBe(true);
    });
    
    it('should filter by namespace', () => {
      const ns1Memories = memoryModel.getAll({ namespace: 'ns1' });
      
      expect(ns1Memories).toHaveLength(2);
      expect(ns1Memories.every(m => m.namespace === 'ns1')).toBe(true);
    });
    
    it('should filter by type', () => {
      const configMemories = memoryModel.getAll({ type: 'config' });
      
      expect(configMemories).toHaveLength(2);
      expect(configMemories.every(m => m.type === 'config')).toBe(true);
    });
    
    it('should filter by multiple criteria', () => {
      const filtered = memoryModel.getAll({
        namespace: 'ns1',
        type: 'state'
      });
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('m2');
    });
  });
  
  describe('update', () => {
    beforeEach(() => {
      memoryModel.create({
        id: 'mem-update',
        namespace: 'test',
        key: 'update-key',
        value: { original: true },
        type: 'state'
      });
    });
    
    it('should update memory value', () => {
      const newValue = { updated: true, count: 42 };
      
      const result = memoryModel.update('test', 'update-key', {
        value: newValue
      });
      
      expect(result.changes).toBe(1);
      
      const updated = memoryModel.get('test', 'update-key');
      expect(updated.value).toEqual(newValue);
    });
    
    it('should update metadata', () => {
      const metadata = {
        lastModifiedBy: 'agent-123',
        version: 2
      };
      
      memoryModel.update('test', 'update-key', { metadata });
      
      const updated = memoryModel.get('test', 'update-key');
      expect(updated.metadata).toEqual(metadata);
    });
    
    it('should update expiration', () => {
      const newExpiry = new Date(Date.now() + 7200000).toISOString();
      
      memoryModel.update('test', 'update-key', {
        expires_at: newExpiry
      });
      
      const updated = memoryModel.get('test', 'update-key');
      expect(updated.expires_at).toBe(newExpiry);
    });
    
    it('should update updated_at timestamp', async () => {
      const before = memoryModel.get('test', 'update-key');
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      memoryModel.update('test', 'update-key', {
        type: 'updated-state'
      });
      
      const after = memoryModel.get('test', 'update-key');
      expect(new Date(after.updated_at).getTime()).toBeGreaterThan(
        new Date(before.updated_at).getTime()
      );
    });
    
    it('should return no changes for non-existent memory', () => {
      const result = memoryModel.update('test', 'non-existent', {
        value: { new: 'value' }
      });
      
      expect(result.changes).toBe(0);
    });
  });
  
  describe('delete', () => {
    beforeEach(() => {
      memoryModel.create({
        id: 'mem-delete',
        namespace: 'test',
        key: 'delete-key',
        value: { data: 'to-delete' }
      });
    });
    
    it('should delete memory by namespace and key', () => {
      const result = memoryModel.delete('test', 'delete-key');
      
      expect(result.changes).toBe(1);
      
      const deleted = memoryModel.get('test', 'delete-key');
      expect(deleted).toBeNull();
    });
    
    it('should return no changes for non-existent memory', () => {
      const result = memoryModel.delete('test', 'non-existent');
      
      expect(result.changes).toBe(0);
    });
  });
  
  describe('deleteById', () => {
    beforeEach(() => {
      memoryModel.create({
        id: 'mem-delete-id',
        namespace: 'test',
        key: 'delete-id-key',
        value: { data: 'to-delete' }
      });
    });
    
    it('should delete memory by ID', () => {
      const result = memoryModel.deleteById('mem-delete-id');
      
      expect(result.changes).toBe(1);
      
      const deleted = memoryModel.getById('mem-delete-id');
      expect(deleted).toBeNull();
    });
  });
  
  describe('deleteExpired', () => {
    beforeEach(() => {
      const now = Date.now();
      const memories = [
        {
          id: 'expired-1',
          namespace: 'cache',
          key: 'old-1',
          value: { data: 'expired' },
          expires_at: new Date(now - 3600000).toISOString() // 1 hour ago
        },
        {
          id: 'expired-2',
          namespace: 'cache',
          key: 'old-2',
          value: { data: 'expired' },
          expires_at: new Date(now - 7200000).toISOString() // 2 hours ago
        },
        {
          id: 'valid-1',
          namespace: 'cache',
          key: 'new-1',
          value: { data: 'valid' },
          expires_at: new Date(now + 3600000).toISOString() // 1 hour from now
        },
        {
          id: 'valid-2',
          namespace: 'cache',
          key: 'permanent',
          value: { data: 'no-expiry' }
          // No expiration
        }
      ];
      
      memories.forEach(memory => memoryModel.create(memory));
    });
    
    it('should delete all expired memories', () => {
      const result = memoryModel.deleteExpired();
      
      expect(result.changes).toBe(2);
      
      const remaining = memoryModel.getAll();
      expect(remaining).toHaveLength(2);
      expect(remaining.map(m => m.id)).toContain('valid-1');
      expect(remaining.map(m => m.id)).toContain('valid-2');
    });
  });
  
  describe('getByNamespace', () => {
    beforeEach(() => {
      const memories = [
        { id: 'm1', namespace: 'agents', key: 'agent-1', value: { state: 'active' } },
        { id: 'm2', namespace: 'agents', key: 'agent-2', value: { state: 'idle' } },
        { id: 'm3', namespace: 'tasks', key: 'task-1', value: { status: 'pending' } },
        { id: 'm4', namespace: 'agents', key: 'agent-3', value: { state: 'busy' } }
      ];
      
      memories.forEach(memory => memoryModel.create(memory));
    });
    
    it('should get all memories in namespace', () => {
      const agentMemories = memoryModel.getByNamespace('agents');
      
      expect(agentMemories).toHaveLength(3);
      expect(agentMemories.every(m => m.namespace === 'agents')).toBe(true);
    });
    
    it('should return empty array for empty namespace', () => {
      const memories = memoryModel.getByNamespace('non-existent');
      
      expect(memories).toEqual([]);
    });
  });
  
  describe('search', () => {
    beforeEach(() => {
      const memories = [
        {
          id: 'm1',
          namespace: 'config',
          key: 'api-settings',
          value: { endpoint: 'https://api.example.com', apiKey: 'secret123' }
        },
        {
          id: 'm2',
          namespace: 'state',
          key: 'user-preferences',
          value: { theme: 'dark', language: 'en' }
        },
        {
          id: 'm3',
          namespace: 'cache',
          key: 'api-response',
          value: { data: 'cached response from api call' }
        }
      ];
      
      memories.forEach(memory => memoryModel.create(memory));
    });
    
    it('should search memories by value content', () => {
      const results = memoryModel.search('api');
      
      expect(results).toHaveLength(2);
      expect(results.map(m => m.id)).toContain('m1');
      expect(results.map(m => m.id)).toContain('m3');
    });
    
    it('should search case-insensitive', () => {
      const results = memoryModel.search('API');
      
      expect(results).toHaveLength(2);
    });
    
    it('should return empty array for no matches', () => {
      const results = memoryModel.search('nonexistent');
      
      expect(results).toEqual([]);
    });
  });
  
  describe('getMetrics', () => {
    beforeEach(() => {
      const memories = [
        {
          id: 'm1',
          namespace: 'ns1',
          key: 'k1',
          value: { size: 'small' },
          access_count: 10
        },
        {
          id: 'm2',
          namespace: 'ns1',
          key: 'k2',
          value: { size: 'medium' },
          access_count: 5
        },
        {
          id: 'm3',
          namespace: 'ns2',
          key: 'k1',
          value: { size: 'large' },
          access_count: 15
        },
        {
          id: 'm4',
          namespace: 'ns2',
          key: 'k2',
          value: { data: 'expired' },
          expires_at: new Date(Date.now() - 3600000).toISOString()
        }
      ];
      
      memories.forEach(memory => memoryModel.create(memory));
    });
    
    it('should calculate memory metrics', () => {
      const metrics = memoryModel.getMetrics();
      
      expect(metrics).toEqual({
        totalEntries: 3, // Excludes expired
        totalSize: expect.any(Number),
        namespaceCount: 2,
        averageAccessCount: 10, // (10 + 5 + 15) / 3
        expiredCount: 1,
        byNamespace: {
          ns1: 2,
          ns2: 1 // Excludes expired
        }
      });
      
      expect(metrics.totalSize).toBeGreaterThan(0);
    });
  });
  
  describe('transaction methods', () => {
    it('should perform bulk operations in transaction', () => {
      const memories = [
        { id: 'bulk-1', namespace: 'bulk', key: 'k1', value: { n: 1 } },
        { id: 'bulk-2', namespace: 'bulk', key: 'k2', value: { n: 2 } },
        { id: 'bulk-3', namespace: 'bulk', key: 'k3', value: { n: 3 } }
      ];
      
      const transaction = db.transaction(() => {
        memories.forEach(memory => memoryModel.create(memory));
        memoryModel.update('bulk', 'k1', { value: { n: 10 } });
        memoryModel.delete('bulk', 'k3');
      });
      
      transaction();
      
      const remaining = memoryModel.getByNamespace('bulk');
      expect(remaining).toHaveLength(2);
      expect(memoryModel.get('bulk').toBe( 'k1').value).toEqual({ n: 10 });
      expect(memoryModel.get('bulk').toBe( 'k3')).toBeNull();
    });
  });
});
