/**
 * Regression: FederationHub's ephemeral-agent terminal accounting was not
 * idempotent.
 *
 * terminateAgent() had no settled guard, completeAgent() counted before its
 * delayed 'terminated' transition, and unregisterSwarm()/shutdown() re-ran
 * terminateAgent() for agents that were already completing/terminated. A
 * repeated call could increment completedAgents/failedAgents and
 * totalAgentLifespanMs more than once for one agent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Import the TS source explicitly: src/federation-hub.js is a stale tracked
// build artifact that would otherwise shadow the implementation under test.
import { createFederationHub, type FederationHub } from '../src/federation-hub.ts';

describe('FederationHub ephemeral agent idempotency', () => {
  let hub: FederationHub;

  beforeEach(async () => {
    hub = createFederationHub({
      federationId: 'test-fed',
      defaultTTL: 60000,
      syncIntervalMs: 60000,
      autoCleanup: false,
    });
    await hub.initialize();
    hub.registerSwarm({
      swarmId: 'swarm-1',
      name: 'swarm-1',
      capabilities: ['test'],
      maxAgents: 10,
      currentAgents: 0,
      status: 'active',
    });
  });

  afterEach(async () => {
    await hub.shutdown();
  });

  async function spawn(): Promise<string> {
    const result = await hub.spawnEphemeralAgent({
      swarmId: 'swarm-1',
      type: 'worker',
      task: 'test task',
    });
    expect(result.agentId).toBeTruthy();
    return result.agentId;
  }

  it('counts a repeated terminateAgent call once', async () => {
    let completedEvents = 0;
    hub.on('event', event => {
      if (event.type === 'agent_completed') completedEvents++;
    });

    const agentId = await spawn();
    expect(await hub.terminateAgent(agentId)).toBe(true);
    expect(await hub.terminateAgent(agentId)).toBe(true);

    expect(hub.getStats().completedAgents).toBe(1);
    expect(hub.getStats().failedAgents).toBe(0);
    expect(completedEvents).toBe(1);
  });

  it('does not double-count completeAgent followed by terminateAgent', async () => {
    const agentId = await spawn();
    expect(hub.completeAgent(agentId, { ok: true })).toBe(true);
    expect(await hub.terminateAgent(agentId)).toBe(true);

    expect(hub.getStats().completedAgents).toBe(1);
    expect(hub.getStats().failedAgents).toBe(0);
  });

  it('does not double-count a repeated completeAgent call', async () => {
    const agentId = await spawn();
    expect(hub.completeAgent(agentId)).toBe(true);
    expect(hub.completeAgent(agentId)).toBe(true);

    expect(hub.getStats().completedAgents).toBe(1);
  });

  it('does not count unregisterSwarm termination again', async () => {
    const agentId = await spawn();
    hub.completeAgent(agentId);
    expect(hub.unregisterSwarm('swarm-1')).toBe(true);

    expect(hub.getStats().completedAgents).toBe(1);
    expect(hub.getStats().failedAgents).toBe(0);
  });

  it('counts a repeated failed termination once', async () => {
    const agentId = await spawn();
    await hub.terminateAgent(agentId, new Error('failed'));
    await hub.terminateAgent(agentId, new Error('failed again'));

    expect(hub.getStats().failedAgents).toBe(1);
    expect(hub.getStats().completedAgents).toBe(0);
  });
});
