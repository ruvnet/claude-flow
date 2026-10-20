#!/usr/bin/env node
// cost-local — what a token costs on hardware you own, and when it beats an API.
//
//   node local-cost.mjs --tok-per-s 80 [--busy 0.25] [--watts-idle 80] [--watts-active 350]
//        [--kwh 0.15] [--hw-price 3000] [--life-years 3] [--resale 0.2]
//        [--compare claude-haiku-4-5] [--out-share 0.25] [--format json|markdown]
//
// Every input is yours and every output an ESTIMATE: throughput and watts are not
// measured here. Cost splits into FIXED (amortisation + idle power, paid busy or
// not) and MARGINAL (extra watts while generating). The number that decides the
// answer is utilisation, so it is always shown at several busy fractions.

import { lookup } from './_pricebook.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const text = name => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };

/** USD per 1M generated tokens at a busy fraction (0–1). Pure. */
export function localCost({ wattsIdle, wattsActive, kwh, hwPrice, lifeYears, resale, tokPerS }, busy) {
  const amortPerHour = (hwPrice * (1 - resale)) / (lifeYears * 8760);
  const fixedPerHour = amortPerHour + (wattsIdle / 1000) * kwh;
  const marginalPerHour = (Math.max(0, wattsActive - wattsIdle) / 1000) * kwh;
  const tokensPerHour = busy * tokPerS * 3600;

  return { fixedPerHour, marginalPerHour, perMtok: tokensPerHour > 0 ? ((fixedPerHour + busy * marginalPerHour) / tokensPerHour) * 1e6 : null };
}

/** The busy fraction above which local beats `apiPerMtok`, or null if it never does at this throughput. */
export function breakEvenBusy(config, apiPerMtok) {
  const { fixedPerHour, marginalPerHour } = localCost(config, 1);
  const denominator = (apiPerMtok * config.tokPerS * 3600) / 1e6 - marginalPerHour;

  return denominator > 0 && fixedPerHour / denominator <= 1 ? fixedPerHour / denominator : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = { wattsIdle: arg('watts-idle', 80), wattsActive: arg('watts-active', 350), kwh: arg('kwh', 0.15), hwPrice: arg('hw-price', 3000), lifeYears: arg('life-years', 3), resale: arg('resale', 0.2), tokPerS: arg('tok-per-s', NaN) };
  if (!Number.isFinite(config.tokPerS) || config.tokPerS <= 0) { console.error('usage: local-cost.mjs --tok-per-s <measured generation speed> [options]'); process.exit(2); }
  const busy = arg('busy', 0.25);
  const entry = lookup(text('compare') ?? '');
  const share = arg('out-share', 0.25);
  // Blended API price per 1M tokens for a mix of `share` output and the rest input.
  const api = entry === null || entry.unit !== 'usd' ? null : entry.input * (1 - share) + entry.output * share;
  const steps = [0.05, 0.25, 0.5, 1].map(b => ({ busy: b, ...localCost(config, b) }));
  const result = { config, busy, atBusy: localCost(config, busy), sensitivity: steps, compare: api === null ? null : { model: entry.id, blendedPerMtok: api, outShare: share, breakEvenBusy: breakEvenBusy(config, api) }, note: 'Estimates from the inputs given; throughput and power are not measured. A local model and a frontier API are different products: compare against a same-capability hosted model.' };

  if (text('format') === 'json') console.log(JSON.stringify(result, null, 2));
  else {
    const out = [`# Local cost estimate`, '', `Fixed: $${result.atBusy.fixedPerHour.toFixed(3)}/h (amortisation + idle power) · marginal: $${result.atBusy.marginalPerHour.toFixed(3)}/h while generating`, '', '| Busy | $ per 1M tokens |', '|---|---|', ...steps.map(s => `| ${s.busy * 100}% | ${s.perMtok === null ? 'n/a' : `$${s.perMtok.toFixed(2)}`} |`)];
    if (result.compare) out.push('', `Against ${result.compare.model} (blended $${api.toFixed(2)}/1M at ${share * 100}% output): ${result.compare.breakEvenBusy === null ? 'local never wins on cost at this throughput' : `local wins above ${(result.compare.breakEvenBusy * 100).toFixed(0)}% busy`}.`);
    out.push('', result.note);
    console.log(out.join('\n'));
  }
}
