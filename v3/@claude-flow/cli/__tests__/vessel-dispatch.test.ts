// Tests for dispatchViaVessel — the vessel → ProviderManager dispatch path.
//
// The module under test imports `@claude-flow/providers` and calls
// `createProviderManager` at runtime. That package is aliased to its source
// by vitest.config.ts, but we still mock it here so tests never hit the
// network: the mock's `complete` is a controllable async fn whose received
// `LLMRequest` argument we capture to assert sampling-param stripping.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the provider layer BEFORE the module under test imports it.
const complete = vi.fn(async (req: { model?: string; temperature?: number }) => ({
  id: 'mock-1',
  model: req.model ?? 'm',
  provider: 'anthropic' as const,
  content: 'mock output',
  usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
  finishReason: 'stop' as const,
}));

vi.mock('@claude-flow/providers', () => ({
  createProviderManager: vi.fn(async () => ({ complete })),
}));

import { dispatchViaVessel } from '../src/mcp-tools/vessel-dispatch.js';
import { BUILTIN_VESSELS } from '../src/mcp-tools/vessels.js';
import type { AnthropicCallInput } from '../src/mcp-tools/agent-execute-core.js';

beforeEach(() => {
  complete.mockClear();
});

describe('dispatchViaVessel', () => {
  it('returns a shaped result on success', async () => {
    const result = await dispatchViaVessel(
      { anthropic: BUILTIN_VESSELS.anthropic },
      { prompt: 'hi' },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.output).toBe('mock output');
    expect(result.usage?.totalTokens).toBe(8);
    expect(result.model).toBeTruthy();
  });

  it('selects the vessel by vesselName', async () => {
    complete.mockImplementation(async (req: { model?: string }) => ({
      id: 'mock-1',
      model: req.model ?? 'm',
      provider: 'anthropic' as const,
      content: 'mock output',
      usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
      finishReason: 'stop' as const,
    }));
    const result = await dispatchViaVessel(
      { anthropic: BUILTIN_VESSELS.anthropic },
      { prompt: 'hi', vesselName: 'anthropic', model: 'claude-sonnet-5' },
    );
    expect(result.success).toBe(true);
    // The anthropic vessel resolved the model from the input/vessel.
    const req = complete.mock.calls[0][0] as { model?: string };
    expect(req.model).toBe('claude-sonnet-5');
  });

  it('maps temperature only when the model does not reject sampling params', async () => {
    // Rejecting model (claude-opus-4-8) → temperature must be stripped.
    await dispatchViaVessel(
      { anthropic: BUILTIN_VESSELS.anthropic },
      { prompt: 'hi', model: 'claude-opus-4-8', temperature: 0.7 } as AnthropicCallInput,
    );
    const rejectingReq = complete.mock.calls[0][0] as { temperature?: number };
    expect(rejectingReq.temperature).toBeUndefined();

    // Non-rejecting model (claude-sonnet-4-6) → temperature is kept.
    await dispatchViaVessel(
      { anthropic: BUILTIN_VESSELS.anthropic },
      { prompt: 'hi', model: 'claude-sonnet-4-6', temperature: 0.7 } as AnthropicCallInput,
    );
    const allowingReq = complete.mock.calls[1][0] as { temperature?: number };
    expect(allowingReq.temperature).toBe(0.7);
  });

  it('returns success:false on provider error', async () => {
    complete.mockRejectedValueOnce(new Error('boom'));
    const result = await dispatchViaVessel(
      { anthropic: BUILTIN_VESSELS.anthropic },
      { prompt: 'hi' },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toContain('boom');
  });

  it('returns success:false when no vessels are provided', async () => {
    const result = await dispatchViaVessel({}, { prompt: 'hi' });
    expect(result.success).toBe(false);
  });
});
