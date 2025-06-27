/// <reference types="jest" />

/**
 * Comprehensive unit tests for Coordination System
 * Tests deadlock detection, task scheduling, and resource management
 */

import { CoordinationManager } from '../../../src/coordination/manager.js';
import { TaskScheduler } from '../../../src/coordination/scheduler.js';
import { ResourceManager } from '../../../src/coordination/resources.js';
import { ConflictResolver } from '../../../src/coordination/conflict-resolution.js';
import { CircuitBreaker } from '../../../src/coordination/circuit-breaker.js';
import { WorkStealingScheduler } from '../../../src/coordination/work-stealing.js';
import { DependencyGraph } from '../../../src/coordination/dependency-graph.js';
import { AdvancedScheduler } from '../../../src/coordination/advanced-scheduler.js';
import { 
  AsyncTestUtils, 
  MemoryTestUtils, 
  PerformanceTestUtils,
  TestAssertions,
  MockFactory 
} from '../../utils/test-utils.js';
import { generateCoordinationTasks, generateErrorScenarios } from '../../fixtures/generators.js';
import { setupTestEnv, cleanupTestEnv, TEST_CONFIG } from '../../test.config.js';

describe('Coordination System - Comprehensive Tests', () => {
  let coordinationManager: CoordinationManager;
  let scheduler: TaskScheduler;
  let resourceManager: ResourceManager;
  let conflictResolver: ConflictResolver;
  let fakeTime: FakeTime;

  beforeEach(() => {
    setupTestEnv();
    
    resourceManager = new ResourceManager({
      maxConcurrentTasks: 10,
      maxMemoryUsage: 1024 * 1024 * 100, // 100MB
      resourceTimeout: 30000,
    });

    scheduler = new TaskScheduler({
      maxConcurrentTasks: 5,
      taskTimeout: 10000,
      retryAttempts: 3,
    });

    conflictResolver = new ConflictResolver({
      enableConflictDetection: true,
      resolutionStrategy: 'priority',
    });

    coordinationManager = new CoordinationManager({
      scheduler,
      resourceManager,
      conflictResolver,
    });

    fakeTime = jest.useFakeTimers();
  });

  afterEach(async () => {
    jest.useRealTimers();
    await cleanupTestEnv();
  });

  describe('Task Scheduling', () => {
    beforeEach(async () => {
      await coordinationManager.initialize();
    });

    it('should schedule tasks with correct priority', async () => {
      const tasks = [
        { id: 'low-1', priority: 'low', execute: jest.fn(async () => 'low-1') },
        { id: 'high-1', priority: 'critical', execute: jest.fn(async () => 'high-1') },
        { id: 'medium-1', priority: 'medium', execute: jest.fn(async () => 'medium-1') },
        { id: 'high-2', priority: 'high', execute: jest.fn(async () => 'high-2') },
      ];

      // Submit all tasks
      const promises = tasks.map(task => 
        coordinationManager.submitTask(task.id, task)
      );

      const results = await Promise.all(promises);
      
      // Verify all tasks completed
      expect(results.length).toBe( 4);
      tasks.forEach(task => {
        expect(task.execute.calls.length).toBe( 1);
      });
    });

    it('should handle task dependencies correctly', async () => {
      const executionOrder: string[] = [];
      
      const tasks = [
        {
          id: 'task-a',
          dependencies: [],
          execute: jest.fn(async () => {
            await AsyncTestUtils.delay(10);
            executionOrder.push('task-a');
            return 'a';
          }),
        },
        {
          id: 'task-b',
          dependencies: ['task-a'],
          execute: jest.fn(async () => {
            await AsyncTestUtils.delay(10);
            executionOrder.push('task-b');
            return 'b';
          }),
        },
        {
          id: 'task-c',
          dependencies: ['task-a', 'task-b'],
          execute: jest.fn(async () => {
            await AsyncTestUtils.delay(10);
            executionOrder.push('task-c');
            return 'c';
          }),
        },
      ];

      // Submit tasks in random order
      const promises = [
        coordinationManager.submitTask('task-c', tasks[2]),
        coordinationManager.submitTask('task-a', tasks[0]),
        coordinationManager.submitTask('task-b', tasks[1]),
      ];

      await Promise.all(promises);
      
      // Verify execution order respected dependencies
      expect(executionOrder[0]).toBe( 'task-a');
      expect(executionOrder[1]).toBe( 'task-b');
      expect(executionOrder[2]).toBe( 'task-c');
    });

    it('should detect and handle circular dependencies', async () => {
      const tasks = [
        { id: 'task-x', dependencies: ['task-y'], execute: jest.spyOn() },
        { id: 'task-y', dependencies: ['task-z'], execute: jest.spyOn() },
        { id: 'task-z', dependencies: ['task-x'], execute: jest.spyOn() },
      ];

      // Submit tasks with circular dependencies
      const promises = tasks.map(task => 
        coordinationManager.submitTask(task.id, task)
      );

      // Should detect circular dependency and reject
      const results = await Promise.allSettled(promises);
      const failures = results.filter(r => r.status === 'rejected');
      
      expect(failures.length >= 1).toBe( true);
      
      // Verify circular dependency was detected
      const error = failures[0] as PromiseRejectedResult;
      expect(error.reason.message.includes('circular')).toBe( true);
    });

    it('should handle task timeouts correctly', async () => {
      const longRunningTask = {
        id: 'long-task',
        timeout: 100, // 100ms timeout
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(200); // Take 200ms
          return 'should not complete';
        }),
      };

      await TestAssertions.assertThrowsAsync(
        () => coordinationManager.submitTask('long-task', longRunningTask),
        Error,
        'timeout'
      );
    });

    it('should handle concurrent task submission', async () => {
      const tasks = generateCoordinationTasks(20);
      
      const promises = tasks.map(task => 
        coordinationManager.submitTask(task.id, {
          execute: jest.fn(async () => `result-${task.id}`),
          priority: task.priority,
        })
      );

      const results = await Promise.all(promises);
      
      expect(results.length).toBe( 20);
      results.forEach((result, i) => {
        expect(result).toBe( `result-${tasks[i].id}`);
      });
    });

    it('should respect concurrency limits', async () => {
      const limitedScheduler = new TaskScheduler({
        maxConcurrentTasks: 2, // Only 2 concurrent tasks
        taskTimeout: 10000,
      });

      const limitedManager = new CoordinationManager({
        scheduler: limitedScheduler,
        resourceManager,
        conflictResolver,
      });

      await limitedManager.initialize();

      let activeTasks = 0;
      let maxActiveTasks = 0;

      const tasks = Array.from({ length: 10 }, (_, i) => ({
        id: `limited-${i}`,
        execute: jest.fn(async () => {
          activeTasks++;
          maxActiveTasks = Math.max(maxActiveTasks, activeTasks);
          await AsyncTestUtils.delay(50);
          activeTasks--;
          return `result-${i}`;
        }),
      }));

      const promises = tasks.map(task => 
        limitedManager.submitTask(task.id, task)
      );

      await Promise.all(promises);
      
      // Should never exceed the concurrency limit
      TestAssertions.assertInRange(maxActiveTasks, 1, 2);
    });
  });

  describe('Deadlock Detection and Prevention', () => {
    beforeEach(async () => {
      await coordinationManager.initialize();
    });

    it('should detect simple deadlocks', async () => {
      const resourceLocks = new Map<string, string>();
      
      const task1 = {
        id: 'deadlock-1',
        requiredResources: ['resource-a', 'resource-b'],
        execute: jest.fn(async () => {
          resourceLocks.set('resource-a', 'deadlock-1');
          await AsyncTestUtils.delay(50);
          resourceLocks.set('resource-b', 'deadlock-1');
          return 'task1-complete';
        }),
      };

      const task2 = {
        id: 'deadlock-2',
        requiredResources: ['resource-b', 'resource-a'],
        execute: jest.fn(async () => {
          resourceLocks.set('resource-b', 'deadlock-2');
          await AsyncTestUtils.delay(50);
          resourceLocks.set('resource-a', 'deadlock-2');
          return 'task2-complete';
        }),
      };

      // Submit both tasks simultaneously
      const promises = [
        coordinationManager.submitTask('deadlock-1', task1),
        coordinationManager.submitTask('deadlock-2', task2),
      ];

      const results = await Promise.allSettled(promises);
      
      // At least one should be prevented/resolved
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');
      
      // Deadlock detection should prevent both from hanging
      expect(successes.length + failures.length).toBe( 2);
    });

    it('should prevent resource starvation', async () => {
      const highPriorityTasks = Array.from({ length: 5 }, (_, i) => ({
        id: `high-${i}`,
        priority: 'critical',
        requiredResources: ['shared-resource'],
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(100);
          return `high-${i}`;
        }),
      }));

      const lowPriorityTask = {
        id: 'low-priority',
        priority: 'low',
        requiredResources: ['shared-resource'],
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(10);
          return 'low-priority-complete';
        }),
      };

      // Submit low priority task first
      const lowPromise = coordinationManager.submitTask('low-priority', lowPriorityTask);
      
      // Then submit high priority tasks
      const highPromises = highPriorityTasks.map(task => 
        coordinationManager.submitTask(task.id, task)
      );

      await AsyncTestUtils.delay(20); // Let low priority task get a chance

      const allResults = await Promise.allSettled([lowPromise, ...highPromises]);
      const successes = allResults.filter(r => r.status === 'fulfilled');
      
      // Low priority task should eventually complete (no starvation)
      expect(successes.length).toBe( 6);
      expect(lowPriorityTask.execute.calls.length).toBe( 1);
    });

    it('should handle complex dependency chains without deadlock', async () => {
      // Create a complex but non-circular dependency graph
      const tasks = [
        { id: 'root', dependencies: [], execute: jest.fn(async () => 'root') },
        { id: 'branch-1', dependencies: ['root'], execute: jest.fn(async () => 'branch-1') },
        { id: 'branch-2', dependencies: ['root'], execute: jest.fn(async () => 'branch-2') },
        { id: 'merge-1', dependencies: ['branch-1', 'branch-2'], execute: jest.fn(async () => 'merge-1') },
        { id: 'leaf-1', dependencies: ['merge-1'], execute: jest.fn(async () => 'leaf-1') },
        { id: 'leaf-2', dependencies: ['merge-1'], execute: jest.fn(async () => 'leaf-2') },
        { id: 'final', dependencies: ['leaf-1', 'leaf-2'], execute: jest.fn(async () => 'final') },
      ];

      const promises = tasks.map(task => 
        coordinationManager.submitTask(task.id, task)
      );

      const results = await Promise.all(promises);
      
      expect(results.length).toBe( 7);
      tasks.forEach(task => {
        expect(task.execute.calls.length).toBe( 1);
      });
    });

    it('should recover from deadlock through timeout', async () => {
      const deadlockTimeout = 1000; // 1 second
      
      const task1 = {
        id: 'timeout-deadlock-1',
        requiredResources: ['resource-x'],
        timeout: deadlockTimeout,
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(2000); // Longer than timeout
          return 'should-not-complete';
        }),
      };

      const task2 = {
        id: 'timeout-deadlock-2',
        requiredResources: ['resource-x'],
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(100);
          return 'task2-complete';
        }),
      };

      const promises = [
        coordinationManager.submitTask('timeout-deadlock-1', task1),
        coordinationManager.submitTask('timeout-deadlock-2', task2),
      ];

      const results = await Promise.allSettled(promises);
      
      // First task should timeout, second should complete
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');
      
      expect(successes.length >= 1).toBe( true);
      expect(failures.length >= 1).toBe( true);
    });
  });

  describe('Resource Management', () => {
    beforeEach(async () => {
      await coordinationManager.initialize();
    });

    it('should track resource usage correctly', async () => {
      const tasks = Array.from({ length: 5 }, (_, i) => ({
        id: `resource-task-${i}`,
        requiredResources: [`cpu-${i % 2}`, 'memory'],
        estimatedMemoryUsage: 1024 * 1024 * 10, // 10MB
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(100);
          return `task-${i}`;
        }),
      }));

      const promises = tasks.map(task => 
        coordinationManager.submitTask(task.id, task)
      );

      // Check resource usage during execution
      await AsyncTestUtils.delay(50);
      
      const resourceStatus = await resourceManager.getResourceStatus();
      expect(resourceStatus);
      
      // Should track active resource usage
      expect(typeof resourceStatus.memoryUsage).toBe( 'number');
      expect(typeof resourceStatus.activeResources).toBe( 'object');

      await Promise.all(promises);
    });

    it('should enforce memory limits', async () => {
      const limitedResourceManager = new ResourceManager({
        maxMemoryUsage: 1024 * 1024 * 50, // 50MB limit
        resourceTimeout: 30000,
      });

      const limitedManager = new CoordinationManager({
        scheduler,
        resourceManager: limitedResourceManager,
        conflictResolver,
      });

      await limitedManager.initialize();

      const memoryHeavyTask = {
        id: 'memory-heavy',
        estimatedMemoryUsage: 1024 * 1024 * 100, // 100MB (exceeds limit)
        execute: jest.fn(async () => 'should-not-run'),
      };

      await TestAssertions.assertThrowsAsync(
        () => limitedManager.submitTask('memory-heavy', memoryHeavyTask),
        Error,
        'memory'
      );
    });

    it('should handle resource conflicts correctly', async () => {
      const sharedResource = 'exclusive-resource';
      
      const tasks = Array.from({ length: 3 }, (_, i) => ({
        id: `conflict-task-${i}`,
        requiredResources: [sharedResource],
        resourceMode: 'exclusive',
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(100);
          return `task-${i}`;
        }),
      }));

      const promises = tasks.map(task => 
        coordinationManager.submitTask(task.id, task)
      );

      const results = await Promise.all(promises);
      
      // All tasks should complete, but serialized due to exclusive resource
      expect(results.length).toBe( 3);
      tasks.forEach(task => {
        expect(task.execute.calls.length).toBe( 1);
      });
    });

    it('should support resource sharing', async () => {
      const sharedResource = 'shared-resource';
      
      const tasks = Array.from({ length: 3 }, (_, i) => ({
        id: `shared-task-${i}`,
        requiredResources: [sharedResource],
        resourceMode: 'shared',
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(50);
          return `shared-${i}`;
        }),
      }));

      const startTime = Date.now();
      
      const promises = tasks.map(task => 
        coordinationManager.submitTask(task.id, task)
      );

      await Promise.all(promises);
      
      const duration = Date.now() - startTime;
      
      // Should complete faster than serialized execution (less than 150ms vs 150ms+)
      TestAssertions.assertInRange(duration, 0, 120);
    });

    it('should handle resource cleanup on task failure', async () => {
      const failingTask = {
        id: 'failing-task',
        requiredResources: ['cleanup-resource'],
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(50);
          throw new Error('Task failed');
        }),
      };

      const followupTask = {
        id: 'followup-task',
        requiredResources: ['cleanup-resource'],
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(10);
          return 'followup-complete';
        }),
      };

      // First task should fail
      await TestAssertions.assertThrowsAsync(
        () => coordinationManager.submitTask('failing-task', failingTask),
        Error,
        'Task failed'
      );

      // Resource should be cleaned up and available for next task
      const result = await coordinationManager.submitTask('followup-task', followupTask);
      expect(result).toBe( 'followup-complete');
    });
  });

  describe('Conflict Resolution', () => {
    beforeEach(async () => {
      await coordinationManager.initialize();
    });

    it('should resolve priority conflicts correctly', async () => {
      const conflictingTasks = [
        {
          id: 'low-priority-conflict',
          priority: 'low',
          requiredResources: ['conflict-resource'],
          execute: jest.fn(async () => {
            await AsyncTestUtils.delay(100);
            return 'low-priority';
          }),
        },
        {
          id: 'high-priority-conflict',
          priority: 'critical',
          requiredResources: ['conflict-resource'],
          execute: jest.fn(async () => {
            await AsyncTestUtils.delay(50);
            return 'high-priority';
          }),
        },
      ];

      const promises = conflictingTasks.map(task => 
        coordinationManager.submitTask(task.id, task)
      );

      const results = await Promise.all(promises);
      
      // Both should complete, high priority first
      expect(results.length).toBe( 2);
      expect(results.includes('high-priority')).toBe( true);
      expect(results.includes('low-priority')).toBe( true);
    });

    it('should handle timestamp-based conflict resolution', async () => {
      const timestampResolver = new ConflictResolver({
        enableConflictDetection: true,
        resolutionStrategy: 'timestamp',
      });

      const timestampManager = new CoordinationManager({
        scheduler,
        resourceManager,
        conflictResolver: timestampResolver,
      });

      await timestampManager.initialize();

      const firstTask = {
        id: 'first-timestamp',
        requiredResources: ['timestamp-resource'],
        execute: jest.fn(async () => 'first'),
      };

      const secondTask = {
        id: 'second-timestamp',
        requiredResources: ['timestamp-resource'],
        execute: jest.fn(async () => 'second'),
      };

      // Submit with slight delay to ensure different timestamps
      const firstPromise = timestampManager.submitTask('first-timestamp', firstTask);
      await AsyncTestUtils.delay(5);
      const secondPromise = timestampManager.submitTask('second-timestamp', secondTask);

      const results = await Promise.all([firstPromise, secondPromise]);
      
      // First submitted should win
      expect(results[0]).toBe( 'first');
      expect(results[1]).toBe( 'second');
    });

    it('should handle conflict escalation', async () => {
      const escalationTasks = Array.from({ length: 5 }, (_, i) => ({
        id: `escalation-${i}`,
        priority: 'medium',
        requiredResources: ['escalation-resource'],
        maxWaitTime: 200,
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(100);
          return `escalation-${i}`;
        }),
      }));

      const promises = escalationTasks.map((task, i) => {
        // Stagger submissions to create queue
        return AsyncTestUtils.delay(i * 10).then(() => 
          coordinationManager.submitTask(task.id, task)
        );
      });

      const results = await Promise.all(promises);
      
      // All tasks should complete despite conflicts
      expect(results.length).toBe( 5);
      escalationTasks.forEach(task => {
        expect(task.execute.calls.length).toBe( 1);
      });
    });

    it('should detect and resolve nested conflicts', async () => {
      const nestedConflictTasks = [
        {
          id: 'nested-1',
          requiredResources: ['resource-a', 'resource-b'],
          execute: jest.fn(async () => {
            await AsyncTestUtils.delay(50);
            return 'nested-1';
          }),
        },
        {
          id: 'nested-2',
          requiredResources: ['resource-b', 'resource-c'],
          execute: jest.fn(async () => {
            await AsyncTestUtils.delay(50);
            return 'nested-2';
          }),
        },
        {
          id: 'nested-3',
          requiredResources: ['resource-c', 'resource-a'],
          execute: jest.fn(async () => {
            await AsyncTestUtils.delay(50);
            return 'nested-3';
          }),
        },
      ];

      const promises = nestedConflictTasks.map(task => 
        coordinationManager.submitTask(task.id, task)
      );

      const results = await Promise.all(promises);
      
      // Should resolve conflicts and complete all tasks
      expect(results.length).toBe( 3);
      nestedConflictTasks.forEach(task => {
        expect(task.execute.calls.length).toBe( 1);
      });
    });
  });

  describe('Advanced Scheduling Features', () => {
    let advancedScheduler: AdvancedScheduler;
    let workStealingScheduler: WorkStealingScheduler;

    beforeEach(async () => {
      advancedScheduler = new AdvancedScheduler({
        enableWorkStealing: true,
        enablePriorityAging: true,
        enableLoadBalancing: true,
      });

      workStealingScheduler = new WorkStealingScheduler({
        maxWorkersPerQueue: 3,
        stealingThreshold: 2,
        balancingInterval: 100,
      });
    });

    it('should support work stealing between queues', async () => {
      await workStealingScheduler.initialize();

      // Create tasks for multiple agents/workers
      const agentTasks = {
        'agent-1': Array.from({ length: 10 }, (_, i) => ({
          id: `agent1-task-${i}`,
          execute: jest.fn(async () => {
            await AsyncTestUtils.delay(20);
            return `agent1-${i}`;
          }),
        })),
        'agent-2': Array.from({ length: 2 }, (_, i) => ({
          id: `agent2-task-${i}`,
          execute: jest.fn(async () => {
            await AsyncTestUtils.delay(20);
            return `agent2-${i}`;
          }),
        })),
      };

      // Submit tasks to different agent queues
      const promises: Promise<any>[] = [];
      
      for (const [agentId, tasks] of Object.entries(agentTasks)) {
        for (const task of tasks) {
          promises.push(workStealingScheduler.submitTask(agentId, task.id, task));
        }
      }

      const results = await Promise.all(promises);
      
      // All tasks should complete
      expect(results.length).toBe( 12);
      
      // Work stealing should have balanced the load
      const agent1Results = results.filter(r => r.startsWith('agent1'));
      const agent2Results = results.filter(r => r.startsWith('agent2'));
      
      expect(agent1Results.length).toBe( 10);
      expect(agent2Results.length).toBe( 2);
    });

    it('should implement priority aging', async () => {
      await advancedScheduler.initialize();

      const oldLowPriorityTask = {
        id: 'old-low',
        priority: 'low',
        submittedAt: Date.now() - 60000, // 1 minute ago
        execute: jest.fn(async () => 'old-low-priority'),
      };

      const newHighPriorityTask = {
        id: 'new-high',
        priority: 'high',
        submittedAt: Date.now(),
        execute: jest.fn(async () => 'new-high-priority'),
      };

      // Submit in order that would normally favor high priority
      const promises = [
        advancedScheduler.submitTask('old-low', oldLowPriorityTask),
        advancedScheduler.submitTask('new-high', newHighPriorityTask),
      ];

      const results = await Promise.all(promises);
      
      // Priority aging should eventually elevate old low priority task
      expect(results.length).toBe( 2);
      expect(oldLowPriorityTask.execute.calls.length).toBe( 1);
      expect(newHighPriorityTask.execute.calls.length).toBe( 1);
    });

    it('should support dynamic priority adjustment', async () => {
      await advancedScheduler.initialize();

      const adjustableTask = {
        id: 'adjustable',
        priority: 'low',
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(100);
          return 'adjustable-complete';
        }),
      };

      // Submit task
      const taskPromise = advancedScheduler.submitTask('adjustable', adjustableTask);
      
      // Adjust priority after submission
      await AsyncTestUtils.delay(10);
      await advancedScheduler.adjustTaskPriority('adjustable', 'critical');

      const result = await taskPromise;
      expect(result).toBe( 'adjustable-complete');
    });

    it('should handle load balancing across multiple schedulers', async () => {
      const schedulers = Array.from({ length: 3 }, () => new AdvancedScheduler({
        enableLoadBalancing: true,
      }));

      await Promise.all(schedulers.map(s => s.initialize()));

      // Create uneven task distribution
      const tasks = Array.from({ length: 30 }, (_, i) => ({
        id: `balance-task-${i}`,
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(50);
          return `task-${i}`;
        }),
      }));

      // Submit all tasks to first scheduler
      const promises = tasks.map(task => 
        schedulers[0].submitTask(task.id, task)
      );

      const results = await Promise.all(promises);
      
      // Load balancing should distribute tasks across schedulers
      expect(results.length).toBe( 30);
      tasks.forEach(task => {
        expect(task.execute.calls.length).toBe( 1);
      });
    });
  });

  describe('Performance and Scalability', () => {
    beforeEach(async () => {
      await coordinationManager.initialize();
    });

    it('should handle high task submission throughput', async () => {
      const { stats } = await PerformanceTestUtils.benchmark(
        async () => {
          const taskId = `perf-task-${Date.now()}-${Math.random()}`;
          return coordinationManager.submitTask(taskId, {
            execute: async () => 'quick-task',
          });
        },
        { iterations: 200, concurrency: 10 }
      );

      TestAssertions.assertInRange(stats.mean, 0, 50); // Should be fast
      console.log(`Task submission performance: ${stats.mean.toFixed(2)}ms average`);
    });

    it('should scale with large numbers of tasks', async () => {
      const largeBatch = Array.from({ length: 1000 }, (_, i) => ({
        id: `scale-task-${i}`,
        execute: jest.fn(async () => `result-${i}`),
      }));

      const startTime = Date.now();
      
      const promises = largeBatch.map(task => 
        coordinationManager.submitTask(task.id, task)
      );

      const results = await Promise.all(promises);
      
      const duration = Date.now() - startTime;
      
      expect(results.length).toBe( 1000);
      TestAssertions.assertInRange(duration, 0, 10000); // Should complete within 10 seconds
      
      console.log(`Large batch (1000 tasks) completed in ${duration}ms`);
    });

    it('should maintain performance under memory pressure', async () => {
      const { leaked } = await MemoryTestUtils.checkMemoryLeak(async () => {
        // Submit many tasks with varying resource requirements
        const tasks = Array.from({ length: 500 }, (_, i) => ({
          id: `memory-task-${i}`,
          estimatedMemoryUsage: 1024 * 100, // 100KB each
          execute: jest.fn(async () => {
            // Simulate some memory usage
            const data = new Array(100).fill(i);
            await AsyncTestUtils.delay(5);
            return data.length;
          }),
        }));

        const promises = tasks.map(task => 
          coordinationManager.submitTask(task.id, task)
        );

        await Promise.all(promises);
      });

      expect(leaked).toBe( false);
    });

    it('should handle load testing scenario', async () => {
      const results = await PerformanceTestUtils.loadTest(
        async () => {
          const taskId = `load-task-${Date.now()}-${Math.random()}`;
          return coordinationManager.submitTask(taskId, {
            execute: async () => 'load-test-result',
          });
        },
        {
          duration: 5000, // 5 seconds
          maxConcurrency: 20,
          requestsPerSecond: 50,
        }
      );

      TestAssertions.assertInRange(results.successfulRequests / results.totalRequests, 0.95, 1.0);
      TestAssertions.assertInRange(results.averageResponseTime, 0, 100);
      
      console.log(`Load test: ${results.successfulRequests}/${results.totalRequests} successful`);
    });
  });

  describe('Error Handling and Recovery', () => {
    beforeEach(async () => {
      await coordinationManager.initialize();
    });

    it('should handle task execution failures gracefully', async () => {
      const errorScenarios = generateErrorScenarios();
      
      for (const scenario of errorScenarios) {
        const failingTask = {
          id: `error-task-${scenario.name}`,
          execute: jest.fn(async () => {
            throw scenario.error;
          }),
        };

        if (scenario.recoverable) {
          // Should retry recoverable errors
          try {
            await coordinationManager.submitTask(`error-task-${scenario.name}`, failingTask);
          } catch (error) {
            // May still fail after retries
            expect(error);
          }
        } else {
          // Should fail fast for non-recoverable errors
          await TestAssertions.assertThrowsAsync(
            () => coordinationManager.submitTask(`error-task-${scenario.name}`, failingTask),
            Error,
            scenario.error.message
          );
        }
      }
    });

    it('should recover from scheduler failures', async () => {
      // Simulate scheduler failure
      const originalSubmit = scheduler.submit.bind(scheduler);
      let failureCount = 0;
      
      scheduler.submit = jest.fn(async (...args) => {
        failureCount++;
        if (failureCount <= 2) {
          throw new Error('Scheduler temporarily unavailable');
        }
        return originalSubmit(...args);
      });

      const resilientTask = {
        id: 'resilient-task',
        execute: jest.fn(async () => 'recovered'),
      };

      // Should eventually succeed after scheduler recovers
      const result = await coordinationManager.submitTask('resilient-task', resilientTask);
      expect(result).toBe( 'recovered');
      expect(failureCount).toBe( 3);
    });

    it('should handle resource manager failures', async () => {
      // Simulate resource manager failure
      const originalAcquire = resourceManager.acquireResources.bind(resourceManager);
      let attempts = 0;
      
      resourceManager.acquireResources = jest.fn(async (...args) => {
        attempts++;
        if (attempts <= 1) {
          throw new Error('Resource manager failure');
        }
        return originalAcquire(...args);
      });

      const resourceTask = {
        id: 'resource-task',
        requiredResources: ['test-resource'],
        execute: jest.fn(async () => 'resource-task-complete'),
      };

      // Should recover from resource manager failure
      const result = await coordinationManager.submitTask('resource-task', resourceTask);
      expect(result).toBe( 'resource-task-complete');
    });

    it('should handle partial system failures', async () => {
      // Create a scenario where some components fail
      const partiallyFailingTasks = Array.from({ length: 10 }, (_, i) => ({
        id: `partial-${i}`,
        execute: jest.fn(async () => {
          if (i % 3 === 0) {
            throw new Error(`Task ${i} failed`);
          }
          return `success-${i}`;
        }),
      }));

      const results = await Promise.allSettled(
        partiallyFailingTasks.map(task => 
          coordinationManager.submitTask(task.id, task)
        )
      );

      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');
      
      // Should have partial success
      expect(successes.length).toBe( 7); // 7 out of 10 should succeed
      expect(failures.length).toBe( 3);
      
      // System should remain functional
      const healthStatus = await coordinationManager.getHealthStatus();
      expect(healthStatus.healthy).toBe( true);
    });

    it('should implement circuit breaker pattern', async () => {
      const circuitBreaker = new CircuitBreaker('test-circuit', {
        threshold: 3,
        timeout: 1000,
        resetTimeout: 2000,
      });

      let failureCount = 0;
      const flakyService = async () => {
        failureCount++;
        if (failureCount <= 5) {
          throw new Error('Service failure');
        }
        return 'service-success';
      };

      // Trigger circuit breaker opening
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(flakyService);
        } catch (error) {
          // Expected failures
        }
      }

      // Circuit should be open now
      expect(circuitBreaker.getState().state).toBe( 'open');

      // Should fail fast while open
      await TestAssertions.assertThrowsAsync(
        () => circuitBreaker.execute(flakyService),
        Error,
        'Circuit breaker test-circuit is open'
      );

      // Wait for reset timeout
      await AsyncTestUtils.delay(2100);

      // Should succeed after circuit resets
      const result = await circuitBreaker.execute(flakyService);
      expect(result).toBe( 'service-success');
    });
  });

  describe('Monitoring and Metrics', () => {
    beforeEach(async () => {
      await coordinationManager.initialize();
    });

    it('should track execution metrics', async () => {
      const tasks = Array.from({ length: 10 }, (_, i) => ({
        id: `metric-task-${i}`,
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(10 + i * 5); // Variable execution time
          return `metric-${i}`;
        }),
      }));

      await Promise.all(
        tasks.map(task => coordinationManager.submitTask(task.id, task))
      );

      const metrics = await coordinationManager.getMetrics();
      
      expect(metrics);
      expect(typeof metrics.totalTasksSubmitted).toBe( 'number');
      expect(typeof metrics.totalTasksCompleted).toBe( 'number');
      expect(typeof metrics.averageExecutionTime).toBe( 'number');
      expect(typeof metrics.currentActiveTasks).toBe( 'number');
      
      expect(metrics.totalTasksCompleted).toBe( 10);
      TestAssertions.assertInRange(metrics.averageExecutionTime, 10, 100);
    });

    it('should track resource utilization metrics', async () => {
      const resourceIntensiveTasks = Array.from({ length: 5 }, (_, i) => ({
        id: `resource-metric-${i}`,
        requiredResources: [`cpu-${i % 2}`, 'memory'],
        estimatedMemoryUsage: 1024 * 1024 * (i + 1), // Variable memory usage
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(50);
          return `resource-${i}`;
        }),
      }));

      await Promise.all(
        resourceIntensiveTasks.map(task => 
          coordinationManager.submitTask(task.id, task)
        )
      );

      const resourceMetrics = await resourceManager.getMetrics();
      
      expect(resourceMetrics);
      expect(typeof resourceMetrics.peakMemoryUsage).toBe( 'number');
      expect(typeof resourceMetrics.averageMemoryUsage).toBe( 'number');
      expect(typeof resourceMetrics.resourceUtilization).toBe( 'object');
    });

    it('should provide health status information', async () => {
      const healthStatus = await coordinationManager.getHealthStatus();
      
      expect(healthStatus);
      expect(typeof healthStatus.healthy).toBe( 'boolean');
      expect(typeof healthStatus.components).toBe( 'object');
      
      // Check individual component health
      expect(typeof healthStatus.components.scheduler).toBe( 'object');
      expect(typeof healthStatus.components.resourceManager).toBe( 'object');
      expect(typeof healthStatus.components.conflictResolver).toBe( 'object');
    });

    it('should detect performance degradation', async () => {
      // Create a scenario that causes performance degradation
      const slowTasks = Array.from({ length: 20 }, (_, i) => ({
        id: `slow-task-${i}`,
        execute: jest.fn(async () => {
          await AsyncTestUtils.delay(200 + i * 10); // Progressively slower
          return `slow-${i}`;
        }),
      }));

      const startTime = Date.now();
      
      await Promise.all(
        slowTasks.map(task => coordinationManager.submitTask(task.id, task))
      );

      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      const performanceMetrics = await coordinationManager.getPerformanceMetrics();
      
      expect(performanceMetrics);
      expect(typeof performanceMetrics.throughput).toBe( 'number');
      expect(typeof performanceMetrics.latency).toBe( 'object');
      
      // Should detect degradation in throughput
      TestAssertions.assertInRange(performanceMetrics.throughput, 0.01, 1.0); // tasks per ms
    });
  });
});
