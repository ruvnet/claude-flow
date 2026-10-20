// _pricebook.mjs — data-driven pricing for every provider the ledger reads.
//
// Rates live in data/prices.json (dated, sourced, editable; COST_PRICES points
// at another copy). Nothing here hard-codes a rate. Two rules the old
// _prices.mjs broke:
//   * a model with no entry is reported UNPRICED, never silently $0;
//   * a family fallback (e.g. "sonnet") is marked `approx` so it is never
//     presented as an exact figure.
// Prices are list-price estimates, not bills.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
let book = null;

export function loadBook(path = process.env.COST_PRICES || join(HERE, '..', 'data', 'prices.json')) {
  if (book && !process.env.COST_PRICES) return book;
  book = JSON.parse(readFileSync(path, 'utf-8'));
  return book;
}

/** The most specific entry whose `match` substring is in the model id, or null. */
export function lookup(model, provider) {
  if (!model) return null;
  const id = String(model).toLowerCase();
  let best = null;
  for (const entry of loadBook().models) {
    if (provider && entry.provider !== provider) continue;
    if (entry.re ? !new RegExp(entry.re).test(id) : !id.includes(entry.match) && id !== entry.id) continue;
    if (best === null || entry.match.length > best.match.length) best = entry;
  }
  return best;
}

const per = (tokens, rate) => ((tokens || 0) / 1e6) * (rate || 0);

/**
 * Price one usage record.
 * usage: { input, cache_read, cache_write_5m, cache_write_1h, output }
 *   `input` is UNCACHED input only; cache reads/writes are separate buckets
 *   (the readers normalise both providers to this shape).
 * Returns { cost, unit, priced, approx, notes[], entry }.
 */
export function priceUsage(model, usage, provider) {
  const entry = lookup(model, provider);
  if (entry === null) return { cost: 0, unit: 'usd', priced: false, approx: false, notes: [`no price for "${model}"`], entry: null };
  const notes = [];
  // A rate the provider does not publish falls back to the input rate (an upper bound) and says so.
  const read = entry.cache_read ?? (notes.push('cache-read rate unpublished: billed at input rate (upper bound)'), entry.input);
  const w5 = entry.cache_write_5m ?? entry.input;
  const w1 = entry.cache_write_1h ?? w5;
  const cost = per(usage.input, entry.input) + per(usage.output, entry.output) + per(usage.cache_read, read)
    + per(usage.cache_write_5m, w5) + per(usage.cache_write_1h, w1);
  if (entry.approx) notes.push(`approximate price (${entry.id}): family fallback or list price`);

  return { cost, unit: entry.unit, priced: true, approx: entry.approx === true, notes, entry };
}

/** What the same tokens would cost on another model id (for what-if savings). */
export const reprice = (model, usage, provider) => priceUsage(model, usage, provider);

/** The next cheaper model for this provider, or null. */
export function downshift(model, provider) {
  const entry = lookup(model, provider)
  const map = loadBook().tiers?.[provider]?.downshift ?? {};

  return entry === null ? null : map[entry.id] ?? null;
}

export const bookDate = () => loadBook().asOf;
