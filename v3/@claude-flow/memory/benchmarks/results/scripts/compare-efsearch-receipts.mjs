#!/usr/bin/env node
/**
 * Dream Cycle 2026-08-15 — compares receipt-baseline.json vs
 * receipt-candidate.json for the HNSWIndex efSearch-default candidate.
 *
 * Paired t-test on per-query latency (same seeded queries, same query
 * index, so pairing is exact). Recall is reported as a straight aggregate
 * delta (recall@10 is already a ratio over 60*10 boolean hits per N, a
 * paired test on a 0/1-per-neighbor series adds no real information here).
 *
 * Frozen invariant (see hypothesis in the dream-cycle gist): recall@10 for
 * the implicit-default path must not drop below 0.90 at any measured N.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.resolve(__dirname, '..');

const baseline = JSON.parse(readFileSync(path.join(RESULTS_DIR, 'receipt-baseline.json'), 'utf8'));
const candidate = JSON.parse(readFileSync(path.join(RESULTS_DIR, 'receipt-candidate.json'), 'utf8'));

const RECALL_FLOOR = 0.90;

function pairedT(a, b) {
  const n = Math.min(a.length, b.length);
  const diffs = [];
  for (let i = 0; i < n; i++) diffs.push(b[i] - a[i]);
  const mean = diffs.reduce((s, x) => s + x, 0) / n;
  const variance = diffs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);
  const t = se > 0 ? mean / se : null;
  return { n, meanDiffMs: mean, t };
}

const out = { recallFloor: RECALL_FLOOR, byN: {}, invariantHolds: true };

for (const N of Object.keys(baseline.byN)) {
  const b = baseline.byN[N].implicitDefault;
  const c = candidate.byN[N].implicitDefault;
  const t = pairedT(b.perQueryMs, c.perQueryMs);
  const recallDeltaPp = Math.round((c.recallAt10 - b.recallAt10) * 10000) / 100;
  const latencyPct = Math.round(((c.msPerQuery - b.msPerQuery) / b.msPerQuery) * 10000) / 100;
  const floorBreached = c.recallAt10 < RECALL_FLOOR;
  if (floorBreached) out.invariantHolds = false;

  out.byN[N] = {
    baselineMsPerQuery: b.msPerQuery,
    candidateMsPerQuery: c.msPerQuery,
    latencyDeltaPct: latencyPct,
    baselineRecallAt10: b.recallAt10,
    candidateRecallAt10: c.recallAt10,
    recallDeltaPp,
    recallFloorBreached: floorBreached,
    pairedT: { n: t.n, meanDiffMs: Math.round(t.meanDiffMs * 100000) / 100000, tStatistic: t.t == null ? null : Math.round(t.t * 100) / 100 },
  };

  console.log(
    `N=${N}: latency ${b.msPerQuery}ms -> ${c.msPerQuery}ms (${latencyPct}%, paired t=${out.byN[N].pairedT.tStatistic}, n=${t.n}) | ` +
    `recall@10 ${b.recallAt10} -> ${c.recallAt10} (${recallDeltaPp}pp) | floor ${RECALL_FLOOR}: ${floorBreached ? 'BREACHED' : 'held'}`
  );
}

console.log(`\nVerdict input: recall@10 >= ${RECALL_FLOOR} invariant ${out.invariantHolds ? 'HOLDS at all measured N' : 'BREACHED at one or more N'}.`);

import { writeFileSync } from 'node:fs';
writeFileSync(path.join(RESULTS_DIR, 'comparison-efsearch-final.json'), JSON.stringify(out, null, 2));
console.log(`Wrote ${path.join(RESULTS_DIR, 'comparison-efsearch-final.json')}`);
