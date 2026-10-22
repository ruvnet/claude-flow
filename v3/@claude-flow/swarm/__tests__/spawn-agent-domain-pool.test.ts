/**
 * Discriminating regression test for the Dream Cycle 2026-09-29 (swarm) fix:
 * UnifiedSwarmCoordinator.spawnAgent()'s auto-domain branch (no `domain`/
 * `agentNumber` given — the plain agentic-flow-compatible call shape) never
 * called `pool.add()`, unlike the other two spawnAgent() branches which both
 * go through registerAgentWithDomain() (which does call pool.add()). The
 * agent was registered in state.agents/agentDomainMap and reported idle by
 * listAgents()/getAgent(), but stayed invisible to the domain pool that
 * assignTaskToDomain() actually draws from via pool.acquire() — so a task
 * routed to that domain either scale-up-creates a *different* agent (when
 * the pool isn't at maxSize) or queues forever (when it is), while the
 * originally spawned agent sits idle and unused forever.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UnifiedSwarmCoordinator, createUnifiedSwarmCoordinator } from '../src/unified-coordinator.js';

describe('spawnAgent() auto-domain branch — domain pool visibility', () => {
  let coordinator: UnifiedSwarmCoordinator;

  beforeEach(async () => {
    coordinator = createUnifiedSwarmCoordinator({
      maxAgents: 20,
      maxTasks: 100,
      heartbeatIntervalMs: 1000,
      healthCheckIntervalMs: 2000,
      taskTimeoutMs: 10000,
      topology: {
        type: 'hierarchical',
        maxAgents: 20,
      },
      consensus: {
        algorithm: 'raft',
        threshold: 0.66,
        timeoutMs: 5000,
        maxRounds: 5,
        requireQuorum: true,
      },
    });

    await coordinator.initialize();
  });

  afterEach(async () => {
    await coordinator.shutdown();
  });

  it('adds the spawned agent to its domain pool (visible in pool stats)', async () => {
    const { agentId, domain } = await coordinator.spawnAgent({ type: 'coder' });
    expect(domain).toBe('core');

    const pool = coordinator.getDomainPool(domain);
    expect(pool).toBeDefined();

    const stats = pool!.getPoolStats();
    // Baseline: total is 0 — the agent was never added to the pool.
    expect(stats.total).toBe(1);
    expect(stats.available).toBe(1);

    // The agent itself is still visible/idle through the generic accessor.
    const agent = coordinator.getAgent(agentId);
    expect(agent?.status).toBe('idle');
  });

  it('routes a domain-assigned task to the agent spawnAgent() actually returned', async () => {
    const { agentId, domain } = await coordinator.spawnAgent({ type: 'coder' });

    const taskId = await coordinator.submitTask({
      type: 'coding',
      name: 'Domain-routed task',
      description: 'Should be routed to the auto-domain-spawned agent',
      priority: 'normal',
      dependencies: [],
      input: {},
      timeoutMs: 5000,
      retries: 0,
      maxRetries: 3,
      metadata: {},
    });

    const assignedAgentId = await coordinator.assignTaskToDomain(taskId, domain);

    // Baseline: the domain pool is empty (agent never added), so acquire()
    // scale-up-creates a brand new agent instead of finding the one
    // spawnAgent() returned — assignedAgentId !== agentId, and a second,
    // orphaned agent now exists in the pool that spawnAgent()'s caller
    // never sees.
    expect(assignedAgentId).toBe(agentId);

    const task = coordinator.getTask(taskId);
    expect(task?.assignedTo?.id).toBe(agentId);
  });

  it('does not throw when an auto-domain spawn pushes a full domain pool over capacity', async () => {
    // 'queen'/'coordinator' both map to the 'queen' domain, whose pool is
    // capped at maxSize 1 (DOMAIN_CONFIGS: agentNumbers: [1]). A second
    // auto-domain spawn into that domain must not reject spawnAgent() itself
    // (callers like the MCP scale-up loop don't wrap this call in try/catch)
    // — it should degrade to the pre-fix pool-invisible state instead.
    const first = await coordinator.spawnAgent({ type: 'queen' });
    expect(first.domain).toBe('queen');

    let poolFullEvent: unknown;
    coordinator.once('agent.domain_pool_full', (event) => {
      poolFullEvent = event;
    });

    const second = await coordinator.spawnAgent({ type: 'coordinator' });
    expect(second.domain).toBe('queen');
    expect(second.spawned).toBe(true);

    // The second agent is still registered and idle, just not pool-visible.
    const secondAgent = coordinator.getAgent(second.agentId);
    expect(secondAgent?.status).toBe('idle');
    expect(secondAgent).toBeDefined();

    const pool = coordinator.getDomainPool('queen');
    expect(pool!.getPoolStats().total).toBe(1);
    expect(poolFullEvent).toBeDefined();
  });

  it('surfaces a non-capacity pool.add() failure instead of swallowing it', async () => {
    const pool = coordinator.getDomainPool('queen');
    expect(pool).toBeDefined();
    const original = pool!.add.bind(pool);
    pool!.add = async () => {
      throw new Error('unexpected pool corruption');
    };

    await expect(coordinator.spawnAgent({ type: 'queen' })).rejects.toThrow('unexpected pool corruption');

    pool!.add = original;
  });

  it('still works correctly via the domain-aware branches (regression guard)', async () => {
    // registerAgentWithDomain()'s own pool.add() call path must be
    // unaffected by this fix.
    const { agentId, domain } = await coordinator.spawnAgent({ type: 'coder', agentNumber: 5 });
    expect(domain).toBe('core');

    const pool = coordinator.getDomainPool(domain);
    expect(pool!.getPoolStats().total).toBe(1);
    expect(pool!.getPoolStats().available).toBe(1);

    const agent = coordinator.getAgent(agentId);
    expect(agent?.status).toBe('idle');
  });
});
