import { describe, it, expect, beforeEach } from 'vitest';
import { createArenaTools, type MCPTool } from '../src/mcp-tools/index.js';
import { InMemoryRunStore } from '../src/persistence/run-store.js';

type Envelope = { success: boolean; result?: any; error?: { message: string } };

let store: InMemoryRunStore;
let tools: MCPTool[];
const tool = (name: string) => tools.find((t) => t.name === name)!;
const call = (name: string, input: Record<string, unknown>) => tool(name).handler(input) as Promise<Envelope>;

beforeEach(() => {
  store = new InMemoryRunStore();
  tools = createArenaTools(store);
});

describe('mcp tool surface', () => {
  it('exposes the expected tools under the arena category', () => {
    expect(tools.map((t) => t.name)).toEqual([
      'arena/run',
      'tournament/run',
      'evolve/run',
      'coevolve/run',
      'run/get',
      'run/list',
    ]);
    for (const t of tools) {
      expect(t.category).toBe('arena');
      expect(t.inputSchema.type).toBe('object');
      expect(typeof t.handler).toBe('function');
    }
  });
});

describe('arena/run', () => {
  it('runs a match and persists it', async () => {
    const r = await call('arena/run', { game: 'pd', a: 'tit-for-tat', b: 'tit-for-tat', rounds: 50 });
    expect(r.success).toBe(true);
    expect(r.result.mean).toEqual([3, 3]);
    expect(r.result.runId).toMatch(/^arena-/);
    expect(r.result.agentdb.namespace).toBe('arena');
    expect(await store.get(r.result.runId)).not.toBeNull();
  });

  it('coerces string numeric inputs (MCP/CLI friendliness)', async () => {
    const r = await call('arena/run', { game: 'pd', a: 'tit-for-tat', b: 'always-defect', rounds: '200', seed: '1' });
    expect(r.success).toBe(true);
    expect(r.result.mean[0]).toBeGreaterThan(0.9);
  });

  it('fails cleanly on an unknown game or strategy', async () => {
    expect((await call('arena/run', { game: 'nope' })).success).toBe(false);
    expect((await call('arena/run', { game: 'pd', a: 'does-not-exist' })).success).toBe(false);
  });
});

describe('tournament/run', () => {
  it('returns a competitive array and ranking, and persists', async () => {
    const r = await call('tournament/run', { game: 'pd', rounds: 100 });
    expect(r.success).toBe(true);
    expect(r.result.ranking.length).toBe(8);
    expect(r.result.matrix.length).toBe(8);
    expect(r.result.tables.competitiveArray).toContain('tit-fo');
    expect(await store.get(r.result.runId)).not.toBeNull();
  });
});

describe('evolve/run', () => {
  it('reports a non-decreasing improvement and an evolved program', async () => {
    const r = await call('evolve/run', { game: 'pd', generations: 150, seed: 42 });
    expect(r.success).toBe(true);
    expect(r.result.finalFitness).toBeGreaterThanOrEqual(r.result.startFitness);
    expect(r.result.best.kind).toBe('fsm');
  });
});

describe('run persistence tools', () => {
  it('lists and fetches persisted runs', async () => {
    const a = await call('arena/run', { game: 'pd' });
    await call('tournament/run', { game: 'pd', rounds: 50 });
    const list = await call('run/list', { limit: 10 });
    expect(list.success).toBe(true);
    expect(list.result.length).toBe(2);
    const got = await call('run/get', { runId: a.result.runId });
    expect(got.success).toBe(true);
    expect(got.result.runId).toBe(a.result.runId);
  });

  it('run/get fails for a missing id', async () => {
    expect((await call('run/get', { runId: 'nope-123' })).success).toBe(false);
  });
});
