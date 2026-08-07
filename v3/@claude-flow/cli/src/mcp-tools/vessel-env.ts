/**
 * Active-vessel selection — single source of truth for "which vessel wins".
 *
 * Centralizes the env-var precedence the old hand-rolled dispatch used so
 * both the runtime dispatch and the CLI resolve the active vessel identically.
 * The precedence mirrors `callAnthropicMessages` (#1725/#2042): an explicit
 * `RUFLO_PROVIDER` wins, then an `ANTHROPIC_BASE_URL` match, then the
 * `anthropic` default, then the first registered vessel.
 */

import type { VesselConfig } from './vessels.js';

/** A resolved active vessel plus how it was chosen (for diagnostics/logging). */
export interface ResolvedVessel {
  vessel: VesselConfig;
  name: string;
  source: 'env-explicit' | 'env-baseurl-match' | 'default';
}

/**
 * Look up a vessel by name with a case-insensitive key match. Returns
 * `undefined` when no name is given or no vessel matches — callers fall
 * through to the next precedence rung rather than erroring.
 */
export function selectVessel(
  vessels: Record<string, VesselConfig>,
  name?: string,
): VesselConfig | undefined {
  if (!name) return undefined;
  const target = name.toLowerCase();
  const entry = Object.entries(vessels).find(
    ([key]) => key.toLowerCase() === target,
  );
  return entry?.[1];
}

/** Strip trailing slashes and lowercase for a normalized baseUrl compare. */
function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

/**
 * Pick the single active vessel from the merged registry using env-var
 * precedence. Throws only when the registry is empty — an env var that
 * matches nothing is treated as "user didn't mean to pin", and we fall
 * through to the default rather than erroring out.
 *
 * Precedence:
 *   1. `RUFLO_PROVIDER` → exact name match (`env-explicit`).
 *   2. `ANTHROPIC_BASE_URL` → vessel whose baseUrl matches (`env-baseurl-match`).
 *   3. `anthropic` default vessel (`default`).
 *   4. First registered vessel (`default`).
 */
export function resolveActiveVessel(
  vessels: Record<string, VesselConfig>,
): ResolvedVessel {
  const entries = Object.entries(vessels);
  if (entries.length === 0) {
    throw new Error('resolveActiveVessel: vessel registry is empty');
  }

  // 1. Explicit provider selection via RUFLO_PROVIDER.
  const explicit = process.env.RUFLO_PROVIDER;
  if (explicit) {
    const match = selectVessel(vessels, explicit);
    if (match) return { vessel: match, name: match.name, source: 'env-explicit' };
  }

  // 2. Anthropic base-URL match — normalized (trailing-slash-insensitive,
  // case-insensitive). No match here falls through rather than throwing.
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  if (baseUrl) {
    const target = normalizeBaseUrl(baseUrl);
    const match = entries.find(
      ([, v]) => normalizeBaseUrl(v.baseUrl) === target,
    );
    if (match) {
      const [name, vessel] = match;
      return { vessel, name, source: 'env-baseurl-match' };
    }
  }

  // 3. 'anthropic' default, else first registered vessel.
  const fallback = selectVessel(vessels, 'anthropic') ?? entries[0][1];
  const fallbackName = selectVessel(vessels, 'anthropic')
    ? 'anthropic'
    : entries[0][0];
  return { vessel: fallback, name: fallbackName, source: 'default' };
}
