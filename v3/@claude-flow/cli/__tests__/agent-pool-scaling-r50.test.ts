import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const state = vi.hoisted(() => ({ cwd: '' }));
vi.mock('../src/mcp-tools/types.js', () => ({ getProjectCwd: () => state.cwd }));
vi.mock('../src/mcp-tools/agent-execute-core.js', () => ({ executeAgentTask: vi.fn() }));
import { agentTools } from '../src/mcp-tools/agent-tools.js';
const scale = (targetSize: number) => agentTools.find(t => t.name === 'agent_pool')!.handler({ action: 'scale', agentType: 'coder', targetSize }) as Promise<any>;
const path = () => join(state.cwd, '.claude-flow/agents/store.json');
beforeEach(() => {
  state.cwd = mkdtempSync(join(tmpdir(), 'ruflo-pool-'));
  mkdirSync(join(state.cwd, '.claude-flow/agents'), { recursive: true });
  const agents = Object.fromEntries(['idle', 'busy'].map(status => [status, { agentId: status, agentType: 'coder', status, config: {}, health: 1, taskCount: 0 }]));
  writeFileSync(path(), JSON.stringify({ agents, version: '3.0.0' }));
});
afterEach(() => rmSync(state.cwd, { recursive: true, force: true }));
it('honors zero while leaving busy agents alive and reports the actual remaining size', async () => {
  const result = await scale(0);
  expect(result.targetSize).toBe(0);
  expect(result.added).toEqual([]);
  expect(result.removed).toEqual(['idle']);
  expect(result.newSize).toBe(1);
  expect(JSON.parse(readFileSync(path(), 'utf8')).agents.busy.status).toBe('busy');
});
it('reports the actual size when no idle agent can meet a downscale', async () => {
  const data = JSON.parse(readFileSync(path(), 'utf8')); data.agents.idle.status = 'busy'; writeFileSync(path(), JSON.stringify(data));
  expect(await scale(1)).toMatchObject({ newSize: 2, removed: [] });
});
it.each([-1, 1.5, NaN])('rejects invalid target %s without writing', async target => {
  const before = readFileSync(path(), 'utf8');
  expect(await scale(target)).toMatchObject({ error: expect.any(String) });
  expect(readFileSync(path(), 'utf8')).toBe(before);
});
it('adds exactly the requested number for a valid scale-up', async () => {
  expect(await scale(3)).toMatchObject({ newSize: 3, added: [expect.any(String)], removed: [] });
});
