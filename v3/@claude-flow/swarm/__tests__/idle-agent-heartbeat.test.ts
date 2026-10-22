import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UnifiedSwarmCoordinator, createUnifiedSwarmCoordinator } from '../src/unified-coordinator.js';

function createCoordinator(): UnifiedSwarmCoordinator {
  return createUnifiedSwarmCoordinator({
    maxAgents: 20,
    maxTasks: 100,
    heartbeatIntervalMs: 60000,
    healthCheckIntervalMs: 60000,
    taskTimeoutMs: 10000,
    autoRecovery: true,
    topology: { type: 'hierarchical', maxAgents: 20 },
    consensus: { algorithm: 'raft', threshold: 0.66, timeoutMs: 5000, maxRounds: 5, requireQuorum: true },
  });
}

function taskData(name: string) {
  return {
    type: 'coding' as const, name, description: name, priority: 'normal' as const,
    dependencies: [], input: {}, timeoutMs: 5000, retries: 0, maxRetries: 3, metadata: {},
  };
}

describe('idle agent heartbeat', () => {
  let c: UnifiedSwarmCoordinator;
  beforeEach(async () => { c = createCoordinator(); await c.initialize(); });
  afterEach(async () => { await c.shutdown(); });

  function check() { (c as unknown as { checkHeartbeats(): void }).checkHeartbeats(); }

  it('does not mark a silent idle agent as error', async () => {
    const { agentId } = await c.spawnAgent({ type: 'coder', domain: 'core' });
    const agent = c.getAgent(agentId)!;
    agent.lastHeartbeat = new Date(Date.now() - 200000);
    check();
    expect(agent.status).toBe('idle');
    expect(agent.health).toBe(1);
  });

  it('still marks a silent busy agent as error', async () => {
    const { agentId } = await c.spawnAgent({ type: 'coder', domain: 'core' });
    await c.submitTask(taskData('busy'));
    const agent = c.getAgent(agentId)!;
    expect(agent.status).toBe('busy');
    agent.lastHeartbeat = new Date(Date.now() - 200000);
    check();
    expect(agent.status).toBe('error');
  });
});
