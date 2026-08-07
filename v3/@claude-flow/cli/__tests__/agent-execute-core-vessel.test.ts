// callAnthropicMessages vessel routing.
//
// The vessel path is the primary dispatch: a ProviderManagerConfig is built
// from merged built-in + user vessels and handed to createProviderManager.
// The legacy Anthropic / Ollama / OpenRouter fetch path remains as a
// fallback. These tests pin the vessel contract and the exact
// AnthropicCallResult shape — including that neither path throws and that no
// provider-specific fields leak onto the result.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  callAnthropicMessages,
  type AnthropicCallInput,
  type AnthropicCallResult,
} from '../src/mcp-tools/agent-execute-core.js';
import { createProviderManager } from '@claude-flow/providers';
import { configManager } from '../src/services/config-file-manager.js';

vi.mock('@claude-flow/providers', () => ({
  createProviderManager: vi.fn(),
}));

vi.mock('../src/services/config-file-manager.js', () => ({
  configManager: { getConfig: vi.fn(), set: vi.fn() },
  ConfigFileManager: vi.fn(),
}));

// Mock handles (cast through `unknown` — never `any`).
const mockedCreate = createProviderManager as unknown as vi.Mock;
const mockedGetConfig = configManager.getConfig as unknown as vi.Mock;

// Raw shape returned by a vessel's `complete()`. Note `provider` and the
// OpenAI-style `promptTokens`/`completionTokens` naming — the result mapping
// must transform these, not pass them through.
const VESSEL_RESPONSE = {
  id: 'v',
  provider: 'anthropic' as const,
  content: 'vessel output',
  usage: { promptTokens: 2, completionTokens: 4, totalTokens: 6 },
  finishReason: 'stop',
};

const PROVIDER_KEYS = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY', 'OLLAMA_API_KEY'] as const;

async function withoutEnv(keys: readonly string[], fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] !== undefined) process.env[k] = saved[k];
    }
  }
}

describe('callAnthropicMessages — vessel path (agent-execute-core)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Empty user vessels → merge falls back to BUILTIN_VESSELS.
    mockedGetConfig.mockReturnValue({ providers: { vessels: {} } });
    // Happy vessel: `complete()` resolves with the shaped response.
    // `destroy()` is a no-op — dispatchViaVessel always calls it in a
    // finally-block, so the mock must expose it or that call throws and
    // the happy path turns into a failure result.
    mockedCreate.mockImplementation(() => ({
      complete: async (req: { model?: string }) => ({
        ...VESSEL_RESPONSE,
        model: req.model ?? 'm',
      }),
      destroy: async () => {},
    }));
  });

  it('routes through the vessel path and returns a shaped result', async () => {
    const result = await callAnthropicMessages({ prompt: 'hi' });
    expect(result.success).toBe(true);
    expect(result.output).toBe('vessel output');
    expect(result.usage?.totalTokens).toBe(6);
  });

  it('preserves the AnthropicCallResult shape (no provider leakage)', async () => {
    const result = await callAnthropicMessages({ prompt: 'hi' });
    const allowed = new Set([
      'success',
      'model',
      'messageId',
      'stopReason',
      'output',
      'usage',
      'durationMs',
      'error',
    ]);
    for (const key of Object.keys(result)) expect(allowed.has(key)).toBe(true);
    expect(typeof result.success).toBe('boolean');
    expect((result as Record<string, unknown>).provider).toBeUndefined();
    // Vessel usage is OpenAI-named (promptTokens/completionTokens); the
    // mapped result must expose the Anthropic-flavored names only.
    expect(result.usage?.inputTokens).toBeTypeOf('number');
    expect(result.usage?.outputTokens).toBeTypeOf('number');
  });

  it('falls back to the legacy path on vessel error and still returns a shaped result', async () => {
    mockedCreate.mockImplementation(() => {
      throw new Error('vessel unavailable');
    });
    await withoutEnv(PROVIDER_KEYS, async () => {
      const result = await callAnthropicMessages({ prompt: 'hi' });
      // Must NOT throw — must always return an AnthropicCallResult-shaped object.
      expect(result).toBeTypeOf('object');
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
    });
  });

  it('uses a vesselName input to select the provider', async () => {
    const input = { prompt: 'hi', vesselName: 'anthropic' } as AnthropicCallInput;
    const result = await callAnthropicMessages(input);
    expect(result.success).toBe(true);
  });

  it('preserves the no-key error when vessels and fallback are both exhausted', async () => {
    mockedCreate.mockImplementation(() => {
      throw new Error('vessel unavailable');
    });
    await withoutEnv(PROVIDER_KEYS, async () => {
      const result = await callAnthropicMessages({ prompt: 'hi' });
      expect(result.success).toBe(false);
      expect(typeof result.error).toBe('string');
      expect(result.error).toContain('ANTHROPIC_API_KEY');
    });
  });
});
