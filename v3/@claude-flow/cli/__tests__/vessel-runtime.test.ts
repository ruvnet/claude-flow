// Runtime tests for the vessel system — model tier resolution across providers
// and ProviderManager config generation. No network, no env mutation.
//
// A "vessel" is pure config (shape, baseUrl, apiKey, tier→model map). These
// tests assert the resolution + translation layer the dispatcher relies on,
// against the shipped BUILTIN_VESSELS baseline.

import { describe, it, expect } from 'vitest';
import {
  resolveModel,
  toProviderManagerConfig,
  BUILTIN_VESSELS,
  mergeVessels,
  type VesselConfig,
} from '../src/mcp-tools/vessels.js';
import { vesselRejectsSamplingParams } from '../src/mcp-tools/vessel-schema.js';

// Snapshotted once at import; tests read but never mutate these.
const anthropic: VesselConfig = BUILTIN_VESSELS.anthropic;
const zai: VesselConfig = BUILTIN_VESSELS.zai;
const longcat: VesselConfig = BUILTIN_VESSELS.longcat;
const openrouter: VesselConfig = BUILTIN_VESSELS.openrouter;

describe('vessel runtime', () => {
  it('zai tier resolution matches user spec', () => {
    expect(resolveModel(zai, 'haiku')).toBe('glm-4.7');
    expect(resolveModel(zai, 'sonnet')).toBe('glm-5.1');
    expect(resolveModel(zai, 'opus')).toBe('glm-5.2');
  });

  it('longcat tier resolution', () => {
    // Current placeholder builtins map every tier to the same model.
    expect(resolveModel(longcat, 'haiku')).toBe('longcat-2.0');
    expect(resolveModel(longcat, 'sonnet')).toBe('longcat-2.0');
    expect(resolveModel(longcat, 'opus')).toBe('longcat-2.0');
  });

  it('anthropic builtins unchanged', () => {
    expect(resolveModel(anthropic, 'haiku')).toBe('claude-haiku-4-5-20251001');
    expect(resolveModel(anthropic, 'sonnet')).toBe('claude-sonnet-5');
    expect(resolveModel(anthropic, 'opus')).toBe('claude-opus-4-8');
  });

  it('vesselRejectsSamplingParams covers zai glm ids', () => {
    expect(vesselRejectsSamplingParams('zai', 'glm-5.2')).toBe(true);
    expect(vesselRejectsSamplingParams('zai', 'glm-5.1')).toBe(true);
    expect(vesselRejectsSamplingParams('zai', 'glm-4.7')).toBe(true);
    expect(vesselRejectsSamplingParams('zai', 'glm-4.5-air')).toBe(true);
  });

  it('toProviderManagerConfig maps shape→provider and carries apiUrl through', () => {
    const cfg = toProviderManagerConfig([anthropic, openrouter]);
    const byUrl = (url: string) => cfg.providers.find((p) => p.apiUrl === url);
    const anthropicProvider = byUrl(anthropic.baseUrl);
    const openrouterProvider = byUrl(openrouter.baseUrl);

    // Anthropic-shaped vessel → anthropic provider.
    expect(anthropicProvider?.provider).toBe('anthropic');
    // OpenRouter speaks the OpenAI wire shape → openai provider (#2042).
    expect(openrouterProvider?.provider).toBe('openai');
    // baseUrl is forwarded verbatim so the provider hits the right endpoint.
    expect(openrouterProvider?.apiUrl).toBe(openrouter.baseUrl);
  });

  it('mergeVessels lets a user vessel override the same-named builtin', () => {
    const userZai: VesselConfig = {
      ...zai,
      models: { haiku: 'custom-glm', sonnet: 'custom-glm', opus: 'custom-glm' },
    };
    const merged = mergeVessels(BUILTIN_VESSELS, { zai: userZai });

    // Override applied.
    expect(merged.zai.models.haiku).toBe('custom-glm');
    // Other builtins retained untouched.
    expect(merged.anthropic).toEqual(BUILTIN_VESSELS.anthropic);
    expect(merged.longcat).toEqual(BUILTIN_VESSELS.longcat);
  });

  it('passes a CLAUDE_CODE_SUBAGENT_MODEL style literal id through unchanged', () => {
    // `glm-4.5-air` is a free-tier id with no tier slot — resolveModel must
    // return it verbatim, not remap it.
    expect(resolveModel(zai, 'glm-4.5-air')).toBe('glm-4.5-air');
  });
});
