/**
 * Self-hosted Ollama (or any OpenAI-compatible local server) as the ruflo
 * execution provider — two gaps found while pointing ruflo at a local
 * endpoint from Claude Code and Grok Build hosts:
 *
 * 1. Precedence: `RUFLO_PROVIDER=ollama` was silently overridden by a stray
 *    `OPENROUTER_API_KEY` whenever `ANTHROPIC_API_KEY` was absent, because
 *    the OpenRouter key-presence branch ran before the explicit choice was
 *    honoured. Key-presence inference must only apply when no provider was
 *    chosen explicitly.
 *
 * 2. Model: a tier-routed agent (`haiku` / `sonnet` / `opus`) reaches the
 *    Ollama branch with the MODEL_MAP output (`claude-haiku-4-5-20251001`,
 *    …), a name no Ollama store has. The model saved by
 *    `providers configure -p ollama -m <tag>` (or `OLLAMA_DEFAULT_MODEL`)
 *    is now the default for tier aliases and Anthropic ids; explicit local
 *    names (`ollama:<tag>` or a bare tag) still pass through untouched.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callAnthropicMessages } from '../src/mcp-tools/agent-execute-core.js';
import { configManager } from '../src/services/config-file-manager.js';

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'OPENROUTER_API_KEY',
  'OPENROUTER_BASE_URL',
  'OLLAMA_API_KEY',
  'OLLAMA_BASE_URL',
  'OLLAMA_DEFAULT_MODEL',
  'RUFLO_PROVIDER',
] as const;

const OLLAMA = 'http://127.0.0.1:11434';

describe('self-hosted Ollama: explicit provider precedence + local default model', () => {
  let dir: string;
  let prevCwd: string | undefined;
  let prevEnv: Record<string, string | undefined>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ruflo-ollama-local-'));
    prevCwd = process.env.CLAUDE_FLOW_CWD;
    process.env.CLAUDE_FLOW_CWD = dir;
    prevEnv = {};
    for (const key of ENV_KEYS) {
      prevEnv[key] = process.env[key];
      delete process.env[key];
    }
    (configManager as unknown as { config: unknown }).config = null;
    (configManager as unknown as { configPath: unknown }).configPath = null;
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'chatcmpl-test',
        model: 'qwen3-coder:30b',
        choices: [{ message: { role: 'assistant', content: 'PONG' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    } as unknown as Response);
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
    fetchSpy.mockRestore();
  });

  function lastRequest(): { url: string; body: Record<string, unknown>; headers: Record<string, string> } {
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    return { url, body: JSON.parse(init.body as string), headers: init.headers as Record<string, string> };
  }

  it('RUFLO_PROVIDER=ollama is honoured even when OPENROUTER_API_KEY is set and ANTHROPIC_API_KEY is not', async () => {
    process.env.RUFLO_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = OLLAMA;
    process.env.OPENROUTER_API_KEY = 'sk-or-stray';

    const result = await callAnthropicMessages({ prompt: 'ping', model: 'qwen3-coder:30b' });

    expect(result.success).toBe(true);
    const { url, headers } = lastRequest();
    expect(url).toBe(`${OLLAMA}/v1/chat/completions`);
    expect(headers.Authorization).toBeUndefined();
  });

  it('a per-agent explicit provider outranks OpenRouter key-presence inference too', async () => {
    process.env.OLLAMA_BASE_URL = OLLAMA;
    process.env.OPENROUTER_API_KEY = 'sk-or-stray';

    await callAnthropicMessages({ prompt: 'ping', model: 'qwen3-coder:30b', provider: 'ollama' });

    expect(lastRequest().url).toBe(`${OLLAMA}/v1/chat/completions`);
  });

  it('with no explicit provider, OpenRouter key-presence inference is unchanged', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-real';

    await callAnthropicMessages({ prompt: 'ping', model: 'sonnet' });

    expect(lastRequest().url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('OLLAMA_DEFAULT_MODEL replaces tier aliases and Anthropic model ids, and only those', async () => {
    process.env.RUFLO_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = OLLAMA;
    process.env.OLLAMA_DEFAULT_MODEL = 'qwen3-coder:30b';

    const cases: Array<[string | undefined, string]> = [
      ['claude-haiku-4-5-20251001', 'qwen3-coder:30b'], // MODEL_MAP output for a tier-routed agent
      ['claude-sonnet-5', 'qwen3-coder:30b'],
      ['sonnet', 'qwen3-coder:30b'],
      [undefined, 'qwen3-coder:30b'],
      ['ollama:gemma4:12b', 'gemma4:12b'], // explicit prefix strips
      ['devstral:latest', 'devstral:latest'], // bare local tag passes through
    ];
    for (const [model, expected] of cases) {
      fetchSpy.mockClear();
      await callAnthropicMessages({ prompt: 'ping', model });
      expect(lastRequest().body.model, `model=${model}`).toBe(expected);
    }
  });

  it('the model saved by `providers configure -p ollama -m` is the default when no env override is set', async () => {
    writeFileSync(
      join(dir, 'claude-flow.config.json'),
      JSON.stringify({ agents: { providers: [{ name: 'ollama', enabled: true, baseUrl: OLLAMA, model: 'gemma4:12b' }] } }),
    );
    process.env.RUFLO_PROVIDER = 'ollama';

    await callAnthropicMessages({ prompt: 'ping', model: 'claude-sonnet-5' });

    const { url, body } = lastRequest();
    expect(url).toBe(`${OLLAMA}/v1/chat/completions`);
    expect(body.model).toBe('gemma4:12b');
  });

  it('env OLLAMA_DEFAULT_MODEL wins over the persisted model', async () => {
    writeFileSync(
      join(dir, 'claude-flow.config.json'),
      JSON.stringify({ agents: { providers: [{ name: 'ollama', enabled: true, baseUrl: OLLAMA, model: 'gemma4:12b' }] } }),
    );
    process.env.RUFLO_PROVIDER = 'ollama';
    process.env.OLLAMA_DEFAULT_MODEL = 'qwen3-coder:30b';

    await callAnthropicMessages({ prompt: 'ping', model: 'haiku' });

    expect(lastRequest().body.model).toBe('qwen3-coder:30b');
  });

  // Regression: a signed-in local Ollama daemon forwards any
  // `-cloud`-suffixed model name straight to Ollama's real cloud service.
  // Silently rewriting a tier-routed/self-hosted request to
  // 'gpt-oss:120b-cloud' when the endpoint is NOT actually Ollama Cloud
  // (here, a local 127.0.0.1 base URL) would leak the prompt off-machine
  // without the user ever asking for that. This must fail loudly instead —
  // no request should even be sent.
  it('without OLLAMA_DEFAULT_MODEL, a self-hosted/local base URL fails loudly instead of synthesizing a -cloud model name', async () => {
    process.env.RUFLO_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = OLLAMA;

    const result = await callAnthropicMessages({ prompt: 'ping', model: 'claude-sonnet-5' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/OLLAMA_DEFAULT_MODEL/);
    expect(result.error).not.toBeUndefined();
    // No -cloud model name was ever synthesized or sent anywhere.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('without OLLAMA_DEFAULT_MODEL, a tier alias against a self-hosted/local base URL also fails loudly (no silent cloud default)', async () => {
    process.env.RUFLO_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = OLLAMA;

    const result = await callAnthropicMessages({ prompt: 'ping', model: 'sonnet' });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/OLLAMA_DEFAULT_MODEL/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // A base URL that IS genuinely Ollama's cloud endpoint (the default when
  // no OLLAMA_BASE_URL override is given at all) may still fall back to the
  // cloud-suffixed default — that's the one case where sending a
  // `-cloud`-suffixed name is not a surprise cloud egress.
  it('with no OLLAMA_BASE_URL override at all (real Ollama Cloud endpoint), the -cloud fallback default still applies', async () => {
    process.env.RUFLO_PROVIDER = 'ollama';
    process.env.OLLAMA_API_KEY = 'sk-ollama-cloud-test';

    const result = await callAnthropicMessages({ prompt: 'ping', model: 'claude-sonnet-5' });

    expect(result.success).toBe(true);
    expect(lastRequest().url).toBe('https://ollama.com/v1/chat/completions');
    expect(lastRequest().body.model).toBe('gpt-oss:120b-cloud');
  });
});
