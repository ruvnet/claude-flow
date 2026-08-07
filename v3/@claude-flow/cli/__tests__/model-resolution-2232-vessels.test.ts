// Regression guard for #2232 — model-resolution behaviour must survive the
// vessel-system wiring into agent-execute-core.ts.
//
// The integration agent (vessel system) edits agent-execute-core.ts. This file
// locks down the model-resolution contract so that edit cannot silently regress
// it. Mirrors the assertions in model-resolution-2232.test.ts and extends them
// with the sampling-params guard and a defensive export-presence check.

import { describe, it, expect } from 'vitest';
import {
  resolveAnthropicModel,
  DEFAULT_ANTHROPIC_MODEL,
  modelRejectsSamplingParams,
} from '../src/mcp-tools/agent-execute-core.js';

describe('model resolution survives vessel integration (#2232)', () => {
  it('DEFAULT_ANTHROPIC_MODEL is claude-sonnet-5', () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe('claude-sonnet-5');
  });

  it('resolveAnthropicModel maps tiers to current ids', () => {
    expect(resolveAnthropicModel('haiku')).toBe('claude-haiku-4-5-20251001');
    expect(resolveAnthropicModel('sonnet')).toBe('claude-sonnet-5');
    expect(resolveAnthropicModel('opus')).toBe('claude-opus-4-8');
    expect(resolveAnthropicModel('inherit')).toBe('claude-sonnet-5');
  });

  it('modelRejectsSamplingParams unchanged for adaptive-thinking family', () => {
    // #2357 — these reject temperature/top_p/top_k on the direct Anthropic path.
    expect(modelRejectsSamplingParams('claude-opus-4-8')).toBe(true);
    expect(modelRejectsSamplingParams('claude-opus-4-7')).toBe(true);
    expect(modelRejectsSamplingParams('claude-sonnet-5')).toBe(true);
    // Haiku still accepts sampling params.
    expect(modelRejectsSamplingParams('claude-haiku-4-5-20251001')).toBe(false);
    // Non-Anthropic (e.g. zai/glm) is outside the anthropic regex — the
    // vessel-schema layer owns that mapping, so the anthropic function returns false.
    expect(modelRejectsSamplingParams('glm-5.2')).toBe(false);
  });

  it('exports preserved for the vessel integration', async () => {
    // Defensive: dynamic namespace import so one missing export does not throw
    // the whole import. The integration agent must keep all three available.
    const mod = await import('../src/mcp-tools/agent-execute-core.js');
    expect(mod.DEFAULT_ANTHROPIC_MODEL).toBeDefined();
    expect(mod.MODEL_MAP).toBeDefined();
    expect(mod.modelRejectsSamplingParams).toBeDefined();
  });
});
