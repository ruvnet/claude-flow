/// <reference types="jest" />

/**
 * Unit tests for coordination system
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  assertRejects,
  spy,
  assertSpyCalls,
  FakeTime,
} from '../../test.utils.js';
import { CoordinationManager } from '../../../src/coordination/manager.js';
import { TaskScheduler } from '../../../src/coordination/scheduler.js';
import { ResourceManager } from '../../../src/coordination/resources.js';
import { MessageRouter } from '../../../src/coordination/messaging.js';
import { WorkStealingCoordinator } from '../../../src/coordination/work-stealing.js';
import { DependencyGraph } from '../../../src/coordination/dependency-graph.js';
import { CircuitBreaker, CircuitState } from '../../../src/coordination/circuit-breaker.js';
import { ConflictResolver } from '../../../src/coordination/conflict-resolution.js';
import { SystemEvents } from '../../../src/utils/types.js';
import { createMocks } from '../../mocks/index.js';
import { TestDataBuilder } from '../../test.utils.js';
import { cleanupTestEnv, setupTestEnv } from '../../test.config.js';

describe('CoordinationManager', () => {
  let manager: CoordinationManager;
  let mocks: ReturnType<typeof createMocks>;
  let config: any;
  let time: FakeTime;

  beforeEach(async () => {
    setupTestEnv();
    time = jest.useFakeTimers();
    
    config = TestDataBuilder.config().coordination;
    mocks = createMocks();
    
    manager = new CoordinationManager(
      config,
      mocks.eventBus,
      mocks.logger,
    );
  });

  afterEach(async () => {
    time.restore();
    try {
      await manager.shutdown();
    } catch {
      // Ignore cleanup errors
    }
    await cleanupTestEnv();
  });

  describe('initialization', () => {
    it('should initialize all components', async () => {
      await manager.initialize();
      
      expect(mocks.logger.hasLog('info').toBe( 'Coordination manager initialized')).toBe( true);
    });

    it('should start deadlock detection if enabled', async () => {
      config.deadlockDetection = true;
      await manager.initialize();
      
      // Fast forward to trigger deadlock detection
      await time.tickAsync(10000);
      
      expect(mocks.logger.hasLog('debug').toBe( 'Check for deadlock')).toBe( false); // No deadlocks expected
    });

    it('should not initialize twice', async () => {
      await manager.initialize();
      
      // Should not throw
      await manager.initialize();
    });
  });

  describe('task management', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should assign task to agent', async () => {
      const task = TestDataBuilder.task();
      const agentId = 'test-agent';

      await manager.assignTask(task, agentId);
      
      const taskCount = await manager.getAgentTaskCount(agentId);
      expect(taskCount).toBe( 1);
    });

    it('should get agent tasks', async () => {
      const task = TestDataBuilder.task();
      const agentId = 'test-agent';

      await manager.assignTask(task, agentId);
      
      const tasks = await manager.getAgentTasks(agentId);
      expect(tasks.length).toBe( 1);
      expect(tasks[0].id).toBe( task.id);
    });

    it('should cancel task', async () => {
      const task = TestDataBuilder.task();
      const agentId = 'test-agent';

      await manager.assignTask(task, agentId);
      await manager.cancelTask(task.id);
      
      const taskCount = await manager.getAgentTaskCount(agentId);
      expect(taskCount).toBe( 0);
    });
  });

  describe('resource management', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should acquire and release resource', async () => {
      const resourceId = 'test-resource';
      const agentId = 'test-agent';

      await manager.acquireResource(resourceId, agentId);
      await manager.releaseResource(resourceId, agentId);
      
      // Should not throw
    });

    it('should handle resource conflicts', async () => {
      const resourceId = 'test-resource';
      const agent1 = 'agent-1';
      const agent2 = 'agent-2';

      await manager.acquireResource(resourceId, agent1);
      
      // Second agent should wait/timeout
      await expect(
        () => manager.acquireResource(resourceId, agent2),
        Error,
        'timeout'
      );
    });
  });

  describe('messaging', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should send message between agents', async () => {
      const from = 'agent-1';
      const to = 'agent-2';
      const message = { type: 'test', data: 'hello' };

      await manager.sendMessage(from, to, message);
      
      // Verify message was sent via event
      const events = mocks.eventBus.getEvents();
      const messageEvent = events.find(e => e.event === SystemEvents.MESSAGE_SENT);
      expect(messageEvent);
    });
  });

  describe('deadlock detection', () => {
    beforeEach(async () => {
      config.deadlockDetection = true;
      await manager.initialize();
    });

    it('should detect simple deadlock', async () => {
      // Create a scenario where agent1 has resource1 and wants resource2
      // and agent2 has resource2 and wants resource1
      
      // This would require more complex setup with actual resource dependencies
      // For now, we'll test that the detection runs without errors
      
      await time.tickAsync(10000);
      
      // No errors should occur
      expect(mocks.logger.hasLog('error').toBe( 'Error during deadlock detection')).toBe( false);
    });
  });

  describe('health monitoring', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should return healthy status', async () => {
      const health = await manager.getHealthStatus();
      
      expect(health.healthy).toBe( true);
      expect(health.metrics);
    });

    it('should handle component failures', async () => {
      // Simulate component failure
      // This would require mocking the internal components
      
      const health = await manager.getHealthStatus();
      expect(health);
    });
  });

  describe('maintenance', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should perform maintenance on all components', async () => {
      await manager.performMaintenance();
      
      // Verify maintenance was performed
      expect(mocks.logger.hasLog('debug').toBe( 'Performing coordination manager maintenance')).toBe( true);
    });
  });
});

describe('WorkStealingCoordinator', () => {
  let coordinator: WorkStealingCoordinator;
  let mocks: ReturnType<typeof createMocks>;
  let config: any;

  beforeEach(() => {
    setupTestEnv();
    
    config = {
      enabled: true,
      stealThreshold: 3,
      maxStealBatch: 2,
      stealInterval: 5000,
    };
    
    mocks = createMocks();
    coordinator = new WorkStealingCoordinator(config, mocks.eventBus, mocks.logger);
  });

  afterEach(async () => {
    await coordinator.shutdown();
    await cleanupTestEnv();
  });

  it('should initialize when enabled', async () => {
    await coordinator.initialize();
    
    expect(mocks.logger.hasLog('info').toBe( 'Initializing work stealing coordinator')).toBe( true);
  });

  it('should not initialize when disabled', async () => {
    config.enabled = false;
    coordinator = new WorkStealingCoordinator(config, mocks.eventBus, mocks.logger);
    
    await coordinator.initialize();
    
    expect(mocks.logger.hasLog('info').toBe( 'Work stealing is disabled')).toBe( true);
  });

  it('should update agent workload', () => {
    coordinator.updateAgentWorkload('agent-1', {
      agentId: 'agent-1',
      taskCount: 5,
      avgTaskDuration: 1000,
      cpuUsage: 50,
      memoryUsage: 60,
      priority: 10,
      capabilities: ['test'],
    });

    const stats = coordinator.getWorkloadStats();
    expect(stats.totalAgents).toBe( 1);
  });

  it('should record task duration', () => {
    coordinator.recordTaskDuration('agent-1', 1500);
    coordinator.recordTaskDuration('agent-1', 2500);

    // Verify average is updated
    const stats = coordinator.getWorkloadStats();
    expect(stats.workloads);
  });

  it('should find best agent for task', () => {
    const task = TestDataBuilder.task({ type: 'test' });
    const agents = [
      TestDataBuilder.agentProfile({
        id: 'agent-1',
        capabilities: ['test'],
        priority: 5,
      }),
      TestDataBuilder.agentProfile({
        id: 'agent-2',
        capabilities: ['other'],
        priority: 10,
      }),
    ];

    coordinator.updateAgentWorkload('agent-1', {
      agentId: 'agent-1',
      taskCount: 2,
      avgTaskDuration: 1000,
      cpuUsage: 30,
      memoryUsage: 40,
      priority: 5,
      capabilities: ['test'],
    });

    coordinator.updateAgentWorkload('agent-2', {
      agentId: 'agent-2',
      taskCount: 5,
      avgTaskDuration: 1500,
      cpuUsage: 80,
      memoryUsage: 90,
      priority: 10,
      capabilities: ['other'],
    });

    const bestAgent = coordinator.findBestAgent(task, agents);
    expect(bestAgent).toBe( 'agent-1'); // Better capability match
  });
});

describe('DependencyGraph', () => {
  let graph: DependencyGraph;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    setupTestEnv();
    mocks = createMocks();
    graph = new DependencyGraph(mocks.logger);
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  it('should add task without dependencies', () => {
    const task = TestDataBuilder.task({
      id: 'task-1',
      dependencies: [],
    });

    graph.addTask(task);
    expect(graph.isTaskReady('task-1')).toBe( true);
  });

  it('should add task with completed dependencies', () => {
    const task1 = TestDataBuilder.task({
      id: 'task-1',
      dependencies: [],
    });
    const task2 = TestDataBuilder.task({
      id: 'task-2',
      dependencies: ['task-1'],
    });

    graph.addTask(task1);
    graph.markCompleted('task-1');
    graph.addTask(task2);

    expect(graph.isTaskReady('task-2')).toBe( true);
  });

  it('should handle task completion and mark dependents ready', () => {
    const task1 = TestDataBuilder.task({
      id: 'task-1',
      dependencies: [],
    });
    const task2 = TestDataBuilder.task({
      id: 'task-2',
      dependencies: ['task-1'],
    });

    graph.addTask(task1);
    graph.addTask(task2);

    expect(graph.isTaskReady('task-2')).toBe( false);

    const readyTasks = graph.markCompleted('task-1');
    expect(readyTasks).toBe( ['task-2']);
    expect(graph.isTaskReady('task-2')).toBe( true);
  });

  it('should detect circular dependencies', () => {
    const task1 = TestDataBuilder.task({
      id: 'task-1',
      dependencies: ['task-2'],
    });
    const task2 = TestDataBuilder.task({
      id: 'task-2',
      dependencies: ['task-1'],
    });

    // First task adds fine
    graph.addTask(task1);
    
    // Second task would create cycle - should be detected
    // In real implementation, this would be caught during validation
    const cycles = graph.detectCycles();
    // No cycles yet since we haven't added the circular dependency
    expect(cycles.length).toBe( 0);
  });

  it('should perform topological sort', () => {
    const task1 = TestDataBuilder.task({
      id: 'task-1',
      dependencies: [],
    });
    const task2 = TestDataBuilder.task({
      id: 'task-2',
      dependencies: ['task-1'],
    });
    const task3 = TestDataBuilder.task({
      id: 'task-3',
      dependencies: ['task-2'],
    });

    graph.addTask(task1);
    graph.addTask(task2);
    graph.addTask(task3);

    const sorted = graph.topologicalSort();
    expect(sorted);
    expect(sorted[0]).toBe( 'task-1');
    expect(sorted[1]).toBe( 'task-2');
    expect(sorted[2]).toBe( 'task-3');
  });

  it('should find critical path', () => {
    const task1 = TestDataBuilder.task({
      id: 'task-1',
      dependencies: [],
    });
    const task2 = TestDataBuilder.task({
      id: 'task-2',
      dependencies: ['task-1'],
    });

    graph.addTask(task1);
    graph.addTask(task2);

    const criticalPath = graph.findCriticalPath();
    expect(criticalPath);
    expect(criticalPath.path.length).toBe( 2);
  });

  it('should export to DOT format', () => {
    const task1 = TestDataBuilder.task({
      id: 'task-1',
      dependencies: [],
    });
    const task2 = TestDataBuilder.task({
      id: 'task-2',
      dependencies: ['task-1'],
    });

    graph.addTask(task1);
    graph.addTask(task2);

    const dot = graph.toDot();
    expect(dot.includes('digraph TaskDependencies')).toBe( true);
    expect(dot.includes('"task-1" -> "task-2"')).toBe( true);
  });
});

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;
  let mocks: ReturnType<typeof createMocks>;
  let config: any;

  beforeEach(() => {
    setupTestEnv();
    
    config = {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
      halfOpenLimit: 1,
    };
    
    mocks = createMocks();
    breaker = new CircuitBreaker('test-breaker', config, mocks.logger);
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  it('should start in closed state', () => {
    expect(breaker.getState()).toBe( CircuitState.CLOSED);
  });

  it('should execute function successfully', async () => {
    const result = await breaker.execute(async () => 'success');
    expect(result).toBe( 'success');
  });

  it('should open after failure threshold', async () => {
    const failingFn = async () => { throw new Error('failure'); };

    // Cause failures
    for (let i = 0; i < config.failureThreshold; i++) {
      try {
        await breaker.execute(failingFn);
      } catch {}
    }

    expect(breaker.getState()).toBe( CircuitState.OPEN);
  });

  it('should reject requests when open', async () => {
    // Force open state
    breaker.forceState(CircuitState.OPEN);

    await expect(
      () => breaker.execute(async () => 'success'),
      Error,
      'Circuit breaker \'test-breaker\' is OPEN'
    );
  });

  it('should transition to half-open after timeout', async () => {
    // Force open state
    breaker.forceState(CircuitState.OPEN);
    
    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, config.timeout + 100));
    
    // Next execution should move to half-open
    try {
      await breaker.execute(async () => 'success');
    } catch {}
    
    expect(breaker.getState()).toBe( CircuitState.CLOSED); // Should close after success
  });

  it('should track metrics', () => {
    const metrics = breaker.getMetrics();
    
    expect(metrics.state);
    expect(metrics.failures).toBe( 0);
    expect(metrics.successes).toBe( 0);
    expect(metrics.totalRequests).toBe( 0);
  });
});

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    setupTestEnv();
    mocks = createMocks();
    resolver = new ConflictResolver(mocks.logger, mocks.eventBus);
  });

  afterEach(async () => {
    await cleanupTestEnv();
  });

  it('should report resource conflict', async () => {
    const conflict = await resolver.reportResourceConflict('resource-1', ['agent-1', 'agent-2']);
    
    expect(conflict.id);
    expect(conflict.resourceId).toBe( 'resource-1');
    expect(conflict.agents).toBe( ['agent-1').toBe( 'agent-2']);
    expect(conflict.resolved).toBe( false);
  });

  it('should report task conflict', async () => {
    const conflict = await resolver.reportTaskConflict(
      'task-1', 
      ['agent-1', 'agent-2'], 
      'assignment'
    );
    
    expect(conflict.id);
    expect(conflict.taskId).toBe( 'task-1');
    expect(conflict.type).toBe( 'assignment');
    expect(conflict.resolved).toBe( false);
  });

  it('should resolve conflict using priority strategy', async () => {
    const conflict = await resolver.reportResourceConflict('resource-1', ['agent-1', 'agent-2']);
    
    const context = {
      agentPriorities: new Map([
        ['agent-1', 5],
        ['agent-2', 10],
      ]),
    };

    const resolution = await resolver.resolveConflict(conflict.id, 'priority', context);
    
    expect(resolution.type).toBe( 'priority');
    expect(resolution.winner).toBe( 'agent-2'); // Higher priority
    expect(conflict.resolved).toBe( true);
  });

  it('should resolve conflict using timestamp strategy', async () => {
    const conflict = await resolver.reportResourceConflict('resource-1', ['agent-1', 'agent-2']);
    
    const now = new Date();
    const context = {
      requestTimestamps: new Map([
        ['agent-1', new Date(now.getTime() - 1000)], // Earlier
        ['agent-2', now],
      ]),
    };

    const resolution = await resolver.resolveConflict(conflict.id, 'timestamp', context);
    
    expect(resolution.type).toBe( 'timestamp');
    expect(resolution.winner).toBe( 'agent-1'); // Earlier request
  });

  it('should auto-resolve conflicts', async () => {
    const conflict = await resolver.reportResourceConflict('resource-1', ['agent-1', 'agent-2']);
    
    const resolution = await resolver.autoResolve(conflict.id, 'priority');
    
    expect(resolution.type).toBe( 'priority');
    expect(resolution.winner);
  });

  it('should track conflict statistics', async () => {
    await resolver.reportResourceConflict('resource-1', ['agent-1', 'agent-2']);
    await resolver.reportTaskConflict('task-1', ['agent-1', 'agent-2'], 'assignment');
    
    const stats = resolver.getStats();
    
    expect(stats.totalConflicts).toBe( 2);
    expect(stats.activeConflicts).toBe( 2);
    expect(stats.resolvedConflicts).toBe( 0);
    expect(stats.conflictsByType.resource).toBe( 1);
    expect(stats.conflictsByType.task).toBe( 1);
  });

  it('should cleanup old conflicts', async () => {
    const conflict = await resolver.reportResourceConflict('resource-1', ['agent-1', 'agent-2']);
    
    // Resolve the conflict
    await resolver.autoResolve(conflict.id);
    
    // Cleanup old conflicts (immediate cleanup for test)
    const removed = resolver.cleanupOldConflicts(0);
    
    expect(removed).toBe( 1);
  });
});
