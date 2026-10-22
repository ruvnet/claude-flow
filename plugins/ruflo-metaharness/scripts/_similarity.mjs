// _similarity.mjs — ADR-152 production similarity module.
//
// Graduated from `_spike-similarity.mjs` (iter 35) after both invariants
// passed on the LEGAL/SUPPORT/DEVOPS fixtures. The spike file STAYS as
// the regression-suite anchor; this file is what production callers
// (`similarity.mjs` skill, `metaharness_similarity` MCP tool) import.
//
// ADR-150 ARCHITECTURAL CONSTRAINTS PRESERVED
//   Removable ✓  pure-TS — no `@metaharness/*` import path
//   Optional  ✓  no new dep on `@metaharness/*`
//   Graceful  ✓  malformed input → low-confidence output, never throws
//   CI-gate   ✓  standalone unit-importable; no `npx` needed
//
// CONTRACT (PUBLIC)
//   projectToVec(input)            → 9-dim numerical feature vector
//   normalizeCost(usd)             → [0,1] log-band normalization (vector index 8)
//   cosine(a, b)                   → [0,1]
//   categoricalAgreement(a, b)     → [0,1] over 4 enum fields
//   jaccard(a, b)                  → [0,1] over agent_topology[]
//   verdictFor(overall)            → 'near-identical' | 'minor-drift' | 'moderate-drift' | 'major-drift'
//   VERDICT_THRESHOLDS             → the bands verdictFor() walks, highest first
//   similarity(a, b, opts?)        → { overall, verdict, components, perDimension? }
//
// WEIGHT DEFAULTS (from ADR-152 §Decision)
//   overall = 0.60·cosine + 0.25·categorical + 0.15·jaccard
//
// ADR-152 reserves a future per-org weight override; for §3.1 the defaults
// are global. The opts.weights hook is here so consumers can experiment
// without forking the module — it is NOT a stable public API.

const DEFAULT_WEIGHTS = Object.freeze({ cosine: 0.6, categorical: 0.25, jaccard: 0.15 });

const CATEGORICAL_FIELDS = Object.freeze(['repo_type', 'archetype', 'template', 'recommendedMode']);

// ─────────────────────────────────────────────────────────────────────
// Cost normalization — vector index 8.
//
// ADR-152 Table 1 specified `log10(usd + 0.001) / log10(10)` clamped to
// [0,1]. `Math.log10(10)` is 1, so the division was a no-op, and the raw
// log is negative for every cost below $0.999 — the outer clamp then
// flattened that whole range to 0. Every realistic per-run cost collapsed
// to the same value, so the documented 9-dim vector was effectively
// 8-dim and `estCostPerRunUsd` could not influence any score.
//
// The replacement is a real log band: costs at or below `min` map to 0,
// at or above `max` map to 1, log-interpolated in between. It is
// monotonic and live across the whole realistic range ($0.001–$10), and
// non-finite or missing input degrades to the band floor rather than NaN.
// ─────────────────────────────────────────────────────────────────────

export const COST_BAND_USD = Object.freeze({ min: 0.001, max: 10 });

export function normalizeCost(usd) {
  const lo = Math.log10(COST_BAND_USD.min);
  const hi = Math.log10(COST_BAND_USD.max);
  const finite = typeof usd === 'number' && Number.isFinite(usd) ? usd : COST_BAND_USD.min;
  const clamped = Math.min(COST_BAND_USD.max, Math.max(COST_BAND_USD.min, finite));
  return (Math.log10(clamped) - lo) / (hi - lo);
}

// ─────────────────────────────────────────────────────────────────────
// Verdict bands — single source of truth.
//
// These bands previously lived inline in `audit-trend.mjs` with a
// `minor-drift` floor of 0.80, while `docs/metaharness-user-guide.md`
// documented 0.85 for the same band. Two encodings of one policy, and
// they disagreed. Consumers now import this table instead of re-encoding
// the bands, so the primitive and its documentation cannot drift apart.
//
// Ordered highest-first; `verdictFor` returns the first band whose `min`
// the score reaches.
// ─────────────────────────────────────────────────────────────────────

export const VERDICT_THRESHOLDS = Object.freeze([
  Object.freeze({ min: 0.95, verdict: 'near-identical' }),
  Object.freeze({ min: 0.85, verdict: 'minor-drift' }),
  Object.freeze({ min: 0.5, verdict: 'moderate-drift' }),
  Object.freeze({ min: Number.NEGATIVE_INFINITY, verdict: 'major-drift' }),
]);

export function verdictFor(overall) {
  for (const band of VERDICT_THRESHOLDS) {
    if (overall >= band.min) return band.verdict;
  }
  return 'major-drift';
}

