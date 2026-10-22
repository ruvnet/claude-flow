/**
 * Dream Cycle 2026-09-20 (performance): discriminating tests for the
 * event-driven rewrite of UnifiedSwarmCoordinator's waitForTaskCompletion()/
 * waitForQueuedTask(). Both previously busy-polled `state.tasks` on a
 * setInterval(..., 100) even though the coordinator already extends
 * EventEmitter and already fires 'task.completed'/'task.failed' at every
 * terminal task-status transition (handleTaskComplete, handleTaskFail's
 * non-retry branch, cancelTask).
 *
 * These tests use fake timers to prove the discriminating property: against
 * the pre-fix implementation, a wait promise does NOT resolve until a
 * setInterval tick actually fires (>=100ms of advanced fake time); against
 * the fix, it resolves on the same microtask queue drain as the terminal
 * event, with zero timer advance required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { UnifiedSwarmCoordinator, createUnifiedSwarmCoordinator } from '../src/unified-coordinator.js';

function baseCoordinatorConfig() {
  return {
    maxAgents: 5,
    maxTasks: 20,
    heartbeatIntervalMs: 1000,
    healthCheckIntervalMs: 2000,
    taskTimeoutMs: 10000,
    topology: { type: 'hierarchical' as const, maxAgents: 5 },
    consensus: {
      algorithm: 'raft' as const,
      threshold: 0.66,
      timeoutMs: 5000,
      maxRounds: 5,
      requireQuorum: true,
    },
  };
}

describe('UnifiedSwarmCoordinator event-driven task wait (Dream Cycle 2026-09-20)', () => {
  let coordinator: UnifiedSwarmCoordinator;

  beforeEach(async () => {
    coordinator = createUnifiedSwarmCoordinator(baseCoordinatorConfig());
    await coordinator.initialize();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await coordinator.shutdown();
  });

  it('resolves waitForTaskCompletion on the task.completed event without waiting for a poll tick', async () => {
    vi.useFakeTimers();

    const agentId = await coordinator.registerAgent({
      name: 'worker',
      type: 'coder',
      status: 'idle',
      capabilities: { languages: [], frameworks: [], domains: [], tools: [], maxConcurrentTasks: 1, reliability: 1 },
      metrics: { tasksCompleted: 0, tasksFailed: 0, avgTaskDurationMs: 0, successRate: 1, cpuUsage: 0, memoryUsageMb: 0, messagesProcessed: 0 },
      workload: 0,
      health: 1.0,
      lastHeartbeat: new Date(),
      topologyRole: 'worker',
      connections: [],
    });

    const taskId = await coordinator.submitTask({
      type: 'coding',
      name: 'Event wait task',
      description: 'discriminating test',
      priority: 'normal',
      dependencies: [],
      input: {},
      timeoutMs: 10000,
      retries: 0,
      maxRetries: 3,
      metadata: {},
    });

    // Task should already be assigned to the pre-registered idle agent.
    expect(coordinator.getTask(taskId)?.status).toBe('assigned');

    const waitPromise = (coordinator as unknown as {
      waitForTaskCompletion(taskId: string, timeoutMs: number): Promise<{ status: string; output?: unknown }>;
    }).waitForTaskCompletion(taskId, 10000);

    let resolved = false;
    void waitPromise.then(() => {
      resolved = true;
    });

    // Fire the real completion path (sets status + emitEvent('task.completed', ...)).
    (coordinator as unknown as {
      handleTaskComplete(agentId: string, data: { taskId: string; result: unknown }): void;
    }).handleTaskComplete(agentId, { taskId, result: { ok: true } });

    // Drain microtasks WITHOUT advancing any timer. A setInterval(..., 100)
    // poll cannot have fired yet — this is the discriminating assertion.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(resolved).toBe(true);

    const result = await waitPromise;
    expect(result.status).toBe('completed');
    expect(result.output).toEqual({ ok: true });
  });

  it('resolves waitForQueuedTask on the task.completed event without waiting for a poll tick', async () => {
    vi.useFakeTimers();

    // Registered as 'busy' so assignTask() skips it and the task below stays
    // genuinely 'queued' (matching what waitForQueuedTask actually waits on)
    // — it exists only so handleTaskComplete() (which looks up the agent by
    // id) has a valid agent record to find.
    const spareAgentId = await coordinator.registerAgent({
      name: 'spare-worker',
      type: 'coder',
      status: 'busy',
      capabilities: { languages: [], frameworks: [], domains: [], tools: [], maxConcurrentTasks: 1, reliability: 1 },
      metrics: { tasksCompleted: 0, tasksFailed: 0, avgTaskDurationMs: 0, successRate: 1, cpuUsage: 0, memoryUsageMb: 0, messagesProcessed: 0 },
      workload: 0,
      health: 1.0,
      lastHeartbeat: new Date(),
      topologyRole: 'worker',
      connections: [],
    });

    const taskId = await coordinator.submitTask({
      type: 'coding',
      name: 'Queued event wait task',
      description: 'discriminating test',
      priority: 'normal',
      dependencies: [],
      input: {},
      timeoutMs: 10000,
      retries: 0,
      maxRetries: 3,
      metadata: {},
    });

    // No agent registered: assignTask() leaves the task 'queued'.
    expect(coordinator.getTask(taskId)?.status).toBe('queued');

    const waitPromise = (coordinator as unknown as {
      waitForQueuedTask(
        taskId: string,
        domain: 'core',
        startTime: number
      ): Promise<{ success: boolean; result?: unknown; taskId: string }>;
    }).waitForQueuedTask(taskId, 'core', performance.now());

    let settled: { success: boolean; result?: unknown } | undefined;
    void waitPromise.then((r) => {
      settled = r;
    });

    (coordinator as unknown as {
      handleTaskComplete(agentId: string, data: { taskId: string; result: unknown }): void;
    }).handleTaskComplete(spareAgentId, {
      taskId,
      result: { done: true },
    });

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBeDefined();
    expect(settled?.success).toBe(true);
    expect(settled?.result).toEqual({ done: true });
  });

  it('still times out via the setTimeout fallback when no terminal event ever fires', async () => {
    vi.useFakeTimers();

    const taskId = await coordinator.submitTask({
      type: 'coding',
      name: 'Never completes',
      description: 'timeout fallback test',
      priority: 'normal',
      dependencies: [],
      input: {},
      timeoutMs: 10000,
      retries: 0,
      maxRetries: 3,
      metadata: {},
    });

    const waitPromise = (coordinator as unknown as {
      waitForQueuedTask(
        taskId: string,
        domain: 'core',
        startTime: number
      ): Promise<{ success: boolean; taskId: string; error?: Error }>;
    }).waitForQueuedTask(taskId, 'core', performance.now());

    let settled: { success: boolean; error?: Error } | undefined;
    void waitPromise.then((r) => {
      settled = r;
    });

    // Not enough time has passed yet.
    await vi.advanceTimersByTimeAsync(5000);
    expect(settled).toBeUndefined();

    // Cross the coordinator's configured taskTimeoutMs (10000).
    await vi.advanceTimersByTimeAsync(5001);

    expect(settled).toBeDefined();
    expect(settled?.success).toBe(false);
    expect(settled?.error?.message).toBe('Task timed out');
    expect(coordinator.getTask(taskId)?.status).toBe('timeout');
  });

  it('resolves waitForTaskCompletion with status "cancelled" when cancelTask fires (event type is task.failed, not the task\'s real status)', async () => {
    vi.useFakeTimers();

    const taskId = await coordinator.submitTask({
      type: 'coding',
      name: 'Cancellable task',
      description: 'cancel-vs-fail event-type nuance test',
      priority: 'normal',
      dependencies: [],
      input: {},
      timeoutMs: 10000,
      retries: 0,
      maxRetries: 3,
      metadata: {},
    });

    await coordinator.registerAgent({
      name: 'worker-2',
      type: 'coder',
      status: 'idle',
      capabilities: { languages: [], frameworks: [], domains: [], tools: [], maxConcurrentTasks: 1, reliability: 1 },
      metrics: { tasksCompleted: 0, tasksFailed: 0, avgTaskDurationMs: 0, successRate: 1, cpuUsage: 0, memoryUsageMb: 0, messagesProcessed: 0 },
      workload: 0,
      health: 1.0,
      lastHeartbeat: new Date(),
      topologyRole: 'worker',
      connections: [],
    });

    const waitPromise = (coordinator as unknown as {
      waitForTaskCompletion(taskId: string, timeoutMs: number): Promise<{ status: string }>;
    }).waitForTaskCompletion(taskId, 10000);

    let result: { status: string } | undefined;
    void waitPromise.then((r) => {
      result = r;
    });

    // cancelTask() emits 'task.failed' (reason: 'cancelled') even though the
    // task's real status becomes 'cancelled', not 'failed'.
    await coordinator.cancelTask(taskId);

    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(result).toBeDefined();
    expect(result?.status).toBe('cancelled');
  });
});
