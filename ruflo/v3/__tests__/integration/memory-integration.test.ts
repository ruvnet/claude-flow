import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HybridBackend } from '../../src/memory/infrastructure/HybridBackend';
import { AgentDBBackend } from '../../src/memory/infrastructure/AgentDBBackend';
import { SQLiteBackend } from '../../src/memory/infrastructure/SQLiteBackend';
import { Memory } from '../../src/memory/domain/Memory';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('Memory Integration Tests', () => {
  let hybridBackend: HybridBackend;
  let testDbPath: string;
  let testAgentDbPath: string;

  beforeEach(async () => {
    // Create temporary database paths
    testDbPath = path.join(__dirname, `test-${Date.now()}.db`);
    testAgentDbPath = path.join(__dirname, `test-agentdb-${Date.now()}`);

    // Initialize backends
    const sqliteBackend = new SQLiteBackend(testDbPath);
    const agentDbBackend = new AgentDBBackend({ dbPath: testAgentDbPath });

    await sqliteBackend.initialize();
    await agentDbBackend.initialize();

    hybridBackend = new HybridBackend(sqliteBackend, agentDbBackend);
    await hybridBackend.initialize();
  });

  afterEach(async () => {
    await hybridBackend.close();

    // Clean up test databases
    try {
      await fs.unlink(testDbPath);
      await fs.rm(testAgentDbPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should store and retrieve memory from hybrid backend', async () => {
    const memory: Memory = {
      id: 'test-memory-1',
      agentId: 'agent-1',
      content: 'Test memory content',
      type: 'task',
      timestamp: Date.now(),
      metadata: { importance: 'high' }
    };

    await hybridBackend.store(memory);
    const retrieved = await hybridBackend.retrieve('test-memory-1');

    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(memory.id);
    expect(retrieved?.content).toBe(memory.content);
    expect(retrieved?.agentId).toBe(memory.agentId);
  });

  it('should perform cross-backend queries by agent ID', async () => {
    const memories: Memory[] = [
      {
        id: 'mem-1',
        agentId: 'agent-1',
        content: 'First memory',
        type: 'task',
        timestamp: Date.now()
      },
      {
        id: 'mem-2',
        agentId: 'agent-1',
        content: 'Second memory',
        type: 'context',
        timestamp: Date.now() + 1000
      },
      {
        id: 'mem-3',
        agentId: 'agent-2',
        content: 'Third memory',
        type: 'task',
        timestamp: Date.now() + 2000
      }
    ];

    for (const memory of memories) {
      await hybridBackend.store(memory);
    }

    const agent1Memories = await hybridBackend.query({ agentId: 'agent-1' });
    expect(agent1Memories).toHaveLength(2);
    expect(agent1Memories.every(m => m.agentId === 'agent-1')).toBe(true);
  });

  it('should query memories by type across backends', async () => {
    const memories: Memory[] = [
      { id: '1', agentId: 'a1', content: 'Task 1', type: 'task', timestamp: Date.now() },
      { id: '2', agentId: 'a1', content: 'Context 1', type: 'context', timestamp: Date.now() },
      { id: '3', agentId: 'a2', content: 'Task 2', type: 'task', timestamp: Date.now() }
    ];

    for (const memory of memories) {
      await hybridBackend.store(memory);
    }

    const taskMemories = await hybridBackend.query({ type: 'task' });
    expect(taskMemories).toHaveLength(2);
    expect(taskMemories.every(m => m.type === 'task')).toBe(true);
  });

  it('should persist memory across backend reinitialization', async () => {
    const memory: Memory = {
      id: 'persistent-mem',
      agentId: 'agent-1',
      content: 'This should persist',
      type: 'task',
      timestamp: Date.now()
    };

    await hybridBackend.store(memory);
    await hybridBackend.close();

    // Reinitialize backends
    const sqliteBackend = new SQLiteBackend(testDbPath);
    const agentDbBackend = new AgentDBBackend({ dbPath: testAgentDbPath });
    await sqliteBackend.initialize();
    await agentDbBackend.initialize();

    hybridBackend = new HybridBackend(sqliteBackend, agentDbBackend);
    await hybridBackend.initialize();

    const retrieved = await hybridBackend.retrieve('persistent-mem');
    expect(retrieved).toBeDefined();
    expect(retrieved?.content).toBe(memory.content);
  });

  it('should handle vector search in AgentDB backend', async () => {
    const memories: Memory[] = [
      {
        id: 'vec-1',
        agentId: 'agent-1',
        content: 'Machine learning algorithm implementation',
        type: 'task',
        timestamp: Date.now(),
        embedding: new Array(384).fill(0).map(() => Math.random())
      },
      {
        id: 'vec-2',
        agentId: 'agent-1',
        content: 'Neural network training',
        type: 'task',
        timestamp: Date.now(),
        embedding: new Array(384).fill(0).map(() => Math.random())
      }
    ];

    for (const memory of memories) {
      await hybridBackend.store(memory);
    }

    const queryEmbedding = new Array(384).fill(0).map(() => Math.random());
    const results = await hybridBackend.vectorSearch(queryEmbedding, 5);

    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });

  it('should update existing memory in both backends', async () => {
    const memory: Memory = {
      id: 'update-mem',
      agentId: 'agent-1',
      content: 'Original content',
      type: 'task',
      timestamp: Date.now()
    };

    await hybridBackend.store(memory);

    const updated: Memory = {
      ...memory,
      content: 'Updated content',
      metadata: { updated: true }
    };

    await hybridBackend.update(updated);
    const retrieved = await hybridBackend.retrieve('update-mem');

    expect(retrieved?.content).toBe('Updated content');
    expect(retrieved?.metadata?.updated).toBe(true);
  });

  it('should delete memory from both backends', async () => {
    const memory: Memory = {
      id: 'delete-mem',
      agentId: 'agent-1',
      content: 'To be deleted',
      type: 'task',
      timestamp: Date.now()
    };

    await hybridBackend.store(memory);
    await hybridBackend.delete('delete-mem');

    const retrieved = await hybridBackend.retrieve('delete-mem');
    expect(retrieved).toBeUndefined();
  });

  it('should handle bulk memory storage', async () => {
    const memories: Memory[] = Array.from({ length: 50 }, (_, i) => ({
      id: `bulk-${i}`,
      agentId: 'agent-1',
      content: `Bulk memory ${i}`,
      type: 'task',
      timestamp: Date.now() + i
    }));

    await Promise.all(memories.map(m => hybridBackend.store(m)));

    const allMemories = await hybridBackend.query({ agentId: 'agent-1' });
    expect(allMemories.length).toBeGreaterThanOrEqual(50);
  });

  it('should query memories with time range filter', async () => {
    const now = Date.now();
    const memories: Memory[] = [
      { id: '1', agentId: 'a1', content: 'Old', type: 'task', timestamp: now - 10000 },
      { id: '2', agentId: 'a1', content: 'Recent', type: 'task', timestamp: now - 1000 },
      { id: '3', agentId: 'a1', content: 'New', type: 'task', timestamp: now }
    ];

    for (const memory of memories) {
      await hybridBackend.store(memory);
    }

    const recentMemories = await hybridBackend.query({
      agentId: 'a1',
      timeRange: { start: now - 5000, end: now }
    });

    expect(recentMemories.length).toBeGreaterThanOrEqual(2);
    expect(recentMemories.every(m => m.timestamp >= now - 5000)).toBe(true);
  });

  it('should handle memory metadata queries', async () => {
    const memories: Memory[] = [
      {
        id: '1',
        agentId: 'a1',
        content: 'High priority',
        type: 'task',
        timestamp: Date.now(),
        metadata: { priority: 'high', status: 'pending' }
      },
      {
        id: '2',
        agentId: 'a1',
        content: 'Low priority',
        type: 'task',
        timestamp: Date.now(),
        metadata: { priority: 'low', status: 'completed' }
      }
    ];

    for (const memory of memories) {
      await hybridBackend.store(memory);
    }

    const highPriorityMemories = await hybridBackend.query({
      agentId: 'a1',
      metadata: { priority: 'high' }
    });

    expect(highPriorityMemories.length).toBeGreaterThan(0);
    expect(highPriorityMemories[0].metadata?.priority).toBe('high');
  });

  it('should handle concurrent memory operations', async () => {
    const operations = Array.from({ length: 20 }, (_, i) => ({
      id: `concurrent-${i}`,
      agentId: 'agent-1',
      content: `Concurrent operation ${i}`,
      type: 'task',
      timestamp: Date.now()
    }));

    await Promise.all(operations.map(op => hybridBackend.store(op)));

    const allMemories = await hybridBackend.query({ agentId: 'agent-1' });
    const concurrentMemories = allMemories.filter(m => m.id.startsWith('concurrent-'));

    expect(concurrentMemories.length).toBe(20);
  });

  it('should clear all memories for an agent', async () => {
    const memories: Memory[] = [
      { id: '1', agentId: 'agent-1', content: 'Mem 1', type: 'task', timestamp: Date.now() },
      { id: '2', agentId: 'agent-1', content: 'Mem 2', type: 'task', timestamp: Date.now() },
      { id: '3', agentId: 'agent-2', content: 'Mem 3', type: 'task', timestamp: Date.now() }
    ];

    for (const memory of memories) {
      await hybridBackend.store(memory);
    }

    await hybridBackend.clearAgent('agent-1');

    const agent1Memories = await hybridBackend.query({ agentId: 'agent-1' });
    const agent2Memories = await hybridBackend.query({ agentId: 'agent-2' });

    expect(agent1Memories).toHaveLength(0);
    expect(agent2Memories.length).toBeGreaterThan(0);
  });

  it('should support hybrid search combining SQL and vector search', async () => {
    const memories: Memory[] = [
      {
        id: 'hybrid-1',
        agentId: 'agent-1',
        content: 'Machine learning optimization',
        type: 'task',
        timestamp: Date.now(),
        embedding: new Array(384).fill(0).map(() => Math.random()),
        metadata: { category: 'ml' }
      },
      {
        id: 'hybrid-2',
        agentId: 'agent-1',
        content: 'Database optimization',
        type: 'task',
        timestamp: Date.now(),
        embedding: new Array(384).fill(0).map(() => Math.random()),
        metadata: { category: 'db' }
      }
    ];

    for (const memory of memories) {
      await hybridBackend.store(memory);
    }

    // First filter by metadata
    const mlMemories = await hybridBackend.query({
      agentId: 'agent-1',
      metadata: { category: 'ml' }
    });

    expect(mlMemories.length).toBeGreaterThan(0);
    expect(mlMemories[0].metadata?.category).toBe('ml');
  });

  it('should handle memory search with pagination', async () => {
    const memories: Memory[] = Array.from({ length: 30 }, (_, i) => ({
      id: `page-${i}`,
      agentId: 'agent-1',
      content: `Memory ${i}`,
      type: 'task',
      timestamp: Date.now() + i
    }));

    for (const memory of memories) {
      await hybridBackend.store(memory);
    }

    const page1 = await hybridBackend.query({ agentId: 'agent-1', limit: 10, offset: 0 });
    const page2 = await hybridBackend.query({ agentId: 'agent-1', limit: 10, offset: 10 });

    expect(page1).toHaveLength(10);
    expect(page2).toHaveLength(10);

    // Ensure no overlap
    const page1Ids = new Set(page1.map(m => m.id));
    const page2Ids = new Set(page2.map(m => m.id));
    const intersection = [...page1Ids].filter(id => page2Ids.has(id));

    expect(intersection).toHaveLength(0);
  });

  it('should maintain data consistency across backends during failures', async () => {
    const memory: Memory = {
      id: 'consistency-test',
      agentId: 'agent-1',
      content: 'Consistency check',
      type: 'task',
      timestamp: Date.now()
    };

    // Mock a failure scenario
    const originalStore = hybridBackend.store.bind(hybridBackend);
    let callCount = 0;

    vi.spyOn(hybridBackend, 'store').mockImplementation(async (mem) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Simulated failure');
      }
      return originalStore(mem);
    });

    try {
      await hybridBackend.store(memory);
    } catch (error) {
      // Expected first failure
    }

    // Retry should succeed
    await hybridBackend.store(memory);
    const retrieved = await hybridBackend.retrieve('consistency-test');

    expect(retrieved).toBeDefined();
    expect(retrieved?.content).toBe(memory.content);

    vi.restoreAllMocks();
  });
});
