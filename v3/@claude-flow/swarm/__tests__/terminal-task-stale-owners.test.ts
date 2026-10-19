/**
 * Regression: a task retargeted from one domain to another can legitimately
 * have two AgentState owners. #4245 keeps the previous owner busy because a
 * retarget does not prove that worker stopped executing. Once the task is
 * terminal, however, the non-reporting owner is a stale reservation.
 *
 * handleTaskComplete()/handleTaskFail()/cancelTask() only cleared the
 * reporting (or task.assignedTo) agent. The other owner kept
 * currentTask === taskId forever, so it stayed busy and its domain-pool slot
 * stayed reserved even though the task was completed/failed/cancelled.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  UnifiedSwarmCoordinator,
  createUnifiedSwarmCoordinator,
} from '../src/unified-coordinator.js';

function createCoordinator(): UnifiedSwarmCoordinator {
  return createUnifiedSwarmCoordinator({
    maxAgents: 20,
    maxTasks: 100,
    heartbeatIntervalMs: 1000,
    healthCheckIntervalMs: 2000,
    taskTimeoutMs: 10000,
    topology: { type: 'hierarchical', maxAgents: 20 },
    consensus: {
      algorithm: 'raft',
      threshold: 0.66,
      timeoutMs: 5000,
      maxRounds: 5,
      requireQuorum: true,
    },
  });
}

function taskData(name: string) {
  return {
    type: 'coding' as const,
    name,
    description: name,
    priority: 'normal' as const,
    dependencies: [],
    input: {},
    timeoutMs: 5000,
    retries: 0,
    maxRetries: 3,
    metadata: {},
  };
}

async function flush(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('terminal task clears stale owners', () => {
  let coordinator: UnifiedSwarmCoordinator;
  let firstAgentId: string;
  let secondAgentId: string;
  let taskId: string;

  beforeEach(async () => {
    coordinator = createCoordinator();
    await coordinator.initialize();

    const first = await coordinator.spawnAgent({ type: 'coder', domain: 'core' });
    const second = await coordinator.spawnAgent({ type: 'coder', domain: 'security' });
    firstAgentId = first.agentId;
    secondAgentId = second.agentId;

    taskId = await coordinator.submitTask(taskData('retargeted'));
    expect(coordinator.getTask(taskId)?.assignedTo?.id).toBe(firstAgentId);

    expect(await coordinator.assignTaskToDomain(taskId, 'security')).toBe(secondAgentId);
    expect(coordinator.getAgent(firstAgentId)).toMatchObject({
      status: 'busy',
      currentTask: { id: taskId },
    });
    expect(coordinator.getAgent(secondAgentId)).toMatchObject({
      status: 'busy',
      currentTask: { id: taskId },
    });
  });

  afterEach(async () => {
    await flush();
    await coordinator.shutdown();
  });

  it('releases the non-reporting owner on completion', async () => {
    (coordinator as unknown as {
      handleTaskComplete(agentId: string, data: { taskId: string; result: unknown }): void;
    }).handleTaskComplete(secondAgentId, { taskId, result: { ok: true } });
    await flush();

    expect(coordinator.getTask(taskId)?.status).toBe('completed');
    expect(coordinator.getMetrics().completedTasks).toBe(1);
    expect(coordinator.getAgent(firstAgentId)).toMatchObject({
      status: 'idle',
      currentTask: undefined,
    });
    expect(coordinator.getAgent(secondAgentId)).toMatchObject({
      status: 'idle',
      currentTask: undefined,
    });
    expect(coordinator.getDomainPool('core')!.getState().availableAgents).toContain(firstAgentId);
    expect(coordinator.getDomainPool('security')!.getState().availableAgents).toContain(secondAgentId);
  });

  it('releases the non-assigned owner on cancellation', async () => {
    await coordinator.cancelTask(taskId);
    await flush();

    expect(coordinator.getTask(taskId)?.status).toBe('cancelled');
    expect(coordinator.getAgent(firstAgentId)).toMatchObject({
      status: 'idle',
      currentTask: undefined,
    });
    expect(coordinator.getAgent(secondAgentId)).toMatchObject({
      status: 'idle',
      currentTask: undefined,
    });
  });

  it('releases the non-reporting owner on terminal failure', async () => {
    const task = coordinator.getTask(taskId)!;
    task.retries = task.maxRetries;

    (coordinator as unknown as {
      handleTaskFail(agentId: string, data: { taskId: string; error: string }): void;
    }).handleTaskFail(secondAgentId, { taskId, error: 'worker failed' });
    await flush();

    expect(coordinator.getTask(taskId)?.status).toBe('failed');
    expect(coordinator.getAgent(firstAgentId)).toMatchObject({
      status: 'idle',
      currentTask: undefined,
    });
    expect(coordinator.getAgent(secondAgentId)).toMatchObject({
      status: 'idle',
      currentTask: undefined,
    });
  });
});
