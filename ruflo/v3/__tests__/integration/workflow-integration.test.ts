import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WorkflowEngine } from '../../src/task-execution/application/WorkflowEngine';
import { SwarmCoordinator } from '../../src/coordination/application/SwarmCoordinator';
import { HybridBackend } from '../../src/memory/infrastructure/HybridBackend';
import { PluginManager } from '../../src/infrastructure/plugins/PluginManager';
import { Task } from '../../src/task-execution/domain/Task';
import { Agent } from '../../src/agent-lifecycle/domain/Agent';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs/promises';

describe('Full Workflow Integration Tests', () => {
  let workflowEngine: WorkflowEngine;
  let coordinator: SwarmCoordinator;
  let memoryBackend: HybridBackend;
  let pluginManager: PluginManager;
  let eventBus: EventEmitter;
  let testDbPath: string;

  beforeEach(async () => {
    testDbPath = path.join(__dirname, `workflow-test-${Date.now()}.db`);
    eventBus = new EventEmitter();

    // Initialize memory backend
    memoryBackend = {
      store: vi.fn().mockResolvedValue(undefined),
      retrieve: vi.fn().mockResolvedValue(null),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      vectorSearch: vi.fn().mockResolvedValue([]),
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    } as any;

    // Initialize plugin manager
    pluginManager = new PluginManager({ eventBus });
    await pluginManager.initialize();

    // Initialize coordinator
    coordinator = new SwarmCoordinator({
      topology: 'hierarchical',
      memoryBackend,
      eventBus,
      pluginManager
    });
    await coordinator.initialize();

    // Initialize workflow engine
    workflowEngine = new WorkflowEngine({
      coordinator,
      memoryBackend,
      eventBus,
      pluginManager
    });
    await workflowEngine.initialize();
  });

  afterEach(async () => {
    await workflowEngine.shutdown();
    await coordinator.shutdown();
    await pluginManager.shutdown();

    try {
      await fs.unlink(testDbPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should execute end-to-end agent workflow', async () => {
    // 1. Spawn agents
    const coder = await coordinator.spawnAgent({
      id: 'coder-1',
      type: 'coder',
      capabilities: ['code', 'refactor']
    });

    const tester = await coordinator.spawnAgent({
      id: 'tester-1',
      type: 'tester',
      capabilities: ['test', 'validate']
    });

    // 2. Create workflow
    const workflow = {
      id: 'feature-workflow',
      name: 'Implement Feature',
      tasks: [
        {
          id: 'code-task',
          type: 'code',
          description: 'Implement login feature',
          assignedTo: 'coder-1',
          priority: 'high'
        },
        {
          id: 'test-task',
          type: 'test',
          description: 'Test login feature',
          assignedTo: 'tester-1',
          priority: 'high',
          dependencies: ['code-task']
        }
      ]
    };

    // 3. Execute workflow
    const result = await workflowEngine.executeWorkflow(workflow);

    // 4. Verify execution
    expect(result.status).toBe('completed');
    expect(result.tasksCompleted).toBe(2);
    expect(result.errors).toHaveLength(0);

    // 5. Verify memory persistence
    expect(memoryBackend.store).toHaveBeenCalled();
  });

  it('should persist task execution pipeline to memory', async () => {
    const storedMemories: any[] = [];
    (memoryBackend.store as any).mockImplementation(async (memory) => {
      storedMemories.push(memory);
      return memory;
    });

    await coordinator.spawnAgent({
      id: 'worker',
      type: 'coder',
      capabilities: ['code']
    });

    const task: Task = {
      id: 'persist-task',
      type: 'code',
      description: 'Persistence test',
      priority: 'medium'
    };

    await workflowEngine.executeTask(task, 'worker');

    // Verify task lifecycle was persisted
    expect(storedMemories.length).toBeGreaterThan(0);

    const taskStartMemory = storedMemories.find(m =>
      m.type === 'task-start' && m.metadata?.taskId === 'persist-task'
    );

    const taskCompleteMemory = storedMemories.find(m =>
      m.type === 'task-complete' && m.metadata?.taskId === 'persist-task'
    );

    expect(taskStartMemory).toBeDefined();
    expect(taskCompleteMemory).toBeDefined();
  });

  it('should handle memory persistence across multiple operations', async () => {
    const memories = new Map<string, any>();

    (memoryBackend.store as any).mockImplementation(async (memory) => {
      memories.set(memory.id, memory);
      return memory;
    });

    (memoryBackend.retrieve as any).mockImplementation(async (id) => {
      return memories.get(id) || null;
    });

    (memoryBackend.query as any).mockImplementation(async (query) => {
      return Array.from(memories.values()).filter(m => {
        if (query.agentId && m.agentId !== query.agentId) return false;
        if (query.type && m.type !== query.type) return false;
        return true;
      });
    });

    // Create agent
    const agent = await coordinator.spawnAgent({
      id: 'persistent-agent',
      type: 'coder',
      capabilities: ['code']
    });

    // Execute multiple tasks
    const tasks = [
      { id: 'task-1', type: 'code', description: 'Task 1', priority: 'high' as const },
      { id: 'task-2', type: 'code', description: 'Task 2', priority: 'medium' as const },
      { id: 'task-3', type: 'code', description: 'Task 3', priority: 'low' as const }
    ];

    for (const task of tasks) {
      await workflowEngine.executeTask(task, 'persistent-agent');
    }

    // Query memories
    const agentMemories = await memoryBackend.query({ agentId: 'persistent-agent' });

    expect(agentMemories.length).toBeGreaterThan(0);
    expect(memories.size).toBeGreaterThan(0);
  });

  it('should coordinate multi-agent parallel execution', async () => {
    const agents = await Promise.all([
      coordinator.spawnAgent({ id: 'parallel-1', type: 'coder', capabilities: ['code'] }),
      coordinator.spawnAgent({ id: 'parallel-2', type: 'coder', capabilities: ['code'] }),
      coordinator.spawnAgent({ id: 'parallel-3', type: 'coder', capabilities: ['code'] })
    ]);

    const tasks: Task[] = [
      { id: 'p-task-1', type: 'code', description: 'Parallel 1', priority: 'high' },
      { id: 'p-task-2', type: 'code', description: 'Parallel 2', priority: 'high' },
      { id: 'p-task-3', type: 'code', description: 'Parallel 3', priority: 'high' }
    ];

    const startTime = Date.now();
    const results = await workflowEngine.executeParallel(tasks);
    const duration = Date.now() - startTime;

    expect(results).toHaveLength(3);
    expect(results.every(r => r.status === 'completed' || r.status === 'failed')).toBe(true);

    // Parallel execution should be faster than sequential
    expect(duration).toBeLessThan(500);
  });

  it('should handle complex workflow with dependencies', async () => {
    await coordinator.spawnAgent({ id: 'designer', type: 'designer', capabilities: ['design'] });
    await coordinator.spawnAgent({ id: 'coder', type: 'coder', capabilities: ['code'] });
    await coordinator.spawnAgent({ id: 'tester', type: 'tester', capabilities: ['test'] });
    await coordinator.spawnAgent({ id: 'deployer', type: 'deployer', capabilities: ['deploy'] });

    const workflow = {
      id: 'complex-workflow',
      name: 'Full Stack Feature',
      tasks: [
        {
          id: 'design',
          type: 'design',
          description: 'Design UI',
          assignedTo: 'designer',
          priority: 'high' as const,
          dependencies: []
        },
        {
          id: 'implement',
          type: 'code',
          description: 'Implement feature',
          assignedTo: 'coder',
          priority: 'high' as const,
          dependencies: ['design']
        },
        {
          id: 'test',
          type: 'test',
          description: 'Test implementation',
          assignedTo: 'tester',
          priority: 'high' as const,
          dependencies: ['implement']
        },
        {
          id: 'deploy',
          type: 'deploy',
          description: 'Deploy to production',
          assignedTo: 'deployer',
          priority: 'high' as const,
          dependencies: ['test']
        }
      ]
    };

    const result = await workflowEngine.executeWorkflow(workflow);

    expect(result.status).toBe('completed');
    expect(result.executionOrder).toEqual(['design', 'implement', 'test', 'deploy']);
  });

  it('should integrate plugins into workflow execution', async () => {
    const pluginCalls: string[] = [];

    const validatorPlugin = {
      id: 'workflow-validator',
      name: 'Workflow Validator',
      version: '1.0.0',
      initialize: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
      getExtensionPoints: vi.fn().mockReturnValue([
        {
          name: 'workflow.beforeExecute',
          handler: async (workflow) => {
            pluginCalls.push('validate');
            return { validated: true, workflow };
          }
        },
        {
          name: 'workflow.afterExecute',
          handler: async (result) => {
            pluginCalls.push('complete');
            return { logged: true, result };
          }
        }
      ])
    };

    await pluginManager.loadPlugin(validatorPlugin);

    await coordinator.spawnAgent({ id: 'plugin-agent', type: 'coder', capabilities: ['code'] });

    const workflow = {
      id: 'plugin-workflow',
      name: 'Plugin Test',
      tasks: [
        {
          id: 'task-1',
          type: 'code',
          description: 'Test task',
          assignedTo: 'plugin-agent',
          priority: 'high' as const
        }
      ]
    };

    await workflowEngine.executeWorkflow(workflow);

    expect(pluginCalls).toContain('validate');
    expect(pluginCalls).toContain('complete');
  });

  it('should handle workflow failures and rollback', async () => {
    const executedTasks: string[] = [];
    const rolledBackTasks: string[] = [];

    await coordinator.spawnAgent({
      id: 'failing-agent',
      type: 'coder',
      capabilities: ['code']
    });

    const workflow = {
      id: 'rollback-workflow',
      name: 'Rollback Test',
      tasks: [
        {
          id: 'success-1',
          type: 'code',
          description: 'Success task 1',
          assignedTo: 'failing-agent',
          priority: 'high' as const,
          onExecute: () => executedTasks.push('success-1'),
          onRollback: () => rolledBackTasks.push('success-1')
        },
        {
          id: 'success-2',
          type: 'code',
          description: 'Success task 2',
          assignedTo: 'failing-agent',
          priority: 'high' as const,
          dependencies: ['success-1'],
          onExecute: () => executedTasks.push('success-2'),
          onRollback: () => rolledBackTasks.push('success-2')
        },
        {
          id: 'failure',
          type: 'code',
          description: 'Failing task',
          assignedTo: 'failing-agent',
          priority: 'high' as const,
          dependencies: ['success-2'],
          onExecute: () => {
            executedTasks.push('failure');
            throw new Error('Intentional failure');
          },
          onRollback: () => rolledBackTasks.push('failure')
        }
      ],
      rollbackOnFailure: true
    };

    const result = await workflowEngine.executeWorkflow(workflow);

    expect(result.status).toBe('failed');
    expect(executedTasks).toContain('success-1');
    expect(executedTasks).toContain('success-2');
    expect(rolledBackTasks.length).toBeGreaterThan(0);
  });

  it('should support workflow resume after interruption', async () => {
    await coordinator.spawnAgent({ id: 'resume-agent', type: 'coder', capabilities: ['code'] });

    const workflow = {
      id: 'resume-workflow',
      name: 'Resume Test',
      tasks: [
        { id: 'task-1', type: 'code', description: 'Task 1', assignedTo: 'resume-agent', priority: 'high' as const },
        { id: 'task-2', type: 'code', description: 'Task 2', assignedTo: 'resume-agent', priority: 'high' as const },
        { id: 'task-3', type: 'code', description: 'Task 3', assignedTo: 'resume-agent', priority: 'high' as const }
      ]
    };

    // Start workflow
    const execution = workflowEngine.startWorkflow(workflow);

    // Simulate interruption after first task
    await new Promise(resolve => setTimeout(resolve, 100));
    await workflowEngine.pauseWorkflow('resume-workflow');

    const checkpointState = await workflowEngine.getWorkflowState('resume-workflow');
    expect(checkpointState.status).toBe('paused');

    // Resume workflow
    await workflowEngine.resumeWorkflow('resume-workflow');
    const result = await execution;

    expect(result.status).toBe('completed');
  });

  it('should monitor and report workflow metrics', async () => {
    await coordinator.spawnAgent({ id: 'metrics-agent', type: 'coder', capabilities: ['code'] });

    const workflow = {
      id: 'metrics-workflow',
      name: 'Metrics Test',
      tasks: Array.from({ length: 5 }, (_, i) => ({
        id: `metric-task-${i}`,
        type: 'code',
        description: `Metric task ${i}`,
        assignedTo: 'metrics-agent',
        priority: 'medium' as const
      }))
    };

    await workflowEngine.executeWorkflow(workflow);

    const metrics = await workflowEngine.getWorkflowMetrics('metrics-workflow');

    expect(metrics.tasksTotal).toBe(5);
    expect(metrics.tasksCompleted).toBe(5);
    expect(metrics.totalDuration).toBeGreaterThan(0);
    expect(metrics.averageTaskDuration).toBeGreaterThan(0);
    expect(metrics.successRate).toBe(1.0);
  });

  it('should integrate event-driven architecture', async () => {
    const events: any[] = [];

    eventBus.on('workflow:started', (e) => events.push({ type: 'started', ...e }));
    eventBus.on('workflow:taskComplete', (e) => events.push({ type: 'taskComplete', ...e }));
    eventBus.on('workflow:completed', (e) => events.push({ type: 'completed', ...e }));

    await coordinator.spawnAgent({ id: 'event-agent', type: 'coder', capabilities: ['code'] });

    const workflow = {
      id: 'event-workflow',
      name: 'Event Test',
      tasks: [
        {
          id: 'event-task',
          type: 'code',
          description: 'Event task',
          assignedTo: 'event-agent',
          priority: 'high' as const
        }
      ]
    };

    await workflowEngine.executeWorkflow(workflow);

    // Allow async event processing
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(events.find(e => e.type === 'started')).toBeDefined();
    expect(events.find(e => e.type === 'taskComplete')).toBeDefined();
    expect(events.find(e => e.type === 'completed')).toBeDefined();
  });

  it('should support distributed workflow execution', async () => {
    // Create multiple coordinators (simulating distributed nodes)
    const node1Coordinator = coordinator;
    const node2Coordinator = new SwarmCoordinator({
      topology: 'mesh',
      memoryBackend,
      eventBus
    });
    await node2Coordinator.initialize();

    await node1Coordinator.spawnAgent({ id: 'node1-agent', type: 'coder', capabilities: ['code'] });
    await node2Coordinator.spawnAgent({ id: 'node2-agent', type: 'coder', capabilities: ['code'] });

    const distributedWorkflow = {
      id: 'distributed-workflow',
      name: 'Distributed Test',
      tasks: [
        {
          id: 'node1-task',
          type: 'code',
          description: 'Node 1 task',
          assignedTo: 'node1-agent',
          priority: 'high' as const
        },
        {
          id: 'node2-task',
          type: 'code',
          description: 'Node 2 task',
          assignedTo: 'node2-agent',
          priority: 'high' as const
        }
      ]
    };

    const result = await workflowEngine.executeDistributedWorkflow(
      distributedWorkflow,
      [node1Coordinator, node2Coordinator]
    );

    expect(result.status).toBe('completed');
    expect(result.tasksCompleted).toBe(2);

    await node2Coordinator.shutdown();
  });

  it('should persist complete workflow state across restarts', async () => {
    const workflowState = {
      id: 'persistent-workflow',
      name: 'Persistence Test',
      tasks: [
        { id: 'task-1', type: 'code', description: 'Task 1', priority: 'high' as const }
      ],
      status: 'in-progress',
      completedTasks: [],
      currentTask: 'task-1'
    };

    await memoryBackend.store({
      id: 'workflow-state',
      agentId: 'system',
      content: JSON.stringify(workflowState),
      type: 'workflow-state',
      timestamp: Date.now()
    });

    // Simulate restart
    await workflowEngine.shutdown();
    workflowEngine = new WorkflowEngine({
      coordinator,
      memoryBackend,
      eventBus,
      pluginManager
    });
    await workflowEngine.initialize();

    (memoryBackend.retrieve as any).mockResolvedValue({
      id: 'workflow-state',
      agentId: 'system',
      content: JSON.stringify(workflowState),
      type: 'workflow-state',
      timestamp: Date.now()
    });

    const restored = await workflowEngine.restoreWorkflow('persistent-workflow');

    expect(restored).toBeDefined();
    expect(restored.id).toBe('persistent-workflow');
    expect(restored.status).toBe('in-progress');
  });

  it('should handle concurrent workflow executions', async () => {
    await coordinator.spawnAgent({ id: 'concurrent-worker', type: 'coder', capabilities: ['code'] });

    const workflows = Array.from({ length: 5 }, (_, i) => ({
      id: `concurrent-workflow-${i}`,
      name: `Concurrent ${i}`,
      tasks: [
        {
          id: `task-${i}`,
          type: 'code',
          description: `Task ${i}`,
          assignedTo: 'concurrent-worker',
          priority: 'medium' as const
        }
      ]
    }));

    const results = await Promise.all(
      workflows.map(w => workflowEngine.executeWorkflow(w))
    );

    expect(results).toHaveLength(5);
    expect(results.every(r => r.status === 'completed' || r.status === 'failed')).toBe(true);
  });

  it('should support workflow composition and nesting', async () => {
    await coordinator.spawnAgent({ id: 'composer', type: 'coder', capabilities: ['code'] });

    const subWorkflow = {
      id: 'sub-workflow',
      name: 'Sub Workflow',
      tasks: [
        {
          id: 'sub-task-1',
          type: 'code',
          description: 'Sub task 1',
          assignedTo: 'composer',
          priority: 'high' as const
        },
        {
          id: 'sub-task-2',
          type: 'code',
          description: 'Sub task 2',
          assignedTo: 'composer',
          priority: 'high' as const
        }
      ]
    };

    const mainWorkflow = {
      id: 'main-workflow',
      name: 'Main Workflow',
      tasks: [
        {
          id: 'main-task-1',
          type: 'code',
          description: 'Main task 1',
          assignedTo: 'composer',
          priority: 'high' as const
        },
        {
          id: 'nested-workflow',
          type: 'workflow',
          description: 'Execute sub-workflow',
          workflow: subWorkflow,
          priority: 'high' as const,
          dependencies: ['main-task-1']
        },
        {
          id: 'main-task-2',
          type: 'code',
          description: 'Main task 2',
          assignedTo: 'composer',
          priority: 'high' as const,
          dependencies: ['nested-workflow']
        }
      ]
    };

    const result = await workflowEngine.executeWorkflow(mainWorkflow);

    expect(result.status).toBe('completed');
    expect(result.tasksCompleted).toBeGreaterThanOrEqual(4); // 2 main + 2 sub
  });

  it('should provide comprehensive workflow debugging', async () => {
    await coordinator.spawnAgent({ id: 'debug-agent', type: 'coder', capabilities: ['code'] });

    const workflow = {
      id: 'debug-workflow',
      name: 'Debug Test',
      debug: true,
      tasks: [
        {
          id: 'debug-task',
          type: 'code',
          description: 'Debug task',
          assignedTo: 'debug-agent',
          priority: 'high' as const
        }
      ]
    };

    const result = await workflowEngine.executeWorkflow(workflow);

    const debugInfo = await workflowEngine.getWorkflowDebugInfo('debug-workflow');

    expect(debugInfo.executionTrace).toBeDefined();
    expect(debugInfo.taskTimings).toBeDefined();
    expect(debugInfo.memorySnapshots).toBeDefined();
    expect(debugInfo.eventLog).toBeDefined();
  });
});
