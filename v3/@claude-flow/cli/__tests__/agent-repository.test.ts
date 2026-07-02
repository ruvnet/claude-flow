import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = mkdtempSync(join(tmpdir(), 'agent-repo-test-'));
const storeDir = join(testDir, '.claude-flow', 'agents');

vi.mock('../src/mcp-tools/types.js', () => ({
  getProjectCwd: () => testDir,
}));

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('AgentRepository', () => {
  it('loadStore returns empty store when no file exists', async () => {
    const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
    const repo = new AgentRepository();
    const store = repo.loadStore();
    expect(store.agents).toEqual({});
    expect(store.version).toBe('3.0.0');
  });

  it('saveStore and loadStore round-trips agents', async () => {
    const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
    const repo = new AgentRepository();
    const agent = {
      agentId: 'agent-1',
      agentType: 'coder',
      status: 'idle' as const,
      health: 1.0,
      taskCount: 0,
      config: {},
      createdAt: new Date().toISOString(),
    };
    const store = { agents: { 'agent-1': agent }, version: '3.0.0' };
    repo.saveStore(store);
    const loaded = repo.loadStore();
    expect(loaded.agents['agent-1'].agentId).toBe('agent-1');
  });

  it('atomic write produces valid JSON on concurrent save', async () => {
    const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
    const repo = new AgentRepository();
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(new Promise<void>(resolve => {
        setTimeout(() => {
          const agent = {
            agentId: `agent-${i}`,
            agentType: 'test',
            status: 'idle' as const,
            health: 1.0,
            taskCount: i,
            config: {},
            createdAt: new Date().toISOString(),
          };
          repo.saveStore({ agents: { [`agent-${i}`]: agent }, version: '3.0.0' });
          resolve();
        }, Math.random() * 20);
      }));
    }
    await Promise.all(promises);
    const store = repo.loadStore();
    expect(Object.keys(store.agents).length).toBeGreaterThanOrEqual(1);
  });

  it('getAllActiveAgents excludes terminated', async () => {
    const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
    const repo = new AgentRepository();
    const store = {
      agents: {
        'a1': { agentId: 'a1', agentType: 't', status: 'idle' as const, health: 1, taskCount: 0, config: {}, createdAt: '' },
        'a2': { agentId: 'a2', agentType: 't', status: 'terminated' as const, health: 1, taskCount: 0, config: {}, createdAt: '' },
      },
      version: '3.0.0',
    };
    repo.saveStore(store);
    const active = repo.getAllActiveAgents();
    expect(active.length).toBe(1);
    expect(active[0].agentId).toBe('a1');
  });

  it('incrementActiveTask sets busy and increments count', async () => {
    const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
    const repo = new AgentRepository();
    repo.saveStore({
      agents: {
        'a1': { agentId: 'a1', agentType: 't', status: 'idle' as const, health: 1, taskCount: 3, config: {}, createdAt: '' },
      },
      version: '3.0.0',
    });
    repo.incrementActiveTask('a1');
    const agent = repo.getAgent('a1')!;
    expect(agent.status).toBe('busy');
    expect(agent.activeTaskCount).toBe(1);
  });

  it('decrementActiveTask restores idle after last task', async () => {
    const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
    const repo = new AgentRepository();
    repo.saveStore({
      agents: {
        'a1': { agentId: 'a1', agentType: 't', status: 'busy' as const, health: 1, taskCount: 3, activeTaskCount: 1, config: {}, createdAt: '' },
      },
      version: '3.0.0',
    });
    repo.decrementActiveTask('a1', { success: true });
    const agent = repo.getAgent('a1')!;
    expect(agent.status).toBe('idle');
    expect(agent.activeTaskCount).toBe(0);
    expect(agent.lastResult).toEqual({ success: true });
  });

  it('decrementActiveTask preserves terminated status', async () => {
    const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
    const repo = new AgentRepository();
    repo.saveStore({
      agents: {
        'a1': { agentId: 'a1', agentType: 't', status: 'terminated' as const, health: 1, taskCount: 3, activeTaskCount: 1, config: {}, createdAt: '' },
      },
      version: '3.0.0',
    });
    repo.decrementActiveTask('a1', { success: true });
    const agent = repo.getAgent('a1')!;
    expect(agent.status).toBe('terminated');
    expect(agent.lastResult).toEqual({ success: true });
  });

  it('decrementActiveTask persists failed result', async () => {
    const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
    const repo = new AgentRepository();
    repo.saveStore({
      agents: {
        'a1': { agentId: 'a1', agentType: 't', status: 'busy' as const, health: 1, taskCount: 3, activeTaskCount: 1, config: {}, createdAt: '' },
      },
      version: '3.0.0',
    });
    repo.decrementActiveTask('a1', { error: 'API timeout', success: false });
    const agent = repo.getAgent('a1')!;
    expect(agent.lastResult).toEqual({ error: 'API timeout', success: false });
  });

  it('terminateAgent sets status to terminated', async () => {
    const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
    const repo = new AgentRepository();
    repo.saveStore({
      agents: {
        'a1': { agentId: 'a1', agentType: 't', status: 'idle' as const, health: 1, taskCount: 0, config: {}, createdAt: '' },
      },
      version: '3.0.0',
    });
    repo.terminateAgent('a1');
    expect(repo.getAgent('a1')!.status).toBe('terminated');
  });

  it('updateAgent returns false for unknown agent', async () => {
    const { AgentRepository } = await import('../src/agent-store/agent-repository.js');
    const repo = new AgentRepository();
    const result = repo.updateAgent('nonexistent', { status: 'terminated' });
    expect(result).toBe(false);
  });
});
