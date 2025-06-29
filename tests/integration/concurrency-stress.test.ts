/// <reference types="jest" />

/**
 * Integration tests for high-concurrency multi-agent scenarios
 * Tests state management with 32+ concurrent agents and stress scenarios
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  waitFor,
  createDeferred
} from '../test.utils.js';
import { SwarmCoordinator } from '../../src/coordination/swarm-coordinator.js';
import { StateManager } from '../../src/state/manager.js';
import { ProcessPool } from '../../src/core/process-pool.js';
import { MemoryManager } from '../../src/memory/manager.js';
import { EventBus } from '../../src/core/event-bus.js';
import { Logger } from '../../src/core/logger.js';
import { cleanupTestEnv, setupTestEnv, TEST_CONFIG } from '../test.config.js';

describe('High-Concurrency Stress Tests', () => {
  let stateManager: StateManager;
  let processPool: ProcessPool;
  let memoryManager: MemoryManager;
  let swarmCoordinator: SwarmCoordinator;
  let eventBus: EventBus;
  let logger: Logger;

  beforeEach(async () => {
    setupTestEnv();

    logger = new Logger({
      level: 'debug',
      format: 'text',
      destination: 'console',
    });

    eventBus = new EventBus();
    
    stateManager = new StateManager({
      maxConcurrentOperations: 64,
      stateTimeout: 30000,
      enableConcurrencyControl: true,
      maxRetries: 3
    });

    processPool = new ProcessPool({
      maxProcesses: 32,
      processTimeout: 45000,
      enableHealthChecks: true,
      restartThreshold: 3
    });

    memoryManager = new MemoryManager({
      backend: 'memory',
      maxEntries: 10000,
      enableConcurrency: true
    });

    swarmCoordinator = new SwarmCoordinator({
      maxAgents: 64,
      maxConcurrentTasks: 32,
      taskTimeout: 30000,
      enableMonitoring: true,
      enableWorkStealing: true,
      maxRetries: 2
    });

    await Promise.all([
      stateManager.initialize(),
      processPool.initialize(),
      memoryManager.initialize(),
      swarmCoordinator.start()
    ]);
  });

  afterEach(async () => {
    await Promise.all([
      swarmCoordinator.shutdown(),
      processPool.shutdown(),
      stateManager.cleanup(),
      memoryManager.cleanup()
    ]);
    await cleanupTestEnv();
  });

  describe('StateManager Concurrency with 32+ Agents', () => {
    it('should handle 32 concurrent agents accessing state simultaneously', async () => {
      const agentCount = 32;
      const operationsPerAgent = 10;
      const agents = Array.from({ length: agentCount }, (_, i) => ({
        id: `stress-agent-${i}`,
        name: `Stress Agent ${i}`,
        type: 'stress-tester' as const
      }));

      // Create agents in the swarm
      const swarmAgents = agents.map(agent => 
        swarmCoordinator.createAgent(agent)
      );

      const results: Array<{agentId: string, operationResults: any[]}> = [];
      const startTime = Date.now();

      // Each agent performs multiple state operations concurrently
      const agentOperations = swarmAgents.map(async (agent) => {
        const operationResults = [];
        
        for (let op = 0; op < operationsPerAgent; op++) {
          const stateKey = `agent-${agent.id}-state-${op}`;
          const stateValue = {
            agentId: agent.id,
            operation: op,
            timestamp: Date.now(),
            data: `test-data-${Math.random()}`
          };

          try {
            // Concurrent state operations
            await stateManager.setState(stateKey, stateValue);
            const retrievedState = await stateManager.getState(stateKey);
            await stateManager.updateState(stateKey, {
              ...stateValue,
              updated: true,
              updateTime: Date.now()
            });
            
            operationResults.push({
              operation: op,
              success: true,
              stateKey,
              retrievedCorrectly: retrievedState?.agentId === agent.id
            });
          } catch (error) {
            operationResults.push({
              operation: op,
              success: false,
              error: error.message
            });
          }
        }

        return { agentId: agent.id, operationResults };
      });

      // Execute all agent operations concurrently
      const allResults = await Promise.all(agentOperations);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify all operations completed
      expect(allResults.length).toBe(agentCount);
      
      // Check success rate
      const totalOperations = allResults.reduce((sum, result) => 
        sum + result.operationResults.length, 0
      );
      const successfulOperations = allResults.reduce((sum, result) => 
        sum + result.operationResults.filter(op => op.success).length, 0
      );
      
      const successRate = successfulOperations / totalOperations;
      expect(successRate).toBeGreaterThan(0.95); // 95% success rate minimum
      
      // Verify state consistency
      for (const result of allResults) {
        const successfulOps = result.operationResults.filter(op => op.success);
        expect(successfulOps.length).toBeGreaterThan(operationsPerAgent * 0.9);
        
        // Verify state retrieval accuracy
        const correctRetrievals = successfulOps.filter(op => op.retrievedCorrectly);
        expect(correctRetrievals.length).toBe(successfulOps.length);
      }

      console.log(`32 agents completed ${totalOperations} operations in ${duration}ms`);
      console.log(`Success rate: ${(successRate * 100).toFixed(2)}%`);
      console.log(`Throughput: ${(totalOperations / duration * 1000).toFixed(2)} ops/sec`);
    });

    it('should handle 64 concurrent agents with resource contention', async () => {
      const agentCount = 64;
      const sharedResourceCount = 8;
      const agents = Array.from({ length: agentCount }, (_, i) => 
        swarmCoordinator.createAgent({
          id: `contention-agent-${i}`,
          name: `Contention Agent ${i}`,
          type: 'contention-tester'
        })
      );

      // Shared resources that agents will compete for
      const sharedResources = Array.from({ length: sharedResourceCount }, (_, i) => 
        `shared-resource-${i}`
      );

      const completedOperations: Array<{
        agentId: string;
        resourceId: string;
        startTime: number;
        endTime: number;
        success: boolean;
      }> = [];

      // Each agent tries to access shared resources
      const agentTasks = agents.map(async (agent) => {
        const resourceId = sharedResources[Math.floor(Math.random() * sharedResourceCount)];
        const startTime = Date.now();
        
        try {
          // Lock resource through state manager
          const lockKey = `lock:${resourceId}`;
          const lockValue = {
            lockedBy: agent.id,
            lockTime: startTime,
            expires: startTime + 5000 // 5 second lock
          };

          // Try to acquire lock (with retry logic for contention)
          let lockAcquired = false;
          let attempts = 0;
          const maxAttempts = 10;

          while (!lockAcquired && attempts < maxAttempts) {
            try {
              const existingLock = await stateManager.getState(lockKey);
              const now = Date.now();
              
              if (!existingLock || existingLock.expires < now) {
                await stateManager.setState(lockKey, lockValue);
                lockAcquired = true;
              } else {
                // Wait and retry
                await new Promise(resolve => setTimeout(resolve, 50));
                attempts++;
              }
            } catch (error) {
              attempts++;
              await new Promise(resolve => setTimeout(resolve, 25));
            }
          }

          if (lockAcquired) {
            // Simulate work with the resource
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Update resource state
            const resourceKey = `resource:${resourceId}`;
            const resourceState = await stateManager.getState(resourceKey) || { useCount: 0 };
            await stateManager.setState(resourceKey, {
              ...resourceState,
              useCount: resourceState.useCount + 1,
              lastUsedBy: agent.id,
              lastUsedAt: Date.now()
            });

            // Release lock
            await stateManager.deleteState(lockKey);

            completedOperations.push({
              agentId: agent.id,
              resourceId,
              startTime,
              endTime: Date.now(),
              success: true
            });
          } else {
            completedOperations.push({
              agentId: agent.id,
              resourceId,
              startTime,
              endTime: Date.now(),
              success: false
            });
          }
        } catch (error) {
          completedOperations.push({
            agentId: agent.id,
            resourceId,
            startTime,
            endTime: Date.now(),
            success: false
          });
        }
      });

      await Promise.all(agentTasks);

      // Verify results
      expect(completedOperations.length).toBe(agentCount);
      
      const successfulOperations = completedOperations.filter(op => op.success);
      const successRate = successfulOperations.length / agentCount;
      
      // With contention, we expect some failures but majority should succeed
      expect(successRate).toBeGreaterThan(0.7); // 70% minimum success rate
      
      // Verify resource state consistency
      for (const resourceId of sharedResources) {
        const resourceKey = `resource:${resourceId}`;
        const resourceState = await stateManager.getState(resourceKey);
        
        if (resourceState) {
          const usesForThisResource = successfulOperations.filter(
            op => op.resourceId === resourceId
          ).length;
          expect(resourceState.useCount).toBe(usesForThisResource);
        }
      }

      console.log(`64 agents competed for ${sharedResourceCount} resources`);
      console.log(`Success rate: ${(successRate * 100).toFixed(2)}%`);
      console.log(`Average operation time: ${(successfulOperations.reduce((sum, op) => sum + (op.endTime - op.startTime), 0) / successfulOperations.length).toFixed(2)}ms`);
    });
  });

  describe('ProcessPool Stress Testing', () => {
    it('should handle 32+ concurrent process spawns without degradation', async () => {
      const processCount = 40;
      const processes: Array<{
        id: string;
        startTime: number;
        endTime?: number;
        success: boolean;
        result?: any;
      }> = [];

      const processSpawns = Array.from({ length: processCount }, async (_, i) => {
        const processId = `stress-process-${i}`;
        const startTime = Date.now();
        
        try {
          const result = await processPool.execute({
            id: processId,
            command: 'node',
            args: ['-e', `
              const start = Date.now();
              let count = 0;
              while (Date.now() - start < 200) {
                count++;
              }
              console.log(JSON.stringify({ processId: '${processId}', iterations: count }));
            `],
            timeout: 5000,
            retries: 2
          });

          processes.push({
            id: processId,
            startTime,
            endTime: Date.now(),
            success: true,
            result
          });

          return result;
        } catch (error) {
          processes.push({
            id: processId,
            startTime,
            endTime: Date.now(),
            success: false
          });
          throw error;
        }
      });

      const results = await Promise.allSettled(processSpawns);
      
      // Verify process pool handled the load
      const successfulProcesses = results.filter(r => r.status === 'fulfilled');
      const failedProcesses = results.filter(r => r.status === 'rejected');
      
      const successRate = successfulProcesses.length / processCount;
      expect(successRate).toBeGreaterThan(0.9); // 90% success rate minimum
      
      // Check process pool health
      const poolStats = await processPool.getStats();
      expect(poolStats.activeProcesses).toBeLessThanOrEqual(32); // Should respect max limit
      expect(poolStats.queuedTasks).toBe(0); // All tasks should complete
      
      // Verify performance didn't degrade significantly
      const successfulProcessData = processes.filter(p => p.success);
      const averageExecutionTime = successfulProcessData.reduce(
        (sum, p) => sum + (p.endTime! - p.startTime), 0
      ) / successfulProcessData.length;
      
      expect(averageExecutionTime).toBeLessThan(10000); // Should complete within 10 seconds
      
      console.log(`Process pool handled ${processCount} concurrent processes`);
      console.log(`Success rate: ${(successRate * 100).toFixed(2)}%`);
      console.log(`Average execution time: ${averageExecutionTime.toFixed(2)}ms`);
      console.log(`Failed processes: ${failedProcesses.length}`);
    });

    it('should handle process failures and recovery under load', async () => {
      const reliableProcessCount = 20;
      const failingProcessCount = 10;
      
      // Mix of reliable and failing processes
      const allProcesses = [
        // Reliable processes
        ...Array.from({ length: reliableProcessCount }, (_, i) => ({
          id: `reliable-${i}`,
          shouldFail: false
        })),
        // Failing processes
        ...Array.from({ length: failingProcessCount }, (_, i) => ({
          id: `failing-${i}`,
          shouldFail: true
        }))
      ];

      // Shuffle to mix reliable and failing processes
      const shuffled = allProcesses.sort(() => Math.random() - 0.5);
      
      const processResults = await Promise.allSettled(
        shuffled.map(async ({ id, shouldFail }) => {
          if (shouldFail) {
            return processPool.execute({
              id,
              command: 'node',
              args: ['-e', 'process.exit(1)'], // Force failure
              timeout: 5000,
              retries: 1
            });
          } else {
            return processPool.execute({
              id,
              command: 'node',
              args: ['-e', `console.log('Success from ${id}')`],
              timeout: 5000,
              retries: 2
            });
          }
        })
      );
      
      const successful = processResults.filter(r => r.status === 'fulfilled');
      const failed = processResults.filter(r => r.status === 'rejected');
      
      // All reliable processes should succeed
      expect(successful.length).toBe(reliableProcessCount);
      // All failing processes should fail
      expect(failed.length).toBe(failingProcessCount);
      
      // Process pool should remain healthy despite failures
      const poolStats = await processPool.getStats();
      expect(poolStats.totalProcesses).toBeGreaterThan(0);
      expect(poolStats.failedProcesses).toBe(failingProcessCount);
      
      // Pool should recover and be ready for new processes
      const recoveryResult = await processPool.execute({
        id: 'recovery-test',
        command: 'node',
        args: ['-e', 'console.log("Recovery successful")'],
        timeout: 5000
      });
      
      expect(recoveryResult.success).toBe(true);
      
      console.log(`Process pool handled ${reliableProcessCount} reliable + ${failingProcessCount} failing processes`);
      console.log(`Pool recovered successfully after failures`);
    });
  });

  describe('Memory Coordination Under Load', () => {
    it('should maintain memory consistency with high concurrent access', async () => {
      const concurrentWriters = 32;
      const entriesPerWriter = 25;
      const sessionId = `stress-session-${Date.now()}`;
      
      const writerTasks = Array.from({ length: concurrentWriters }, async (_, writerIndex) => {
        const writerId = `writer-${writerIndex}`;
        const entries = [];
        
        for (let entryIndex = 0; entryIndex < entriesPerWriter; entryIndex++) {
          const entryId = `${writerId}-entry-${entryIndex}`;
          const entry = {
            id: entryId,
            agentId: writerId,
            sessionId,
            type: 'stress-test',
            content: `Content from ${writerId} entry ${entryIndex}`,
            context: {
              writerIndex,
              entryIndex,
              timestamp: Date.now(),
              concurrencyTest: true
            },
            timestamp: new Date(),
            tags: ['stress', 'concurrency', writerId],
            version: 1
          };
          
          try {
            await memoryManager.storeEntry(entry);
            entries.push(entryId);
            
            // Randomly perform reads and updates to increase contention
            if (Math.random() < 0.3) {
              const retrievedEntry = await memoryManager.getEntry(entryId);
              expect(retrievedEntry?.agentId).toBe(writerId);
            }
            
            if (Math.random() < 0.2) {
              await memoryManager.updateEntry(entryId, {
                ...entry,
                content: `Updated ${entry.content}`,
                version: 2
              });
            }
          } catch (error) {
            console.warn(`Failed to store entry ${entryId}:`, error.message);
          }
        }
        
        return { writerId, storedEntries: entries };
      });
      
      const writerResults = await Promise.all(writerTasks);
      
      // Verify all writers completed successfully
      expect(writerResults.length).toBe(concurrentWriters);
      
      const totalEntriesExpected = concurrentWriters * entriesPerWriter;
      const totalEntriesStored = writerResults.reduce(
        (sum, result) => sum + result.storedEntries.length, 0
      );
      
      // Should have high success rate for memory operations
      const storageSuccessRate = totalEntriesStored / totalEntriesExpected;
      expect(storageSuccessRate).toBeGreaterThan(0.95);
      
      // Verify memory consistency by querying all entries
      const allEntries = await memoryManager.queryEntries({
        sessionId,
        tags: ['stress'],
        limit: totalEntriesExpected + 100
      });
      
      expect(allEntries.length).toBe(totalEntriesStored);
      
      // Verify data integrity
      for (const result of writerResults) {
        const writerEntries = allEntries.filter(e => e.agentId === result.writerId);
        expect(writerEntries.length).toBe(result.storedEntries.length);
        
        // Check that each entry has correct metadata
        for (const entry of writerEntries) {
          expect(entry.sessionId).toBe(sessionId);
          expect(entry.type).toBe('stress-test');
          expect(entry.context.concurrencyTest).toBe(true);
        }
      }
      
      console.log(`Memory system handled ${totalEntriesStored}/${totalEntriesExpected} concurrent writes`);
      console.log(`Storage success rate: ${(storageSuccessRate * 100).toFixed(2)}%`);
    });

    it('should handle memory cleanup during concurrent operations', async () => {
      const activeWriters = 16;
      const cleanupInterval = 500; // 500ms
      const testDuration = 3000; // 3 seconds
      const sessionId = `cleanup-session-${Date.now()}`;
      
      let totalWritten = 0;
      let totalCleaned = 0;
      let cleanupErrors = 0;
      
      // Start continuous writers
      const writerPromises = Array.from({ length: activeWriters }, async (_, writerIndex) => {
        const writerId = `cleanup-writer-${writerIndex}`;
        let entryCount = 0;
        const startTime = Date.now();
        
        while (Date.now() - startTime < testDuration) {
          try {
            const entryId = `${writerId}-${entryCount++}`;
            await memoryManager.storeEntry({
              id: entryId,
              agentId: writerId,
              sessionId,
              type: 'temporary',
              content: `Temporary content ${entryCount}`,
              context: {
                temporary: true,
                writerIndex,
                createdAt: Date.now()
              },
              timestamp: new Date(),
              tags: ['temporary', 'cleanup-test'],
              version: 1
            });
            totalWritten++;
            
            // Small delay to prevent overwhelming the system
            await new Promise(resolve => setTimeout(resolve, 50));
          } catch (error) {
            console.warn(`Writer ${writerId} error:`, error.message);
          }
        }
        
        return writerId;
      });
      
      // Start periodic cleanup
      const cleanupPromise = (async () => {
        const startTime = Date.now();
        
        while (Date.now() - startTime < testDuration) {
          try {
            // Query and delete old temporary entries
            const oldEntries = await memoryManager.queryEntries({
              type: 'temporary',
              tags: ['cleanup-test'],
              limit: 100
            });
            
            const cutoffTime = Date.now() - 1000; // Delete entries older than 1 second
            const entriesToDelete = oldEntries.filter(
              entry => entry.context.createdAt < cutoffTime
            );
            
            for (const entry of entriesToDelete) {
              try {
                await memoryManager.deleteEntry(entry.id);
                totalCleaned++;
              } catch (error) {
                cleanupErrors++;
              }
            }
            
            await new Promise(resolve => setTimeout(resolve, cleanupInterval));
          } catch (error) {
            cleanupErrors++;
            await new Promise(resolve => setTimeout(resolve, cleanupInterval));
          }
        }
      })();
      
      // Wait for all operations to complete
      await Promise.all([...writerPromises, cleanupPromise]);
      
      // Verify system remained stable during concurrent write/cleanup
      expect(totalWritten).toBeGreaterThan(0);
      expect(totalCleaned).toBeGreaterThan(0);
      expect(cleanupErrors).toBeLessThan(totalCleaned * 0.1); // Less than 10% cleanup errors
      
      // Check final state
      const remainingEntries = await memoryManager.queryEntries({
        sessionId,
        tags: ['cleanup-test'],
        limit: 1000
      });
      
      // Should have successfully cleaned up most old entries
      expect(remainingEntries.length).toBeLessThan(totalWritten * 0.5);
      
      console.log(`Concurrent cleanup test: ${totalWritten} written, ${totalCleaned} cleaned, ${cleanupErrors} errors`);
      console.log(`Remaining entries: ${remainingEntries.length}`);
    });
  });

  describe('Swarm Operation Validation Framework', () => {
    it('should validate swarm operations under high agent load', async () => {
      const objectiveId = 'stress-objective-validation';
      const maxAgents = 48;
      const tasksPerAgent = 3;
      
      // Create a complex objective with many subtasks
      const objective = swarmCoordinator.createObjective({
        description: 'Stress test swarm coordination with high agent count',
        strategy: 'distributed',
        maxAgents,
        priority: 'high'
      });
      
      // Create agents with different capabilities
      const agents = Array.from({ length: maxAgents }, (_, i) => {
        const capabilities = [
          'compute',
          i % 3 === 0 ? 'analysis' : null,
          i % 4 === 0 ? 'storage' : null,
          i % 5 === 0 ? 'network' : null
        ].filter(Boolean);
        
        return swarmCoordinator.createAgent({
          id: `validation-agent-${i}`,
          name: `Validation Agent ${i}`,
          type: 'validation-worker',
          capabilities
        });
      });
      
      // Create tasks that require coordination
      const tasks = [];
      for (let agentIndex = 0; agentIndex < maxAgents; agentIndex++) {
        for (let taskIndex = 0; taskIndex < tasksPerAgent; taskIndex++) {
          const taskId = `task-${agentIndex}-${taskIndex}`;
          const task = swarmCoordinator.createTask({
            type: 'validation',
            description: `Validation task ${taskIndex} for agent ${agentIndex}`,
            priority: Math.floor(Math.random() * 5) + 1,
            requiredCapabilities: ['compute'],
            estimatedDuration: 200 + Math.random() * 300, // 200-500ms
            dependencies: taskIndex > 0 ? [`task-${agentIndex}-${taskIndex - 1}`] : []
          });
          tasks.push(task);
        }
      }
      
      objective.tasks = tasks;
      
      // Execute the objective with validation
      const startTime = Date.now();
      const executionPromise = swarmCoordinator.executeObjective(objective.id);
      
      // Monitor swarm health during execution
      const healthCheckInterval = setInterval(async () => {
        try {
          const swarmStatus = await swarmCoordinator.getSwarmStatus();
          expect(swarmStatus.activeAgents).toBeLessThanOrEqual(maxAgents);
          expect(swarmStatus.health).toBe('healthy');
        } catch (error) {
          console.warn('Health check failed:', error.message);
        }
      }, 500);
      
      try {
        await executionPromise;
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        clearInterval(healthCheckInterval);
        
        // Validate swarm execution results
        const finalStatus = await swarmCoordinator.getSwarmStatus();
        const completedTasks = tasks.filter(task => task.status === 'completed');
        const failedTasks = tasks.filter(task => task.status === 'failed');
        
        // Verify high completion rate
        const completionRate = completedTasks.length / tasks.length;
        expect(completionRate).toBeGreaterThan(0.9); // 90% completion rate
        
        // Verify agents are healthy
        const healthyAgents = agents.filter(agent => agent.status !== 'failed');
        expect(healthyAgents.length).toBeGreaterThan(maxAgents * 0.95); // 95% agent health
        
        // Validate task dependencies were respected
        for (const task of completedTasks) {
          if (task.dependencies.length > 0) {
            const dependencies = tasks.filter(t => task.dependencies.includes(t.id));
            const dependenciesCompleted = dependencies.every(dep => 
              dep.status === 'completed' && dep.completedAt! < task.completedAt!
            );
            expect(dependenciesCompleted).toBe(true);
          }
        }
        
        // Check resource utilization efficiency
        const agentMetrics = await Promise.all(
          agents.map(agent => swarmCoordinator.getAgentMetrics(agent.id))
        );
        
        const totalTasksCompleted = agentMetrics.reduce(
          (sum, metrics) => sum + metrics.tasksCompleted, 0
        );
        const averageTasksPerAgent = totalTasksCompleted / maxAgents;
        
        // Verify reasonable work distribution
        expect(averageTasksPerAgent).toBeGreaterThan(1);
        
        console.log(`Swarm validation: ${maxAgents} agents completed ${completedTasks.length}/${tasks.length} tasks in ${duration}ms`);
        console.log(`Completion rate: ${(completionRate * 100).toFixed(2)}%`);
        console.log(`Average tasks per agent: ${averageTasksPerAgent.toFixed(2)}`);
        console.log(`Failed tasks: ${failedTasks.length}`);
        
      } finally {
        clearInterval(healthCheckInterval);
      }
    });
  });
});
