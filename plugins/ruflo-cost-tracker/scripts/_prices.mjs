// _prices.mjs — single source of truth for cost-tracker model pricing.
//
// Iter 31 of ADR-149 router work consolidated 5 scripts' worth of pricing
// into one module. This is the cost-tracker plugin equivalent: track.mjs
// and counterfactual.mjs both maintained identical PRICING tables, and
// bench.mjs has its own ANTHROPIC_PRICING. When pricing changes, drift
// across scripts is the failure mode. One module prevents that.
//
// Underscore-prefix filename signals "library, not a CLI entry" — smoke.sh
// uses `scripts/*.mjs` for the CLI surface check, but reaches this file
// only through the `parses cleanly` step (still valid).

// USD per 1M tokens. Kept in sync with REFERENCE.md "Model pricing" table.
// Source of truth for: track.mjs (session cost computation),
// counterfactual.mjs (multi-baseline analysis), bench.mjs (anthropic baseline).
export const PRICING = {
  haiku:  { input: 0.25,  output: 1.25,  cache_write: 0.30,  cache_read: 0.03 },
  sonnet: { input: 3.00,  output: 15.00, cache_write: 3.75,  cache_read: 0.30 },
  opus:   { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 },
};

/** Map a model id to one of `haiku | sonnet | opus | unknown`. */
export function modelTier(model) {
  if (!model) return 'unknown';
  const m = String(model).toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('opus')) return 'opus';
  return 'unknown';
}

/**
 * Compute USD cost for a usage record at a given tier.
 * usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens }
 */
export function costForUsage(tier, usage) {
  const p = PRICING[tier];
  if (!p || !usage) return 0;
  return (usage.input_tokens || 0) / 1e6 * p.input
       + (usage.output_tokens || 0) / 1e6 * p.output
       + (usage.cache_creation_input_tokens || 0) / 1e6 * p.cache_write
       + (usage.cache_read_input_tokens || 0) / 1e6 * p.cache_read;
}

/**
 * Compute USD cost for a tokens-bundle (totals already summed) at a given tier.
 * tokens: { input, output, cache_write, cache_read }
 * Used by counterfactual analysis where tokens are aggregated across models
 * before applying a single baseline tier's pricing.
 */
export function costAtTier(tokens, tier) {
  const p = PRICING[tier];
  if (!p) return 0;
  return (tokens.input / 1e6) * p.input
       + (tokens.output / 1e6) * p.output
       + (tokens.cache_write / 1e6) * p.cache_write
       + (tokens.cache_read / 1e6) * p.cache_read;
}
