/**
 * Vessel model-family guard + structural validation for the dispatch system.
 *
 * Different vessel/model families reject standard LLM sampling parameters
 * (`temperature`, `top_p`, `top_k`) with an HTTP 400 "Extra inputs are not
 * permitted" response. The dispatch layer must know which vessel's active
 * model falls into a rejecting family so it can strip those params before
 * sending the request (see {@link vesselRejectsSamplingParams}).
 */

import type { VesselConfig } from './vessels.js';

// ===== REJECT-SAMPLING-PARAMS FAMILIES =====

// #2357 — The Anthropic Messages API returns HTTP 400 "Extra inputs are not
// permitted" for adaptive-thinking models (Claude Fable 5 / Opus 4.x / Sonnet
// 5) when the request carries `temperature`, `top_p`, or `top_k`. These models
// own their own sampling, so the extra keys are rejected as unknown inputs.
// The same behavior is observed on other providers' adaptive families: ZAI's
// GLM-4/5 and the LongCat model line. Each family is matched by a RegExp
// against the concrete model id; {@link vesselRejectsSamplingParams} is the
// single gate the dispatcher consults before deciding whether to strip params.

/** A model family identified by a RegExp matched against a concrete model id. */
export interface VesselModelFamily {
  /** RegExp tested against the model id (e.g. `claude-sonnet-5`). */
  pattern: RegExp;
  /** Human-readable rationale — why this family rejects sampling params. */
  description: string;
}

/**
 * Registry of model families that reject `temperature`/`top_p`/`top_k`.
 * Keys are vessel names; the pattern is matched against the active model id.
 * Add a new entry whenever a provider ships an adaptive-thinking model that
 * returns the 400 "Extra inputs are not permitted" error.
 */
export const VESSEL_MODEL_FAMILIES: Record<string, VesselModelFamily> = {
  anthropic: {
    pattern: /^claude-(fable-5|opus-4-8|opus-4-7|sonnet-5)/,
    description: 'Anthropic adaptive-thinking models reject sampling params',
  },
  zai: {
    pattern: /^glm-[45]\./,
    description: 'ZAI GLM-4/5 reject sampling params',
  },
  longcat: {
    pattern: /^longcat-/,
    description: 'LongCat models reject sampling params',
  },
};

// ===== SAMPLING-PARAM GUARD =====

/**
 * Whether the given vessel's active model rejects `temperature`/`top_p`/
 * `top_k`. Returns `true` only when the vessel name is a known family AND
 * the model id matches that family's pattern. Unknown vessels default to
 * `false` (params are sent normally) — the safe direction for families that
 * tolerate the keys.
 *
 * @param vesselName - Vessel name (key into {@link VESSEL_MODEL_FAMILIES}).
 * @param model - Concrete model id resolved for the vessel.
 */
export function vesselRejectsSamplingParams(vesselName: string, model: string): boolean {
  const fam = VESSEL_MODEL_FAMILIES[vesselName];
  return fam ? fam.pattern.test(model) : false;
}

// ===== STRUCTURAL VALIDATION =====

/** Allowed {@link VesselConfig.shape} values — the two supported wire protocols. */
const VESSEL_SHAPES = new Set<string>(['anthropic', 'openai']);

/**
 * Runtime structural guard narrowing `unknown` to {@link VesselConfig}.
 * Enforces the minimum shape the dispatcher requires: a non-empty `name`,
 * a supported `shape`, and a `baseUrl`. Optional fields (`apiKey`, `models`,
 * `headers`) are validated only when present. Does NOT check semantic
 * correctness (e.g. URL validity) — that is the caller's responsibility.
 *
 * @param v - Value to validate, typically parsed from untrusted input.
 * @returns `true` iff `v` satisfies the `VesselConfig` shape.
 */
export function validateVessel(v: unknown): v is VesselConfig {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;

  if (typeof o['name'] !== 'string' || o['name'].length === 0) return false;
  if (typeof o['baseUrl'] !== 'string') return false;
  if (!VESSEL_SHAPES.has(o['shape'] as string)) return false;

  // Optional fields — validated only when present.
  if (o['apiKey'] !== undefined && typeof o['apiKey'] !== 'string') return false;
  if (o['models'] !== undefined) {
    if (typeof o['models'] !== 'object' || o['models'] === null) return false;
  }
  if (o['headers'] !== undefined) {
    if (typeof o['headers'] !== 'object' || o['headers'] === null) return false;
  }

  return true;
}
