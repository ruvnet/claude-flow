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
//   cosine(a, b)                   → [0,1]
//   categoricalAgreement(a, b)     → [0,1] over 4 enum fields
//   jaccard(a, b)                  → [0,1] over agent_topology[]
//   similarity(a, b, opts?)        → { overall, components, perDimension? }
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
    Math.max(0, Math.min(1, Math.log10((s.estCostPerRunUsd ?? 0) + 0.001) / Math.log10(10))),
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
