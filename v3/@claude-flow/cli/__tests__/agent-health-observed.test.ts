import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTools } from '../src/mcp-tools/agent-tools.js';
import { executeAgentTask } from '../src/mcp-tools/agent-execute-core.js';
import { appendAgentExecution, summarizeAgentExecutions } from '../src/mcp-tools/agent-health-metrics.js';

const ENV_KEYS = ['CLAUDE_FLOW_CWD', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_API_KEY', 'RUFLO_PROVIDER'] as const;
let dir: string;
let originalEnv: Record<string, string | undefined>;

const health = (input: Record<string, unknown>) =>
  agentTools.find(tool => tool.name === 'agent_health')!.handler(input) as Promise<any>;

function storePath(): string {
  return join(dir, '.claude-flow', 'agents', 'store.json');
}

function writeAgents(): void {
  mkdirSync(join(dir, '.claude-flow', 'agents'), { recursive: true });
  writeFileSync(storePath(), JSON.stringify({ version: '3.0.0', agents: {
    observed: { agentId: 'observed', agentType: 'worker', status: 'idle', health: 1, taskCount: 0, config: {}, createdAt: '2026-01-01T00:00:00.000Z' },
    untouched: { agentId: 'untouched', agentType: 'worker', status: 'idle', health: 1, taskCount: 100, config: {}, createdAt: '2026-01-01T00:00:00.000Z' },
  } }));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-health-observed-'));
  originalEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.CLAUDE_FLOW_CWD = dir;
  writeAgents();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  rmSync(dir, { recursive: true, force: true });
});

it('reports unobserved registry entries as unknown instead of healthy with zero failures', async () => {
  expect(await health({ agentId: 'untouched' })).toMatchObject({ health: null, healthy: null, sampleCount: 0, uptime: null });
  expect(await health({})).toMatchObject({
    observedCount: 0, unknownCount: 2, avgHealth: null,
    overall: { healthy: 0, unknown: 2, score: null },
  });
});

it('persists failed and successful agent_execute outcomes in the bounded health window', async () => {
  expect((await executeAgentTask({ agentId: 'observed', prompt: 'first' })).success).toBe(false);
  expect(await health({ agentId: 'observed' })).toMatchObject({ health: 0, errorRate: 1, failures: 1, sampleCount: 1 });

  process.env.ANTHROPIC_API_KEY = 'test-key';
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
    id: 'msg-test', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'done' }],
    stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
  }) } as Response);
  expect((await executeAgentTask({ agentId: 'observed', prompt: 'second' })).success).toBe(true);

  expect(await health({ agentId: 'observed' })).toMatchObject({
    health: 0.5, errorRate: 0.5, failures: 1, successes: 1, sampleCount: 2,
    latency: { p50: expect.any(Number), p95: expect.any(Number) },
  });
  const aggregate = await health({});
  expect(aggregate).toMatchObject({
    observedCount: 1, unknownCount: 1, avgHealth: 0.5,
    agents: [expect.objectContaining({ id: 'observed', tasks: { active: 0, queued: null, completed: 1, failed: 1 } }), expect.objectContaining({ id: 'untouched', health: 'unknown' })],
  });
  expect(JSON.parse(readFileSync(storePath(), 'utf-8')).agents.observed).toMatchObject({ health: 0.5, executionHistory: [{ success: false }, { success: true }] });
});

it('keeps only the newest 20 samples and computes latency percentiles from measured durations', () => {
  let history: unknown = [];
  for (let i = 1; i <= 25; i++) {
    history = appendAgentExecution(history, { at: new Date().toISOString(), success: i % 5 !== 0, durationMs: i });
  }
  expect(summarizeAgentExecutions(history)).toMatchObject({
    health: 0.8, errorRate: 0.2, sampleCount: 20, failures: 4,
    latency: { avg: 15.5, p50: 15, p95: 24, p99: 25 },
  });
});

it('preserves an explicit health update made while a provider call is in flight', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let complete!: (response: Response) => void;
  vi.spyOn(globalThis, 'fetch').mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const pending = executeAgentTask({ agentId: 'observed', prompt: 'slow response' });
  const store = JSON.parse(readFileSync(storePath(), 'utf-8'));
  store.agents.observed.health = 0.7;
  writeFileSync(storePath(), JSON.stringify(store));
  complete({ ok: true, json: async () => ({
    id: 'msg-test', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'done' }],
    stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 },
  }) } as Response);
  expect((await pending).success).toBe(true);
  expect(JSON.parse(readFileSync(storePath(), 'utf-8')).agents.observed.health).toBe(0.7);
  expect(await health({ agentId: 'observed' })).toMatchObject({ health: 1, sampleCount: 1 });
});
