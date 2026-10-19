/**
 * Regression: unregisterAgent()/terminateAgent() removed a domain agent from
 * state/topology/bus/consensus but never from its AgentPool or agentDomainMap.
 *
 * The pool then kept advertising the removed id. A later
 * assignTaskToDomain() acquired it and returned it as the assignee, while
 * getAgent() was already undefined; handleAgentMessage() drops reports from
 * unknown agents, so the task could never complete. terminateAgent() also
 * deleted agentDomainMap before unregisterAgent(), which made the cancel path's
 * releaseDomainAgent() a no-op and left the slot busy.
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

describe('domain agent teardown', () => {
  let coordinator: UnifiedSwarmCoordinator;

  beforeEach(async () => {
    coordinator = createCoordinator();
    await coordinator.initialize();
  });

  afterEach(async () => {
    await coordinator.shutdown();
  });

  it('unregisterAgent removes the agent from its domain pool', async () => {
    const taskId = await coordinator.submitTask(taskData('active'));
    const { agentId } = await coordinator.spawnAgent({ type: 'coder', domain: 'core' });
    expect(await coordinator.assignTaskToDomain(taskId, 'core')).toBe(agentId);

    await coordinator.unregisterAgent(agentId);

    expect(coordinator.getAgent(agentId)).toBeUndefined();
    expect(coordinator.getDomainPool('core')!.getPoolStats().total).toBe(0);
    expect(coordinator.getTask(taskId)?.status).toBe('cancelled');

    const next = await coordinator.submitTask(taskData('next'));
    expect(await coordinator.assignTaskToDomain(next, 'core')).toBeUndefined();
    expect(coordinator.getTask(next)?.status).toBe('queued');
  });

  it('terminateAgent removes the agent from its domain pool', async () => {
    const taskId = await coordinator.submitTask(taskData('active'));
    const { agentId } = await coordinator.spawnAgent({ type: 'coder', domain: 'core' });
    expect(await coordinator.assignTaskToDomain(taskId, 'core')).toBe(agentId);

    const result = await coordinator.terminateAgent(agentId, { force: true });
    expect(result.terminated).toBe(true);

    expect(coordinator.getAgent(agentId)).toBeUndefined();
    expect(coordinator.getDomainPool('core')!.getPoolStats().total).toBe(0);
    expect(coordinator.getTask(taskId)?.status).toBe('cancelled');

    const next = await coordinator.submitTask(taskData('next'));
    expect(await coordinator.assignTaskToDomain(next, 'core')).toBeUndefined();
    expect(coordinator.getTask(next)?.status).toBe('queued');
  });

  it('keeps other domain agents usable after one is unregistered', async () => {
    const first = await coordinator.submitTask(taskData('first'));
    const firstAgent = await coordinator.spawnAgent({ type: 'coder', domain: 'core' });
    expect(await coordinator.assignTaskToDomain(first, 'core')).toBe(firstAgent.agentId);

    // Submitted while the only current agent is busy, so it stays queued while
    // the second agent is added.
    const queued = await coordinator.submitTask(taskData('queued'));
    const secondAgent = await coordinator.spawnAgent({ type: 'coder', domain: 'core' });

    await coordinator.unregisterAgent(firstAgent.agentId);

    expect(coordinator.getDomainPool('core')!.getPoolStats().total).toBe(1);
    expect(await coordinator.assignTaskToDomain(queued, 'core')).toBe(secondAgent.agentId);
    expect(coordinator.getAgent(secondAgent.agentId)).toBeDefined();
    expect(coordinator.getTask(queued)?.assignedTo?.id).toBe(secondAgent.agentId);
  });
});
