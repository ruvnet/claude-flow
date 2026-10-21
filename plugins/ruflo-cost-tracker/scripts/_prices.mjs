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

// USD per 1M tokens, per tier. DERIVED from data/prices.json (see _pricebook.mjs),
// the one dated, sourced price table; nothing here hard-codes a rate any more.
// Each tier is the current model of that family; cache_write is the 5-minute rate.
// Source of truth for: track.mjs (session cost computation),
// counterfactual.mjs (multi-baseline analysis). The multi-provider ledger
// (ledger.mjs) prices per model id with the 5m/1h split instead of per tier.
import { loadBook } from './_pricebook.mjs';

const tierOf = (id) => {
  const m = loadBook().models.find((entry) => entry.id === id);
  return { input: m.input, output: m.output, cache_write: m.cache_write_5m, cache_read: m.cache_read };
};
export const PRICING = {
  haiku:  tierOf('claude-haiku-4-5'),
  sonnet: tierOf('claude-sonnet-5-5'),
  opus:   tierOf('claude-opus-5-5'),
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
