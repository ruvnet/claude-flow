import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callAnthropicMessages, executeAgentTask } from '../src/mcp-tools/agent-execute-core.js';

vi.mock('../src/ruvector/model-router.js', () => ({
  recordModelOutcome: vi.fn(), recordModelOutcomeByModelId: vi.fn(),
}));

describe('explicit execution provider boundaries', () => {
  let dir: string;
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-provider-selection-'));
    for (const key of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'OPENROUTER_API_KEY', 'OLLAMA_API_KEY', 'RUFLO_PROVIDER', 'OLLAMA_BASE_URL', 'OPENROUTER_BASE_URL']) vi.stubEnv(key, '');
    vi.stubEnv('CLAUDE_FLOW_CWD', dir);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      id: 'response', model: 'test-model', content: [{type: 'text', text: 'done'}],
      choices: [{message: {content: 'done'}, finish_reason: 'stop'}],
      usage: {input_tokens: 1, output_tokens: 1}, stop_reason: 'end_turn',
    }) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); rmSync(dir, {recursive: true, force: true}); });

  it.each(['argument', 'environment'])('honors explicit Ollama from %s when an OpenRouter key also exists', async source => {
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-test');
    vi.stubEnv('OLLAMA_API_KEY', 'ollama-test');
    if (source === 'environment') vi.stubEnv('RUFLO_PROVIDER', 'ollama');
    const result = await callAnthropicMessages({prompt: 'test', ...(source === 'argument' ? {provider: 'ollama' as const} : {})});
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://ollama.com/v1/chat/completions');
  });

  it.each(['anthropic', 'ollama', 'openrouter'] as const)('fails closed when explicit %s lacks credentials despite another configured provider', async provider => {
    vi.stubEnv(provider === 'anthropic' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY', 'other-provider-test');
    const result = await callAnthropicMessages({prompt: 'test', provider});
    expect(result.success).toBe(false);
    expect(result.error?.toLowerCase()).toContain(provider);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps key-based inference when no provider was selected', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-test');
    expect((await callAnthropicMessages({prompt: 'test'})).success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('lets a per-agent provider override the environment default', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'anthropic-test');
    vi.stubEnv('OLLAMA_API_KEY', 'ollama-test');
    vi.stubEnv('RUFLO_PROVIDER', 'ollama');
    expect((await callAnthropicMessages({prompt: 'test', provider: 'anthropic'})).success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
  });

  it('honors the stored agent provider through actual agent execution', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'openrouter-test');
    vi.stubEnv('OLLAMA_API_KEY', 'ollama-test');
    const agents = join(dir, '.claude-flow', 'agents'); mkdirSync(agents, {recursive: true});
    writeFileSync(join(agents, 'store.json'), JSON.stringify({version: '3.0.0', agents: {
      selected: {agentId: 'selected', agentType: 'coder', status: 'idle', health: 100, taskCount: 0, config: {}, createdAt: new Date().toISOString(), provider: 'ollama', model: 'sonnet'},
    }}));
    expect((await executeAgentTask({agentId: 'selected', prompt: 'test'})).success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://ollama.com/v1/chat/completions');
  });
});
