/// <reference types="jest" />

/**
 * Comprehensive unit tests for Incremental Updates across the system
 */

import { MemoryManager } from '../../src/memory/manager.js';
import { MemoryBackendFactory } from '../../src/memory/backend.js';
import { SwarmMemory } from '../../src/swarm/memory.js';
import { ConfigurationManager } from '../../src/core/config.js';
import { deepMerge } from '../../src/utils/helpers.js';
import { ResourceManager } from '../../src/resources/resource-manager.js';
import { SimpleCache } from '../../src/memory/cache.js';
import { 
  AsyncTestUtils, 
  FileSystemTestUtils,
  TestDataGenerator 
} from '../utils/test-utils.js';

describe('Incremental Updates Test Suite', () => {
  let tempDir: string;
  let fakeTime: FakeTime;
  
  beforeEach(async () => {
    tempDir = await FileSystemTestUtils.createTempDir('incremental-test-');
    fakeTime = jest.useFakeTimers();
  });

  afterEach(async () => {
    await FileSystemTestUtils.cleanup(tempDir);
    jest.useRealTimers();
  });

  describe('Memory Manager Incremental Updates', () => {
    let memoryManager: MemoryManager;

    beforeEach(async () => {
      const backend = MemoryBackendFactory.create('local', { directory: tempDir });
      memoryManager = new MemoryManager({ backend });
      await memoryManager.initialize();
    });

    it('should increment version on each update', async () => {
      // Store initial entry
      await memoryManager.store('test-key', 'initial value', { namespace: 'test' });
      const initial = await memoryManager.retrieve('test-key', 'test');
      expect(initial?.version).toBe( 1);

      // First update
      await memoryManager.update(initial!.id, { content: 'updated value 1' });
      const updated1 = await memoryManager.retrieve('test-key', 'test');
      expect(updated1?.version).toBe( 2);
      expect(updated1?.content).toBe( 'updated value 1');

      // Second update
      await memoryManager.update(updated1!.id, { content: 'updated value 2' });
      const updated2 = await memoryManager.retrieve('test-key', 'test');
      expect(updated2?.version).toBe( 3);
      expect(updated2?.content).toBe( 'updated value 2');
    });

    it('should handle partial updates correctly', async () => {
      await memoryManager.store('test-key', { a: 1, b: 2, c: 3 }, { namespace: 'test' });
      const initial = await memoryManager.retrieve('test-key', 'test');

      // Partial update
      await memoryManager.update(initial!.id, { 
        content: { ...initial!.content, b: 5 },
        metadata: { updated: true }
      });

      const updated = await memoryManager.retrieve('test-key', 'test');
      expect(updated?.content).toBe( { a: 1).toBe( b: 5, c: 3 });
      expect(updated?.metadata?.updated).toBe( true);
    });

    it('should preserve timestamps correctly during updates', async () => {
      await memoryManager.store('test-key', 'value', { namespace: 'test' });
      const initial = await memoryManager.retrieve('test-key', 'test');
      const createdAt = initial!.createdAt;

      // Advance time to ensure different timestamp
      jest.advanceTimersByTime(1000);

      await memoryManager.update(initial!.id, { content: 'updated' });
      const updated = await memoryManager.retrieve('test-key', 'test');

      expect(updated?.createdAt).toBe( createdAt);
      assert(updated!.updatedAt > createdAt);
    });
  });

  describe('Swarm Memory Incremental Updates', () => {
    let swarmMemory: SwarmMemory;

    beforeEach(() => {
      swarmMemory = new SwarmMemory();
    });

    it('should track version history on updates', async () => {
      await swarmMemory.set('test-key', 'version 1');
      await swarmMemory.update('test-key', 'version 2');
      await swarmMemory.update('test-key', 'version 3');

      const entry = await swarmMemory.get('test-key');
      expect(entry.version).toBe( 3);
      expect(entry.previousVersions.length).toBe( 2);
      expect(entry.previousVersions[0].value).toBe( 'version 1');
      expect(entry.previousVersions[1].value).toBe( 'version 2');
    });

    it('should limit version history to 10 entries', async () => {
      await swarmMemory.set('test-key', 'version 0');
      
      // Create 12 updates
      for (let i = 1; i <= 12; i++) {
        await swarmMemory.update('test-key', `version ${i}`);
      }

      const entry = await swarmMemory.get('test-key');
      expect(entry.version).toBe( 13);
      expect(entry.previousVersions.length).toBe( 10);
      expect(entry.previousVersions[0].value).toBe( 'version 2');
      expect(entry.previousVersions[9].value).toBe( 'version 11');
    });

    it('should handle concurrent updates with proper versioning', async () => {
      await swarmMemory.set('counter', 0);

      // Simulate concurrent updates
      const updates = Array(10).fill(null).map(async () => {
        const current = await swarmMemory.get('counter');
        await swarmMemory.update('counter', current.value + 1);
      });

      await Promise.all(updates);

      const final = await swarmMemory.get('counter');
      expect(final.value).toBe( 10);
      expect(final.version).toBe( 11); // Initial + 10 updates
    });
  });

  describe('Configuration Manager Incremental Updates', () => {
    let configManager: ConfigurationManager;

    beforeEach(() => {
      configManager = new ConfigurationManager({
        defaultConfig: {
          model: 'claude-3-sonnet',
          temperature: 0.7,
          maxTokens: 4096,
          tools: { webSearch: true, memory: true }
        }
      });
    });

    it('should handle nested configuration updates', () => {
      const initial = configManager.getConfig();
      
      configManager.update({
        temperature: 0.9,
        tools: { webSearch: false }
      });

      const updated = configManager.getConfig();
      expect(updated.temperature).toBe( 0.9);
      expect(updated.tools.webSearch).toBe( false);
      expect(updated.tools.memory).toBe( true); // Preserved
      expect(updated.model).toBe( 'claude-3-sonnet'); // Preserved
    });

    it('should track configuration differences', () => {
      configManager.update({ temperature: 0.5 });
      
      const diff = configManager.getDiff();
      expect(diff).toBe( { temperature: 0.5 });
      
      configManager.update({ maxTokens: 8192 });
      const diff2 = configManager.getDiff();
      expect(diff2).toBe( { temperature: 0.5).toBe( maxTokens: 8192 });
    });
  });

  describe('Cache Hit/Miss Counter Updates', () => {
    it('should increment cache hit/miss counters correctly', () => {
      const cache = new SimpleCache<string>({ maxSize: 3 });
      
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      
      // Generate hits
      cache.get('key1');
      cache.get('key2');
      cache.get('key1');
      
      // Generate misses
      cache.get('key3');
      cache.get('key4');
      
      expect(cache.stats(), {
        size: 2,
        maxSize: 3,
        hits: 3,
        misses: 2
      });
    });

    it('should handle cache eviction during incremental adds', () => {
      const cache = new SimpleCache<string>({ maxSize: 2 });
      
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3'); // Should evict key1
      
      expect(cache.has('key1')).toBe( false);
      expect(cache.has('key2')).toBe( true);
      expect(cache.has('key3')).toBe( true);
      expect(cache.stats().size).toBe( 2);
    });
  });

  describe('Deep Merge Incremental Updates', () => {
    it('should handle deep nested object updates', () => {
      const original = {
        level1: {
          level2: {
            level3: {
              a: 1,
              b: 2
            },
            array: [1, 2, 3]
          },
          keep: 'this'
        }
      };

      const update = {
        level1: {
          level2: {
            level3: {
              b: 5,
              c: 3
            },
            array: [4, 5]
          }
        }
      };

      const result = deepMerge(original, update);
      
      expect(result, {
        level1: {
          level2: {
            level3: {
              a: 1,
              b: 5,
              c: 3
            },
            array: [4, 5]
          },
          keep: 'this'
        }
      });
    });

    it('should not mutate original objects during merge', () => {
      const original = { a: 1, nested: { b: 2 } };
      const update = { nested: { b: 3, c: 4 } };
      
      const result = deepMerge(original, update);
      
      expect(original.nested.b).toBe( 2);
      expect(result.nested.b).toBe( 3);
      expect(result.nested.c).toBe( 4);
    });
  });

  describe('Resource Manager Incremental Updates', () => {
    let resourceManager: ResourceManager;

    beforeEach(() => {
      resourceManager = new ResourceManager({
        maxMemory: 1024 * 1024 * 1024, // 1GB
        maxCpu: 4,
        maxThreads: 10
      });
    });

    it('should track incremental resource allocation', async () => {
      const allocation1 = await resourceManager.allocate('task1', {
        memory: 100 * 1024 * 1024, // 100MB
        cpu: 1,
        threads: 2
      });

      expect(allocation1).toBe( true);
      
      const usage1 = resourceManager.getUsage();
      expect(usage1.memory).toBe( 100 * 1024 * 1024);
      expect(usage1.cpu).toBe( 1);
      expect(usage1.threads).toBe( 2);

      const allocation2 = await resourceManager.allocate('task2', {
        memory: 200 * 1024 * 1024, // 200MB
        cpu: 1,
        threads: 3
      });

      expect(allocation2).toBe( true);
      
      const usage2 = resourceManager.getUsage();
      expect(usage2.memory).toBe( 300 * 1024 * 1024);
      expect(usage2.cpu).toBe( 2);
      expect(usage2.threads).toBe( 5);
    });

    it('should handle resource deallocation correctly', async () => {
      await resourceManager.allocate('task1', {
        memory: 500 * 1024 * 1024,
        cpu: 2,
        threads: 4
      });

      const usageBefore = resourceManager.getUsage();
      expect(usageBefore.memory).toBe( 500 * 1024 * 1024);

      resourceManager.deallocate('task1');

      const usageAfter = resourceManager.getUsage();
      expect(usageAfter.memory).toBe( 0);
      expect(usageAfter.cpu).toBe( 0);
      expect(usageAfter.threads).toBe( 0);
    });
  });

  describe('Batch Incremental Updates', () => {
    it('should handle batch memory updates efficiently', async () => {
      const backend = MemoryBackendFactory.create('local', { directory: tempDir });
      const memoryManager = new MemoryManager({ backend });
      await memoryManager.initialize();

      // Store multiple entries
      const entries = await Promise.all(
        Array(10).fill(null).map((_, i) => 
          memoryManager.store(`key-${i}`, i, { namespace: 'batch' })
        )
      );

      // Batch update with increments
      await Promise.all(
        entries.map(async (_, i) => {
          const entry = await memoryManager.retrieve(`key-${i}`, 'batch');
          return memoryManager.update(entry!.id, { 
            content: entry!.content + 10 
          });
        })
      );

      // Verify all updates
      for (let i = 0; i < 10; i++) {
        const updated = await memoryManager.retrieve(`key-${i}`, 'batch');
        expect(updated?.content).toBe( i + 10);
        expect(updated?.version).toBe( 2);
      }
    });
  });

  describe('Atomic Counter Operations', () => {
    it('should handle atomic increments correctly', () => {
      class Counter {
        private value: number = 0;
        private updates: number = 0;
        
        increment(): number {
          this.updates++;
          return ++this.value;
        }
        
        decrement(): number {
          this.updates++;
          return --this.value;
        }
        
        getStats() {
          return { value: this.value, updates: this.updates };
        }
      }

      const counter = new Counter();
      
      // Perform multiple operations
      counter.increment();
      counter.increment();
      counter.decrement();
      counter.increment();
      
      const stats = counter.getStats();
      expect(stats.value).toBe( 2);
      expect(stats.updates).toBe( 4);
    });
  });

  describe('Event-Driven Updates', () => {
    it('should emit events on incremental updates', async () => {
      const backend = MemoryBackendFactory.create('local', { directory: tempDir });
      const memoryManager = new MemoryManager({ backend });
      await memoryManager.initialize();

      const updateEvents: any[] = [];
      memoryManager.on('memory:updated', (event) => {
        updateEvents.push(event);
      });

      await memoryManager.store('event-key', 'initial', { namespace: 'events' });
      const entry = await memoryManager.retrieve('event-key', 'events');
      
      await memoryManager.update(entry!.id, { content: 'updated' });
      
      // Wait for event propagation
      await AsyncTestUtils.waitFor(() => updateEvents.length > 0, 100);
      
      expect(updateEvents.length).toBe( 1);
      expect(updateEvents[0].id).toBe( entry!.id);
      expect(updateEvents[0].updates.content).toBe( 'updated');
    });
  });
});
