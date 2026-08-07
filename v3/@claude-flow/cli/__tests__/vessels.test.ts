// Tests for the vessel registry: BUILTIN_VESSELS, inferShape, resolveModel,
// toProviderManagerConfig, mergeVessels, and vesselsFromEnv. Vessels are pure
// config — no runtime provider is instantiated here.

import { describe, it, expect } from 'vitest';
import {
  BUILTIN_VESSELS,
  inferShape,
  resolveModel,
  toProviderManagerConfig,
  mergeVessels,
  vesselsFromEnv,
} from '../src/mcp-tools/vessels.js';
import type { VesselConfig } from '../src/mcp-tools/vessels.js';

describe('vessel registry', () => {
  it('exposes the expected built-in vessels with valid shapes and base URLs', () => {
    const keys = Object.keys(BUILTIN_VESSELS);
    for (const name of ['anthropic', 'openrouter', 'ollama', 'zai', 'longcat']) {
      expect(keys).toContain(name);
    }

    for (const vessel of Object.values(BUILTIN_VESSELS)) {
      expect(vessel).toHaveProperty('name');
      expect(['anthropic', 'openai']).toContain(vessel.shape);
      expect(typeof vessel.baseUrl).toBe('string');
      expect(vessel.baseUrl.length).toBeGreaterThan(0);
    }

    expect(BUILTIN_VESSELS.zai.shape).toBe('anthropic');
    expect(BUILTIN_VESSELS.zai.baseUrl).toContain('/anthropic');
    expect(BUILTIN_VESSELS.longcat.shape).toBe('anthropic');
  });

  it('infers provider shape from a base URL', () => {
    expect(inferShape('https://api.z.ai/api/anthropic')).toBe('anthropic');
    expect(inferShape('https://openrouter.ai/api')).toBe('openai');
    expect(inferShape('http://localhost:11434')).toBe('openai');
  });

  it('resolves logical tiers to concrete model ids for zai', () => {
    const zai = BUILTIN_VESSELS.zai;
    expect(resolveModel(zai, 'opus')).toBe('glm-5.2');
    expect(resolveModel(zai, 'sonnet')).toBe('glm-5.1');
    expect(resolveModel(zai, 'haiku')).toBe('glm-4.7');
  });

  it('passes a literal model id through unchanged', () => {
    const zai = BUILTIN_VESSELS.zai;
    expect(resolveModel(zai, 'glm-4.5-air')).toBe('glm-4.5-air');
    expect(resolveModel(zai, 'anthropic/claude-opus-4')).toBe('anthropic/claude-opus-4');
  });

  it('falls back to the literal input for an unknown tier without throwing', () => {
    const zai = BUILTIN_VESSELS.zai;
    expect(() => resolveModel(zai, 'gpt-5')).not.toThrow();
    expect(resolveModel(zai, 'gpt-5')).toBe('gpt-5');
  });

  it('translates a vessel into a ProviderManagerConfig with fallback enabled', () => {
    const cfg = toProviderManagerConfig([
      { ...BUILTIN_VESSELS.anthropic, apiKey: 'sk-test' },
    ]);
    expect(cfg.providers.length).toBeGreaterThanOrEqual(1);
    expect(cfg.providers[0].provider).toBe('anthropic');
    expect(cfg.providers[0].apiKey).toBe('sk-test');
    expect(cfg.providers[0].apiUrl).toBe(BUILTIN_VESSELS.anthropic.baseUrl);
    expect(cfg.providers[0].model).toBeTruthy();
    expect(cfg.fallback.maxAttempts).toBe(2);
  });

  it('lets a user vessel override a same-named built-in and combines the rest', () => {
    const user: Record<string, VesselConfig> = {
      zai: { ...BUILTIN_VESSELS.zai, baseUrl: 'https://custom.z.ai/api/anthropic' },
      custom: {
        name: 'custom',
        shape: 'openai',
        baseUrl: 'https://example.com/v1',
        apiKey: '',
        models: {},
      },
    };
    const merged = mergeVessels(BUILTIN_VESSELS, user);
    expect(merged.zai.baseUrl).toBe('https://custom.z.ai/api/anthropic');
    expect(merged.custom).toBeDefined();
    expect(merged.anthropic).toEqual(BUILTIN_VESSELS.anthropic);
  });

  it('synthesizes Authorization: Bearer for a bearer-auth vessel (longcat)', () => {
    // LongCat's /anthropic proxy authenticates via `Authorization: Bearer`, not
    // x-api-key. The vessel declares auth: 'bearer'; toProviderManagerConfig
    // must build the header from the runtime apiKey and surface it on the
    // generated provider config — without hardcoding any token in source.
    const longcat = { ...BUILTIN_VESSELS.longcat, apiKey: 'sk-lcat-runtime' };
    const cfg = toProviderManagerConfig([longcat]);

    expect(cfg.providers).toHaveLength(1);
    const provider = cfg.providers[0];
    expect(provider.provider).toBe('anthropic');
    expect(provider.apiUrl).toBe('https://api.longcat.chat/anthropic');
    expect(provider.headers).toBeDefined();
    expect(provider.headers!['Authorization']).toBe('Bearer sk-lcat-runtime');
  });

  it('does not add an Authorization header for the default x-api-key vessel', () => {
    // The anthropic built-in uses the default x-api-key scheme, so its provider
    // config must carry no Authorization header — Bearer is opt-in only.
    const anthropic = { ...BUILTIN_VESSELS.anthropic, apiKey: 'sk-anthropic' };
    const cfg = toProviderManagerConfig([anthropic]);

    const provider = cfg.providers[0];
    expect(provider.headers?.['Authorization']).toBeUndefined();
    expect(provider.headers?.['x-api-key']).toBeUndefined(); // set later by the provider
  });

  it('merges vessel.headers on top of a bearer Authorization header', () => {
    // A bearer vessel may also carry extra headers (e.g. vendor metadata); they
    // must survive alongside the synthesized Authorization header.
    const longcat = {
      ...BUILTIN_VESSELS.longcat,
      apiKey: 'sk-lcat-runtime',
      headers: { 'X-LCat-Trace': 'abc' },
    };
    const cfg = toProviderManagerConfig([longcat]);
    const provider = cfg.providers[0];

    expect(provider.headers!['Authorization']).toBe('Bearer sk-lcat-runtime');
    expect(provider.headers!['X-LCat-Trace']).toBe('abc');
  });

  it('merges an env-synthesized vessel when ANTHROPIC_BASE_URL is set', () => {
    const original = process.env.ANTHROPIC_BASE_URL;
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.example.com/anthropic';
    try {
      const vessels = vesselsFromEnv();
      expect(vessels['env-anthropic']).toBeDefined();
      expect(vessels['env-anthropic'].baseUrl).toBe('https://proxy.example.com/anthropic');
      expect(vessels['env-anthropic'].shape).toBe('anthropic');
    } finally {
      if (original === undefined) {
        delete process.env.ANTHROPIC_BASE_URL;
      } else {
        process.env.ANTHROPIC_BASE_URL = original;
      }
    }
  });
});
