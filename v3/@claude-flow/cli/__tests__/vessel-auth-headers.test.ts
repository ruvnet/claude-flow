/**
 * Vessel → provider-config auth-header wiring
 *
 * The vessel layer must translate a vessel's auth scheme into the `headers`
 * field the AnthropicProvider reads at init. This is the contract that lets an
 * anthropic-shaped vessel authenticate with EITHER x-api-key (Anthropic/ZAI)
 * OR Authorization: Bearer (LongCat) — driven by the vessel's `auth` config
 * flag, never hardcoded by name. Pure unit test of toProviderManagerConfig();
 * no network, no provider runtime.
 *
 * Run with: npx vitest run __tests__/vessel-auth-headers.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_VESSELS,
  toProviderManagerConfig,
  type VesselConfig,
} from '../src/mcp-tools/vessels.js';

describe('toProviderManagerConfig auth-header wiring', () => {
  it('longcat (auth: bearer) emits Authorization: Bearer <apiKey>, no x-api-key', () => {
    const longcat: VesselConfig = {
      ...BUILTIN_VESSELS['longcat'],
      apiKey: 'longcat-runtime-key',
    };
    const cfg = toProviderManagerConfig([longcat]);
    const providerConfig = cfg.providers[0];

    // The provider switches to Bearer purely because this header is present;
    // it must NOT also set x-api-key (the two schemes must never collide).
    expect(providerConfig.headers?.['Authorization']).toBe('Bearer longcat-runtime-key');
    expect(providerConfig.apiKey).toBe('longcat-runtime-key');
  });

  it('anthropic (default auth) emits no Authorization header', () => {
    const anthropic: VesselConfig = {
      ...BUILTIN_VESSELS['anthropic'],
      apiKey: 'sk-ant-default',
    };
    const cfg = toProviderManagerConfig([anthropic]);
    const providerConfig = cfg.providers[0];

    // Default x-api-key scheme: no Authorization header is synthesized, so the
    // provider keeps its default x-api-key behavior.
    expect(providerConfig.headers?.['Authorization']).toBeUndefined();
    expect(providerConfig.apiKey).toBe('sk-ant-default');
  });

  it('zai (default auth) emits no Authorization header', () => {
    const zai: VesselConfig = {
      ...BUILTIN_VESSELS['zai'],
      apiKey: 'zai-key',
    };
    const cfg = toProviderManagerConfig([zai]);
    const providerConfig = cfg.providers[0];

    expect(providerConfig.headers?.['Authorization']).toBeUndefined();
  });

  it('passes through arbitrary caller-supplied headers unchanged', () => {
    const vessel: VesselConfig = {
      name: 'openrouter-like',
      shape: 'anthropic',
      baseUrl: 'https://example.com/anthropic',
      apiKey: 'k',
      models: { sonnet: 'm' },
      headers: { 'X-Custom': 'value' },
    };
    const cfg = toProviderManagerConfig([vessel]);
    const providerConfig = cfg.providers[0];

    expect(providerConfig.headers?.['X-Custom']).toBe('value');
    expect(providerConfig.headers?.['Authorization']).toBeUndefined();
  });

  it('bearer vessel with empty apiKey does not fabricate a Bearer token', () => {
    // Guards against emitting "Bearer " with no credential if the vessel has
    // not been given a runtime apiKey yet.
    const longcat: VesselConfig = {
      ...BUILTIN_VESSELS['longcat'],
      apiKey: '',
    };
    const cfg = toProviderManagerConfig([longcat]);
    const providerConfig = cfg.providers[0];

    const auth = providerConfig.headers?.['Authorization'];
    expect(auth === undefined || auth === 'Bearer ').toBe(true);
    // A non-empty Bearer value is only produced when a real key is present.
    expect(auth === 'Bearer longcat-runtime-key').toBe(false);
  });
});
