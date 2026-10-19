/**
 * Regression: domain pools must not synthesize agents that the coordinator
 * does not know about.
 *
 * AgentPool.acquire() used to scale up whenever it had no available agent.
 * For a domain pool that produced a `*-domain-pool_agent_N` that was absent
 * from UnifiedSwarmCoordinator.state.agents, topology, message-bus
 * subscriptions and the consensus engine. The coordinator then assigned a
 * task to that id and sent it a message, but handleAgentMessage() drops
 * reports from unknown agents, so the task could only wait for its timeout.
 * The same scale-up also ran on a normal acquire when utilization crossed
 * scaleUpThreshold, inflating the fixed 15-agent roster with invisible agents.
 *
 * Domain pools are explicit rosters: membership is created by spawnAgent()/
 * registerAgentWithDomain() and removed by the coordinator. They now set
 * autoScale:false and healthChecks:false, so the pool never creates, removes
 * or replaces members on its own.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  UnifiedSwarmCoordinator,
  createUnifiedSwarmCoordinator,
} from '../src/unified-coordinator.js';
import { AgentPool, createAgentPool } from '../src/agent-pool.js';

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

describe('domain pools do not auto-create or auto-remove agents', () => {
  let coordinator: UnifiedSwarmCoordinator;

  beforeEach(async () => {
    coordinator = createCoordinator();
    await coordinator.initialize();
  });

  afterEach(async () => {
    await coordinator.shutdown();
  });

  it('queues a task instead of acquiring a pool-only agent from an empty domain', async () => {
    const taskId = await coordinator.submitTask(taskData('empty-pool'));

    expect(await coordinator.assignTaskToDomain(taskId, 'core')).toBeUndefined();

    expect(coordinator.getTask(taskId)?.status).toBe('queued');
    expect(coordinator.getDomainPool('core')!.getPoolStats().total).toBe(0);
    expect(coordinator.getStatus().domains.find(d => d.name === 'core')?.agentCount).toBe(0);
  });

  it('does not scale a one-agent domain up to a second, unregistered agent', async () => {
    const { agentId } = await coordinator.spawnAgent({ type: 'coder', domain: 'core' });
    const first = await coordinator.submitTask(taskData('first'));
    const second = await coordinator.submitTask(taskData('second'));

    expect(await coordinator.assignTaskToDomain(first, 'core')).toBe(agentId);
    expect(await coordinator.assignTaskToDomain(second, 'core')).toBeUndefined();

    expect(coordinator.getTask(second)?.status).toBe('queued');
    expect(coordinator.getDomainPool('core')!.getPoolStats()).toMatchObject({
      total: 1,
      busy: 1,
      available: 0,
    });
    expect(coordinator.getAgentsByDomain('core')).toHaveLength(1);
  });

  it('still registers explicitly spawned agents in the domain pool', async () => {
    const hierarchy = await coordinator.spawnFullHierarchy();

    expect(hierarchy.size).toBe(15);
    expect(coordinator.getDomainPool('queen')!.getPoolStats().total).toBe(1);
    expect(coordinator.getDomainPool('security')!.getPoolStats().total).toBe(3);
    expect(coordinator.getDomainPool('core')!.getPoolStats().total).toBe(5);
    expect(coordinator.getDomainPool('integration')!.getPoolStats().total).toBe(3);
    expect(coordinator.getDomainPool('support')!.getPoolStats().total).toBe(3);
  });

  it('keeps auto-scaling for type-based pools (default behavior)', async () => {
    const pool: AgentPool = createAgentPool({
      name: 'worker-test-pool',
      type: 'worker',
      minSize: 0,
      maxSize: 2,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.2,
      cooldownMs: 30000,
      healthCheckIntervalMs: 2000,
      healthChecks: false,
    });
    await pool.initialize();

    const agent = await pool.acquire();
    expect(agent).toBeDefined();
    expect(pool.getPoolStats().total).toBe(1);

    await pool.shutdown();
  });

  it('does not seed minSize agents when the pool does not own membership', async () => {
    const pool: AgentPool = createAgentPool({
      name: 'external-roster-pool',
      type: 'worker',
      minSize: 1,
      maxSize: 2,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.2,
      cooldownMs: 30000,
      healthCheckIntervalMs: 2000,
      autoScale: false,
      healthChecks: false,
    });
    await pool.initialize();

    expect(pool.getPoolStats().total).toBe(0);
    expect(await pool.acquire()).toBeUndefined();

    await pool.shutdown();
  });

  it('ignores explicit scale() calls when the pool does not own membership', async () => {
    const pool: AgentPool = createAgentPool({
      name: 'external-roster-scale-pool',
      type: 'worker',
      minSize: 0,
      maxSize: 2,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.2,
      cooldownMs: 30000,
      healthCheckIntervalMs: 2000,
      autoScale: false,
      healthChecks: false,
    });
    await pool.initialize();

    await pool.scale(1);
    expect(pool.getPoolStats().total).toBe(0);

    await pool.shutdown();
  });
});
