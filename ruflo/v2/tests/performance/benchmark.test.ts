/**
 * Performance Benchmark Tests for Claude Flow v2.0.0
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { SystemIntegration } from '../../integration/system-integration.js';
import { SwarmCoordinator } from '../../coordination/swarm-coordinator.js';
import { AgentManager } from '../../agents/agent-manager.js';
import { TaskEngine } from '../../task/engine.js';
import { MemoryManager } from '../../memory/manager.js';
import type { IntegrationConfig } from '../../integration/types.js';

// Performance test configuration
const PERFORMANCE_CONFIG: IntegrationConfig = {
  logLevel: 'warn', // Reduce logging for performance tests
  environment: 'testing',
  monitoring: {
    enabled: false, // Disable monitoring to reduce overhead
    metrics: false,
    realTime: false
  }
};

describe('Performance Benchmark Tests', () => {
  let systemIntegration: SystemIntegration;
  let swarmCoordinator: SwarmCoordinator;
  let agentManager: AgentManager;
  let taskEngine: TaskEngine;
  let memoryManager: MemoryManager;

  beforeEach(async () => {
    systemIntegration = SystemIntegration.getInstance();
    await systemIntegration.initialize(PERFORMANCE_CONFIG);

    swarmCoordinator = systemIntegration.getComponent<SwarmCoordinator>('swarmCoordinator')!;
    agentManager = systemIntegration.getComponent<AgentManager>('agentManager')!;
    taskEngine = systemIntegration.getComponent<TaskEngine>('taskEngine')!;
    memoryManager = systemIntegration.getComponent<MemoryManager>('memoryManager')!;
  });

  afterEach(async () => {
    await systemIntegration.shutdown();
  });

  describe('System Initialization Performance', () => {
    it('should initialize system within acceptable time', async () => {
      // Shutdown current system
      await systemIntegration.shutdown();

      const startTime = performance.now();
      await systemIntegration.initialize(PERFORMANCE_CONFIG);
      const endTime = performance.now();

      const initTime = endTime - startTime;
      
      expect(initTime).toBeLessThan(5000); // Should initialize in under 5 seconds
      expect(systemIntegration.isReady()).toBe(true);
      
      console.log(`System initialization time: ${initTime.toFixed(2)}ms`);
    });

    it('should handle multiple rapid initializations', async () => {
      const iterations = 5;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        await systemIntegration.shutdown();
        
        const startTime = performance.now();
        await systemIntegration.initialize(PERFORMANCE_CONFIG);
        const endTime = performance.now();
        
        times.push(endTime - startTime);
      }

      const averageTime = times.reduce((sum, time) => sum + time, 0) / times.length;
      const maxTime = Math.max(...times);
      
      expect(averageTime).toBeLessThan(3000);
      expect(maxTime).toBeLessThan(7000);
      
      console.log(`Average init time: ${averageTime.toFixed(2)}ms, Max: ${maxTime.toFixed(2)}ms`);
    });
  });

  describe('Agent Management Performance', () => {
    it('should spawn agents efficiently', async () => {
      const agentCount = 100;
      const agents: string[] = [];
      
      const startTime = performance.now();
      
      // Spawn agents in parallel
      const spawnPromises = Array.from({ length: agentCount }, (_, i) =>
        agentManager.spawnAgent('researcher', {
          name: `Agent-${i}`,
          capabilities: ['research', 'analysis']
        })
      );
      
      const spawnedAgents = await Promise.all(spawnPromises);
      const endTime = performance.now();
      
      const spawnTime = endTime - startTime;
      const agentsPerSecond = (agentCount / spawnTime) * 1000;
      
      expect(spawnedAgents).toHaveLength(agentCount);
      expect(spawnTime).toBeLessThan(10000); // Should complete in under 10 seconds
      expect(agentsPerSecond).toBeGreaterThan(10); // At least 10 agents per second
      
      console.log(`Spawned ${agentCount} agents in ${spawnTime.toFixed(2)}ms (${agentsPerSecond.toFixed(2)} agents/sec)`);
      
      agents.push(...spawnedAgents);
    });

    it('should handle agent communication efficiently', async () => {
      // Spawn test agents
      const agent1 = await agentManager.spawnAgent('coordinator', { name: 'Coordinator' });
      const agent2 = await agentManager.spawnAgent('researcher', { name: 'Researcher' });
      
      const messageCount = 1000;
      const startTime = performance.now();
      
      // Send many messages
      const messagePromises = Array.from({ length: messageCount }, (_, i) =>
        agentManager.sendMessage({
          from: agent1,
          to: agent2,
          type: 'request',
          data: { index: i, task: 'benchmark test' }
        })
      );
      
      await Promise.all(messagePromises);
      const endTime = performance.now();
      
      const messageTime = endTime - startTime;
      const messagesPerSecond = (messageCount / messageTime) * 1000;
      
      expect(messageTime).toBeLessThan(5000); // Should complete in under 5 seconds
      expect(messagesPerSecond).toBeGreaterThan(200); // At least 200 messages per second
      
      console.log(`Sent ${messageCount} messages in ${messageTime.toFixed(2)}ms (${messagesPerSecond.toFixed(2)} msg/sec)`);
    });

    it('should scale agent listing efficiently', async () => {
      // Spawn many agents
      const agentCount = 500;
      const spawnPromises = Array.from({ length: agentCount }, (_, i) =>
        agentManager.spawnAgent('coder', { name: `Coder-${i}` })
      );
      
      await Promise.all(spawnPromises);
      
      // Benchmark agent listing
      const iterations = 100;
      const times: number[] = [];
      
      for (let i = 0; i < iterations; i++) {
        const startTime = performance.now();
        const agents = await agentManager.listAgents();
        const endTime = performance.now();
        
        times.push(endTime - startTime);
        expect(agents.length).toBeGreaterThanOrEqual(agentCount);
      }
      
      const averageTime = times.reduce((sum, time) => sum + time, 0) / times.length;
      const maxTime = Math.max(...times);
      
      expect(averageTime).toBeLessThan(50); // Should average under 50ms
      expect(maxTime).toBeLessThan(200); // Max should be under 200ms
      
      console.log(`Agent listing: avg ${averageTime.toFixed(2)}ms, max ${maxTime.toFixed(2)}ms`);
    });
  });

  describe('Swarm Coordination Performance', () => {
    it('should create swarms efficiently', async () => {
      const swarmCount = 50;
      const startTime = performance.now();
      
      const swarmPromises = Array.from({ length: swarmCount }, (_, i) =>
        swarmCoordinator.createSwarm({
          objective: `Benchmark swarm ${i}`,
          strategy: 'auto',
          topology: 'mesh',
          maxAgents: 5
        })
      );
      
      const swarms = await Promise.all(swarmPromises);
      const endTime = performance.now();
      
      const creationTime = endTime - startTime;
      const swarmsPerSecond = (swarmCount / creationTime) * 1000;
      
      expect(swarms).toHaveLength(swarmCount);
      expect(creationTime).toBeLessThan(15000); // Should complete in under 15 seconds
      expect(swarmsPerSecond).toBeGreaterThan(3); // At least 3 swarms per second
      
      console.log(`Created ${swarmCount} swarms in ${creationTime.toFixed(2)}ms (${swarmsPerSecond.toFixed(2)} swarms/sec)`);
    });

    it('should handle large swarm coordination', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Large swarm performance test',
        strategy: 'development',
        topology: 'distributed',
        maxAgents: 100
      });
      
      const agentCount = 80;
      const startTime = performance.now();
      
      // Spawn many agents in the swarm
      const agentPromises = Array.from({ length: agentCount }, (_, i) =>
        swarmCoordinator.spawnAgentInSwarm(swarmId, {
          type: ['researcher', 'coder', 'analyst', 'tester'][i % 4],
          name: `SwarmAgent-${i}`,
          capabilities: ['general']
        })
      );
      
      const agents = await Promise.all(agentPromises);
      const endTime = performance.now();
      
      const spawnTime = endTime - startTime;
      
      expect(agents).toHaveLength(agentCount);
      expect(spawnTime).toBeLessThan(20000); // Should complete in under 20 seconds
      
      // Test swarm status retrieval performance
      const statusStartTime = performance.now();
      const swarmStatus = await swarmCoordinator.getSwarmStatus(swarmId);
      const statusEndTime = performance.now();
      
      const statusTime = statusEndTime - statusStartTime;
      
      expect(swarmStatus.agents).toHaveLength(agentCount);
      expect(statusTime).toBeLessThan(500); // Status retrieval should be fast
      
      console.log(`Large swarm (${agentCount} agents): spawn ${spawnTime.toFixed(2)}ms, status ${statusTime.toFixed(2)}ms`);
    });
  });

  describe('Task Engine Performance', () => {
    it('should handle high task throughput', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Task throughput test',
        strategy: 'development',
        topology: 'mesh',
        maxAgents: 20
      });
      
      // Spawn agents for task execution
      const agents = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          swarmCoordinator.spawnAgentInSwarm(swarmId, {
            type: 'coder',
            name: `TaskAgent-${i}`
          })
        )
      );
      
      const taskCount = 1000;
      const startTime = performance.now();
      
      // Create many tasks
      const taskPromises = Array.from({ length: taskCount }, (_, i) =>
        taskEngine.createTask({
          swarmId,
          type: 'development',
          objective: `Task ${i}`,
          assignedAgents: [agents[i % agents.length]],
          priority: 'medium'
        })
      );
      
      const tasks = await Promise.all(taskPromises);
      const endTime = performance.now();
      
      const creationTime = endTime - startTime;
      const tasksPerSecond = (taskCount / creationTime) * 1000;
      
      expect(tasks).toHaveLength(taskCount);
      expect(creationTime).toBeLessThan(30000); // Should complete in under 30 seconds
      expect(tasksPerSecond).toBeGreaterThan(30); // At least 30 tasks per second
      
      console.log(`Created ${taskCount} tasks in ${creationTime.toFixed(2)}ms (${tasksPerSecond.toFixed(2)} tasks/sec)`);
    });

    it('should efficiently query task status', async () => {
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'Task query performance test',
        strategy: 'auto',
        topology: 'centralized',
        maxAgents: 5
      });
      
      const agent = await swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: 'coder',
        name: 'QueryTestAgent'
      });
      
      // Create many tasks
      const taskCount = 200;
      const tasks = await Promise.all(
        Array.from({ length: taskCount }, (_, i) =>
          taskEngine.createTask({
            swarmId,
            type: 'development',
            objective: `Query test task ${i}`,
            assignedAgents: [agent],
            priority: 'low'
          })
        )
      );
      
      // Benchmark task status queries
      const queryIterations = 100;
      const queryTimes: number[] = [];
      
      for (let i = 0; i < queryIterations; i++) {
        const randomTaskId = tasks[Math.floor(Math.random() * tasks.length)];
        
        const startTime = performance.now();
        const status = await taskEngine.getTaskStatus(randomTaskId);
        const endTime = performance.now();
        
        queryTimes.push(endTime - startTime);
        expect(status.id).toBe(randomTaskId);
      }
      
      const averageQueryTime = queryTimes.reduce((sum, time) => sum + time, 0) / queryTimes.length;
      const maxQueryTime = Math.max(...queryTimes);
      
      expect(averageQueryTime).toBeLessThan(20); // Average under 20ms
      expect(maxQueryTime).toBeLessThan(100); // Max under 100ms
      
      console.log(`Task queries: avg ${averageQueryTime.toFixed(2)}ms, max ${maxQueryTime.toFixed(2)}ms`);
    });
  });

  describe('Memory Performance', () => {
    it('should handle high-frequency memory operations', async () => {
      const operationCount = 10000;
      const keys = Array.from({ length: operationCount }, (_, i) => `perf-test-${i}`);
      const values = keys.map(key => ({ key, data: `value-${key}`, timestamp: Date.now() }));
      
      // Benchmark SET operations
      const setStartTime = performance.now();
      await Promise.all(
        keys.map((key, i) => memoryManager.set(key, values[i]))
      );
      const setEndTime = performance.now();
      
      const setTime = setEndTime - setStartTime;
      const setsPerSecond = (operationCount / setTime) * 1000;
      
      expect(setTime).toBeLessThan(10000); // Should complete in under 10 seconds
      expect(setsPerSecond).toBeGreaterThan(1000); // At least 1000 sets per second
      
      // Benchmark GET operations
      const getStartTime = performance.now();
      const retrievedValues = await Promise.all(
        keys.map(key => memoryManager.get(key))
      );
      const getEndTime = performance.now();
      
      const getTime = getEndTime - getStartTime;
      const getsPerSecond = (operationCount / getTime) * 1000;
      
      expect(retrievedValues).toHaveLength(operationCount);
      expect(getTime).toBeLessThan(5000); // Should complete in under 5 seconds
      expect(getsPerSecond).toBeGreaterThan(2000); // At least 2000 gets per second
      
      console.log(`Memory ops: ${setsPerSecond.toFixed(0)} sets/sec, ${getsPerSecond.toFixed(0)} gets/sec`);
    });

    it('should efficiently handle pattern queries', async () => {
      // Setup test data with patterns
      const patterns = ['user:', 'task:', 'swarm:', 'agent:', 'config:'];
      const itemsPerPattern = 1000;
      
      for (const pattern of patterns) {
        const promises = Array.from({ length: itemsPerPattern }, (_, i) =>
          memoryManager.set(`${pattern}${i}`, { pattern, index: i, data: `test-data-${i}` })
        );
        await Promise.all(promises);
      }
      
      // Benchmark pattern queries
      const queryIterations = 50;
      const queryTimes: number[] = [];
      
      for (let i = 0; i < queryIterations; i++) {
        const randomPattern = patterns[Math.floor(Math.random() * patterns.length)];
        
        const startTime = performance.now();
        const keys = await memoryManager.keys(`${randomPattern}*`);
        const endTime = performance.now();
        
        queryTimes.push(endTime - startTime);
        expect(keys.length).toBe(itemsPerPattern);
      }
      
      const averageQueryTime = queryTimes.reduce((sum, time) => sum + time, 0) / queryTimes.length;
      const maxQueryTime = Math.max(...queryTimes);
      
      expect(averageQueryTime).toBeLessThan(100); // Average under 100ms
      expect(maxQueryTime).toBeLessThan(500); // Max under 500ms
      
      console.log(`Pattern queries: avg ${averageQueryTime.toFixed(2)}ms, max ${maxQueryTime.toFixed(2)}ms`);
    });
  });

  describe('End-to-End Performance', () => {
    it('should handle complete workflow efficiently', async () => {
      const startTime = performance.now();
      
      // Create swarm
      const swarmId = await swarmCoordinator.createSwarm({
        objective: 'End-to-end performance test',
        strategy: 'development',
        topology: 'hierarchical',
        maxAgents: 15
      });
      
      // Spawn coordinated agents
      const agents = await Promise.all([
        swarmCoordinator.spawnAgentInSwarm(swarmId, { type: 'coordinator', name: 'Coordinator' }),
        swarmCoordinator.spawnAgentInSwarm(swarmId, { type: 'researcher', name: 'Researcher' }),
        swarmCoordinator.spawnAgentInSwarm(swarmId, { type: 'coder', name: 'Developer-1' }),
        swarmCoordinator.spawnAgentInSwarm(swarmId, { type: 'coder', name: 'Developer-2' }),
        swarmCoordinator.spawnAgentInSwarm(swarmId, { type: 'tester', name: 'Tester' }),
        swarmCoordinator.spawnAgentInSwarm(swarmId, { type: 'reviewer', name: 'Reviewer' })
      ]);
      
      // Create workflow tasks
      const researchTask = await taskEngine.createTask({
        swarmId,
        type: 'research',
        objective: 'Research requirements',
        assignedAgents: [agents[1]],
        priority: 'high'
      });
      
      const developmentTasks = await Promise.all([
        taskEngine.createTask({
          swarmId,
          type: 'development',
          objective: 'Develop module A',
          dependencies: [researchTask],
          assignedAgents: [agents[2]],
          priority: 'high'
        }),
        taskEngine.createTask({
          swarmId,
          type: 'development',
          objective: 'Develop module B',
          dependencies: [researchTask],
          assignedAgents: [agents[3]],
          priority: 'high'
        })
      ]);
      
      const testingTask = await taskEngine.createTask({
        swarmId,
        type: 'testing',
        objective: 'Test integrated modules',
        dependencies: developmentTasks,
        assignedAgents: [agents[4]],
        priority: 'medium'
      });
      
      const reviewTask = await taskEngine.createTask({
        swarmId,
        type: 'review',
        objective: 'Review final implementation',
        dependencies: [testingTask],
        assignedAgents: [agents[5]],
        priority: 'medium'
      });
      
      // Store shared memory
      await memoryManager.set(`swarm:${swarmId}:workflow`, {
        tasks: [researchTask, ...developmentTasks, testingTask, reviewTask],
        agents: agents,
        status: 'active'
      });
      
      // Get final status
      const swarmStatus = await swarmCoordinator.getSwarmStatus(swarmId);
      const workflowData = await memoryManager.get(`swarm:${swarmId}:workflow`);
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      expect(swarmStatus.agents).toHaveLength(6);
      expect(workflowData.tasks).toHaveLength(5);
      expect(totalTime).toBeLessThan(15000); // Should complete in under 15 seconds
      
      console.log(`Complete workflow setup: ${totalTime.toFixed(2)}ms`);
    });

    it('should maintain performance under load', async () => {
      const concurrentSwarms = 10;
      const agentsPerSwarm = 8;
      const tasksPerSwarm = 12;
      
      const startTime = performance.now();
      
      // Create multiple swarms concurrently
      const swarmPromises = Array.from({ length: concurrentSwarms }, (_, i) =>
        swarmCoordinator.createSwarm({
          objective: `Load test swarm ${i}`,
          strategy: 'auto',
          topology: 'mesh',
          maxAgents: agentsPerSwarm
        })
      );
      
      const swarms = await Promise.all(swarmPromises);
      
      // Spawn agents in all swarms
      const allAgentPromises = swarms.flatMap(swarmId =>
        Array.from({ length: agentsPerSwarm }, (_, i) =>
          swarmCoordinator.spawnAgentInSwarm(swarmId, {
            type: ['researcher', 'coder', 'analyst', 'tester'][i % 4],
            name: `LoadAgent-${i}`,
            capabilities: ['general']
          })
        )
      );
      
      const allAgents = await Promise.all(allAgentPromises);
      
      // Create tasks in all swarms
      const allTaskPromises = swarms.flatMap((swarmId, swarmIndex) => {
        const swarmAgents = allAgents.slice(
          swarmIndex * agentsPerSwarm,
          (swarmIndex + 1) * agentsPerSwarm
        );
        
        return Array.from({ length: tasksPerSwarm }, (_, i) =>
          taskEngine.createTask({
            swarmId,
            type: 'development',
            objective: `Load test task ${i}`,
            assignedAgents: [swarmAgents[i % swarmAgents.length]],
            priority: 'medium'
          })
        );
      });
      
      const allTasks = await Promise.all(allTaskPromises);
      
      const endTime = performance.now();
      const totalTime = endTime - startTime;
      
      const totalAgents = concurrentSwarms * agentsPerSwarm;
      const totalTasks = concurrentSwarms * tasksPerSwarm;
      
      expect(allAgents).toHaveLength(totalAgents);
      expect(allTasks).toHaveLength(totalTasks);
      expect(totalTime).toBeLessThan(60000); // Should complete in under 60 seconds
      
      console.log(`Load test: ${concurrentSwarms} swarms, ${totalAgents} agents, ${totalTasks} tasks in ${totalTime.toFixed(2)}ms`);
    });
  });
});