/**
 * Queen Coordinator Tests
 *
 * TDD London School methodology tests for the Queen Coordinator.
 * Uses mocks for all dependencies to isolate the unit under test.
 *
 * Test Categories:
 * 1. Initialization and Lifecycle
 * 2. Strategic Task Analysis
 * 3. Agent Delegation
 * 4. Swarm Health Monitoring
 * 5. Consensus Coordination
 * 6. Learning from Outcomes
 * 7. Integration Points
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  QueenCoordinator,
  createQueenCoordinator,
  type QueenCoordinatorConfig,
  type ISwarmCoordinator,
  type INeuralLearningSystem,
  type IMemoryService,
  type TaskAnalysis,
  type DelegationPlan,
  type HealthReport,
  type Decision,
  type TaskResult,
  type AgentScore,
} from '../src/queen-coordinator.js';
import type {
  AgentState,
  AgentType,
  AgentId,
  TaskDefinition,
  TaskId,
  TaskType,
  TaskPriority,
  CoordinatorMetrics,
  ConsensusResult,
  AgentCapabilities,
  AgentMetrics,
} from '../src/types.js';
import type { AgentDomain, DomainStatus } from '../src/unified-coordinator.js';

// =============================================================================
// Mock Factories
// =============================================================================

function createMockSwarmCoordinator(): ISwarmCoordinator {
  return {
    getAgentsByDomain: vi.fn().mockReturnValue([]),
    getAllAgents: vi.fn().mockReturnValue([]),
    getAvailableAgents: vi.fn().mockReturnValue([]),
    getMetrics: vi.fn().mockReturnValue(createMockMetrics()),
    getDomainConfigs: vi.fn().mockReturnValue(new Map()),
    getStatus: vi.fn().mockReturnValue({
      domains: createMockDomainStatuses(),
      metrics: createMockMetrics(),
    }),
    assignTaskToDomain: vi.fn().mockResolvedValue('agent_1'),
    proposeConsensus: vi.fn().mockResolvedValue(createMockConsensusResult(true)),
    broadcastMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockNeuralSystem(): INeuralLearningSystem {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    beginTask: vi.fn().mockReturnValue('trajectory_1'),
    recordStep: vi.fn(),
    completeTask: vi.fn().mockResolvedValue(undefined),
    findPatterns: vi.fn().mockResolvedValue([]),
    retrieveMemories: vi.fn().mockResolvedValue([]),
    triggerLearning: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockMemoryService(): IMemoryService {
  return {
    semanticSearch: vi.fn().mockResolvedValue([]),
    store: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockAgent(
  id: string,
  type: AgentType = 'coder',
  status: AgentState['status'] = 'idle'
): AgentState {
  return {
    id: {
      id,
      swarmId: 'swarm_1',
      type,
      instance: 1,
    },
    name: `agent-${id}`,
    type,
    status,
    capabilities: createMockCapabilities(),
    metrics: createMockAgentMetrics(),
    workload: 0.3,
    health: 0.9,
    lastHeartbeat: new Date(),
    topologyRole: 'worker',
    connections: [],
  };
}

function createMockCapabilities(): AgentCapabilities {
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

function createMockAgentMetrics(): AgentMetrics {
  return {
    tasksCompleted: 10,
    tasksFailed: 1,
    averageExecutionTime: 5000,
    successRate: 0.91,
    cpuUsage: 0.5,
    memoryUsage: 0.4,
    messagesProcessed: 100,
    lastActivity: new Date(),
    responseTime: 50,
    health: 0.9,
  };
}

function createMockTask(
  id: string,
  type: TaskType = 'coding',
  priority: TaskPriority = 'normal'
): TaskDefinition {
  return {
    id: {
      id,
      swarmId: 'swarm_1',
      sequence: 1,
      priority,
    },
    type,
    name: `Task ${id}`,
    description: 'A test task for implementation',
    priority,
    status: 'created',
    dependencies: [],
    input: {},
    createdAt: new Date(),
    timeoutMs: 60000,
    retries: 0,
    maxRetries: 3,
    metadata: {},
  };
}

function createMockMetrics(): CoordinatorMetrics {
  return {
    uptime: 3600,
    activeAgents: 5,
    totalTasks: 100,
    completedTasks: 90,
    failedTasks: 5,
    avgTaskDurationMs: 5000,
    messagesPerSecond: 50,
    consensusSuccessRate: 0.95,
    coordinationLatencyMs: 50,
    memoryUsageBytes: 100000000,
  };
}

function createMockDomainStatuses(): DomainStatus[] {
  return [
    {
      name: 'queen',
      agentCount: 1,
      availableAgents: 1,
      busyAgents: 0,
      tasksQueued: 0,
      tasksCompleted: 10,
    },
    {
      name: 'security',
      agentCount: 3,
      availableAgents: 2,
      busyAgents: 1,
      tasksQueued: 2,
      tasksCompleted: 20,
    },
    {
      name: 'core',
      agentCount: 5,
      availableAgents: 3,
      busyAgents: 2,
      tasksQueued: 3,
      tasksCompleted: 30,
    },
    {
      name: 'integration',
      agentCount: 3,
      availableAgents: 2,
      busyAgents: 1,
      tasksQueued: 1,
      tasksCompleted: 25,
    },
    {
      name: 'support',
      agentCount: 3,
      availableAgents: 3,
      busyAgents: 0,
      tasksQueued: 0,
      tasksCompleted: 15,
    },
  ];
}

function createMockConsensusResult(approved: boolean): ConsensusResult {
  return {
    proposalId: 'proposal_1',
    approved,
    approvalRate: approved ? 0.8 : 0.4,
    participationRate: 0.9,
    finalValue: { approved },
    rounds: 1,
    durationMs: 100,
  };
}

function createMockTaskResult(success: boolean): TaskResult {
  return {
    taskId: 'task_1',
    success,
    output: success ? { result: 'completed' } : undefined,
    error: success ? undefined : 'Task failed',
    durationMs: 5000,
    agentId: 'agent_1',
    domain: 'core',
    metrics: {
      startTime: new Date(Date.now() - 5000),
      endTime: new Date(),
      retries: 0,
      resourceUsage: {
        memoryMb: 256,
        cpuPercent: 50,
      },
      stepsCompleted: 5,
      qualityScore: success ? 0.9 : 0.3,
    },
  };
}

// =============================================================================
// Test Suites
// =============================================================================

describe('QueenCoordinator', () => {
  let queen: QueenCoordinator;
  let mockSwarm: ISwarmCoordinator;
  let mockNeural: INeuralLearningSystem;
  let mockMemory: IMemoryService;

  beforeEach(() => {
    vi.useFakeTimers();
    mockSwarm = createMockSwarmCoordinator();
    mockNeural = createMockNeuralSystem();
    mockMemory = createMockMemoryService();
  });

  afterEach(async () => {
    if (queen) {
      await queen.shutdown();
    }
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Initialization and Lifecycle Tests
  // ===========================================================================

  describe('Initialization and Lifecycle', () => {
    it('should create queen coordinator with default config', () => {
      queen = createQueenCoordinator(mockSwarm);

      expect(queen).toBeInstanceOf(QueenCoordinator);
    });

    it('should create queen coordinator with custom config', () => {
      const config: Partial<QueenCoordinatorConfig> = {
        enableLearning: true,
        patternRetrievalK: 10,
        healthCheckIntervalMs: 5000,
      };

      queen = createQueenCoordinator(mockSwarm, config, mockNeural, mockMemory);

      expect(queen).toBeInstanceOf(QueenCoordinator);
      expect(queen.isLearningEnabled()).toBe(true);
    });

    it('should initialize neural system when learning is enabled', async () => {
      queen = createQueenCoordinator(mockSwarm, { enableLearning: true }, mockNeural);

      await queen.initialize();

      expect(mockNeural.initialize).toHaveBeenCalled();
    });

    it('should not initialize neural system when learning is disabled', async () => {
      queen = createQueenCoordinator(mockSwarm, { enableLearning: false }, mockNeural);

      await queen.initialize();

      expect(mockNeural.initialize).not.toHaveBeenCalled();
    });

    it('should emit initialized event', async () => {
      queen = createQueenCoordinator(mockSwarm);
      const eventHandler = vi.fn();
      queen.on('queen.initialized', eventHandler);

      await queen.initialize();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'queen.initialized',
          data: expect.objectContaining({
            learningEnabled: false,
          }),
        })
      );
    });

    it('should trigger learning on shutdown when enabled', async () => {
      queen = createQueenCoordinator(mockSwarm, { enableLearning: true }, mockNeural);
      await queen.initialize();

      await queen.shutdown();

      expect(mockNeural.triggerLearning).toHaveBeenCalled();
    });

    it('should emit shutdown event', async () => {
      queen = createQueenCoordinator(mockSwarm);
      await queen.initialize();
      const eventHandler = vi.fn();
      queen.on('queen.shutdown', eventHandler);

      await queen.shutdown();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'queen.shutdown',
        })
      );
    });
  });

  // ===========================================================================
  // Strategic Task Analysis Tests
  // ===========================================================================

  describe('Strategic Task Analysis', () => {
    beforeEach(async () => {
      queen = createQueenCoordinator(mockSwarm, { enableLearning: true }, mockNeural);
      await queen.initialize();
    });

    it('should analyze a simple coding task', async () => {
      const task = createMockTask('task_1', 'coding');

      const analysis = await queen.analyzeTask(task);

      expect(analysis).toMatchObject({
        taskId: 'task_1',
        recommendedDomain: 'integration',
        confidence: expect.any(Number),
      });
      expect(analysis.complexity).toBeGreaterThan(0);
      expect(analysis.complexity).toBeLessThanOrEqual(1);
      expect(analysis.requiredCapabilities).toContain('coding');
    });

    it('should analyze a testing task', async () => {
      const task = createMockTask('task_2', 'testing');

      const analysis = await queen.analyzeTask(task);

      expect(analysis.recommendedDomain).toBe('support');
      expect(analysis.requiredCapabilities).toContain('testing');
    });

    it('should analyze a security-related task', async () => {
      const task = createMockTask('task_3', 'review');
      task.description = 'Review security implementation for vulnerabilities';

      const analysis = await queen.analyzeTask(task);

      expect(analysis.requiredCapabilities).toContain('security');
    });

    it('should decompose complex coding tasks', async () => {
      const task = createMockTask('task_4', 'coding', 'high');
      // A very long description triggers decomposition (>200 chars)
      task.description = 'Implement a complex feature with multiple components that requires careful design and extensive testing across multiple modules. This task involves creating new API endpoints, database schemas, service layers, and comprehensive unit tests for the entire feature set. Additional requirements include proper error handling, logging, and performance optimization considerations.';

      const analysis = await queen.analyzeTask(task);

      expect(analysis.subtasks.length).toBeGreaterThan(0);
      expect(analysis.subtasks.some(st => st.type === 'coding')).toBe(true);
    });

    it('should query neural system for patterns when learning is enabled', async () => {
      const task = createMockTask('task_5', 'coding');
      vi.mocked(mockNeural.findPatterns).mockResolvedValue([
        {
          patternId: 'pattern_1',
          strategy: 'Use TDD approach',
          successRate: 0.9,
          relevanceScore: 0.8,
          keyLearnings: ['Write tests first'],
        },
      ]);

      const analysis = await queen.analyzeTask(task);

      expect(mockNeural.findPatterns).toHaveBeenCalled();
      expect(analysis.matchedPatterns.length).toBe(1);
      expect(analysis.matchedPatterns[0].strategy).toBe('Use TDD approach');
    });

    it('should filter patterns below threshold', async () => {
      const config = { enableLearning: true, patternThreshold: 0.7 };
      queen = createQueenCoordinator(mockSwarm, config, mockNeural);
      await queen.initialize();

      vi.mocked(mockNeural.findPatterns).mockResolvedValue([
        { patternId: 'p1', strategy: 'Good', successRate: 0.9, relevanceScore: 0.8 },
        { patternId: 'p2', strategy: 'Low', successRate: 0.5, relevanceScore: 0.5 },
      ]);

      const task = createMockTask('task_6', 'coding');
      const analysis = await queen.analyzeTask(task);

      expect(analysis.matchedPatterns.length).toBe(1);
      expect(analysis.matchedPatterns[0].patternId).toBe('p1');
    });

    it('should calculate resource requirements based on complexity', async () => {
      const task = createMockTask('task_7', 'coding', 'critical');
      task.description = 'Very complex task with many requirements and dependencies';

      const analysis = await queen.analyzeTask(task);

      expect(analysis.resourceRequirements).toMatchObject({
        minAgents: expect.any(Number),
        maxAgents: expect.any(Number),
        memoryMb: expect.any(Number),
        cpuIntensive: true,
      });
    });

    it('should emit task analyzed event', async () => {
      const eventHandler = vi.fn();
      queen.on('queen.task.analyzed', eventHandler);

      const task = createMockTask('task_8', 'coding');
      await queen.analyzeTask(task);

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'queen.task.analyzed',
          data: expect.objectContaining({
            taskId: 'task_8',
          }),
        })
      );
    });

    it('should cache analysis results', async () => {
      const task = createMockTask('task_9', 'coding');

      const analysis = await queen.analyzeTask(task);
      const cache = queen.getAnalysisCache();

      expect(cache.has(analysis.analysisId)).toBe(true);
    });
  });

  // ===========================================================================
  // Agent Delegation Tests
  // ===========================================================================

  describe('Agent Delegation', () => {
    beforeEach(async () => {
      queen = createQueenCoordinator(mockSwarm, { enableLearning: false });
      await queen.initialize();

      // Setup mock agents
      vi.mocked(mockSwarm.getAllAgents).mockReturnValue([
        createMockAgent('agent_1', 'coder', 'idle'),
        createMockAgent('agent_2', 'tester', 'idle'),
        createMockAgent('agent_3', 'architect', 'busy'),
        createMockAgent('agent_4', 'specialist', 'idle'),
      ]);

      vi.mocked(mockSwarm.getAvailableAgents).mockReturnValue([
        createMockAgent('agent_1', 'coder', 'idle'),
        createMockAgent('agent_2', 'tester', 'idle'),
        createMockAgent('agent_4', 'specialist', 'idle'),
      ]);
    });

    it('should delegate task to best matching agent', async () => {
      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);

      const plan = await queen.delegateToAgents(task, analysis);

      expect(plan).toMatchObject({
        taskId: 'task_1',
        analysisId: analysis.analysisId,
        primaryAgent: expect.objectContaining({
          agentId: expect.any(String),
        }),
        strategy: expect.any(String),
      });
    });

    it('should score agents based on capabilities', async () => {
      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);

      const scores = queen.scoreAgents(task, analysis.matchedPatterns);

      expect(scores.length).toBe(4);
      expect(scores[0].totalScore).toBeGreaterThan(0);
      expect(scores[0].capabilityScore).toBeGreaterThanOrEqual(0);
      expect(scores[0].capabilityScore).toBeLessThanOrEqual(1);
    });

    it('should prefer idle agents over busy agents', async () => {
      const task = createMockTask('task_1', 'analysis');
      const analysis = await queen.analyzeTask(task);

      const scores = queen.scoreAgents(task, analysis.matchedPatterns);

      const idleAgent = scores.find(s => s.agentId === 'agent_1');
      const busyAgent = scores.find(s => s.agentId === 'agent_3');

      expect(idleAgent!.availabilityScore).toBeGreaterThan(busyAgent!.availabilityScore);
    });

    it('should select backup agents for failover', async () => {
      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);

      const plan = await queen.delegateToAgents(task, analysis);

      expect(plan.backupAgents.length).toBeGreaterThanOrEqual(0);
      expect(plan.backupAgents.length).toBeLessThanOrEqual(2);
    });

    it('should create parallel assignments for subtasks', async () => {
      const task = createMockTask('task_1', 'coding', 'high');
      task.description = 'Complex task requiring design, implementation, and testing phases';
      const analysis = await queen.analyzeTask(task);

      // Force subtasks
      if (analysis.subtasks.length > 0) {
        const plan = await queen.delegateToAgents(task, analysis);

        expect(plan.parallelAssignments.length).toBe(analysis.subtasks.length);
      }
    });

    it('should determine appropriate execution strategy', async () => {
      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);

      const plan = await queen.delegateToAgents(task, analysis);

      expect(['sequential', 'parallel', 'pipeline', 'fan-out-fan-in', 'hybrid']).toContain(
        plan.strategy
      );
    });

    it('should call swarm assignTaskToDomain', async () => {
      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);

      await queen.delegateToAgents(task, analysis);

      expect(mockSwarm.assignTaskToDomain).toHaveBeenCalledWith(
        'task_1',
        expect.any(String)
      );
    });

    it('should broadcast delegation message', async () => {
      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);

      await queen.delegateToAgents(task, analysis);

      expect(mockSwarm.broadcastMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'delegation',
          taskId: 'task_1',
        }),
        'normal'
      );
    });

    it('should emit task delegated event', async () => {
      const eventHandler = vi.fn();
      queen.on('queen.task.delegated', eventHandler);

      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);
      await queen.delegateToAgents(task, analysis);

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'queen.task.delegated',
          data: expect.objectContaining({
            taskId: 'task_1',
          }),
        })
      );
    });

    it('should store delegation plan', async () => {
      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);

      const plan = await queen.delegateToAgents(task, analysis);
      const plans = queen.getDelegationPlans();

      expect(plans.has(plan.planId)).toBe(true);
    });
  });

  // ===========================================================================
  // Swarm Health Monitoring Tests
  // ===========================================================================

  describe('Swarm Health Monitoring', () => {
    beforeEach(async () => {
      queen = createQueenCoordinator(mockSwarm, {
        healthCheckIntervalMs: 1000,
        bottleneckThresholds: {
          queueDepth: 5,
          errorRate: 0.1,
          responseTimeMs: 1000,
        },
      });
      await queen.initialize();

      vi.mocked(mockSwarm.getAllAgents).mockReturnValue([
        createMockAgent('agent_1', 'coder', 'idle'),
        createMockAgent('agent_2', 'tester', 'busy'),
        createMockAgent('agent_3', 'architect', 'idle'),
      ]);
    });

    it('should generate health report', async () => {
      const report = await queen.monitorSwarmHealth();

      expect(report).toMatchObject({
        reportId: expect.any(String),
        timestamp: expect.any(Date),
        overallHealth: expect.any(Number),
        domainHealth: expect.any(Map),
        agentHealth: expect.any(Array),
        bottlenecks: expect.any(Array),
        alerts: expect.any(Array),
        recommendations: expect.any(Array),
      });
    });

    it('should calculate overall health score', async () => {
      const report = await queen.monitorSwarmHealth();

      expect(report.overallHealth).toBeGreaterThanOrEqual(0);
      expect(report.overallHealth).toBeLessThanOrEqual(1);
    });

    it('should report domain health for all domains', async () => {
      const report = await queen.monitorSwarmHealth();

      expect(report.domainHealth.size).toBe(5); // queen, security, core, integration, support
    });

    it('should report individual agent health', async () => {
      const report = await queen.monitorSwarmHealth();

      expect(report.agentHealth.length).toBe(3);
      expect(report.agentHealth[0]).toMatchObject({
        agentId: expect.any(String),
        domain: expect.any(String),
        health: expect.any(Number),
        status: expect.any(String),
      });
    });

    it('should detect queue bottlenecks', async () => {
      vi.mocked(mockSwarm.getStatus).mockReturnValue({
        domains: [
          { name: 'core', agentCount: 5, availableAgents: 1, busyAgents: 4, tasksQueued: 15, tasksCompleted: 10 },
          ...createMockDomainStatuses().slice(1),
        ] as DomainStatus[],
        metrics: createMockMetrics(),
      });

      const report = await queen.monitorSwarmHealth();

      const queueBottleneck = report.bottlenecks.find(
        b => b.type === 'domain' && b.description.includes('queue')
      );
      expect(queueBottleneck).toBeDefined();
    });

    it('should detect error agents', async () => {
      vi.mocked(mockSwarm.getAllAgents).mockReturnValue([
        createMockAgent('agent_1', 'coder', 'error'),
        createMockAgent('agent_2', 'tester', 'error'),
        createMockAgent('agent_3', 'architect', 'idle'),
      ]);

      const report = await queen.monitorSwarmHealth();

      const agentBottleneck = report.bottlenecks.find(
        b => b.type === 'agent' && b.description.includes('error')
      );
      expect(agentBottleneck).toBeDefined();
      expect(agentBottleneck!.description).toContain('2');
    });

    it('should generate alerts for critical bottlenecks', async () => {
      vi.mocked(mockSwarm.getStatus).mockReturnValue({
        domains: [
          { name: 'core', agentCount: 5, availableAgents: 0, busyAgents: 5, tasksQueued: 25, tasksCompleted: 10 },
          ...createMockDomainStatuses().slice(1),
        ] as DomainStatus[],
        metrics: createMockMetrics(),
      });

      const report = await queen.monitorSwarmHealth();

      const criticalAlert = report.alerts.find(a => a.type === 'critical' || a.type === 'error');
      expect(criticalAlert).toBeDefined();
    });

    it('should generate recommendations', async () => {
      vi.mocked(mockSwarm.getAllAgents).mockReturnValue([
        createMockAgent('agent_1', 'coder', 'error'),
      ]);

      const report = await queen.monitorSwarmHealth();

      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should calculate health metrics', async () => {
      const report = await queen.monitorSwarmHealth();

      expect(report.metrics).toMatchObject({
        totalAgents: 3,
        activeAgents: expect.any(Number),
        idleAgents: expect.any(Number),
        errorAgents: expect.any(Number),
        totalTasks: expect.any(Number),
        completedTasks: expect.any(Number),
        failedTasks: expect.any(Number),
      });
    });

    it('should emit health report event', async () => {
      const eventHandler = vi.fn();
      queen.on('queen.health.report', eventHandler);

      await queen.monitorSwarmHealth();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'queen.health.report',
        })
      );
    });

    it('should store last health report', async () => {
      await queen.monitorSwarmHealth();

      const lastReport = queen.getLastHealthReport();
      expect(lastReport).toBeDefined();
    });

    it('should run periodic health checks', async () => {
      const spy = vi.spyOn(queen, 'monitorSwarmHealth');

      // Advance timers to trigger health check
      vi.advanceTimersByTime(1500);

      expect(spy).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Consensus Coordination Tests
  // ===========================================================================

  describe('Consensus Coordination', () => {
    beforeEach(async () => {
      queen = createQueenCoordinator(mockSwarm, {
        consensusTimeouts: {
          majority: 1000,
          supermajority: 2000,
          unanimous: 5000,
        },
      });
      await queen.initialize();
    });

    it('should coordinate majority consensus', async () => {
      vi.mocked(mockSwarm.proposeConsensus).mockResolvedValue(createMockConsensusResult(true));

      const decision: Decision = {
        decisionId: '',
        type: 'task-assignment',
        proposal: { taskId: 'task_1', agentId: 'agent_1' },
        requiredConsensus: 'majority',
        timeout: 1000,
        initiator: 'queen',
        metadata: {},
      };

      const result = await queen.coordinateConsensus(decision);

      expect(result.approved).toBe(true);
      expect(mockSwarm.proposeConsensus).toHaveBeenCalledWith(
        expect.objectContaining({
          threshold: 0.51,
        })
      );
    });

    it('should coordinate supermajority consensus', async () => {
      vi.mocked(mockSwarm.proposeConsensus).mockResolvedValue(createMockConsensusResult(true));

      const decision: Decision = {
        decisionId: '',
        type: 'resource-allocation',
        proposal: { resource: 'memory', amount: 1024 },
        requiredConsensus: 'supermajority',
        timeout: 2000,
        initiator: 'queen',
        metadata: {},
      };

      const result = await queen.coordinateConsensus(decision);

      expect(mockSwarm.proposeConsensus).toHaveBeenCalledWith(
        expect.objectContaining({
          threshold: 0.67,
        })
      );
    });

    it('should coordinate unanimous consensus', async () => {
      vi.mocked(mockSwarm.proposeConsensus).mockResolvedValue(createMockConsensusResult(true));

      const decision: Decision = {
        decisionId: '',
        type: 'topology-change',
        proposal: { newTopology: 'mesh' },
        requiredConsensus: 'unanimous',
        timeout: 5000,
        initiator: 'queen',
        metadata: {},
      };

      await queen.coordinateConsensus(decision);

      expect(mockSwarm.proposeConsensus).toHaveBeenCalledWith(
        expect.objectContaining({
          threshold: 1.0,
        })
      );
    });

    it('should allow queen override for emergency actions', async () => {
      const decision: Decision = {
        decisionId: '',
        type: 'emergency-action',
        proposal: { action: 'stop-all' },
        requiredConsensus: 'queen-override',
        timeout: 0,
        initiator: 'queen',
        metadata: {},
      };

      const result = await queen.coordinateConsensus(decision);

      expect(result.approved).toBe(true);
      expect(result.approvalRate).toBe(1.0);
      expect(mockSwarm.proposeConsensus).not.toHaveBeenCalled();
    });

    it('should reject queen override for non-allowed decision types', async () => {
      const decision: Decision = {
        decisionId: '',
        type: 'task-assignment',
        proposal: { taskId: 'task_1' },
        requiredConsensus: 'queen-override',
        timeout: 0,
        initiator: 'queen',
        metadata: {},
      };

      await expect(queen.coordinateConsensus(decision)).rejects.toThrow(
        'Queen override not allowed'
      );
    });

    it('should use weighted consensus based on agent performance', async () => {
      vi.mocked(mockSwarm.getAllAgents).mockReturnValue([
        createMockAgent('agent_1', 'coder', 'idle'),
        createMockAgent('agent_2', 'tester', 'idle'),
      ]);
      vi.mocked(mockSwarm.proposeConsensus).mockResolvedValue(createMockConsensusResult(true));

      const decision: Decision = {
        decisionId: '',
        type: 'resource-allocation',
        proposal: { resource: 'cpu' },
        requiredConsensus: 'weighted',
        timeout: 1000,
        initiator: 'queen',
        metadata: {},
      };

      await queen.coordinateConsensus(decision);

      expect(mockSwarm.proposeConsensus).toHaveBeenCalledWith(
        expect.objectContaining({
          weights: expect.any(Object),
        })
      );
    });

    it('should emit consensus completed event', async () => {
      const eventHandler = vi.fn();
      queen.on('queen.consensus.completed', eventHandler);
      vi.mocked(mockSwarm.proposeConsensus).mockResolvedValue(createMockConsensusResult(true));

      const decision: Decision = {
        decisionId: '',
        type: 'task-assignment',
        proposal: {},
        requiredConsensus: 'majority',
        timeout: 1000,
        initiator: 'queen',
        metadata: {},
      };

      await queen.coordinateConsensus(decision);

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'queen.consensus.completed',
          data: expect.objectContaining({
            approved: true,
          }),
        })
      );
    });
  });

  // ===========================================================================
  // Learning from Outcomes Tests
  // ===========================================================================

  describe('Learning from Outcomes', () => {
    beforeEach(async () => {
      queen = createQueenCoordinator(mockSwarm, { enableLearning: true }, mockNeural, mockMemory);
      await queen.initialize();
    });

    it('should record successful task outcome', async () => {
      const task = createMockTask('task_1', 'coding');
      const result = createMockTaskResult(true);

      await queen.recordOutcome(task, result);

      expect(mockNeural.beginTask).toHaveBeenCalled();
      expect(mockNeural.recordStep).toHaveBeenCalled();
      expect(mockNeural.completeTask).toHaveBeenCalled();
    });

    it('should record failed task outcome', async () => {
      const task = createMockTask('task_1', 'coding');
      const result = createMockTaskResult(false);

      await queen.recordOutcome(task, result);

      const outcomeHistory = queen.getOutcomeHistory();
      expect(outcomeHistory.length).toBe(1);
      expect(outcomeHistory[0].success).toBe(false);
    });

    it('should store outcome in memory service', async () => {
      const task = createMockTask('task_1', 'coding');
      const result = createMockTaskResult(true);

      await queen.recordOutcome(task, result);

      expect(mockMemory.store).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringContaining('outcome_task_1'),
          namespace: 'queen-outcomes',
          tags: expect.arrayContaining(['coding', 'success']),
        })
      );
    });

    it('should emit outcome recorded event', async () => {
      const eventHandler = vi.fn();
      queen.on('queen.outcome.recorded', eventHandler);

      const task = createMockTask('task_1', 'coding');
      const result = createMockTaskResult(true);

      await queen.recordOutcome(task, result);

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'queen.outcome.recorded',
          data: expect.objectContaining({
            taskId: 'task_1',
            success: true,
          }),
        })
      );
    });

    it('should maintain outcome history with limit', async () => {
      const task = createMockTask('task_1', 'coding');
      const result = createMockTaskResult(true);

      // Record many outcomes
      for (let i = 0; i < 10; i++) {
        await queen.recordOutcome(task, result);
      }

      const history = queen.getOutcomeHistory();
      expect(history.length).toBe(10);
    });

    it('should calculate reward based on success and quality', async () => {
      const task = createMockTask('task_1', 'coding');
      const result = createMockTaskResult(true);

      await queen.recordOutcome(task, result);

      expect(mockNeural.recordStep).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining('executed_coding'),
        expect.any(Number),
        expect.any(Float32Array)
      );
    });

    it('should not attempt learning when neural system unavailable', async () => {
      queen = createQueenCoordinator(mockSwarm, { enableLearning: true });
      await queen.initialize();

      const task = createMockTask('task_1', 'coding');
      const result = createMockTaskResult(true);

      // Should not throw
      await queen.recordOutcome(task, result);
    });

    it('should handle memory storage errors gracefully', async () => {
      vi.mocked(mockMemory.store).mockRejectedValue(new Error('Storage failed'));

      const task = createMockTask('task_1', 'coding');
      const result = createMockTaskResult(true);

      // Should not throw
      await queen.recordOutcome(task, result);

      const history = queen.getOutcomeHistory();
      expect(history.length).toBe(1);
    });
  });

  // ===========================================================================
  // Performance Statistics Tests
  // ===========================================================================

  describe('Performance Statistics', () => {
    beforeEach(async () => {
      queen = createQueenCoordinator(mockSwarm);
      await queen.initialize();
    });

    it('should track analysis latencies', async () => {
      const task = createMockTask('task_1', 'coding');

      await queen.analyzeTask(task);
      await queen.analyzeTask(task);

      const stats = queen.getPerformanceStats();
      expect(stats.avgAnalysisLatencyMs).toBeGreaterThan(0);
      expect(stats.totalAnalyses).toBe(2);
    });

    it('should track delegation latencies', async () => {
      vi.mocked(mockSwarm.getAllAgents).mockReturnValue([
        createMockAgent('agent_1', 'coder', 'idle'),
      ]);

      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);
      await queen.delegateToAgents(task, analysis);

      const stats = queen.getPerformanceStats();
      expect(stats.avgDelegationLatencyMs).toBeGreaterThan(0);
      expect(stats.totalDelegations).toBe(1);
    });

    it('should track consensus latencies', async () => {
      vi.mocked(mockSwarm.proposeConsensus).mockResolvedValue(createMockConsensusResult(true));

      const decision: Decision = {
        decisionId: '',
        type: 'task-assignment',
        proposal: {},
        requiredConsensus: 'majority',
        timeout: 1000,
        initiator: 'queen',
        metadata: {},
      };

      await queen.coordinateConsensus(decision);

      const stats = queen.getPerformanceStats();
      expect(stats.totalDecisions).toBe(1);
    });

    it('should report all statistics together', async () => {
      const stats = queen.getPerformanceStats();

      expect(stats).toMatchObject({
        avgAnalysisLatencyMs: expect.any(Number),
        avgDelegationLatencyMs: expect.any(Number),
        avgConsensusLatencyMs: expect.any(Number),
        totalAnalyses: expect.any(Number),
        totalDelegations: expect.any(Number),
        totalDecisions: expect.any(Number),
      });
    });
  });

  // ===========================================================================
  // Integration Points Tests
  // ===========================================================================

  describe('Integration Points', () => {
    it('should work with UnifiedSwarmCoordinator interface', async () => {
      const swarm = createMockSwarmCoordinator();
      queen = createQueenCoordinator(swarm);
      await queen.initialize();

      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);

      expect(analysis).toBeDefined();
      expect(analysis.analysisId).toBeDefined();
    });

    it('should work with NeuralLearningSystem interface', async () => {
      const neural = createMockNeuralSystem();
      queen = createQueenCoordinator(mockSwarm, { enableLearning: true }, neural);
      await queen.initialize();

      expect(neural.initialize).toHaveBeenCalled();
    });

    it('should work with UnifiedMemoryService interface', async () => {
      const memory = createMockMemoryService();
      queen = createQueenCoordinator(mockSwarm, { enableLearning: true }, mockNeural, memory);
      await queen.initialize();

      const task = createMockTask('task_1', 'coding');
      const result = createMockTaskResult(true);
      await queen.recordOutcome(task, result);

      expect(memory.store).toHaveBeenCalled();
    });

    it('should emit events that can be subscribed to', async () => {
      queen = createQueenCoordinator(mockSwarm);
      await queen.initialize();

      const eventHandler = vi.fn();
      queen.on('event', eventHandler);

      const task = createMockTask('task_1', 'coding');
      await queen.analyzeTask(task);

      expect(eventHandler).toHaveBeenCalled();
    });

    it('should check learning enabled status', async () => {
      queen = createQueenCoordinator(mockSwarm, { enableLearning: false });
      expect(queen.isLearningEnabled()).toBe(false);

      queen = createQueenCoordinator(mockSwarm, { enableLearning: true }, mockNeural);
      expect(queen.isLearningEnabled()).toBe(true);
    });
  });

  // ===========================================================================
  // Edge Cases and Error Handling Tests
  // ===========================================================================

  describe('Edge Cases and Error Handling', () => {
    beforeEach(async () => {
      queen = createQueenCoordinator(mockSwarm);
      await queen.initialize();
    });

    it('should handle empty agent list', async () => {
      vi.mocked(mockSwarm.getAllAgents).mockReturnValue([]);

      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);

      expect(analysis).toBeDefined();

      const scores = queen.scoreAgents(task, []);
      expect(scores).toEqual([]);
    });

    it('should handle task with no description', async () => {
      const task = createMockTask('task_1', 'coding');
      task.description = '';

      const analysis = await queen.analyzeTask(task);

      expect(analysis).toBeDefined();
      expect(analysis.complexity).toBeGreaterThan(0);
    });

    it('should handle neural system errors gracefully', async () => {
      queen = createQueenCoordinator(mockSwarm, { enableLearning: true }, mockNeural);
      await queen.initialize();

      vi.mocked(mockNeural.findPatterns).mockRejectedValue(new Error('Neural error'));

      const task = createMockTask('task_1', 'coding');
      const analysis = await queen.analyzeTask(task);

      // Should still complete analysis
      expect(analysis).toBeDefined();
      expect(analysis.matchedPatterns).toEqual([]);
    });

    it('should handle consensus rejection', async () => {
      vi.mocked(mockSwarm.proposeConsensus).mockResolvedValue(createMockConsensusResult(false));

      const decision: Decision = {
        decisionId: '',
        type: 'resource-allocation',
        proposal: {},
        requiredConsensus: 'majority',
        timeout: 1000,
        initiator: 'queen',
        metadata: {},
      };

      const result = await queen.coordinateConsensus(decision);

      expect(result.approved).toBe(false);
    });

    it('should handle all task types', async () => {
      const taskTypes: TaskType[] = [
        'research', 'analysis', 'coding', 'testing',
        'review', 'documentation', 'coordination', 'consensus', 'custom'
      ];

      for (const type of taskTypes) {
        const task = createMockTask(`task_${type}`, type);
        const analysis = await queen.analyzeTask(task);

        expect(analysis).toBeDefined();
        expect(analysis.recommendedDomain).toBeDefined();
      }
    });

    it('should handle all priority levels', async () => {
      const priorities: TaskPriority[] = ['critical', 'high', 'normal', 'low', 'background'];

      for (const priority of priorities) {
        const task = createMockTask(`task_${priority}`, 'coding', priority);
        const analysis = await queen.analyzeTask(task);

        expect(analysis).toBeDefined();
      }
    });
  });
});