// ─────────────────────────────────────────────────────────────────────
// 9-dim feature vector. The mapping mirrors ADR-152 §Decision Table 1.
// Missing fields default to 0 — that's the graceful-degradation path.
// ─────────────────────────────────────────────────────────────────────

export function projectToVec(input) {
  const s = input?.score ?? {};
  const g = input?.genome ?? {};
  return [
    (s.harnessFit ?? 0) / 100,
    (s.compileConfidence ?? 0) / 100,
    (s.taskCoverage ?? 0) / 100,
    (s.toolSafety ?? 0) / 100,
    (s.memoryUsefulness ?? 0) / 100,
    g.risk_score ?? 0,
    g.test_confidence ?? 0,
    g.publish_readiness ?? 0,
    normalizeCost(s.estCostPerRunUsd),
  ];
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return Math.max(0, Math.min(1, dot / denom));
}

export function categoricalAgreement(a, b) {
  let matches = 0;
  for (const f of CATEGORICAL_FIELDS) {
    const av = a?.genome?.[f] ?? a?.score?.[f];
    const bv = b?.genome?.[f] ?? b?.score?.[f];
    if (av && bv && av === bv) matches++;
  }
  return matches / CATEGORICAL_FIELDS.length;
}

export function jaccard(a, b) {
  const A = new Set(a?.genome?.agent_topology ?? []);
  const B = new Set(b?.genome?.agent_topology ?? []);
  if (A.size === 0 && B.size === 0) return 1;
  const intersection = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : intersection / union;
}

// ─────────────────────────────────────────────────────────────────────
// Composite similarity with optional per-dimension breakdown.
// Returns the ADR-152 §"return shape": overall + components + per-dim.
// ─────────────────────────────────────────────────────────────────────

export function similarity(a, b, opts = {}) {
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const va = projectToVec(a);
  const vb = projectToVec(b);
  const cos = cosine(va, vb);
  const cat = categoricalAgreement(a, b);
  const jac = jaccard(a, b);

  const overall = weights.cosine * cos + weights.categorical * cat + weights.jaccard * jac;

  const result = {
    overall: round4(overall),
    // The verdict is derived here, next to the score it classifies, so
    // every consumer (similarity.mjs, audit-trend.mjs) reports the same
    // band for the same number.
    verdict: verdictFor(round4(overall)),
    components: {
      cosine: round4(cos),
      categorical: round4(cat),
      jaccard: round4(jac),
    },
    weights,
  };

  if (opts.perDimension) {
    result.perDimension = perDimensionBreakdown(a, b, va, vb, weights);
  }
  return result;
}

function round4(x) {
  return Math.round(x * 10000) / 10000;
}

function perDimensionBreakdown(a, b, va, vb, weights) {
  // Per-dimension contribution = squared-error-normalized cosine slice + categorical/jaccard direct.
  // We surface raw a/b values + a contribution sign so callers can explain
  // why two harnesses scored as they did (used by Recommendation Engine
  // §3.2 confidence calc + Drift Detection §3.3 alert reason).
  const out = {};

  const numericKeys = [
    ['harnessFit', 'score', 100], ['compileConfidence', 'score', 100],
    ['taskCoverage', 'score', 100], ['toolSafety', 'score', 100],
    ['memoryUsefulness', 'score', 100],
    ['risk_score', 'genome', 1], ['test_confidence', 'genome', 1],
    ['publish_readiness', 'genome', 1],
    ['estCostPerRunUsd', 'score', 1],
  ];
  for (let i = 0; i < numericKeys.length; i++) {
    const [k, src] = numericKeys[i];
    const av = a?.[src]?.[k];
    const bv = b?.[src]?.[k];
    out[`numeric.${k}`] = {
      a: av ?? null, b: bv ?? null,
      contribution: round4(va[i] * vb[i] * weights.cosine / 9),
    };
  }
  for (const f of CATEGORICAL_FIELDS) {
    const av = a?.genome?.[f] ?? a?.score?.[f];
    const bv = b?.genome?.[f] ?? b?.score?.[f];
    out[`categorical.${f}`] = {
      a: av ?? null, b: bv ?? null,
      contribution: av && bv && av === bv ? round4(weights.categorical / 4) : 0,
    };
  }
  const A = new Set(a?.genome?.agent_topology ?? []);
  const B = new Set(b?.genome?.agent_topology ?? []);
  const overlap = [...A].filter((x) => B.has(x));
  const union = new Set([...A, ...B]);
  out['set.agent_topology'] = {
    a: [...A], b: [...B],
    contribution: union.size === 0 ? 0 : round4((overlap.length / union.size) * weights.jaccard),
  };
  return out;
}
