// Regression tests for the vessel dispatch model-family guard + structural
// validation (vessel-schema.ts). The dispatch layer consults
// `vesselRejectsSamplingParams` to strip `temperature`/`top_p`/`top_k` for
// families that return HTTP 400 "Extra inputs are not permitted", and
// `validateVessel` to narrow untrusted input to a `VesselConfig`.

import { describe, it, expect } from 'vitest';
import {
  VESSEL_MODEL_FAMILIES,
  vesselRejectsSamplingParams,
  validateVessel,
} from '../src/mcp-tools/vessel-schema.js';

describe('VESSEL_MODEL_FAMILIES', () => {
  it('has entries for anthropic, zai, and longcat', () => {
    expect(Object.keys(VESSEL_MODEL_FAMILIES).sort()).toEqual(['anthropic', 'longcat', 'zai']);
  });
});

describe('vesselRejectsSamplingParams — anthropic', () => {
  it('rejects the Opus 4.8 family (incl. dated variant ids)', () => {
    expect(vesselRejectsSamplingParams('anthropic', 'claude-opus-4-8')).toBe(true);
    expect(vesselRejectsSamplingParams('anthropic', 'claude-opus-4-8-20250514')).toBe(true);
  });

  it('does NOT reject Haiku or legacy Sonnet models', () => {
    expect(vesselRejectsSamplingParams('anthropic', 'claude-haiku-4-5-20251001')).toBe(false);
    expect(vesselRejectsSamplingParams('anthropic', 'claude-3-5-sonnet')).toBe(false);
  });
});

describe('vesselRejectsSamplingParams — zai', () => {
  it('rejects the GLM-4/5 family', () => {
    expect(vesselRejectsSamplingParams('zai', 'glm-5.2')).toBe(true);
    expect(vesselRejectsSamplingParams('zai', 'glm-5.1')).toBe(true);
    expect(vesselRejectsSamplingParams('zai', 'glm-4.7')).toBe(true);
    // /^glm-[45]\./ matches the `glm-4.` prefix of `glm-4.5-air`.
    expect(vesselRejectsSamplingParams('zai', 'glm-4.5-air')).toBe(true);
  });

  it('does NOT reject non-GLM models', () => {
    expect(vesselRejectsSamplingParams('zai', 'gpt-4')).toBe(false);
  });
});

describe('vesselRejectsSamplingParams — longcat', () => {
  it('rejects LongCat model ids', () => {
    expect(vesselRejectsSamplingParams('longcat', 'longcat-2.0')).toBe(true);
  });

  it('does NOT reject non-LongCat models', () => {
    expect(vesselRejectsSamplingParams('longcat', 'claude-sonnet-5')).toBe(false);
  });
});

describe('vesselRejectsSamplingParams — unknown vessel', () => {
  it('defaults to false (no throw) for an unknown family', () => {
    expect(vesselRejectsSamplingParams('nonexistent', 'anything')).toBe(false);
  });
});

describe('validateVessel', () => {
  it('accepts a minimal valid VesselConfig', () => {
    const v = { name: 'x', shape: 'anthropic', baseUrl: 'https://x.com', apiKey: 'k' };
    expect(validateVessel(v)).toBe(true);
  });

  it('rejects when required fields are missing or invalid', () => {
    expect(validateVessel({ shape: 'anthropic', baseUrl: 'https://x.com' })).toBe(false); // missing name
    expect(validateVessel({ name: '', shape: 'anthropic', baseUrl: 'https://x.com' })).toBe(false); // empty name
    expect(validateVessel({ name: 'x', shape: 'gemini', baseUrl: 'https://x.com' })).toBe(false); // bad shape
    expect(validateVessel({ name: 'x', shape: 'openai' })).toBe(false); // missing baseUrl
  });

  it('rejects a non-string apiKey when present', () => {
    const v = { name: 'x', shape: 'openai', baseUrl: 'https://x.com', apiKey: 123 };
    expect(validateVessel(v)).toBe(false);
  });
});
