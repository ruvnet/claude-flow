/**
 * Production Performance Validation Tests
 * 
 * These tests validate system performance under real load conditions.
 * Performance requirements based on production SLA expectations.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { SystemIntegration } from '../../src/integration/system-integration.js';
import { AgentManager } from '../../src/agents/agent-manager.js';
import { MemoryManager } from '../../src/memory/manager.js';
import { SwarmCoordinator } from '../../src/coordination/swarm-coordinator.js';
import { TaskEngine } from '../../src/task/engine.js';

describe('Production Performance Validation', () => {
  let systemIntegration: SystemIntegration;
  let agentManager: AgentManager;
  let memoryManager: MemoryManager;
  let swarmCoordinator: SwarmCoordinator;
  let taskEngine: TaskEngine;

  beforeAll(async () => {
    systemIntegration = SystemIntegration.getInstance();
    await systemIntegration.initialize({
      logLevel: 'error', // Minimize logging overhead for performance tests
      environment: 'performance-test',
      orchestrator: {
        maxConcurrency: 20,
        timeout: 30000
      },
      agents: {
        maxAgents: 50,
        defaultStrategy: 'balanced'
      },
      memory: {
        backend: 'memory', // Use fastest backend for performance tests
        ttl: 3600,
        maxSize: 10000
      }
    });

    agentManager = systemIntegration.getComponent('agentManager') as AgentManager;
    memoryManager = systemIntegration.getComponent('memoryManager') as MemoryManager;
    swarmCoordinator = systemIntegration.getComponent('swarmCoordinator') as SwarmCoordinator;
    taskEngine = systemIntegration.getComponent('taskEngine') as TaskEngine;
  });

  afterAll(async () => {
    if (systemIntegration?.isReady()) {
      await systemIntegration.shutdown();
    }
  });

  describe('Agent Management Performance', () => {
    test('should create 100 agents in under 10 seconds', async () => {
      const agentCount = 100;
      const maxTime = 10000; // 10 seconds
      const startTime = Date.now();

      const createPromises = Array.from({ length: agentCount }, (_, i) =>
        agentManager.createAgent({
          type: 'researcher',
          name: `perf-agent-${i}`,
          capabilities: ['research', 'analysis']
        })
      );

      const agentIds = await Promise.all(createPromises);
      const creationTime = Date.now() - startTime;

      expect(agentIds).toHaveLength(agentCount);
      expect(creationTime).toBeLessThan(maxTime);

      console.log(`Created ${agentCount} agents in ${creationTime}ms (${creationTime/agentCount}ms per agent)`);

      // Performance cleanup
      const cleanupStart = Date.now();
      const removePromises = agentIds.map(id => agentManager.removeAgent(id));
      await Promise.all(removePromises);
      const cleanupTime = Date.now() - cleanupStart;

      expect(cleanupTime).toBeLessThan(5000); // 5 seconds for cleanup
      console.log(`Cleaned up ${agentCount} agents in ${cleanupTime}ms`);
    });

    test('should handle concurrent agent operations without degradation', async () => {
      const concurrency = 20;
      const operationsPerAgent = 5;
      const maxTimePerOperation = 500; // 500ms per operation

      const concurrentOperations = Array.from({ length: concurrency }, async (_, agentIndex) => {
        const agentId = await agentManager.createAgent({
          type: 'researcher',
          name: `concurrent-agent-${agentIndex}`,
          capabilities: ['research']
        });

        const operationTimes: number[] = [];

        for (let i = 0; i < operationsPerAgent; i++) {
          const opStart = Date.now();
          
          // Mix of operations
          if (i % 3 === 0) {
            await agentManager.getAgent(agentId);
          } else if (i % 3 === 1) {
            await agentManager.updateAgent(agentId, {
              name: `concurrent-agent-${agentIndex}-updated-${i}`
            });
          } else {
            await agentManager.getAgentStatus(agentId);
          }
          
          operationTimes.push(Date.now() - opStart);
        }

        // Clean up
        await agentManager.removeAgent(agentId);

        return operationTimes;
      });

      const allOperationTimes = (await Promise.all(concurrentOperations)).flat();
      
      // Verify performance requirements
      const avgTime = allOperationTimes.reduce((sum, time) => sum + time, 0) / allOperationTimes.length;
      const maxTime = Math.max(...allOperationTimes);

      expect(avgTime).toBeLessThan(maxTimePerOperation);
      expect(maxTime).toBeLessThan(maxTimePerOperation * 2); // Allow 2x degradation for worst case

      console.log(`Concurrent operations - Avg: ${avgTime}ms, Max: ${maxTime}ms`);
    });
  });

  describe('Memory Management Performance', () => {
    test('should handle 1000 memory operations per second', async () => {
      const operationsPerSecond = 1000;
      const testDuration = 5000; // 5 seconds
      const expectedOperations = (operationsPerSecond * testDuration) / 1000;

      let operationCount = 0;
      const startTime = Date.now();
      const operations: Promise<void>[] = [];

      while (Date.now() - startTime < testDuration) {
        const operation = (async () => {
          const key = `perf-${operationCount++}-${Date.now()}`;
          const data = { 
            index: operationCount,
            timestamp: Date.now(),
            payload: 'x'.repeat(100) // 100 char payload
          };

          await memoryManager.store(key, data, 'performance-test');
          const retrieved = await memoryManager.retrieve(key, 'performance-test');
          expect(retrieved).toEqual(data);
          await memoryManager.delete(key, 'performance-test');
        })();

        operations.push(operation);

        // Control operation rate
        if (operations.length >= 100) {
          await Promise.all(operations.splice(0, 50));
        }
      }

      // Wait for remaining operations
      await Promise.all(operations);

      const actualDuration = Date.now() - startTime;
      const actualRate = (operationCount * 1000) / actualDuration;

      expect(actualRate).toBeGreaterThan(operationsPerSecond * 0.8); // Allow 20% deviation
      console.log(`Memory operations rate: ${actualRate.toFixed(2)} ops/sec`);
    });

    test('should handle large data objects efficiently', async () => {
      const largeDataSizes = [1024, 10240, 102400, 1024000]; // 1KB, 10KB, 100KB, 1MB
      const maxTime = 1000; // 1 second per operation

      for (const size of largeDataSizes) {
        const key = `large-data-${size}`;
        const data = {
          size,
          payload: 'x'.repeat(size),
          metadata: {
            created: Date.now(),
            type: 'performance-test'
          }
        };

        const startTime = Date.now();
        
        await memoryManager.store(key, data, 'performance-test');
        const storeTime = Date.now() - startTime;

        const retrieveStart = Date.now();
        const retrieved = await memoryManager.retrieve(key, 'performance-test');
        const retrieveTime = Date.now() - retrieveStart;

        const deleteStart = Date.now();
        await memoryManager.delete(key, 'performance-test');
        const deleteTime = Date.now() - deleteStart;

        // Verify data integrity
        expect(retrieved.size).toBe(size);
        expect(retrieved.payload).toBe(data.payload);

        // Performance requirements
        expect(storeTime).toBeLessThan(maxTime);
        expect(retrieveTime).toBeLessThan(maxTime);
        expect(deleteTime).toBeLessThan(maxTime / 2); // Delete should be faster

        console.log(`${size} bytes - Store: ${storeTime}ms, Retrieve: ${retrieveTime}ms, Delete: ${deleteTime}ms`);
      }
    });
  });

  describe('Swarm Coordination Performance', () => {
    test('should coordinate multiple swarms efficiently', async () => {
      const swarmCount = 10;
      const agentsPerSwarm = 5;
      const maxCoordinationTime = 15000; // 15 seconds

      const startTime = Date.now();

      // Create multiple swarms concurrently
      const swarmPromises = Array.from({ length: swarmCount }, (_, i) =>
        swarmCoordinator.initializeSwarm({
          topology: 'mesh',
          maxAgents: agentsPerSwarm,
          strategy: 'balanced',
          name: `perf-swarm-${i}`
        })
      );

      const swarmIds = await Promise.all(swarmPromises);
      const creationTime = Date.now() - startTime;

      expect(swarmIds).toHaveLength(swarmCount);
      expect(creationTime).toBeLessThan(maxCoordinationTime);

      // Verify all swarms are operational
      const statusPromises = swarmIds.map(id => swarmCoordinator.getSwarmStatus(id));
      const statuses = await Promise.all(statusPromises);

      statuses.forEach((status, index) => {
        expect(status).toBeDefined();
        expect(status.topology).toBe('mesh');
        expect(status.maxAgents).toBe(agentsPerSwarm);
      });

      // Performance cleanup
      const cleanupStart = Date.now();
      const destroyPromises = swarmIds.map(id => swarmCoordinator.destroySwarm(id));
      await Promise.all(destroyPromises);
      const cleanupTime = Date.now() - cleanupStart;

      expect(cleanupTime).toBeLessThan(5000);
      console.log(`Swarm coordination - Creation: ${creationTime}ms, Cleanup: ${cleanupTime}ms`);
    });

    test('should handle cross-swarm communication efficiently', async () => {
      // Create two swarms for communication testing
      const swarm1Id = await swarmCoordinator.initializeSwarm({
        topology: 'mesh',
        maxAgents: 3,
        strategy: 'balanced'
      });

      const swarm2Id = await swarmCoordinator.initializeSwarm({
        topology: 'hierarchical',
        maxAgents: 3,
        strategy: 'research'
      });

      const messageCount = 100;
      const maxCommunicationTime = 5000; // 5 seconds

      const startTime = Date.now();

      // Send messages between swarms
      const communicationPromises = Array.from({ length: messageCount }, (_, i) =>
        swarmCoordinator.sendMessage(swarm1Id, swarm2Id, {
          type: 'performance-test',
          index: i,
          timestamp: Date.now(),
          payload: `test-message-${i}`
        })
      );

      await Promise.all(communicationPromises);
      const communicationTime = Date.now() - startTime;

      expect(communicationTime).toBeLessThan(maxCommunicationTime);

      const messagesPerSecond = (messageCount * 1000) / communicationTime;
      console.log(`Cross-swarm communication: ${messagesPerSecond.toFixed(2)} messages/sec`);

      // Cleanup
      await swarmCoordinator.destroySwarm(swarm1Id);
      await swarmCoordinator.destroySwarm(swarm2Id);
    });
  });

  describe('Task Execution Performance', () => {
    test('should execute 50 tasks concurrently within time limits', async () => {
      const taskCount = 50;
      const maxExecutionTime = 20000; // 20 seconds
      const startTime = Date.now();

      const taskPromises = Array.from({ length: taskCount }, (_, i) =>
        taskEngine.executeTask({
          id: `perf-task-${i}`,
          type: 'research',
          description: `Performance test task ${i}`,
          priority: 'medium',
          timeout: 5000
        })
      );

      const results = await Promise.all(taskPromises);
      const executionTime = Date.now() - startTime;

      expect(results).toHaveLength(taskCount);
      expect(executionTime).toBeLessThan(maxExecutionTime);

      // Verify all tasks completed successfully
      results.forEach((result, index) => {
        expect(result).toBeDefined();
        expect(result.status).toMatch(/completed|success/);
      });

      const tasksPerSecond = (taskCount * 1000) / executionTime;
      console.log(`Task execution: ${tasksPerSecond.toFixed(2)} tasks/sec`);
    });

    test('should maintain performance under sustained load', async () => {
      const loadDuration = 30000; // 30 seconds
      const targetRate = 10; // 10 tasks per second
      const tolerance = 0.8; // 80% of target rate

      let completedTasks = 0;
      let totalExecutionTime = 0;
      const startTime = Date.now();

      while (Date.now() - startTime < loadDuration) {
        const batchStart = Date.now();
        const batchSize = 10;

        const batchPromises = Array.from({ length: batchSize }, (_, i) =>
          taskEngine.executeTask({
            id: `sustained-task-${completedTasks + i}`,
            type: 'analysis',
            description: `Sustained load task ${completedTasks + i}`,
            priority: 'low',
            timeout: 3000
          })
        );

        const batchResults = await Promise.all(batchPromises);
        const batchTime = Date.now() - batchStart;

        completedTasks += batchResults.filter(r => r.status.match(/completed|success/)).length;
        totalExecutionTime += batchTime;

        // Control rate to avoid overwhelming the system
        const targetBatchTime = (batchSize * 1000) / targetRate;
        if (batchTime < targetBatchTime) {
          await new Promise(resolve => setTimeout(resolve, targetBatchTime - batchTime));
        }
      }

      const actualDuration = Date.now() - startTime;
      const actualRate = (completedTasks * 1000) / actualDuration;
      const avgExecutionTime = totalExecutionTime / completedTasks;

      expect(actualRate).toBeGreaterThan(targetRate * tolerance);
      expect(avgExecutionTime).toBeLessThan(5000); // Average task should complete in under 5 seconds

      console.log(`Sustained load - Rate: ${actualRate.toFixed(2)} tasks/sec, Avg time: ${avgExecutionTime.toFixed(2)}ms`);
    });
  });

  describe('Memory Usage and Resource Management', () => {
    test('should not leak memory during sustained operations', async () => {
      // Get baseline memory usage
      const initialMemory = process.memoryUsage();
      const operationCycles = 1000;

      for (let cycle = 0; cycle < operationCycles; cycle++) {
        // Create and destroy resources
        const agentId = await agentManager.createAgent({
          type: 'researcher',
          name: `memory-test-${cycle}`,
          capabilities: ['research']
        });

        await memoryManager.store(`temp-${cycle}`, { cycle, data: 'x'.repeat(1000) }, 'memory-test');
        await memoryManager.retrieve(`temp-${cycle}`, 'memory-test');
        await memoryManager.delete(`temp-${cycle}`, 'memory-test');
        
        await agentManager.removeAgent(agentId);

        // Periodic memory check
        if (cycle % 100 === 0) {
          if (global.gc) {
            global.gc(); // Force garbage collection if available
          }
          
          const currentMemory = process.memoryUsage();
          const heapGrowth = currentMemory.heapUsed - initialMemory.heapUsed;
          
          // Memory growth should be reasonable (less than 50MB after 1000 operations)
          expect(heapGrowth).toBeLessThan(50 * 1024 * 1024);
        }
      }

      // Final memory check
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage();
      const totalHeapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;

      console.log(`Memory usage - Initial: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB, Final: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB, Growth: ${(totalHeapGrowth / 1024 / 1024).toFixed(2)}MB`);
      
      // Total memory growth should be minimal
      expect(totalHeapGrowth).toBeLessThan(100 * 1024 * 1024); // Less than 100MB growth
    });
  });
});