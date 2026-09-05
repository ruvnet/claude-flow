// Generate the bundled seed corpus for ADR-148. ~50 templated DRACO rows,
// each with a hand-labelled `scores` map reflecting which Claude tier is
// best on that query type. Embeddings use a deterministic synthetic
// projection (same FNV-1a-keyed RNG as scripts/benchmark-router.mjs) so the
// corpus is reproducible from this script.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DIM = 32;  // matches bench default; reasonable starter before we wire real ONNX 384-dim

const CHEAP_TEMPLATES = [
  ['rename {x} to {y}', 'cheap'],
  ['add a console.log to {x}', 'cheap'],
  ['fix typo in {x}', 'cheap'],
  ['remove unused import {x}', 'cheap'],
  ['add return type annotation to {x}', 'cheap'],
  ['format {x} as kebab-case', 'cheap'],
  ['increment counter in {x}', 'cheap'],
  ['add try/catch around {x}', 'cheap'],
  ['change var to const in {x}', 'cheap'],
  ['delete unused export {x}', 'cheap'],
];
const MID_TEMPLATES = [
  ['implement a debounce helper for {x}', 'mid'],
  ['add unit tests for {x}', 'mid'],
  ['extract a hook from {x}', 'mid'],
  ['refactor {x} to use async/await', 'mid'],
  ['add input validation to {x}', 'mid'],
  ['migrate {x} from callbacks to promises', 'mid'],
  ['add a logging layer to {x}', 'mid'],
  ['parameterize {x} with options object', 'mid'],
  ['add a config schema for {x}', 'mid'],
  ['write integration tests covering {x}', 'mid'],
];
const STRONG_TEMPLATES = [
  ['design a distributed consensus protocol with byzantine fault tolerance for {x}', 'strong'],
  ['audit the {x} authentication flow for OWASP top-10 vulnerabilities', 'strong'],
  ['architect a multi-tenant database schema with row-level security for {x}', 'strong'],
  ['analyze why {x} has a memory leak under load — produce hypothesis with evidence', 'strong'],
  ['refactor {x} to the strategy pattern and migrate all callers safely', 'strong'],
  ['write a threat model for {x} including STRIDE categorization and mitigations', 'strong'],
  ['compare CRDT-based and OT-based collaborative editing for {x} with citations', 'strong'],
  ['design a backwards-compatible API deprecation path for {x}', 'strong'],
  ['plan a zero-downtime migration of {x} from postgres to a sharded backend', 'strong'],
  ['reason about consistency guarantees of {x} under partition and recovery', 'strong'],
  ['debug a nondeterministic race condition in {x} across distributed workers', 'strong'],
  ['design an event-sourced architecture for {x} with snapshots and replay', 'strong'],
];
const NOUNS = ['cache','session','token','user','order','queue','router','schema','span','tenant','worker','feature-flag','rate-limiter','health-check','rpc-client','migration','dashboard','webhook','indexer','pipeline'];

let _s = 1234567;
const rng = () => { _s = (_s * 16807) % 2147483647; return _s / 2147483647; };

function fnv1a(s) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0; }
  return h >>> 0;
}
function embed(task, tier) {
  let h = fnv1a(task) | 1;
  const next = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; h = h >>> 0; return ((h % 2_000_001) / 1_000_000) - 1; };
  const v = new Array(DIM);
  for (let i = 0; i < DIM; i++) v[i] = next() * 0.5;
  // Two signal channels — tier-monotonic so KRR/k-NN/FastGRNN can separate.
  v[0] = tier === 'cheap' ? 0.85 : tier === 'mid' ? 0.0 : -0.85;
  v[1] = tier === 'strong' ? 0.7 : 0.0;
  return v;
}

// Per-tier ground-truth quality on each Claude model — these are the design
// assumptions, not measurements. Documented in ADR-148 and in this file's
// header so callers know what the seed represents.
const SCORES_BY_TIER = {
  cheap:  { haiku: 0.94, sonnet: 0.92, opus: 0.93 },  // any model is fine; cheapest wins
  mid:    { haiku: 0.65, sonnet: 0.91, opus: 0.92 },  // haiku misses; sonnet/opus tie
  strong: { haiku: 0.30, sonnet: 0.65, opus: 0.92 },  // only opus clears
};

function buildCorpus() {
  const rows = [];
  for (const [template, tier] of [...CHEAP_TEMPLATES, ...MID_TEMPLATES, ...STRONG_TEMPLATES]) {
    // 2 examples per template = ~64 rows
    for (let i = 0; i < 2; i++) {
      const x = NOUNS[Math.floor(rng() * NOUNS.length)];
      const y = NOUNS[Math.floor(rng() * NOUNS.length)];
      const task = template.replaceAll('{x}', x).replaceAll('{y}', y);
      rows.push({
        embedding: embed(task, tier),
        scores: SCORES_BY_TIER[tier],
        // Provenance — not consumed by the router; here so future regen knows where each row came from.
        _meta: { tier, template, task },
      });
    }
  }
  return rows;
}

const rows = buildCorpus();

// Strip _meta for the bundled artifact (keep it small + clean for the loader)
const bundled = rows.map(r => ({ embedding: r.embedding, scores: r.scores }));

const outPath = process.argv[2] ?? resolve('v3/@claude-flow/cli/assets/model-router/seed-rows.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(bundled, null, 0));
console.log(`wrote ${rows.length} rows (${bundled.length} bundled) to ${outPath}`);
console.log(`tier distribution: cheap=${rows.filter(r => r._meta.tier==='cheap').length}, mid=${rows.filter(r => r._meta.tier==='mid').length}, strong=${rows.filter(r => r._meta.tier==='strong').length}`);

// Also write a provenance sidecar for repo-readers
const provPath = outPath.replace(/\.json$/, '.provenance.json');
writeFileSync(provPath, JSON.stringify({
  generated_by: 'scripts/gen-seed-corpus.mjs',
  generated_at: '2026-06-15',
  dim: DIM,
  rows: rows.length,
  tier_distribution: {
    cheap:  rows.filter(r => r._meta.tier==='cheap').length,
    mid:    rows.filter(r => r._meta.tier==='mid').length,
    strong: rows.filter(r => r._meta.tier==='strong').length,
  },
  scores_by_tier: SCORES_BY_TIER,
  templates: { cheap: CHEAP_TEMPLATES.map(t=>t[0]), mid: MID_TEMPLATES.map(t=>t[0]), strong: STRONG_TEMPLATES.map(t=>t[0]) },
  caveat: 'Synthetic deterministic corpus with hand-set scores per ADR-148. To be replaced by real DRACO trajectories once CLAUDE_FLOW_ROUTER_TRAJECTORY=1 collection runs in production.',
}, null, 2));
console.log(`wrote provenance: ${provPath}`);
