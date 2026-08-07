/**
 * AnthropicProvider auth-scheme regression tests
 *
 * Locks in the header-selection logic in `doInitialize()`:
 *   - default (no Authorization header)  -> sets `x-api-key` from apiKey
 *   - caller-supplied Authorization       -> drops `x-api-key`, keeps Authorization
 *   - extra config headers                -> merged over the defaults
 *
 * The two auth schemes must never be emitted together — LongCat's Bearer
 * endpoint rejects requests that also carry a (stale) x-api-key.
 *
 * Run with: npx vitest run src/__tests__/anthropic-auth.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { vi } from 'vitest';
import { AnthropicProvider } from '../anthropic-provider.js';
import type { LLMProviderConfig } from '../types.js';

// Stub the network: doHealthCheck (called at the end of initialize()) only
// reads response.ok, and doComplete/doStreamComplete are not exercised here.
const okResponse = {
  ok: true,
  status: 200,
  json: async () => ({ data: [] }),
  text: async () => '[]',
} as unknown as Response;

beforeAll(() => {
  vi.stubGlobal('fetch', async () => okResponse);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// The provider's request headers are private; reach them through a typed
// view so the test reads the actual wire fields without widening the type.
interface AnthropicProviderHeaders {
  headers: Record<string, string>;
}

function headersOf(provider: AnthropicProvider): Record<string, string> {
  return (provider as unknown as AnthropicProviderHeaders).headers;
}

// Minimal, valid config factory. validateConfig() only requires `model`;
// doInitialize() additionally requires `apiKey` (even for Bearer — the key is
// still the credential, it just isn't sent over the wire as x-api-key).
function config(overrides: Partial<LLMProviderConfig> = {}): LLMProviderConfig {
  return {
    provider: 'anthropic',
    apiKey: 'sk-test-default',
    model: 'claude-3-5-sonnet-20241022',
    ...overrides,
  };
}

describe('AnthropicProvider auth-scheme selection', () => {
  it('default path: sets x-api-key and does not emit Authorization', async () => {
    const provider = new AnthropicProvider({ config: config() });
    await provider.initialize();

    const headers = headersOf(provider);
    expect(headers['x-api-key']).toBe('sk-test-default');
    expect(headers['Authorization']).toBeUndefined();
    // Defaults are always present.
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['Content-Type']).toBe('application/json');

    provider.destroy();
  });

  it('Bearer path: caller-supplied Authorization drops x-api-key', async () => {
    const provider = new AnthropicProvider({
      config: config({
        apiKey: 'sk-bearer-credential',
        headers: { Authorization: 'Bearer sk-bearer-credential' },
      }),
    });
    await provider.initialize();

    const headers = headersOf(provider);
    expect(headers['Authorization']).toBe('Bearer sk-bearer-credential');
    // The two schemes must never be emitted together.
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['anthropic-version']).toBe('2023-06-01');

    provider.destroy();
  });

  it('extra caller headers merge over (and can override) the defaults', async () => {
    const provider = new AnthropicProvider({
      config: config({
        headers: {
          Authorization: 'Bearer override-key',
          'Content-Type': 'application/json+lcat',
          'X-Custom': 'value',
        },
      }),
    });
    await provider.initialize();

    const headers = headersOf(provider);
    expect(headers['Authorization']).toBe('Bearer override-key');
    expect(headers['x-api-key']).toBeUndefined();
    // Content-Type was overridden by the caller; custom header was added.
    expect(headers['Content-Type']).toBe('application/json+lcat');
    expect(headers['X-Custom']).toBe('value');

    provider.destroy();
  });

  it('missing apiKey still throws AuthenticationError', async () => {
    const provider = new AnthropicProvider({ config: config({ apiKey: '' }) });
    await expect(provider.initialize()).rejects.toThrow(/API key is required/i);

    provider.destroy();
  });
});
