/**
 * Regression: domain-pool agents were never released on terminal task
 * transitions.
 *
 * UnifiedSwarmCoordinator.assignTaskToDomain() draws the agent from
 * AgentPool.acquire(), which moves that agent into the pool's `busy` set.
 * handleTaskComplete()/handleTaskFail()/cancelTask() only reset the shared
 * AgentState; they never called releaseAgentToDomain(). AgentPool.release()
 * is the only operation that removes the id from `busy`, so each finished
 * task permanently consumed one slot. Once the domain pool was full,
 * pool.acquire() returned undefined and assignTaskToDomain() appended every
 * further task to domainTaskQueues, where it stayed forever:
 * releaseAgentToDomain() (the only queue-draining path) had no callers in
 * src/.
 *
 * These are public-path regressions: agents are registered and tasks routed
 * through spawnAgent()/assignTaskToDomain(), and the terminal message is the
 * same task_complete/task_fail/cancel signal an agent sends through the
 * message bus. The private handlers are invoked directly because the class
 * exposes no public completion method (existing wait tests use the same
 * pattern).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  UnifiedSwarmCoordinator,
  createUnifiedSwarmCoordinator,
} from '../src/unified-coordinator.js';
import type { TaskDefinition } from '../src/types.js';

const DOMAIN = 'core' as const;
const POOL_SIZE = 5;

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

async function completeTask(
  coordinator: UnifiedSwarmCoordinator,
  agentId: string,
  taskId: string
): Promise<void> {
  (coordinator as unknown as {
    handleTaskComplete(agentId: string, data: { taskId: string; result: unknown }): void;
  }).handleTaskComplete(agentId, { taskId, result: { ok: true } });
  await flushRelease();
}

async function failTask(
  coordinator: UnifiedSwarmCoordinator,
  agentId: string,
  taskId: string
): Promise<void> {
  (coordinator as unknown as {
    handleTaskFail(agentId: string, data: { taskId: string; error: string }): void;
  }).handleTaskFail(agentId, { taskId, error: 'worker failed' });
  await flushRelease();
}

/** Let the fire-and-forget release settle before asserting pool state. */
async function flushRelease(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe('UnifiedSwarmCoordinator domain pool release', () => {
  let coordinator: UnifiedSwarmCoordinator;

  beforeEach(async () => {
    coordinator = createCoordinator();
    await coordinator.initialize();
  });

  afterEach(async () => {
    await coordinator.shutdown();
  });

  async function assignTasks(count: number): Promise<string[]> {
    // Submit before spawning so submitTask() cannot auto-assign the task to a
    // generic idle agent; every assignment in this test then goes through the
    // domain pool, which is the ownership path under test.
    const taskIds: string[] = [];
    for (let i = 0; i < count; i++) {
      taskIds.push(await coordinator.submitTask(taskData(`task-${i}`)));
    }

    for (let i = 0; i < POOL_SIZE; i++) {
      await coordinator.spawnAgent({ type: 'coder', domain: DOMAIN });
    }

    for (let i = 0; i < Math.min(count, POOL_SIZE); i++) {
      expect(await coordinator.assignTaskToDomain(taskIds[i], DOMAIN)).toBeDefined();
    }
    return taskIds;
  }

  function poolStats() {
    return coordinator.getDomainPool(DOMAIN)!.getState();
  }

  it('returns a completed agent to the domain pool', async () => {
    const taskIds = await assignTasks(POOL_SIZE);
    const completedAgentId = coordinator.getTask(taskIds[0])!.assignedTo!.id;

    expect(poolStats().busyAgents).toContain(completedAgentId);

    await completeTask(coordinator, completedAgentId, taskIds[0]);

    const state = poolStats();
    expect(state.busyAgents).not.toContain(completedAgentId);
    expect(state.availableAgents).toContain(completedAgentId);
    expect(state.busyAgents).toHaveLength(POOL_SIZE - 1);
    expect(state.availableAgents).toHaveLength(1);
  });

  it('dispatches a queued domain task into the released slot', async () => {
    const taskIds = await assignTasks(POOL_SIZE + 1);

    expect(await coordinator.assignTaskToDomain(taskIds[POOL_SIZE], DOMAIN)).toBeUndefined();
    expect(coordinator.getTask(taskIds[POOL_SIZE])?.status).toBe('queued');

    const completedAgentId = coordinator.getTask(taskIds[0])!.assignedTo!.id;
    await completeTask(coordinator, completedAgentId, taskIds[0]);

    const queuedTask = coordinator.getTask(taskIds[POOL_SIZE])!;
    expect(queuedTask.status).toBe('assigned');
    expect(queuedTask.assignedTo?.id).toBe(completedAgentId);

    const state = poolStats();
    expect(state.busyAgents).toHaveLength(POOL_SIZE);
    expect(state.availableAgents).toHaveLength(0);
    expect(coordinator.getStatus().domains.find(d => d.name === DOMAIN)?.tasksQueued).toBe(0);
  });

  it('drains a one-agent domain queue without scaling its only agent away', async () => {
    const taskIds = [
      await coordinator.submitTask({ ...taskData('queen-0'), type: 'coordination' }),
      await coordinator.submitTask({ ...taskData('queen-1'), type: 'coordination' }),
    ];
    const { agentId } = await coordinator.spawnAgent({ type: 'queen', domain: 'queen' });

    expect(await coordinator.assignTaskToDomain(taskIds[0], 'queen')).toBe(agentId);
    expect(await coordinator.assignTaskToDomain(taskIds[1], 'queen')).toBeUndefined();
    expect(coordinator.getTask(taskIds[1])?.status).toBe('queued');

    await completeTask(coordinator, agentId, taskIds[0]);

    const queuedTask = coordinator.getTask(taskIds[1])!;
    expect(queuedTask.status).toBe('assigned');
    expect(queuedTask.assignedTo?.id).toBe(agentId);
    expect(coordinator.getAgent(agentId)).toBeDefined();
    expect(coordinator.getDomainPool('queen')!.getState()).toMatchObject({
      busyAgents: [agentId],
      availableAgents: [],
    });
  });

  it('returns an agent whose task failed terminally to the domain pool', async () => {
    const taskIds = await assignTasks(POOL_SIZE);
    const failedAgentId = coordinator.getTask(taskIds[0])!.assignedTo!.id;

    const task = coordinator.getTask(taskIds[0]) as TaskDefinition;
    task.retries = task.maxRetries;

    await failTask(coordinator, failedAgentId, taskIds[0]);

    expect(coordinator.getTask(taskIds[0])?.status).toBe('failed');

    const state = poolStats();
    expect(state.busyAgents).not.toContain(failedAgentId);
    expect(state.availableAgents).toContain(failedAgentId);
    expect(state.busyAgents).toHaveLength(POOL_SIZE - 1);
  });

  it('returns an agent whose task was cancelled to the domain pool', async () => {
    const taskIds = await assignTasks(POOL_SIZE);
    const cancelledAgentId = coordinator.getTask(taskIds[0])!.assignedTo!.id;

    await coordinator.cancelTask(taskIds[0]);

    expect(coordinator.getTask(taskIds[0])?.status).toBe('cancelled');

    const state = poolStats();
    expect(state.busyAgents).not.toContain(cancelledAgentId);
    expect(state.availableAgents).toContain(cancelledAgentId);
    expect(state.busyAgents).toHaveLength(POOL_SIZE - 1);
  });

  it('does not resurrect a cancelled task still sitting in a domain queue', async () => {
    const taskIds = await assignTasks(POOL_SIZE + 1);

    expect(await coordinator.assignTaskToDomain(taskIds[POOL_SIZE], DOMAIN)).toBeUndefined();
    await coordinator.cancelTask(taskIds[POOL_SIZE]);
    expect(coordinator.getTask(taskIds[POOL_SIZE])?.status).toBe('cancelled');

    const completedAgentId = coordinator.getTask(taskIds[0])!.assignedTo!.id;
    await completeTask(coordinator, completedAgentId, taskIds[0]);

    const cancelledTask = coordinator.getTask(taskIds[POOL_SIZE])!;
    expect(cancelledTask.status).toBe('cancelled');
    expect(cancelledTask.assignedTo).toBeUndefined();

    const state = poolStats();
    expect(state.busyAgents).toHaveLength(POOL_SIZE - 1);
    expect(state.availableAgents).toContain(completedAgentId);
  });
});
