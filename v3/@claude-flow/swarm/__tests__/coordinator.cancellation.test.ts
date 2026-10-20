import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUnifiedSwarmCoordinator, type UnifiedSwarmCoordinator } from '../src/unified-coordinator.js';
import type { MessageBus } from '../src/message-bus.js';

let coordinator: UnifiedSwarmCoordinator;
let agentId: string;
const turns = async () => { for (let i = 0; i < 4; i++) await new Promise<void>(setImmediate); };
const task = (maxRetries = 3) => ({
  type: 'coding' as const, name: 'Cancellation fixture', description: '',
  priority: 'normal' as const, dependencies: [], input: {},
  timeoutMs: 5000, retries: 0, maxRetries, metadata: {},
});

beforeEach(async () => {
  coordinator = createUnifiedSwarmCoordinator({ taskTimeoutMs: 20 });
  await coordinator.initialize();
  ({ agentId } = await coordinator.spawnAgent({ type: 'coder' }));
});
afterEach(async () => { await coordinator.shutdown(); });

async function report(type: 'task_complete' | 'task_fail', taskId: string) {
  // Use the real in-process transport to exercise the worker-report boundary.
  const transport = (coordinator as unknown as { messageBus: MessageBus }).messageBus;
  await transport.send({
    type, from: agentId, to: agentId, priority: 'normal', requiresAck: false, ttlMs: 5000,
    payload: { taskId, result: 'worker result', error: 'worker failure' },
  });
  await turns();
}

describe('UnifiedSwarmCoordinator cancellation is terminal', () => {
  it('does not retry a cancelled task when its own cancellation notification arrives', async () => {
    const id = await coordinator.submitTask(task());
    await coordinator.cancelTask(id);
    await turns();
    expect(coordinator.getTask(id)).toMatchObject({ status: 'cancelled', retries: 0 });
    expect(coordinator.getAgent(agentId)).toMatchObject({ status: 'idle', currentTask: undefined });
  });

  it('does not count cancellation as a failed task when no retries remain', async () => {
    const id = await coordinator.submitTask(task(0));
    await coordinator.cancelTask(id);
    await turns();
    expect(coordinator.getTask(id)!.status).toBe('cancelled');
    expect(coordinator.getAgent(agentId)!.metrics.tasksFailed).toBe(0);
    expect(coordinator.getMetrics().failedTasks).toBe(0);
  });

  it('does not release a new assignment when the old task is cancelled again', async () => {
    const old = await coordinator.submitTask(task());
    await coordinator.cancelTask(old);
    const next = await coordinator.submitTask(task());
    await coordinator.cancelTask(old);
    expect(coordinator.getAgent(agentId)).toMatchObject({ status: 'busy', currentTask: { id: next } });
    expect(coordinator.getTask(next)!.status).toBe('assigned');
  });

  it('ignores a late completion report for a cancelled task while a new task runs', async () => {
    const old = await coordinator.submitTask(task());
    await coordinator.cancelTask(old);
    const next = await coordinator.submitTask(task());
    await report('task_complete', old);
    expect(coordinator.getTask(old)!.status).toBe('cancelled');
    expect(coordinator.getAgent(agentId)).toMatchObject({ status: 'busy', currentTask: { id: next } });
    expect(coordinator.getMetrics().completedTasks).toBe(0);
  });

  it('keeps ordinary completion terminal and counts it only once', async () => {
    const id = await coordinator.submitTask(task());
    await report('task_complete', id);
    await report('task_complete', id);
    await coordinator.cancelTask(id);
    expect(coordinator.getTask(id)).toMatchObject({ status: 'completed', output: 'worker result' });
    expect(coordinator.getMetrics().completedTasks).toBe(1);
    expect(coordinator.getAgent(agentId)!.metrics.tasksCompleted).toBe(1);
  });

  it('still retries a live task on an ordinary failure report', async () => {
    const id = await coordinator.submitTask(task());
    await report('task_fail', id);
    expect(coordinator.getTask(id)).toMatchObject({ status: 'assigned', retries: 1 });
    expect(coordinator.getAgent(agentId)).toMatchObject({ status: 'busy', currentTask: { id } });
  });

  it('preserves late worker cleanup after an existing wait timeout', async () => {
    const [result] = await coordinator.executeParallel([{ task: task(), domain: 'core' }]);
    expect(result.success).toBe(false);
    expect(coordinator.getTask(result.taskId)!.status).toBe('timeout');
    expect(coordinator.getAgent(agentId)!.status).toBe('busy');
    await report('task_complete', result.taskId);
    expect(coordinator.getAgent(agentId)).toMatchObject({ status: 'idle', currentTask: undefined });
  });

  it('can still cancel and release an assignment after an existing wait timeout', async () => {
    const [result] = await coordinator.executeParallel([{ task: task(), domain: 'core' }]);
    expect(coordinator.getTask(result.taskId)!.status).toBe('timeout');
    await coordinator.cancelTask(result.taskId);
    await turns();
    expect(coordinator.getTask(result.taskId)!.status).toBe('cancelled');
    expect(coordinator.getAgent(agentId)).toMatchObject({ status: 'idle', currentTask: undefined });
  });
});
