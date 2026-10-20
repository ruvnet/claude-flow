import { beforeEach, describe, expect, it } from 'vitest';
import { AgentRegistry } from '../src/coordination/agent-registry.js';
import { TaskOrchestrator } from '../src/coordination/task-orchestrator.js';
import { EventBus } from '../src/shared/events.js';

let registry: AgentRegistry;
let orchestrator: TaskOrchestrator;
let events: EventBus;
beforeEach(async () => {
  events = new EventBus();
  registry = new AgentRegistry(events);
  await registry.spawn('agent-6');
  orchestrator = new TaskOrchestrator(events, registry);
});

function runningTask() {
  const task = orchestrator.createTask({
    type: 'implementation', title: 'Implement change', description: 'Regression fixture',
    domain: 'core', phase: 'phase-2-core',
  });
  orchestrator.queueTask(task.id);
  orchestrator.assignTask(task.id, 'agent-6');
  orchestrator.startTask(task.id);
  return task;
}

function expectReleased() {
  expect(registry.getState('agent-6')).toMatchObject({ currentTask: null, status: 'idle' });
  expect(registry.getState('agent-6')!.completedTasks).toEqual([]);
  expect(registry.getState('agent-6')!.metrics.tasksCompleted).toBe(0);
}

describe('TaskOrchestrator worker ownership after non-success', () => {
  it('releases the worker so the retry can be assigned to the same agent', () => {
    const task = runningTask();
    orchestrator.failTask(task.id, new Error('retryable'));
    expectReleased();
    expect(task).toMatchObject({ status: 'queued', assignedAgent: null });
    expect(() => orchestrator.assignTask(task.id, 'agent-6')).not.toThrow();
    orchestrator.startTask(task.id);
    expect(registry.getState('agent-6')!.currentTask).toBe(task.id);
  });

  it('releases a terminally failed worker without counting a successful completion', () => {
    const task = runningTask();
    for (let attempt = 1; attempt <= task.metadata.maxRetries; attempt++) {
      if (attempt > 1) {
        orchestrator.assignTask(task.id, 'agent-6');
        orchestrator.startTask(task.id);
      }
      orchestrator.failTask(task.id, new Error('permanent'));
    }
    expect(task.status).toBe('failed');
    expectReleased();
    expect(registry.getState('agent-6')!.metrics.tasksFailed).toBe(1);
    expect(() => runningTask()).not.toThrow();
  });

  it('clears ownership on cancellation so an idle agent can accept another task', () => {
    const task = runningTask();
    orchestrator.cancelTask(task.id);
    expect(task.status).toBe('cancelled');
    expectReleased();
    expect(() => runningTask()).not.toThrow();
  });

  it('keeps a rejected assignment queued without claiming a busy worker', () => {
    const active = runningTask();
    const queued = orchestrator.createTask({
      type: 'implementation', title: 'Next', description: '',
      domain: 'core', phase: 'phase-2-core',
    });
    orchestrator.queueTask(queued.id);
    expect(() => orchestrator.assignTask(queued.id, 'agent-6')).toThrow('already has task');
    expect(queued).toMatchObject({ status: 'queued', assignedAgent: null });
    expect(registry.getState('agent-6')!.currentTask).toBe(active.id);
  });

  it('does not release another task when cancelling an old assignment again', () => {
    const cancelled = runningTask();
    orchestrator.cancelTask(cancelled.id);
    const active = runningTask();
    orchestrator.cancelTask(cancelled.id);
    expect(registry.getState('agent-6')).toMatchObject({ currentTask: active.id, status: 'active' });
  });

  it('continues to count successful completion once', () => {
    const task = runningTask();
    orchestrator.completeTask(task.id, {
      taskId: task.id, success: true, output: null, error: null, duration: 1,
      metrics: { linesOfCode: 0, testsWritten: 0, testsPassed: 0, coveragePercent: 0, performanceImpact: 0 },
    });
    expect(registry.getState('agent-6')).toMatchObject({ currentTask: null, status: 'idle' });
    expect(registry.getState('agent-6')!.completedTasks).toEqual([task.id]);
    expect(registry.getState('agent-6')!.metrics.tasksCompleted).toBe(1);
    expect(registry.getState('agent-6')!.metrics.tasksFailed).toBe(0);
  });

  it('exposes consistent ownership to synchronous assignment event observers', () => {
    const observed: unknown[] = [];
    events.subscribe('agent:status-changed', () => {
      const state = registry.getState('agent-6')!;
      if (state.status === 'active') {
        const task = orchestrator.getTask(state.currentTask!)!;
        observed.push({ status: task.status, assignedAgent: task.assignedAgent });
      }
    });
    runningTask();
    expect(observed).toEqual([{ status: 'assigned', assignedAgent: 'agent-6' }]);
  });
});
