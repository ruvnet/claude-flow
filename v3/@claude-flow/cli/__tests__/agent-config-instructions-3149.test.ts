/** #3149: persisted agent instructions must reach the provider at execution. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeAgentTask } from '../src/mcp-tools/agent-execute-core.js';

const ENV_KEYS = ['CLAUDE_FLOW_CWD', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_API_KEY', 'RUFLO_PROVIDER'] as const;
let dir: string;
let oldEnv: Record<string, string | undefined>;
let fetchSpy: ReturnType<typeof vi.spyOn>;

function writeAgent(instructions: unknown): void {
  const agentDir = join(dir, '.claude-flow', 'agents');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'store.json'), JSON.stringify({
    version: '3.0.0',
    agents: {
      'agent-3149': {
        agentId: 'agent-3149', agentType: 'researcher', status: 'idle', health: 1,
        taskCount: 0, createdAt: '2026-01-01T00:00:00.000Z',
        config: { instructions },
      },
    },
  }));
}

function sentSystemPrompt(): string {
  const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string).system[0].text;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-agent-3149-'));
  oldEnv = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.CLAUDE_FLOW_CWD = dir;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      id: 'msg-test', model: 'claude-sonnet-5',
      content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  } as unknown as Response);
});

afterEach(() => {
  fetchSpy.mockRestore();
  for (const key of ENV_KEYS) {
    if (oldEnv[key] === undefined) delete process.env[key];
    else process.env[key] = oldEnv[key];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('agent system prompt precedence', () => {
  it('uses configured instructions when the caller supplies no system prompt', async () => {
    writeAgent('You work on project X at /repo/X.');
    const result = await executeAgentTask({ agentId: 'agent-3149', prompt: 'Find the file' });
    expect(result.success).toBe(true);
    expect(sentSystemPrompt()).toBe('You work on project X at /repo/X.');
  });

  it('keeps an explicit caller system prompt above configured instructions', async () => {
    writeAgent('Configured instructions');
    await executeAgentTask({ agentId: 'agent-3149', prompt: 'Find the file', systemPrompt: 'Caller override' });
    expect(sentSystemPrompt()).toBe('Caller override');
  });

  it('uses the generic prompt when configured instructions are not text', async () => {
    writeAgent({ unexpected: true });
    await executeAgentTask({ agentId: 'agent-3149', prompt: 'Find the file' });
    expect(sentSystemPrompt()).toContain('You are a researcher agent');
  });
});
