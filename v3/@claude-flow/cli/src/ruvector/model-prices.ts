/**
 * model-prices.ts — Single source of truth for per-model pricing.
 *
 * Iter 31 — Previously the price table existed in three scripts (train-
 * bundled-krr.mjs, auto-retrain-router.mjs, calibration-check.mjs) AND was
 * derived from the openrouter-alts.json sidecar for the bundled list. As
 * cost-aware features land (trajectory outcomes, cost-savings observability,
 * cost-ceiling routing), they need ONE canonical price lookup. This module
 * is it.
 *
 * Prices are blended ($/Mtok) using a 1×input + 3×output mix, reflecting
 * the average input/output token ratio for code tasks. To compute spend
 * for a specific call:
 *
 *   const usd = costUsd(modelId, inputTokens, outputTokens);
 *
 * Unknown model ids fall back to a conservative $1/Mtok blended estimate
 * so callers always get a number (cost-tracking doesn't silently drop).
 *
 * Source: OpenRouter price page snapshot, ADR-149 bench dates.
 *
 * @module model-prices
 */

/** Per-million-token input and output prices ($USD). */
export interface ModelPrice {
  in: number;
  out: number;
}

/**
 * Curated price table. Keys are concrete model ids matching either
 * OpenRouter slugs or Anthropic SDK ids that the cost-optimal router can
 * choose. New models added via the registry sidecar should be reflected
 * here AS THEY ARE ADDED (no auto-sync); see ADR-149.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // Cheap tier
  'inclusionai/ling-2.6-flash':         { in: 0.01,  out: 0.03 },
  'google/gemini-2.5-flash-lite':       { in: 0.10,  out: 0.40 },
  'meta-llama/llama-3.3-70b-instruct':  { in: 0.13,  out: 0.40 },
  // Mid tier
  'anthropic/claude-haiku-4.5':         { in: 1.00,  out: 5.00 },
  'openai/gpt-4.1':                     { in: 2.00,  out: 8.00 },
  // Strong tier
  'anthropic/claude-sonnet-4-6':        { in: 3.00,  out: 15.00 },
  'anthropic/claude-opus-4':            { in: 15.00, out: 75.00 },
  // Tier-label fallbacks (when the trajectory only carries a coarse tier
  // and not a concrete modelId — happens before iter 13 wiring landed).
  haiku:   { in: 1.00,  out: 5.00 },
  sonnet:  { in: 3.00,  out: 15.00 },
  opus:    { in: 15.00, out: 75.00 },
  inherit: { in: 3.00,  out: 15.00 },
};

/**
 * Blended $/Mtok using the 1× input + 3× output ratio. Used by the KRR
 * trainer (scripts/train-bundled-krr.mjs and others) as the cost feature
 * the cost-optimal selector divides quality by.
 */
export function blendedPrice(modelId: string): number {
  const p = MODEL_PRICES[modelId] ?? { in: 1.0, out: 1.0 };
  return p.in + 3 * p.out;
}

/**
 * Compute USD spend for a single call. Cost = (input × $/Mtok_in +
 * output × $/Mtok_out) / 1_000_000.
 *
 * Returns 0 on missing usage and falls back to a conservative blended
 * estimate when the model is unknown — never returns undefined.
 */
export function costUsd(
  modelId: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number {
  if (!inputTokens && !outputTokens) return 0;
  const p: ModelPrice = (modelId ? MODEL_PRICES[modelId] : undefined) ?? { in: 1.0, out: 1.0 };
  const inT = inputTokens ?? 0;
  const outT = outputTokens ?? 0;
  return (inT * p.in + outT * p.out) / 1_000_000;
}
