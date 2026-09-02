/**
 * UnifiedSwarmCoordinator Tests
 * Comprehensive tests for the unified swarm coordination system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UnifiedSwarmCoordinator, createUnifiedSwarmCoordinator } from '../src/unified-coordinator.js';
import type {
  AgentState,
  TaskDefinition,
  CoordinatorConfig,
  AgentType,
  TaskType,
  TaskPriority,
} from '../src/types.js';

describe('UnifiedSwarmCoordinator', () => {
  let coordinator: UnifiedSwarmCoordinator;

  beforeEach(async () => {
    coordinator = createUnifiedSwarmCoordinator({
      maxAgents: 20,
      maxTasks: 100,
      heartbeatIntervalMs: 1000,
      healthCheckIntervalMs: 2000,
      taskTimeoutMs: 10000,
      topology: {
        type: 'hierarchical',
        maxAgents: 20,
      },
      consensus: {
        algorithm: 'raft',
        threshold: 0.66,
        timeoutMs: 5000,
        maxRounds: 5,
        requireQuorum: true,
      },
    });

    await coordinator.initialize();
  });

  afterEach(async () => {
    await coordinator.shutdown();
  });

  describe('Initialization', () => {
    it('should initialize successfully', () => {
      const state = coordinator.getState();
      expect(state.status).toBe('running');
      expect(state.id).toBeDefined();
      expect(state.id.id).toContain('swarm_');
    });

    it('should create default configuration', () => {
      const state = coordinator.getState();
      expect(state.topology.type).toBe('hierarchical');
      expect(state.agents.size).toBe(0);
      expect(state.tasks.size).toBe(0);
    });

    it('should initialize with mesh topology', async () => {
      const meshCoordinator = createUnifiedSwarmCoordinator({
        topology: { type: 'mesh', maxAgents: 10 },
      });
      await meshCoordinator.initialize();

      expect(meshCoordinator.getTopology()).toBe('mesh');

      await meshCoordinator.shutdown();
    });
  });

  describe('Agent Registration', () => {
    it('should register a new agent', async () => {
      const agentData: Omit<AgentState, 'id'> = {
        name: 'test-agent-1',
        type: 'coder',
        status: 'idle',
        capabilities: createTestCapabilities(),
        metrics: createTestMetrics(),
        workload: 0,
        health: 1.0,
        lastHeartbeat: new Date(),
        topologyRole: 'worker',
        connections: [],
      };

      const agentId = await coordinator.registerAgent(agentData);

      expect(agentId).toBeDefined();
      expect(agentId).toContain('agent_');

      const agent = coordinator.getAgent(agentId);
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('test-agent-1');
      expect(agent?.type).toBe('coder');
    });

    it('should register multiple agents', async () => {
      const agentTypes: AgentType[] = ['coder', 'tester', 'reviewer'];
      const agentIds: string[] = [];

      for (const type of agentTypes) {
        const agentData: Omit<AgentState, 'id'> = {
          name: `agent-${type}`,
          type,
          status: 'idle',
          capabilities: createTestCapabilities(),
          metrics: createTestMetrics(),
          workload: 0,
          health: 1.0,
          lastHeartbeat: new Date(),
          topologyRole: 'worker',
          connections: [],
        };

        const id = await coordinator.registerAgent(agentData);
        agentIds.push(id);
      }

      expect(agentIds).toHaveLength(3);
      expect(coordinator.getAllAgents()).toHaveLength(3);
    });

    it('should throw error when max agents reached', async () => {
      const smallCoordinator = createUnifiedSwarmCoordinator({
        maxAgents: 2,
      });
      await smallCoordinator.initialize();

      // Register 2 agents
      for (let i = 0; i < 2; i++) {
        await smallCoordinator.registerAgent({
          name: `agent-${i}`,
          type: 'worker',
          status: 'idle',
          capabilities: createTestCapabilities(),
          metrics: createTestMetrics(),
          workload: 0,
          health: 1.0,
          lastHeartbeat: new Date(),
          topologyRole: 'worker',
          connections: [],
        });
      }

      // Third should fail
      await expect(
        smallCoordinator.registerAgent({
          name: 'agent-overflow',
          type: 'worker',
          status: 'idle',
          capabilities: createTestCapabilities(),
          metrics: createTestMetrics(),
          workload: 0,
          health: 1.0,
          lastHeartbeat: new Date(),
          topologyRole: 'worker',
          connections: [],
        })
      ).rejects.toThrow('Maximum agents');

      await smallCoordinator.shutdown();
    });

    it('should unregister an agent', async () => {
      const agentId = await coordinator.registerAgent({
        name: 'temporary-agent',
        type: 'worker',
        status: 'idle',
        capabilities: createTestCapabilities(),
        metrics: createTestMetrics(),
        workload: 0,
        health: 1.0,
        lastHeartbeat: new Date(),
        topologyRole: 'worker',
        connections: [],
      });

      expect(coordinator.getAgent(agentId)).toBeDefined();

      await coordinator.unregisterAgent(agentId);

      expect(coordinator.getAgent(agentId)).toBeUndefined();
    });
  });

  describe('Task Management', () => {
    let agentId: string;

    beforeEach(async () => {
      agentId = await coordinator.registerAgent({
        name: 'worker-agent',
        type: 'coder',
        status: 'idle',
        capabilities: createTestCapabilities(),
        metrics: createTestMetrics(),
        workload: 0,
        health: 1.0,
        lastHeartbeat: new Date(),
        topologyRole: 'worker',
        connections: [],
      });
    });

    it('should submit a new task', async () => {
      const taskData: Omit<TaskDefinition, 'id' | 'status' | 'createdAt'> = {
        type: 'coding',
        name: 'Test Task',
        description: 'A test coding task',
        priority: 'normal',
        dependencies: [],
        input: { code: 'console.log("test")' },
        timeoutMs: 5000,
        retries: 0,
        maxRetries: 3,
        metadata: {},
      };

      const taskId = await coordinator.submitTask(taskData);

      expect(taskId).toBeDefined();
      expect(taskId).toContain('task_');

      const task = coordinator.getTask(taskId);
      expect(task).toBeDefined();
      expect(task?.name).toBe('Test Task');
      expect(task?.status).toBe('assigned');
    });

    it('should assign task to available agent', async () => {
      const taskId = await coordinator.submitTask({
        type: 'coding',
        name: 'Code Task',
        description: 'Task for coder',
        priority: 'high',
        dependencies: [],
        input: {},
        timeoutMs: 5000,
        retries: 0,
        maxRetries: 3,
        metadata: {},
      });

      const task = coordinator.getTask(taskId);
      expect(task?.assignedTo).toBeDefined();
      expect(task?.assignedTo?.id).toBe(agentId);

      const agent = coordinator.getAgent(agentId);
      expect(agent?.status).toBe('busy');
      expect(agent?.currentTask?.id).toBe(taskId);
    });

    it('should cancel a task', async () => {
      const taskId = await coordinator.submitTask({
        type: 'testing',
        name: 'Test Task',
        description: 'Task to cancel',
        priority: 'normal',
        dependencies: [],
        input: {},
        timeoutMs: 5000,
        retries: 0,
        maxRetries: 3,
        metadata: {},
      });

      await coordinator.cancelTask(taskId);

      const task = coordinator.getTask(taskId);
      expect(task?.status).toBe('cancelled');

      const agent = coordinator.getAgent(agentId);
      expect(agent?.status).toBe('idle');
      expect(agent?.currentTask).toBeUndefined();
    });

    it('should get tasks by status', async () => {
      await coordinator.submitTask({
        type: 'coding',
        name: 'Task 1',
        description: 'First task',
        priority: 'normal',
        dependencies: [],
        input: {},
        timeoutMs: 5000,
        retries: 0,
        maxRetries: 3,
        metadata: {},
      });

      const assignedTasks = coordinator.getTasksByStatus('assigned');
      expect(assignedTasks).toHaveLength(1);
    });
  });

  describe('Topology Management', () => {
    it('should maintain hierarchical topology', async () => {
      // Register queen
      const queenId = await coordinator.registerAgent({
        name: 'queen-agent',
        type: 'queen',
        status: 'idle',
        capabilities: createTestCapabilities(),
        metrics: createTestMetrics(),
        workload: 0,
        health: 1.0,
        lastHeartbeat: new Date(),
        topologyRole: 'queen',
        connections: [],
      });

      // Register workers
      const worker1Id = await coordinator.registerAgent({
        name: 'worker-1',
        type: 'worker',
        status: 'idle',
        capabilities: createTestCapabilities(),
        metrics: createTestMetrics(),
        workload: 0,
        health: 1.0,
        lastHeartbeat: new Date(),
        topologyRole: 'worker',
        connections: [],
      });

      const state = coordinator.getState();
      expect(state.topology.nodes).toHaveLength(2);

      const queen = state.topology.nodes.find(n => n.role === 'queen');
      expect(queen).toBeDefined();
      expect(queen?.agentId).toBe(queenId);
    });

    it('should change topology type', () => {
      coordinator.setTopology('mesh');
      expect(coordinator.getTopology()).toBe('mesh');

      coordinator.setTopology('centralized');
      expect(coordinator.getTopology()).toBe('centralized');
    });
  });

  describe('Lifecycle Management', () => {
    it('should pause and resume coordinator', async () => {
      await coordinator.pause();
      expect(coordinator.getState().status).toBe('paused');

      await coordinator.resume();
      expect(coordinator.getState().status).toBe('running');
    });

    it('should shutdown cleanly', async () => {
      const agentId = await coordinator.registerAgent({
        name: 'agent-to-cleanup',
        type: 'worker',
        status: 'idle',
        capabilities: createTestCapabilities(),
        metrics: createTestMetrics(),
        workload: 0,
        health: 1.0,
        lastHeartbeat: new Date(),
        topologyRole: 'worker',
        connections: [],
      });

      await coordinator.shutdown();

      expect(coordinator.getState().status).toBe('stopped');
      expect(coordinator.getAllAgents()).toHaveLength(0);
    });
  });

  describe('Domain-Based Routing', () => {
    it('should assign tasks to specific domains', async () => {
      // Register agent with domain
      const result = await coordinator.registerAgentWithDomain(
        {
          name: 'security-agent',
          type: 'specialist',
          status: 'idle',
          capabilities: createTestCapabilities(),
          metrics: createTestMetrics(),
          workload: 0,
          health: 1.0,
          lastHeartbeat: new Date(),
          topologyRole: 'worker',
          connections: [],
        },
        2 // Security domain (agent #2)
      );

      expect(result.domain).toBe('security');
      expect(result.agentId).toBeDefined();
    });

    it('should get agent domain from agent number', () => {
      expect(coordinator.getAgentDomain(1)).toBe('queen');
      expect(coordinator.getAgentDomain(2)).toBe('security');
      expect(coordinator.getAgentDomain(5)).toBe('core');
      expect(coordinator.getAgentDomain(10)).toBe('integration');
      expect(coordinator.getAgentDomain(13)).toBe('support');
    });

    it('should spawn full 15-agent hierarchy', async () => {
      const hierarchy = await coordinator.spawnFullHierarchy();

      expect(hierarchy.size).toBe(15);
      expect(hierarchy.get(1)?.domain).toBe('queen');
      expect(hierarchy.get(2)?.domain).toBe('security');
      expect(hierarchy.get(5)?.domain).toBe('core');

      const status = coordinator.getStatus();
      expect(status.domains).toHaveLength(5);
    });
  });

  describe('Performance Metrics', () => {
    it('should track coordinator metrics', async () => {
      const metrics = coordinator.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.uptime).toBeGreaterThanOrEqual(0);
      expect(metrics.activeAgents).toBe(0);
      expect(metrics.totalTasks).toBe(0);
      expect(metrics.completedTasks).toBe(0);
    });

    it('should generate performance report', async () => {
      const report = coordinator.getPerformanceReport();

      expect(report).toBeDefined();
      expect(report.timestamp).toBeInstanceOf(Date);
      expect(report.coordinationLatencyP50).toBeGreaterThanOrEqual(0);
      expect(report.messagesPerSecond).toBeGreaterThanOrEqual(0);
    });

    it('should report healthy status', async () => {
      // Add at least one agent to be considered healthy
      await coordinator.registerAgent({
        name: 'health-agent',
        type: 'worker',
        status: 'idle',
        capabilities: createTestCapabilities(),
        metrics: createTestMetrics(),
        workload: 0,
        health: 1.0,
        lastHeartbeat: new Date(),
        topologyRole: 'worker',
        connections: [],
      });

      // Wait for health check interval (2000ms configured in beforeEach)
      await new Promise(resolve => setTimeout(resolve, 2500));

      const metrics = coordinator.getMetrics();
      expect(metrics.activeAgents).toBeGreaterThan(0);
      expect(coordinator.isHealthy()).toBe(true);
    });
  });
});

// ===== TEST UTILITIES =====

function createTestCapabilities() {
  return {
    codeGeneration: true,
    codeReview: true,
    testing: true,
    documentation: true,
    research: true,
    analysis: true,
    coordination: false,
    languages: ['typescript', 'javascript'],
    frameworks: ['node', 'vitest'],
    domains: ['backend', 'testing'],
    tools: ['git', 'npm'],
    maxConcurrentTasks: 3,
    maxMemoryUsage: 512 * 1024 * 1024,
    maxExecutionTime: 300000,
    reliability: 0.95,
    speed: 1.0,
    quality: 0.9,
  };
}

function createTestMetrics() {
  return {
    tasksCompleted: 0,
    tasksFailed: 0,
    averageExecutionTime: 0,
    successRate: 1.0,
    cpuUsage: 0,
    memoryUsage: 0,
    messagesProcessed: 0,
    lastActivity: new Date(),
    responseTime: 0,
    health: 1.0,
  };
}
