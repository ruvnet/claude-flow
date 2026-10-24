import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SwarmCoordinator } from '../../src/coordination/application/SwarmCoordinator';
import { Agent } from '../../src/agent-lifecycle/domain/Agent';
import { Task } from '../../src/task-execution/domain/Task';
import { HybridBackend } from '../../src/memory/infrastructure/HybridBackend';
import { EventEmitter } from 'events';

describe('Swarm Integration Tests', () => {
  let coordinator: SwarmCoordinator;
  let memoryBackend: HybridBackend;
  let eventBus: EventEmitter;

  beforeEach(async () => {
    eventBus = new EventEmitter();
    memoryBackend = {
      store: vi.fn(),
      retrieve: vi.fn(),
      query: vi.fn(),
      initialize: vi.fn(),
      close: vi.fn()
    } as any;

    coordinator = new SwarmCoordinator({
      topology: 'hierarchical',
      memoryBackend,
      eventBus
    });

    await coordinator.initialize();
  });

  afterEach(async () => {
    await coordinator.shutdown();
  });

  it('should spawn multiple agents in swarm', async () => {
    const agentConfigs = [
      { id: 'agent-1', type: 'coder', capabilities: ['code', 'refactor'] },
      { id: 'agent-2', type: 'tester', capabilities: ['test', 'validate'] },
      { id: 'agent-3', type: 'reviewer', capabilities: ['review', 'analyze'] }
    ];

    const agents = await Promise.all(
      agentConfigs.map(config => coordinator.spawnAgent(config))
    );

    expect(agents).toHaveLength(3);
    expect(agents[0].id).toBe('agent-1');
    expect(agents[1].id).toBe('agent-2');
    expect(agents[2].id).toBe('agent-3');

    const activeAgents = await coordinator.listAgents();
    expect(activeAgents).toHaveLength(3);
  });

  it('should coordinate task distribution across agents', async () => {
    await coordinator.spawnAgent({ id: 'coder-1', type: 'coder', capabilities: ['code'] });
    await coordinator.spawnAgent({ id: 'coder-2', type: 'coder', capabilities: ['code'] });

    const tasks: Task[] = [
      { id: 'task-1', type: 'code', description: 'Implement feature A', priority: 'high' },
      { id: 'task-2', type: 'code', description: 'Implement feature B', priority: 'medium' },
      { id: 'task-3', type: 'code', description: 'Implement feature C', priority: 'low' }
    ];

    const assignments = await coordinator.distributeTasks(tasks);

    expect(assignments).toHaveLength(3);
    expect(assignments.every(a => a.agentId)).toBe(true);
    expect(assignments.every(a => a.taskId)).toBe(true);

    // Verify load balancing
    const agent1Tasks = assignments.filter(a => a.agentId === 'coder-1');
    const agent2Tasks = assignments.filter(a => a.agentId === 'coder-2');

    // Tasks should be distributed (not all to one agent)
    expect(agent1Tasks.length).toBeGreaterThan(0);
    expect(agent2Tasks.length).toBeGreaterThan(0);
  });

  it('should handle multi-agent communication', async () => {
    const sender = await coordinator.spawnAgent({
      id: 'sender',
      type: 'coder',
      capabilities: ['code']
    });

    const receiver = await coordinator.spawnAgent({
      id: 'receiver',
      type: 'reviewer',
      capabilities: ['review']
    });

    const messages: any[] = [];
    eventBus.on('agent:message', (msg) => messages.push(msg));

    await coordinator.sendMessage({
      from: 'sender',
      to: 'receiver',
      type: 'task-complete',
      payload: { taskId: 'task-1', result: 'success' }
    });

    // Allow async event processing
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(messages.length).toBeGreaterThan(0);
    expect(messages[0].from).toBe('sender');
    expect(messages[0].to).toBe('receiver');
  });

  it('should maintain swarm state across operations', async () => {
    await coordinator.spawnAgent({ id: 'agent-1', type: 'coder', capabilities: ['code'] });

    const stateBefore = await coordinator.getSwarmState();
    expect(stateBefore.agents).toHaveLength(1);

    await coordinator.spawnAgent({ id: 'agent-2', type: 'tester', capabilities: ['test'] });

    const stateAfter = await coordinator.getSwarmState();
    expect(stateAfter.agents).toHaveLength(2);
    expect(stateAfter.topology).toBe('hierarchical');
  });

  it('should handle agent failures gracefully', async () => {
    const agent = await coordinator.spawnAgent({
      id: 'fragile-agent',
      type: 'coder',
      capabilities: ['code']
    });

    const task: Task = {
      id: 'failing-task',
      type: 'code',
      description: 'This will fail',
      priority: 'high'
    };

    // Mock agent failure
    vi.spyOn(agent, 'executeTask').mockRejectedValue(new Error('Agent crashed'));

    const result = await coordinator.executeTask('fragile-agent', task);

    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();

    // Verify swarm continues functioning
    const agents = await coordinator.listAgents();
    expect(agents).toHaveLength(1);
  });

  it('should coordinate hierarchical agent topology', async () => {
    const queen = await coordinator.spawnAgent({
      id: 'queen',
      type: 'coordinator',
      capabilities: ['coordinate', 'manage'],
      role: 'leader'
    });

    const workers = await Promise.all([
      coordinator.spawnAgent({ id: 'worker-1', type: 'coder', capabilities: ['code'], parent: 'queen' }),
      coordinator.spawnAgent({ id: 'worker-2', type: 'tester', capabilities: ['test'], parent: 'queen' }),
      coordinator.spawnAgent({ id: 'worker-3', type: 'reviewer', capabilities: ['review'], parent: 'queen' })
    ]);

    const hierarchy = await coordinator.getHierarchy();

    expect(hierarchy.leader).toBe('queen');
    expect(hierarchy.workers).toHaveLength(3);
    expect(hierarchy.workers.every(w => w.parent === 'queen')).toBe(true);
  });

  it('should support mesh topology coordination', async () => {
    coordinator = new SwarmCoordinator({
      topology: 'mesh',
      memoryBackend,
      eventBus
    });
    await coordinator.initialize();

    const agents = await Promise.all([
      coordinator.spawnAgent({ id: 'mesh-1', type: 'coder', capabilities: ['code'] }),
      coordinator.spawnAgent({ id: 'mesh-2', type: 'tester', capabilities: ['test'] }),
      coordinator.spawnAgent({ id: 'mesh-3', type: 'reviewer', capabilities: ['review'] })
    ]);

    const connections = await coordinator.getMeshConnections();

    // In mesh topology, each agent should be connected to others
    expect(connections.length).toBeGreaterThan(0);
    expect(connections.every(c => c.type === 'peer')).toBe(true);
  });

  it('should handle dynamic agent scaling', async () => {
    await coordinator.spawnAgent({ id: 'base-agent', type: 'coder', capabilities: ['code'] });

    const initialCount = (await coordinator.listAgents()).length;
    expect(initialCount).toBe(1);

    // Scale up
    await coordinator.scaleAgents({ type: 'coder', count: 3 });

    const scaledUpCount = (await coordinator.listAgents()).length;
    expect(scaledUpCount).toBe(4);

    // Scale down
    await coordinator.scaleAgents({ type: 'coder', count: 2 });

    const scaledDownCount = (await coordinator.listAgents()).length;
    expect(scaledDownCount).toBe(2);
  });

  it('should persist swarm state to memory', async () => {
    await coordinator.spawnAgent({ id: 'persistent-agent', type: 'coder', capabilities: ['code'] });

    const task: Task = {
      id: 'persist-task',
      type: 'code',
      description: 'Test persistence',
      priority: 'high'
    };

    await coordinator.executeTask('persistent-agent', task);

    // Verify memory backend was called
    expect(memoryBackend.store).toHaveBeenCalled();

    const storedData = (memoryBackend.store as any).mock.calls;
    expect(storedData.length).toBeGreaterThan(0);
  });

  it('should handle concurrent task execution', async () => {
    const agents = await Promise.all([
      coordinator.spawnAgent({ id: 'concurrent-1', type: 'coder', capabilities: ['code'] }),
      coordinator.spawnAgent({ id: 'concurrent-2', type: 'coder', capabilities: ['code'] }),
      coordinator.spawnAgent({ id: 'concurrent-3', type: 'coder', capabilities: ['code'] })
    ]);

    const tasks: Task[] = Array.from({ length: 10 }, (_, i) => ({
      id: `task-${i}`,
      type: 'code',
      description: `Concurrent task ${i}`,
      priority: 'medium'
    }));

    const startTime = Date.now();
    const results = await coordinator.executeTasksConcurrently(tasks);
    const duration = Date.now() - startTime;

    expect(results).toHaveLength(10);
    expect(results.every(r => r.status === 'completed' || r.status === 'failed')).toBe(true);

    // Concurrent execution should be faster than sequential
    expect(duration).toBeLessThan(1000); // Adjust based on mock implementation
  });

  it('should implement consensus mechanism for critical decisions', async () => {
    const agents = await Promise.all([
      coordinator.spawnAgent({ id: 'voter-1', type: 'reviewer', capabilities: ['review'] }),
      coordinator.spawnAgent({ id: 'voter-2', type: 'reviewer', capabilities: ['review'] }),
      coordinator.spawnAgent({ id: 'voter-3', type: 'reviewer', capabilities: ['review'] })
    ]);

    const decision = {
      id: 'consensus-1',
      type: 'code-approval',
      payload: { code: 'function test() { return true; }' }
    };

    const consensusResult = await coordinator.reachConsensus(decision, agents.map(a => a.id));

    expect(consensusResult.decision).toBeDefined();
    expect(consensusResult.votes).toHaveLength(3);
    expect(consensusResult.consensusReached).toBeDefined();
  });

  it('should handle agent termination and cleanup', async () => {
    const agent = await coordinator.spawnAgent({
      id: 'temporary-agent',
      type: 'coder',
      capabilities: ['code']
    });

    expect(await coordinator.listAgents()).toHaveLength(1);

    await coordinator.terminateAgent('temporary-agent');

    const remainingAgents = await coordinator.listAgents();
    expect(remainingAgents).toHaveLength(0);
    expect(remainingAgents.find(a => a.id === 'temporary-agent')).toBeUndefined();
  });

  it('should support task dependency resolution', async () => {
    await coordinator.spawnAgent({ id: 'dep-agent', type: 'coder', capabilities: ['code'] });

    const tasks: Task[] = [
      {
        id: 'task-1',
        type: 'code',
        description: 'Base task',
        priority: 'high',
        dependencies: []
      },
      {
        id: 'task-2',
        type: 'code',
        description: 'Depends on task-1',
        priority: 'high',
        dependencies: ['task-1']
      },
      {
        id: 'task-3',
        type: 'code',
        description: 'Depends on task-2',
        priority: 'high',
        dependencies: ['task-2']
      }
    ];

    const executionOrder = await coordinator.resolveTaskDependencies(tasks);

    expect(executionOrder[0].id).toBe('task-1');
    expect(executionOrder[1].id).toBe('task-2');
    expect(executionOrder[2].id).toBe('task-3');
  });

  it('should monitor agent health and performance', async () => {
    const agent = await coordinator.spawnAgent({
      id: 'monitored-agent',
      type: 'coder',
      capabilities: ['code']
    });

    const tasks: Task[] = Array.from({ length: 5 }, (_, i) => ({
      id: `perf-task-${i}`,
      type: 'code',
      description: `Performance test ${i}`,
      priority: 'medium'
    }));

    for (const task of tasks) {
      await coordinator.executeTask('monitored-agent', task);
    }

    const metrics = await coordinator.getAgentMetrics('monitored-agent');

    expect(metrics.tasksCompleted).toBeGreaterThanOrEqual(0);
    expect(metrics.averageExecutionTime).toBeDefined();
    expect(metrics.successRate).toBeDefined();
    expect(metrics.health).toBeDefined();
  });

  it('should support swarm reconfiguration on the fly', async () => {
    // Start with hierarchical
    expect(coordinator.getTopology()).toBe('hierarchical');

    await coordinator.spawnAgent({ id: 'reconfig-1', type: 'coder', capabilities: ['code'] });
    await coordinator.spawnAgent({ id: 'reconfig-2', type: 'tester', capabilities: ['test'] });

    // Reconfigure to mesh
    await coordinator.reconfigure({ topology: 'mesh' });

    expect(coordinator.getTopology()).toBe('mesh');

    const agents = await coordinator.listAgents();
    expect(agents).toHaveLength(2); // Agents should persist
  });
});
