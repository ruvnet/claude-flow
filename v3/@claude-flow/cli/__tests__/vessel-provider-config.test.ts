// Focused tests for toProviderManagerConfig — the adapter that maps the
// vessel registry onto a real ProviderManagerConfig consumed by
// @claude-flow/providers.
//
// Discoveries from reading the implementation (vessels.ts:147):
//  - The function takes a `VesselConfig[]` ARRAY, not a record. BUILTIN_VESSELS
//    is a record, so tests pass `[<vessel>]` / `Object.values(...)` as needed.
//  - Each vessel becomes one LLMProviderConfig keyed by its SHAPE
//    ('anthropic' | 'openai'), NOT its name. So openrouter → provider 'openai',
//    zai → provider 'anthropic'.
//  - The per-provider default model is the vessel's `sonnet` tier mapping.
//  - `defaultVesselName` sets `defaultProvider` to that vessel's SHAPE. It does
//    NOT reorder the providers array — order tracks input order.
//  - fallback is hardcoded { enabled: true, maxAttempts: 2 }.
//  - Empty input does NOT throw: returns providers [], defaultProvider
//    'anthropic' (the hard-coded ultimate fallback).

import { describe, it, expect } from 'vitest';
import {
  toProviderManagerConfig,
  BUILTIN_VESSELS,
} from '../src/mcp-tools/vessels.js';

describe('toProviderManagerConfig', () => {
  it('single anthropic vessel → one provider config', () => {
    const result = toProviderManagerConfig([
      { ...BUILTIN_VESSELS.anthropic, apiKey: 'sk-test-123' },
    ]);

    expect(result.providers).toHaveLength(1);
    expect(result.providers[0].provider).toBe('anthropic');
    expect(result.providers[0].apiUrl).toBe('https://api.anthropic.com/v1');
    expect(result.providers[0].apiKey).toBe('sk-test-123');
  });

  it('openrouter vessel → provider "openai"', () => {
    const result = toProviderManagerConfig([BUILTIN_VESSELS.openrouter]);

    expect(result.providers[0].provider).toBe('openai');
    expect(result.providers[0].apiUrl).toContain('openrouter.ai');
  });

  it('zai vessel → provider "anthropic" with zai base url and a glm model', () => {
    const result = toProviderManagerConfig([BUILTIN_VESSELS.zai]);

    expect(result.providers[0].provider).toBe('anthropic');
    expect(result.providers[0].apiUrl).toBe('https://api.z.ai/api/anthropic');
    // sonnet tier is the per-provider default model.
    expect(result.providers[0].model).toBe('glm-5.1');
    expect(result.providers[0].model).toMatch(/^glm-/);
  });

  it('defaultVesselName pins defaultProvider to that vessel\'s shape (no reorder)', () => {
    const result = toProviderManagerConfig(
      [BUILTIN_VESSELS.anthropic, BUILTIN_VESSELS.zai, BUILTIN_VESSELS.openrouter],
      'openrouter',
    );

    // Honored via defaultProvider, NOT by reordering. openrouter is openai-shaped.
    expect(result.defaultProvider).toBe('openai');
    // Input order is preserved.
    expect(result.providers.map((p) => p.provider)).toEqual([
      'anthropic',
      'anthropic',
      'openai',
    ]);
  });

  it('fallback enabled with maxAttempts 2', () => {
    const result = toProviderManagerConfig([BUILTIN_VESSELS.anthropic]);

    expect(result.fallback.enabled).toBe(true);
    expect(result.fallback.maxAttempts).toBe(2);
  });

  it('multiple vessels → multiple provider configs, no throw', () => {
    const result = toProviderManagerConfig([
      BUILTIN_VESSELS.anthropic,
      BUILTIN_VESSELS.zai,
      BUILTIN_VESSELS.openrouter,
    ]);

    expect(result.providers).toHaveLength(3);
    const validProviders = ['anthropic', 'openai'];
    result.providers.forEach((p) => {
      expect(validProviders).toContain(p.provider);
    });
  });

  it('empty vessels does NOT throw — returns empty providers + anthropic fallback default', () => {
    const result = toProviderManagerConfig([]);

    expect(result.providers).toHaveLength(0);
    // Ultimate fallback when no vessel exists to derive a default from.
    expect(result.defaultProvider).toBe('anthropic');
    expect(result.fallback.enabled).toBe(true);
  });
});
