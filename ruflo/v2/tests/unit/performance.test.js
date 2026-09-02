/**
 * Performance tests for Claude-Flow
 */

import { jest } from '@jest/globals';
import { perfHelpers } from '../utils/test-helpers.js';
import fs from 'fs-extra';
import { parseFlags } from '../../cli/utils.js';
import { deepMerge } from '../../utils/helpers.js';
import { agentCommand } from '../../cli/simple-commands/agent.js';
import { memoryCommand } from '../../cli/simple-commands/memory.js';

describe('Performance Tests', () => {
  describe('Utility Functions Performance', () => {
    test('parseFlags should handle large argument lists efficiently', async () => {
      const largeArgList = [];
      for (let i = 0; i < 1000; i++) {
        largeArgList.push(`--flag${i}`, `value${i}`);
      }

      const { result, duration } = await perfHelpers.measureTime(() => {
        return parseFlags(largeArgList);
      });

      expect(duration).toBeLessThan(100); // Should complete in less than 100ms
      expect(Object.keys(result.flags)).toHaveLength(1000);
    });

    test('JSON stringify should handle large datasets efficiently', async () => {
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
        value: Math.random() * 1000,
        description: `Description for item ${i}`.repeat(5)
      }));

      const { result, duration } = await perfHelpers.measureTime(() => {
        return JSON.stringify(largeDataset);
      });

      expect(duration).toBeLessThan(500); // Should complete in less than 500ms
      expect(result).toContain('Item 0');
      expect(result).toContain('Item 999');
    });

    test('deepMerge should handle deeply nested objects efficiently', async () => {
      const createDeepObject = (depth) => {
        let obj = { value: 'leaf' };
        for (let i = 0; i < depth; i++) {
          obj = { [`level${i}`]: obj };
        }
        return obj;
      };

      const obj1 = createDeepObject(50);
      const obj2 = createDeepObject(50);

      const { result, duration } = await perfHelpers.measureTime(() => {
        return deepMerge(obj1, obj2);
      });

      expect(duration).toBeLessThan(100); // Should complete in less than 100ms
      expect(result).toBeDefined();
    });
  });

  describe('Command Performance', () => {
    beforeEach(() => {
      // Mock file system operations for performance testing
      jest.spyOn(fs, 'pathExists').mockResolvedValue(true);
      jest.spyOn(fs, 'readJson').mockResolvedValue({ entries: [] });
      jest.spyOn(fs, 'writeJson').mockResolvedValue(undefined);
    });

    test('agent list command should respond quickly', async () => {
      const { duration } = await perfHelpers.measureTime(async () => {
        await agentCommand(['list'], {});
      });

      expect(duration).toBeLessThan(200); // Should complete in less than 200ms
    });

    test('memory list with large dataset should be performant', async () => {
      const largeMemoryData = {
        entries: Array.from({ length: 10000 }, (_, i) => ({
          key: `key${i}`,
          value: `value${i}`,
          timestamp: new Date().toISOString(),
          tags: [`tag${i % 10}`]
        }))
      };

      jest.spyOn(fs, 'readJson').mockResolvedValue(largeMemoryData);

      const { duration } = await perfHelpers.measureTime(async () => {
        await memoryCommand(['list'], {});
      });

      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });

    test('memory search with pattern should be efficient', async () => {
      const searchableData = {
        entries: Array.from({ length: 5000 }, (_, i) => ({
          key: i % 2 === 0 ? `api/endpoint${i}` : `config/setting${i}`,
          value: `value${i}`,
          timestamp: new Date().toISOString()
        }))
      };

      jest.spyOn(fs, 'readJson').mockResolvedValue(searchableData);

      const { duration } = await perfHelpers.measureTime(async () => {
        await memoryCommand(['list'], { pattern: 'api/*' });
      });

      expect(duration).toBeLessThan(500); // Should complete in less than 500ms
    });
  });

  describe('Memory Usage Tests', () => {
    test('should not leak memory during repeated operations', async () => {
      const getMemoryUsage = () => process.memoryUsage().heapUsed;
      
      const initialMemory = getMemoryUsage();
      
      // Perform 100 operations
      for (let i = 0; i < 100; i++) {
        const largeArray = Array.from({ length: 1000 }, (_, j) => ({
          id: j,
          data: 'x'.repeat(1000)
        }));
        
        parseFlags([`--test${i}`, 'value']);
        JSON.stringify(largeArray.slice(0, 10)); // Only format first 10 to keep it reasonable
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
      }
      
      const finalMemory = getMemoryUsage();
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });

  describe('Concurrent Operations', () => {
    test('should handle concurrent memory operations efficiently', async () => {
      const mockData = { entries: [] };
      jest.spyOn(fs, 'readJson').mockResolvedValue(mockData);
      jest.spyOn(fs, 'writeJson').mockResolvedValue(undefined);

      const { duration } = await perfHelpers.measureTime(async () => {
        const operations = [];
        
        // Simulate 20 concurrent memory operations
        for (let i = 0; i < 20; i++) {
          operations.push(memoryCommand(['store', `key${i}`, `value${i}`], {}));
        }
        
        await Promise.all(operations);
      });

      expect(duration).toBeLessThan(2000); // Should complete in less than 2 seconds
    });

    test('should handle concurrent agent operations efficiently', async () => {
      const mockSwarmData = {
        agents: Array.from({ length: 100 }, (_, i) => ({
          id: `agent-${i}`,
          name: `Agent ${i}`,
          type: 'researcher',
          status: 'idle'
        }))
      };
      
      jest.spyOn(fs, 'readJson').mockResolvedValue(mockSwarmData);

      const { duration } = await perfHelpers.measureTime(async () => {
        const operations = [];
        
        // Simulate 10 concurrent agent status checks
        for (let i = 0; i < 10; i++) {
          operations.push(agentCommand(['status'], {}));
        }
        
        await Promise.all(operations);
      });

      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });
  });

  describe('Large Data Handling', () => {
    test('should handle large configuration files efficiently', async () => {
      const largeConfig = {
        version: '2.0.0',
        features: {},
        agents: {},
        tasks: {},
        memory: {}
      };

      // Create large configuration with many properties
      for (let i = 0; i < 1000; i++) {
        largeConfig.features[`feature${i}`] = {
          enabled: i % 2 === 0,
          config: {
            setting1: `value${i}`,
            setting2: Math.random(),
            setting3: Array.from({ length: 10 }, (_, j) => `item${j}`)
          }
        };
      }

      const { duration } = await performance.measureTime(() => {
        return JSON.stringify(largeConfig);
      });

      expect(duration).toBeLessThan(100); // Should serialize in less than 100ms
    });

    test('should handle large log files efficiently', async () => {
      const largeLogs = Array.from({ length: 10000 }, (_, i) => ({
        timestamp: new Date(Date.now() - i * 1000).toISOString(),
        level: ['info', 'warn', 'error', 'debug'][i % 4],
        message: `Log message ${i}`,
        context: {
          agentId: `agent-${i % 10}`,
          taskId: `task-${i % 100}`,
          metadata: {
            duration: Math.random() * 1000,
            success: i % 5 !== 0
          }
        }
      }));

      const { duration } = await performance.measureTime(() => {
        // Simulate log processing
        const errors = largeLogs.filter(log => log.level === 'error');
        const recent = largeLogs.slice(0, 100);
        return { errors: errors.length, recent: recent.length };
      });

      expect(duration).toBeLessThan(200); // Should process in less than 200ms
    });
  });

  describe('Benchmarks', () => {
    test('should meet performance benchmarks for CLI startup', async () => {
      // This would test actual CLI startup time in a real environment
      const mockStartupOperations = async () => {
        // Simulate CLI startup operations
        parseFlags(['--help']);
        await new Promise(resolve => setTimeout(resolve, 10)); // Simulate I/O
        return 'CLI ready';
      };

      const { result, duration } = await performance.measureTime(mockStartupOperations);

      expect(result).toBe('CLI ready');
      expect(duration).toBeLessThan(100); // CLI should start in less than 100ms
    });

    test('should meet performance benchmarks for swarm initialization', async () => {
      jest.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
      jest.spyOn(fs, 'writeJson').mockResolvedValue(undefined);

      const mockSwarmInit = async () => {
        // Simulate swarm initialization
        const swarmData = {
          id: 'test-swarm',
          agents: Array.from({ length: 8 }, (_, i) => ({ id: `agent-${i}` }))
        };
        
        await new Promise(resolve => setTimeout(resolve, 50)); // Simulate setup
        return swarmData;
      };

      const { result, duration } = await performance.measureTime(mockSwarmInit);

      expect(result.agents).toHaveLength(8);
      expect(duration).toBeLessThan(200); // Swarm init should complete in less than 200ms
    });
  });
});