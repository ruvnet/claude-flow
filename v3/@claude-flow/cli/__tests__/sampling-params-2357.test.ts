/**
 * Regression test for #2357 (Finding A): callAnthropicMessages always sent
 * `temperature` (default 0.7), but the adaptive-thinking family — Fable 5,
 * Opus 4.8, Opus 4.7 — removed temperature/top_p/top_k. The API rejects the
 * request with 400 "temperature: Extra inputs are not permitted", so
 * agent_execute / workflow_run / the WASM-agent Anthropic path could not
 * call any current frontier model when an ANTHROPIC_API_KEY was set.
 *
 * Pin the contract: sampling params are omitted for models that reject them,
 * and unchanged (including the 0.7 default) for models that still accept
 * them. The Ollama / OpenRouter OpenAI-compat paths are out of scope — they
 * accept temperature.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  callAnthropicMessages,
  modelRejectsSamplingParams,
} from '../src/mcp-tools/agent-execute-core.js';

describe('modelRejectsSamplingParams (#2357)', () => {
  it.each([
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-5',
  ])('rejects sampling params for %s', (m) => {
    expect(modelRejectsSamplingParams(m)).toBe(true);
  });

  it('covers dated snapshots of the same family', () => {
    expect(modelRejectsSamplingParams('claude-opus-4-8-20260301')).toBe(true);
  });

  it.each([
    'claude-sonnet-4-6',
    'claude-haiku-4-5-20251001',
    'claude-opus-4-6', // pre-4.7 Opus still accepts sampling params
  ])('keeps sampling params for %s', (m) => {
    expect(modelRejectsSamplingParams(m)).toBe(false);
  });
});

describe('callAnthropicMessages request body (#2357)', () => {
  const captured: Array<Record<string, unknown>> = [];
  const savedEnv = { ...process.env };

  beforeEach(() => {
    captured.length = 0;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-real';
    delete process.env.RUFLO_PROVIDER;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OLLAMA_API_KEY;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body) as Record<string, unknown>;
        captured.push(body);
        return {
          ok: true,
          json: async () => ({
            id: 'msg_test',
            model: body.model,
            content: [{ type: 'text', text: 'ok' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
        };
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...savedEnv };
  });

  it.each([
    'claude-fable-5',
    'claude-opus-4-8',
    'claude-opus-4-7',
    'claude-sonnet-5',
  ])('omits temperature for %s (the API 400s otherwise)', async (model) => {
    const r = await callAnthropicMessages({ prompt: 'ping', model, maxTokens: 8 });
    expect(r.success).toBe(true);
    expect(captured[0]).not.toHaveProperty('temperature');
  });

  it('still sends the 0.7 default for models that accept sampling params', async () => {
    await callAnthropicMessages({ prompt: 'ping', model: 'claude-sonnet-4-6', maxTokens: 8 });
    expect(captured[0]).toHaveProperty('temperature', 0.7);
  });

  it('honors an explicit temperature for accepting models', async () => {
    await callAnthropicMessages({
      prompt: 'ping',
      model: 'claude-haiku-4-5-20251001',
      temperature: 0.2,
      maxTokens: 8,
    });
    expect(captured[0]).toHaveProperty('temperature', 0.2);
  });

  it('drops even an explicit temperature for frontier models (would 400)', async () => {
    await callAnthropicMessages({
      prompt: 'ping',
      model: 'claude-fable-5',
      temperature: 0.9,
      maxTokens: 8,
    });
    expect(captured[0]).not.toHaveProperty('temperature');
  });
});
