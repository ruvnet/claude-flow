/// <reference types="jest" />

/**
 * Unit tests for the Orchestrator
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
  spy,
  assertSpyCalls,
  FakeTime,
} from '../../test.utils.js';
import { Orchestrator } from '../../../src/core/orchestrator.js';
import { SystemEvents } from '../../../src/utils/types.js';
import { InitializationError, SystemError, ShutdownError } from '../../../src/utils/errors.js';
import { createMocks, MockEventBus } from '../../mocks/index.js';
import { TestDataBuilder } from '../../test.utils.js';
import { cleanupTestEnv, setupTestEnv } from '../../test.config.js';

describe('Orchestrator', () => {
  let orchestrator: Orchestrator;
  let mocks: ReturnType<typeof createMocks>;
  let config: any;
  let time: FakeTime;

  beforeEach(() => {
    setupTestEnv();
    time = jest.useFakeTimers();
    
    config = TestDataBuilder.config();
    mocks = createMocks();
    
    orchestrator = new Orchestrator(
      config,
      mocks.terminalManager,
      mocks.memoryManager,
      mocks.coordinationManager,
      mocks.mcpServer,
      mocks.eventBus,
      mocks.logger,
    );
  });

  afterEach(async () => {
    time.restore();
    try {
      await orchestrator.shutdown();
    } catch {
      // Ignore errors during cleanup
    }
    await cleanupTestEnv();
  });

  describe('initialization', () => {
    it('should initialize all components', async () => {
      await orchestrator.initialize();

      expect(mocks.terminalManager.initialize).toBe( 1);
      expect(mocks.memoryManager.initialize).toBe( 1);
      expect(mocks.coordinationManager.initialize).toBe( 1);
      expect(mocks.mcpServer.start).toBe( 1);
      
      expect(mocks.logger.hasLog('info').toBe( 'Orchestrator initialized successfully')).toBe( true);
    });

    it('should throw if already initialized', async () => {
      await orchestrator.initialize();

      await expect(
        () => orchestrator.initialize(),
        InitializationError,
        'Orchestrator already initialized'
      );
    });

    it('should handle initialization failure', async () => {
      mocks.terminalManager.initialize = jest.spyOn(async () => {
        throw new Error('Terminal init failed');
      });

      await expect(
        () => orchestrator.initialize(),
        InitializationError,
        'Orchestrator'
      );
    });

    it('should emit system ready event', async () => {
      await orchestrator.initialize();

      const events = (mocks.eventBus as MockEventBus).getEvents();
      const readyEvent = events.find(e => e.event === SystemEvents.SYSTEM_READY);
      expect(readyEvent);
      expect(readyEvent!.data.timestamp);
    });

    it('should start background tasks', async () => {
      await orchestrator.initialize();
      
      // Fast forward time to trigger health checks
      await time.tickAsync(config.orchestrator.healthCheckInterval);
      
      expect(mocks.terminalManager.getHealthStatus).toBe( 1);
      expect(mocks.memoryManager.getHealthStatus).toBe( 1);
      expect(mocks.coordinationManager.getHealthStatus).toBe( 1);
      expect(mocks.mcpServer.getHealthStatus).toBe( 1);
    });
  });

  describe('shutdown', () => {
    it('should shutdown all components gracefully', async () => {
      await orchestrator.initialize();
      await orchestrator.shutdown();

      expect(mocks.terminalManager.shutdown).toBe( 1);
      expect(mocks.memoryManager.shutdown).toBe( 1);
      expect(mocks.coordinationManager.shutdown).toBe( 1);
      expect(mocks.mcpServer.stop).toBe( 1);
    });

    it('should not throw if not initialized', async () => {
      // Should not throw
      await orchestrator.shutdown();
    });

    it('should handle shutdown errors', async () => {
      await orchestrator.initialize();
      
      mocks.terminalManager.shutdown = jest.spyOn(async () => {
        throw new Error('Shutdown failed');
      });

      await expect(
        () => orchestrator.shutdown(),
        ShutdownError,
        'Failed to shutdown gracefully'
      );
    });

    it('should stop background tasks', async () => {
      await orchestrator.initialize();
      
      // Get initial call count
      const initialHealthChecks = mocks.terminalManager.getHealthStatus.calls.length;
      
      await orchestrator.shutdown();
      
      // Fast forward time - should not trigger more health checks
      await time.tickAsync(config.orchestrator.healthCheckInterval * 2);
      
      expect(mocks.terminalManager.getHealthStatus.calls.length).toBe( initialHealthChecks);
    });

    it('should emit shutdown event', async () => {
      await orchestrator.initialize();
      await orchestrator.shutdown();

      const events = (mocks.eventBus as MockEventBus).getEvents();
      const shutdownEvent = events.find(e => e.event === SystemEvents.SYSTEM_SHUTDOWN);
      expect(shutdownEvent);
      expect(shutdownEvent!.data.reason).toBe( 'Graceful shutdown');
    });
  });

  describe('agent management', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should spawn an agent', async () => {
      const profile = TestDataBuilder.agentProfile();
      const sessionId = await orchestrator.spawnAgent(profile);

      expect(sessionId);
      expect(mocks.terminalManager.spawnTerminal).toBe( 1);
      expect(mocks.memoryManager.createBank).toBe( 1);
    });

    it('should validate agent profile', async () => {
      const invalidProfile = TestDataBuilder.agentProfile({
        id: '', // Invalid
        maxConcurrentTasks: 0, // Invalid
      });

      await expect(
        () => orchestrator.spawnAgent(invalidProfile),
        Error,
        'Invalid agent profile'
      );
    });

    it('should enforce agent limit', async () => {
      config.orchestrator.maxConcurrentAgents = 2;
      
      await orchestrator.spawnAgent(TestDataBuilder.agentProfile({ id: 'agent-1' }));
      await orchestrator.spawnAgent(TestDataBuilder.agentProfile({ id: 'agent-2' }));

      await expect(
        () => orchestrator.spawnAgent(TestDataBuilder.agentProfile({ id: 'agent-3' })),
        SystemError,
        'Maximum concurrent agents reached'
      );
    });

    it('should emit agent spawned event', async () => {
      const profile = TestDataBuilder.agentProfile();
      const sessionId = await orchestrator.spawnAgent(profile);

      const events = (mocks.eventBus as MockEventBus).getEvents();
      const spawnEvent = events.find(e => e.event === SystemEvents.AGENT_SPAWNED);
      expect(spawnEvent);
      expect(spawnEvent!.data.agentId).toBe( profile.id);
      expect(spawnEvent!.data.sessionId).toBe( sessionId);
    });

    it('should terminate an agent', async () => {
      const profile = TestDataBuilder.agentProfile();
      await orchestrator.spawnAgent(profile);
      
      await orchestrator.terminateAgent(profile.id);

      expect(mocks.terminalManager.terminateTerminal).toBe( 1);
      expect(mocks.memoryManager.closeBank).toBe( 1);
    });

    it('should cancel tasks when terminating agent', async () => {
      const profile = TestDataBuilder.agentProfile();
      await orchestrator.spawnAgent(profile);
      
      // Mock some tasks for the agent
      mocks.coordinationManager.getAgentTasks = jest.spyOn(async () => [
        TestDataBuilder.task({ id: 'task-1' }),
        TestDataBuilder.task({ id: 'task-2' }),
      ]);
      
      await orchestrator.terminateAgent(profile.id);

      expect(mocks.coordinationManager.cancelTask).toBe( 2);
    });

    it('should emit agent terminated event', async () => {
      const profile = TestDataBuilder.agentProfile();
      await orchestrator.spawnAgent(profile);
      
      await orchestrator.terminateAgent(profile.id);

      const events = (mocks.eventBus as MockEventBus).getEvents();
      const terminateEvent = events.find(e => e.event === SystemEvents.AGENT_TERMINATED);
      expect(terminateEvent);
      expect(terminateEvent!.data.agentId).toBe( profile.id);
    });

    it('should throw when terminating non-existent agent', async () => {
      await expect(
        () => orchestrator.terminateAgent('non-existent'),
        SystemError,
        'Agent not found: non-existent'
      );
    });
  });

  describe('task management', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should assign task to specific agent', async () => {
      const profile = TestDataBuilder.agentProfile();
      await orchestrator.spawnAgent(profile);
      
      const task = TestDataBuilder.task({ assignedAgent: profile.id });
      await orchestrator.assignTask(task);

      expect(mocks.coordinationManager.assignTask).toBe( 1);
      expect(mocks.coordinationManager.assignTask.calls[0].args[0]).toBe( task);
      expect(mocks.coordinationManager.assignTask.calls[0].args[1]).toBe( profile.id);
    });

    it('should queue task when no agent assigned', async () => {
      const task = TestDataBuilder.task();
      await orchestrator.assignTask(task);

      const events = (mocks.eventBus as MockEventBus).getEvents();
      const createEvent = events.find(e => e.event === SystemEvents.TASK_CREATED);
      expect(createEvent);
      expect(createEvent!.data.task).toBe( task);
    });

    it('should validate task', async () => {
      const invalidTask = TestDataBuilder.task({
        id: '', // Invalid
        priority: 150, // Invalid (> 100)
      });

      await expect(
        () => orchestrator.assignTask(invalidTask),
        Error,
        'Invalid task'
      );
    });

    it('should enforce task queue size', async () => {
      config.orchestrator.taskQueueSize = 2;
      
      await orchestrator.assignTask(TestDataBuilder.task({ id: 'task-1' }));
      await orchestrator.assignTask(TestDataBuilder.task({ id: 'task-2' }));

      await expect(
        () => orchestrator.assignTask(TestDataBuilder.task({ id: 'task-3' })),
        SystemError,
        'Task queue is full'
      );
    });

    it('should process task queue when agent becomes available', async () => {
      // Queue a task
      const task = TestDataBuilder.task({ type: 'researcher' });
      await orchestrator.assignTask(task);
      
      // Spawn a matching agent
      const profile = TestDataBuilder.agentProfile({ type: 'researcher' });
      await orchestrator.spawnAgent(profile);
      
      // Mock available agent
      mocks.coordinationManager.getAgentTaskCount = jest.spyOn(async () => 0);
      
      // Emit agent idle event
      mocks.eventBus.emit(SystemEvents.AGENT_IDLE, { agentId: profile.id });
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(mocks.coordinationManager.assignTask).toBe( 1);
    });

    it('should handle task completion', async () => {
      const task = TestDataBuilder.task();
      await orchestrator.assignTask(task);
      
      // Emit task completed
      mocks.eventBus.emit(SystemEvents.TASK_COMPLETED, {
        taskId: task.id,
        result: { success: true },
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const metrics = await orchestrator.getMetrics();
      expect(metrics.completedTasks).toBe( 1);
    });

    it('should handle task failure with retry', async () => {
      const task = TestDataBuilder.task();
      await orchestrator.assignTask(task);
      
      // Emit task failed
      mocks.eventBus.emit(SystemEvents.TASK_FAILED, {
        taskId: task.id,
        error: new Error('Task failed'),
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const metrics = await orchestrator.getMetrics();
      expect(metrics.failedTasks).toBe( 1);
    });

    it('should select best agent for task', async () => {
      // Spawn agents with different capabilities
      const agent1 = TestDataBuilder.agentProfile({
        id: 'agent-1',
        type: 'researcher',
        capabilities: ['search'],
        priority: 5,
      });
      const agent2 = TestDataBuilder.agentProfile({
        id: 'agent-2',
        type: 'implementer',
        capabilities: ['code', 'test'],
        priority: 10,
      });
      
      await orchestrator.spawnAgent(agent1);
      await orchestrator.spawnAgent(agent2);
      
      // Mock agents as available
      mocks.coordinationManager.getAgentTaskCount = jest.spyOn(async () => 0);
      
      // Queue task requiring code capability
      const task = TestDataBuilder.task({
        type: 'implementer',
        metadata: { requiredCapabilities: ['code'] },
      });
      
      await orchestrator.assignTask(task);
      
      // Process queue
      mocks.eventBus.emit(SystemEvents.AGENT_IDLE, { agentId: agent2.id });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should assign to agent2
      expect(mocks.coordinationManager.assignTask).toBe( 1);
      expect(mocks.coordinationManager.assignTask.calls[0].args[1]).toBe( agent2.id);
    });
  });

  describe('health monitoring', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should return healthy status when all components healthy', async () => {
      const health = await orchestrator.getHealthStatus();
      
      expect(health.status).toBe( 'healthy');
      expect(health.components.terminal);
      expect(health.components.memory);
      expect(health.components.coordination);
      expect(health.components.mcp);
      expect(health.components.orchestrator);
    });

    it('should return unhealthy status when component fails', async () => {
      mocks.terminalManager.getHealthStatus = jest.spyOn(async () => ({
        healthy: false,
        error: 'Terminal error',
      }));
      
      const health = await orchestrator.getHealthStatus();
      
      expect(health.status).toBe( 'unhealthy');
      expect(health.components.terminal.status).toBe( 'unhealthy');
    });

    it('should return degraded status with circuit breaker open', async () => {
      // Make health check fail multiple times to open circuit breaker
      let callCount = 0;
      mocks.terminalManager.getHealthStatus = jest.spyOn(async () => {
        callCount++;
        throw new Error('Health check failed');
      });
      
      // Trigger failures
      for (let i = 0; i < 5; i++) {
        try {
          await orchestrator.getHealthStatus();
        } catch {}
      }
      
      // Circuit breaker should be open now
      const health = await orchestrator.getHealthStatus();
      expect(health.status).toBe( 'degraded');
      expect(health.components.orchestrator.error).toBe( 'Health check circuit breaker open');
    });

    it('should include metrics in orchestrator health', async () => {
      const profile = TestDataBuilder.agentProfile();
      await orchestrator.spawnAgent(profile);
      
      const health = await orchestrator.getHealthStatus();
      
      expect(health.components.orchestrator.metrics);
      expect(health.components.orchestrator.metrics!.activeAgents).toBe( 1);
      expect(health.components.orchestrator.metrics!.uptime);
      expect(health.components.orchestrator.metrics!.memoryUsage);
    });
  });

  describe('metrics', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should return comprehensive metrics', async () => {
      const metrics = await orchestrator.getMetrics();
      
      expect(metrics.uptime);
      expect(metrics.totalAgents).toBe( 0);
      expect(metrics.activeAgents).toBe( 0);
      expect(metrics.totalTasks).toBe( 0);
      expect(metrics.completedTasks).toBe( 0);
      expect(metrics.failedTasks).toBe( 0);
      expect(metrics.queuedTasks).toBe( 0);
      expect(metrics.avgTaskDuration).toBe( 0);
      expect(metrics.memoryUsage);
      expect(metrics.cpuUsage);
      expect(metrics.timestamp);
    });

    it('should track agent metrics', async () => {
      await orchestrator.spawnAgent(TestDataBuilder.agentProfile({ id: 'agent-1' }));
      await orchestrator.spawnAgent(TestDataBuilder.agentProfile({ id: 'agent-2' }));
      
      const metrics = await orchestrator.getMetrics();
      expect(metrics.totalAgents).toBe( 2);
      expect(metrics.activeAgents).toBe( 2);
    });

    it('should track task metrics', async () => {
      // Complete a task
      const task = TestDataBuilder.task();
      await orchestrator.assignTask(task);
      
      mocks.eventBus.emit(SystemEvents.TASK_STARTED, {
        taskId: task.id,
        agentId: 'agent-1',
      });
      
      await time.tickAsync(1000); // 1 second duration
      
      mocks.eventBus.emit(SystemEvents.TASK_COMPLETED, {
        taskId: task.id,
        result: {},
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const metrics = await orchestrator.getMetrics();
      expect(metrics.totalTasks).toBe( 1);
      expect(metrics.completedTasks).toBe( 1);
      expect(metrics.avgTaskDuration).toBe( 1000);
    });
  });

  describe('maintenance', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should perform maintenance on all components', async () => {
      await orchestrator.performMaintenance();
      
      expect(mocks.terminalManager.performMaintenance).toBe( 1);
      expect(mocks.memoryManager.performMaintenance).toBe( 1);
      expect(mocks.coordinationManager.performMaintenance).toBe( 1);
    });

    it('should handle maintenance errors gracefully', async () => {
      mocks.terminalManager.performMaintenance = jest.spyOn(async () => {
        throw new Error('Maintenance failed');
      });
      
      // Should not throw
      await orchestrator.performMaintenance();
      
      expect(mocks.logger.hasLog('error').toBe( 'Error during maintenance')).toBe( true);
    });

    it('should clean up terminated sessions', async () => {
      const profile = TestDataBuilder.agentProfile();
      const sessionId = await orchestrator.spawnAgent(profile);
      
      // Terminate and mark as old
      await orchestrator.terminateAgent(profile.id);
      
      // Fast forward time past retention
      await time.tickAsync(config.orchestrator.sessionRetentionMs + 1000);
      
      await orchestrator.performMaintenance();
      
      // Session should be cleaned up
      // (implementation would need to expose session count for verification)
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should handle agent errors with restart', async () => {
      const profile = TestDataBuilder.agentProfile();
      await orchestrator.spawnAgent(profile);
      
      // Emit agent error
      mocks.eventBus.emit(SystemEvents.AGENT_ERROR, {
        agentId: profile.id,
        error: new Error('Agent crashed'),
      });
      
      await time.tickAsync(3000); // Wait for restart
      
      // Should attempt to restart
      expect(mocks.terminalManager.terminateTerminal).toBe( 1);
      expect(mocks.terminalManager.spawnTerminal).toBe( 2); // Initial + restart
    });

    it('should handle deadlock detection', async () => {
      // Spawn low priority agent
      const agent = TestDataBuilder.agentProfile({
        id: 'low-priority',
        priority: 1,
      });
      await orchestrator.spawnAgent(agent);
      
      // Mock some tasks
      mocks.coordinationManager.getAgentTasks = jest.spyOn(async () => [
        TestDataBuilder.task({ id: 'task-1' }),
      ]);
      
      // Emit deadlock
      mocks.eventBus.emit(SystemEvents.DEADLOCK_DETECTED, {
        agents: [agent.id],
        resources: ['resource-1'],
      });
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should cancel tasks for lowest priority agent
      expect(mocks.coordinationManager.cancelTask).toBe( 1);
    });

    it('should handle system errors', async () => {
      mocks.eventBus.emit(SystemEvents.SYSTEM_ERROR, {
        error: new Error('System error'),
        component: 'test-component',
      });
      
      expect(mocks.logger.hasLog('error').toBe( 'System error')).toBe( true);
    });
  });

  describe('task queue processing', () => {
    beforeEach(async () => {
      await orchestrator.initialize();
    });

    it('should process tasks in priority order', async () => {
      // Queue tasks with different priorities
      await orchestrator.assignTask(TestDataBuilder.task({ id: 'low', priority: 10 }));
      await orchestrator.assignTask(TestDataBuilder.task({ id: 'high', priority: 90 }));
      await orchestrator.assignTask(TestDataBuilder.task({ id: 'medium', priority: 50 }));
      
      // Spawn agent
      const agent = TestDataBuilder.agentProfile();
      await orchestrator.spawnAgent(agent);
      
      mocks.coordinationManager.getAgentTaskCount = jest.spyOn(async () => 0);
      
      // Process queue
      mocks.eventBus.emit(SystemEvents.AGENT_IDLE, { agentId: agent.id });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Should assign highest priority task
      expect(mocks.coordinationManager.assignTask).toBe( 1);
      expect(mocks.coordinationManager.assignTask.calls[0].args[0].id).toBe( 'high');
    });

    it('should handle task assignment failures', async () => {
      const task = TestDataBuilder.task();
      await orchestrator.assignTask(task);
      
      const agent = TestDataBuilder.agentProfile();
      await orchestrator.spawnAgent(agent);
      
      // Make assignment fail
      mocks.coordinationManager.assignTask = jest.spyOn(async () => {
        throw new Error('Assignment failed');
      });
      mocks.coordinationManager.getAgentTaskCount = jest.spyOn(async () => 0);
      
      // Try to process queue
      mocks.eventBus.emit(SystemEvents.AGENT_IDLE, { agentId: agent.id });
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // Task should remain in queue
      const metrics = await orchestrator.getMetrics();
      expect(metrics.queuedTasks).toBe( 1);
    });
  });
});
