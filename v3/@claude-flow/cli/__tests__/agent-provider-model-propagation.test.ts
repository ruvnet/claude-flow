/**
 * Regression guard for ruvnet/ruflo#2962 — explicit provider/model selection
 * (`providers configure`, `agent spawn --provider/--model`) did not
 * propagate into actual agent execution. Backend/model selection at
 * `agent_execute` time was driven solely by env vars, never by the
 * persisted `agents.providers` config or the agent's own `config.provider`
 * / `config.model`.
 *
 * Precedence implemented: explicit per-agent flag → env vars → persisted
 * `agents.providers` config → key-presence inference (unchanged, last
 * resort).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentTools } from '../src/mcp-tools/agent-tools.js';
import { callAnthropicMessages, executeAgentTask } from '../src/mcp-tools/agent-execute-core.js';
import { configManager } from '../src/services/config-file-manager.js';

const tool = (name: string) => {
  const t = agentTools.find(t => t.name === name);
  if (!t) throw new Error(`MCP tool not registered: ${name}`);
  return t;
};

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'OLLAMA_API_KEY',
  'OLLAMA_BASE_URL',
  'RUFLO_PROVIDER',
] as const;

describe('#2962 — provider/model config propagates into agent execution', () => {
  let dir: string;
  let prevCwd: string | undefined;
  let prevEnv: Record<string, string | undefined>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-2962-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;

    prevEnv = {};
    for (const key of ENV_KEYS) {
      prevEnv[key] = process.env[key];
      delete process.env[key];
    }

    // configManager is a module-level singleton that caches its loaded
    // config + resolved path across calls; reset its private state so each
    // test's fresh tmp-dir config file is actually re-read from disk
    // instead of reusing a previous test's cached config/path.
    (configManager as unknown as { config: unknown }).config = null;
    (configManager as unknown as { configPath: unknown }).configPath = null;
  });

  afterEach(() => {
    if (prevCwd === undefined) delete process.env.CLAUDE_FLOW_CWD;
    else process.env.CLAUDE_FLOW_CWD = prevCwd;
    for (const key of ENV_KEYS) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
    }
    (configManager as unknown as { config: unknown }).config = null;
    (configManager as unknown as { configPath: unknown }).configPath = null;
    rmSync(dir, { recursive: true, force: true });
    fetchSpy?.mockRestore();
  });

  function writeConfig(agentsProviders: unknown[]): void {
    writeFileSync(
      join(dir, 'claude-flow.config.json'),
      JSON.stringify({ agents: { providers: agentsProviders } }),
    );
  }

  function mockOpenAICompatFetch() {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'chatcmpl-test',
        model: 'qwen3.6:27b',
        choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as unknown as Response);
  }

  // (1) callAnthropicMessages() selects Ollama from the persisted config,
  // not just env vars — no OLLAMA_API_KEY set, agents.providers has an
  // enabled ollama entry with a self-hosted baseUrl → the Ollama branch is
  // taken with no Authorization header sent (no fake credential required).
  it('callAnthropicMessages() dispatches to a self-hosted Ollama endpoint from persisted config alone', async () => {
    writeConfig([
      { name: 'ollama', enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.6:27b' },
    ]);
    mockOpenAICompatFetch();

    const result = await callAnthropicMessages({ prompt: 'say hi' });

    expect(result.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    // Self-hosted, unauthenticated endpoint: no Authorization header, no
    // fake 'local' credential should have been required to reach it.
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  // (2) determineAgentModel() accepts an arbitrary non-Claude model string
  // as an explicit selection (via the modelId fast-path), and that
  // selection is NOT silently substituted for a default when re-read
  // downstream by executeAgentTask — verified by inspecting the actual
  // model sent on the wire, not just the stored record.
  it('an arbitrary non-alias --model string survives spawn and reaches the dispatch call unchanged', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    mockOpenAICompatFetch();
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'msg-test',
        model: 'qwen3.6:27b',
        content: [{ type: 'text', text: 'hi' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    } as unknown as Response);

    const spawnResult = (await tool('agent_spawn').handler({
      agentType: 'researcher',
      config: { model: 'qwen3.6:27b' },
    })) as { agentId: string; model: string; modelRoutedBy: string; modelId?: string };

    expect(spawnResult.modelRoutedBy).toBe('explicit');
    expect(spawnResult.modelId).toBe('qwen3.6:27b');

    await executeAgentTask({ agentId: spawnResult.agentId, prompt: 'say hi' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    // Before the fix: config.model fell through determineAgentModel's
    // alias-only check, agent.modelId was never set, and this would be
    // 'claude-sonnet-5' (the silently-substituted default).
    expect(body.model).toBe('qwen3.6:27b');
  });

  // (3) Full round-trip with no environment variables set at all:
  // providers configure (config-file write) → agent spawn
  // --provider ollama --model <tag> → the resulting agent record's
  // provider/modelId fields are populated → executeAgentTask's dispatch
  // call is constructed with that provider forwarded to a self-hosted
  // endpoint.
  it('round-trip: providers-configure + spawn --provider ollama --model reaches Ollama with zero env vars', async () => {
    // Simulates `providers configure -p ollama -m qwen3.6:27b -e http://127.0.0.1:11434`
    writeConfig([
      { name: 'ollama', enabled: true, baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.6:27b' },
    ]);
    mockOpenAICompatFetch();

    // Simulates `agent spawn --type researcher --provider ollama --model qwen3.6:27b`
    // (commands/agent.ts always sets config.provider — 'ollama' here is an
    // unambiguous explicit choice, unlike the CLI's silent 'anthropic' default)
    const spawnResult = (await tool('agent_spawn').handler({
      agentType: 'researcher',
      config: { provider: 'ollama', model: 'qwen3.6:27b' },
    })) as { agentId: string; provider?: string; modelId?: string };

    expect(spawnResult.provider).toBe('ollama');
    expect(spawnResult.modelId).toBe('qwen3.6:27b');

    const execResult = await executeAgentTask({ agentId: spawnResult.agentId, prompt: 'say hi' });

    expect(execResult.success).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/v1/chat/completions');
  });
});
