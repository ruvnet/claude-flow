/**
 * Tests for Swarm Optimizations
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { CircularBuffer } from '../circular-buffer.js';
import { TTLMap } from '../ttl-map.js';
import { ClaudeConnectionPool } from '../connection-pool.js';
import { AsyncFileManager } from '../async-file-manager.js';
import { OptimizedExecutor } from '../optimized-executor.js';
import { generateId } from '../../../utils/helpers.js';
import type { TaskDefinition, AgentId } from '../../types.js';

describe('Swarm Optimizations', () => {
  describe('CircularBuffer', () => {
    it('should maintain fixed size', () => {
      const buffer = new CircularBuffer<number>(5);
      
      // Add more items than capacity
      for (let i = 0; i < 10; i++) {
        buffer.push(i);
      }
      
      expect(buffer.getSize()).toBe(5);
      expect(buffer.getAll()).toEqual([5, 6, 7, 8, 9]);
    });
    
    it('should return recent items correctly', () => {
      const buffer = new CircularBuffer<string>(3);
      buffer.push('a');
      buffer.push('b');
      buffer.push('c');
      buffer.push('d');
      
      expect(buffer.getRecent(2)).toEqual(['c', 'd']);
      expect(buffer.getRecent(5)).toEqual(['b', 'c', 'd']); // Only 3 items available
    });
    
    it('should track overwritten count', () => {
      const buffer = new CircularBuffer<number>(3);
      for (let i = 0; i < 5; i++) {
        buffer.push(i);
      }
      
      expect(buffer.getTotalItemsWritten()).toBe(5);
      expect(buffer.getOverwrittenCount()).toBe(2);
    });
  });
  
  describe('TTLMap', () => {
    jest.useFakeTimers();
    
    afterEach(() => {
      jest.useRealTimers();
    });
    
    it('should expire items after TTL', () => {
      const map = new TTLMap<string, string>({ defaultTTL: 1000 });
      
      map.set('key1', 'value1');
      expect(map.get('key1')).toBe('value1');
      
      // Advance time past TTL
      jest.advanceTimersByTime(1100);
      
      expect(map.get('key1')).toBeUndefined();
      expect(map.size).toBe(0);
    });
    
    it('should respect max size with LRU eviction', () => {
      const map = new TTLMap<string, number>({ maxSize: 3 });
      
      map.set('a', 1);
      map.set('b', 2);
      map.set('c', 3);
      
      // Access 'a' to make it recently used
      map.get('a');
      
      // Add new item, should evict 'b' (least recently used)
      map.set('d', 4);
      
      expect(map.has('a')).toBe(true);
      expect(map.has('b')).toBe(false);
      expect(map.has('c')).toBe(true);
      expect(map.has('d')).toBe(true);
    });
    
    it('should update TTL on touch', () => {
      const map = new TTLMap<string, string>({ defaultTTL: 1000 });
      
      map.set('key1', 'value1');
      
      // Advance time but not past TTL
      jest.advanceTimersByTime(800);
      
      // Touch to reset TTL
      map.touch('key1', 2000);
      
      // Advance past original TTL
      jest.advanceTimersByTime(300);
      
      // Should still exist due to touch
      expect(map.get('key1')).toBe('value1');
      
      // Advance past new TTL
      jest.advanceTimersByTime(1800);
      expect(map.get('key1')).toBeUndefined();
    });
  });
  
  describe('AsyncFileManager', () => {
    const testDir = '/tmp/swarm-test';
    let fileManager: AsyncFileManager;
    
    beforeEach(() => {
      fileManager = new AsyncFileManager();
    });
    
    it('should handle concurrent write operations', async () => {
      const writes = [];
      
      // Queue multiple writes
      for (let i = 0; i < 5; i++) {
        writes.push(
          fileManager.writeFile(
            `${testDir}/test-${i}.txt`,
            `Content ${i}`
          )
        );
      }
      
      const results = await Promise.all(writes);
      
      expect(results).toHaveLength(5);
      expect(results.every(r => r.success)).toBe(true);
    });
    
    it('should write and read JSON files', async () => {
      const testData = { id: 1, name: 'test', values: [1, 2, 3] };
      const path = `${testDir}/test.json`;
      
      const writeResult = await fileManager.writeJSON(path, testData);
      expect(writeResult.success).toBe(true);
      
      const readResult = await fileManager.readJSON(path);
      expect(readResult.success).toBe(true);
      expect(readResult.data).toEqual(testData);
    });
  });
  
  describe('ClaudeConnectionPool', () => {
    let pool: ClaudeConnectionPool;
    
    beforeEach(() => {
      pool = new ClaudeConnectionPool({ min: 2, max: 5 });
    });
    
    afterEach(async () => {
      await pool.drain();
    });
    
    it('should reuse connections', async () => {
      const conn1 = await pool.acquire();
      const id1 = conn1.id;
      await pool.release(conn1);
      
      const conn2 = await pool.acquire();
      const id2 = conn2.id;
      
      expect(id2).toBe(id1); // Same connection reused
      await pool.release(conn2);
    });
    
    it('should create new connections up to max', async () => {
      const connections = [];
      
      // Acquire max connections
      for (let i = 0; i < 5; i++) {
        connections.push(await pool.acquire());
      }
      
      const stats = pool.getStats();
      expect(stats.total).toBe(5);
      expect(stats.inUse).toBe(5);
      
      // Release all
      for (const conn of connections) {
        await pool.release(conn);
      }
    });
    
    it('should execute with automatic acquire/release', async () => {
      let executionCount = 0;
      
      const result = await pool.execute(async (api) => {
        executionCount++;
        return 'test-result';
      });
      
      expect(result).toBe('test-result');
      expect(executionCount).toBe(1);
      
      const stats = pool.getStats();
      expect(stats.inUse).toBe(0); // Connection released
    });
  });
  
  describe('OptimizedExecutor', () => {
    let executor: OptimizedExecutor;
    
    beforeEach(() => {
      executor = new OptimizedExecutor({
        connectionPool: { min: 1, max: 2 },
        concurrency: 2,
        caching: { enabled: true, ttl: 60000 }
      });
    });
    
    afterEach(async () => {
      await executor.shutdown();
    });
    
    it('should execute tasks successfully', async () => {
      const task: TaskDefinition = {
        id: generateId('task'),
        parentId: generateId('swarm'),
        type: 'analysis',
        objective: 'Test task',
        status: 'pending',
        priority: 'normal',
        assignedTo: undefined,
        dependencies: [],
        result: undefined,
        error: undefined,
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: undefined,
        completedAt: undefined,
        constraints: {
          timeout: 30000,
          maxRetries: 3,
          requiresApproval: false
        },
        metadata: {},
        context: undefined,
        statusHistory: [],
        attempts: []
      };
      
      const agentId: AgentId = {
        id: generateId('agent'),
        type: 'executor'
      };
      
      // Mock the API call
      const mockResult = await executor.executeTask(task, agentId);
      
      // In real tests, this would check actual results
      expect(mockResult).toBeDefined();
      expect(mockResult.taskId).toBe(task.id);
      expect(mockResult.agentId).toBe(agentId);
    });
    
    it('should cache results when enabled', async () => {
      const task: TaskDefinition = {
        id: generateId('task'),
        parentId: generateId('swarm'),
        type: 'query',
        objective: 'Cached task',
        status: 'pending',
        priority: 'normal',
        // ... other required fields
      } as TaskDefinition;
      
      const agentId: AgentId = {
        id: generateId('agent'),
        type: 'analyzer'
      };
      
      // First execution
      const result1 = await executor.executeTask(task, agentId);
      
      // Second execution should hit cache
      const result2 = await executor.executeTask(task, agentId);
      
      const metrics = executor.getMetrics();
      expect(metrics.cacheHitRate).toBeGreaterThan(0);
    });
    
    it('should track metrics correctly', async () => {
      const initialMetrics = executor.getMetrics();
      expect(initialMetrics.totalExecuted).toBe(0);
      
      // Execute some tasks
      // ... task execution ...
      
      const updatedMetrics = executor.getMetrics();
      expect(updatedMetrics.totalExecuted).toBeGreaterThan(0);
    });
  });
});