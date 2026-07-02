import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = mkdtempSync(join(tmpdir(), 'orch-svc-test-'));

vi.mock('../src/mcp-tools/types.js', () => ({
  getProjectCwd: () => testDir,
}));

// Mock agent-execute-core at the module level (hoisted)
const mockExecute = vi.fn();
vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({
  executeAgentTask: mockExecute,
}));

// Mock swarm-tools to avoid @claude-flow/cli-core dependency
vi.mock('../src/mcp-tools/swarm-tools.js', () => {
  let store: { swarms: Record<string, unknown> } = { swarms: {} };
  return {
    loadSwarmStore: () => store,
    saveSwarmStore: (s: typeof store) => { store = s; },
  };
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

async function seedAgent(id: string, status = 'idle' as const) {
  const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
  const repo = new AgentRepository();
  const store = repo.loadStore();
  store.agents[id] = {
    agentId: id,
    agentType: 'test',
    status,
    health: 1.0,
    taskCount: 0,
    config: {},
    createdAt: new Date().toISOString(),
  };
  repo.saveStore(store);
}

async function seedSwarm(agents: string[]) {
  const { loadSwarmStore, saveSwarmStore } = await import('../src/mcp-tools/swarm-tools.js');
  const store = loadSwarmStore();
  store.swarms['swarm-1'] = {
    swarmId: 'swarm-1',
    topology: 'hierarchical',
    maxAgents: 10,
    status: 'running',
    agents,
    tasks: [],
    config: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveSwarmStore(store);
}

describe('OrchestrationService', () => {
  beforeEach(() => {
    mockExecute.mockReset();
  });

  it('parallel executes all agents concurrently', async () => {
    await seedAgent('p1');
    await seedAgent('p2');
    mockExecute.mockResolvedValue({ success: true, output: 'ok', durationMs: 10 });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'do work', agents: ['p1', 'p2'], strategy: 'parallel' });
    expect(result.executor).toBe('agent_execute');
    expect(result.agents).toEqual(['p1', 'p2']);
    expect(result.status).toBe('completed');
    expect(result.success).toBe(true);
    expect(result.results.length).toBe(2);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it('sequential executes agents in order', async () => {
    await seedAgent('s1');
    await seedAgent('s2');
    await seedAgent('s3');
    const callOrder: string[] = [];
    mockExecute.mockImplementation((input: { agentId: string }) => {
      callOrder.push(input.agentId);
      return Promise.resolve({ success: true, output: `done-${input.agentId}`, durationMs: 5 });
    });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'seq', agents: ['s1', 's2', 's3'], strategy: 'sequential' });
    expect(callOrder).toEqual(['s1', 's2', 's3']);
    expect(result.success).toBe(true);
  });

  it('pipeline chains prompts with previous output', async () => {
    await seedAgent('pl1');
    await seedAgent('pl2');
    const prompts: string[] = [];
    mockExecute.mockImplementation((input: { prompt: string }) => {
      prompts.push(input.prompt);
      return Promise.resolve({ success: true, output: 'stage-output', durationMs: 5 });
    });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'pipeline-task', agents: ['pl1', 'pl2'], strategy: 'pipeline' });
    expect(prompts.length).toBe(2);
    expect(prompts[0]).not.toContain('Previous stage');
    expect(prompts[1]).toContain('Previous stage output');
    expect(prompts[1]).toContain('stage-output');
    expect(result.success).toBe(true);
  });

  it('pipeline stops after first failure', async () => {
    await seedAgent('pf1');
    await seedAgent('pf2');
    const callOrder: string[] = [];
    mockExecute.mockImplementation((input: { agentId: string }) => {
      callOrder.push(input.agentId);
      if (input.agentId === 'pf1') {
        return Promise.resolve({ success: false, error: 'fail', durationMs: 5 });
      }
      return Promise.resolve({ success: true, output: 'ok', durationMs: 5 });
    });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'pipe-fail', agents: ['pf1', 'pf2'], strategy: 'pipeline' });
    expect(callOrder).toEqual(['pf1']);
    expect(result.status).toBe('failed');
    expect(result.success).toBe(false);
  });

  it('broadcast behaves as alias for parallel', async () => {
    await seedAgent('b1');
    await seedAgent('b2');
    mockExecute.mockResolvedValue({ success: true, output: 'ok', durationMs: 10 });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'broadcast test', agents: ['b1', 'b2'], strategy: 'broadcast' });
    expect(result.strategy).toBe('parallel');
    expect(result.results.length).toBe(2);
  });

  it('deduplicates agent IDs', async () => {
    await seedAgent('d1');
    await seedAgent('d2');
    mockExecute.mockResolvedValue({ success: true, output: 'ok', durationMs: 10 });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'dedup', agents: ['d1', 'd1', 'd2', 'd2'], strategy: 'parallel' });
    expect(result.agents).toEqual(['d1', 'd2']);
    expect(result.results.length).toBe(2);
  });

  it('rejects unknown agent IDs', async () => {
    await seedAgent('k1');
    mockExecute.mockResolvedValue({ success: true, output: 'ok', durationMs: 10 });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'unknown agent', agents: ['k1', 'unknown-agent'], strategy: 'parallel' });
    expect(result.agents).toEqual(['k1']);
  });

  it('rejects terminated agents', async () => {
    await seedAgent('ta1');
    await seedAgent('dead-agent', 'terminated');
    mockExecute.mockResolvedValue({ success: true, output: 'ok', durationMs: 10 });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'terminated check', agents: ['ta1', 'dead-agent'], strategy: 'parallel' });
    expect(result.agents).toEqual(['ta1']);
  });

  it('resolves from swarm when no explicit agents given', async () => {
    await seedAgent('sw1');
    await seedAgent('sw2');
    await seedSwarm(['sw1', 'sw2']);
    mockExecute.mockResolvedValue({ success: true, output: 'ok', durationMs: 10 });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'swarm resolve' });
    expect(result.agents.length).toBeGreaterThan(0);
    expect(result.agents).toContain('sw1');
  });

  it('returns partial when some agents fail', async () => {
    await seedAgent('pa1');
    await seedAgent('pa2');
    mockExecute
      .mockResolvedValueOnce({ success: true, output: 'ok', durationMs: 10 })
      .mockResolvedValueOnce({ success: false, error: 'fail', durationMs: 5 });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'partial test', agents: ['pa1', 'pa2'], strategy: 'parallel' });
    expect(result.status).toBe('partial');
    expect(result.success).toBe(false);
    expect(result.aggregate.completed).toBe(1);
    expect(result.aggregate.failed).toBe(1);
  });

  it('returns failed when no agents resolved', async () => {
    mockExecute.mockResolvedValue({ success: true, output: 'ok', durationMs: 10 });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'no agents', agents: [] });
    expect(result.status).toBe('failed');
    expect(result.success).toBe(false);
    expect(result.results).toEqual([]);
  });

  it('aggregates token usage', async () => {
    await seedAgent('tu1');
    await seedAgent('tu2');
    mockExecute.mockResolvedValue({
      success: true,
      output: 'ok',
      durationMs: 10,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    const { orchestrate } = await import('../src/orchestration/orchestration-service.js');
    const result = await orchestrate({ task: 'token count', agents: ['tu1', 'tu2'], strategy: 'parallel' });
    expect(result.aggregate.totalTokens).toBe(300);
  });
});
