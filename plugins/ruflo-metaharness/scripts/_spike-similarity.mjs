#!/usr/bin/env node
// _spike-similarity.mjs — ADR-152 §"Smallest demonstrable spike" gate.
//
// This file is the implementation gate for ADR-152 (Genome Similarity Search).
// Per ADR-151's scope-only constraint, ADR-152 cannot graduate to "Accepted"
// until the two invariants below are proven by running this script.
//
// THE TWO INVARIANTS (from ADR-152 §"Smallest demonstrable spike")
//   1. similarity(X, X) === 1                        (self-match exact)
//   2. similarity(legal, devops) < similarity(legal, support)
//                                                    (vertical-affinity correct)
//
// USAGE
//   node scripts/_spike-similarity.mjs               (run + assert)
//   node scripts/_spike-similarity.mjs --format json (CI-consumable)
//
// EXIT CODES
//   0  both invariants hold
//   1  at least one invariant fails (ADR-152 cannot graduate)
//
// LIFECYCLE
// Once ADR-152 is Accepted, the full similarity implementation lands in
// `_similarity.mjs` (production module). This file (`_spike-similarity.mjs`)
// remains as the regression-suite anchor for the two invariants.

const ARGS = (() => {
  const a = { format: 'table' };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--format') a.format = process.argv[++i];
  }
  return a;
})();

// ──────────────────────────────────────────────────────────────────────
// THE PROPOSED IMPLEMENTATION (ADR-152 §"Decision")
//
// Pure-TS. Takes two {genome, score} JSON shapes; emits {overall,
// components: {cosine, categorical, jaccard}}. The 9 numerical features +
// 4 categorical fields + 1 set field per ADR-152.
// ──────────────────────────────────────────────────────────────────────

function projectToVec(input) {
  const s = input.score || {};
  const g = input.genome || {};
  return [
    (s.harnessFit ?? 0) / 100,
    (s.compileConfidence ?? 0) / 100,
    (s.taskCoverage ?? 0) / 100,
    (s.toolSafety ?? 0) / 100,
    (s.memoryUsefulness ?? 0) / 100,
    g.risk_score ?? 0,
    g.test_confidence ?? 0,
    g.publish_readiness ?? 0,
    // estCostPerRunUsd: log10 transform, clamped to [0, 1]
    Math.max(0, Math.min(1, Math.log10((s.estCostPerRunUsd ?? 0) + 0.001) / Math.log10(10))),
  ];
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  // Map cosine from [-1, 1] to [0, 1] for nonnegative vectors it's [0, 1] already
  return Math.max(0, Math.min(1, dot / denom));
}

function categoricalAgreement(a, b) {
  const fields = ['repo_type', 'archetype', 'template', 'recommendedMode'];
  let matches = 0;
  for (const f of fields) {
    const av = a.genome?.[f] ?? a.score?.[f];
    const bv = b.genome?.[f] ?? b.score?.[f];
    if (av && bv && av === bv) matches++;
  }
  return matches / fields.length;
}

function jaccard(a, b) {
  const A = new Set(a.genome?.agent_topology ?? []);
  const B = new Set(b.genome?.agent_topology ?? []);
  if (A.size === 0 && B.size === 0) return 1;
  const intersection = [...A].filter((x) => B.has(x)).length;
  const union = new Set([...A, ...B]).size;
  return union === 0 ? 0 : intersection / union;
}

function similarity(a, b) {
  const cos = cosine(projectToVec(a), projectToVec(b));
  const cat = categoricalAgreement(a, b);
  const jac = jaccard(a, b);
  const overall = 0.6 * cos + 0.25 * cat + 0.15 * jac;
  return {
    overall: Math.round(overall * 10000) / 10000,
    components: {
      cosine: Math.round(cos * 10000) / 10000,
      categorical: Math.round(cat * 10000) / 10000,
      jaccard: Math.round(jac * 10000) / 10000,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────
// THREE SYNTHETIC FIXTURES designed to exercise the invariants. These
// mirror the JSON shapes `harness genome` + `harness score` emit (verified
// against metaharness@0.1.14 via iter-26 test-with-openrouter.mjs).
// ──────────────────────────────────────────────────────────────────────

const LEGAL = {
  score: {
    harnessFit: 78, compileConfidence: 92, taskCoverage: 65,
    toolSafety: 88, memoryUsefulness: 70, estCostPerRunUsd: 0.04,
    recommendedMode: 'CLI + MCP', archetype: 'compliance-harness',
    template: 'vertical:legal', scaffoldReady: true,
  },
  genome: {
    repo_type: 'node_mcp_ci',
    agent_topology: ['contract-analyst', 'redline-reviewer', 'risk-rater', 'compliance-officer'],
    risk_score: 0.45,
    mcp_surface: 'remote',
    test_confidence: 0.7,
    publish_readiness: 0.6,
  },
};

const SUPPORT = {
  score: {
    harnessFit: 75, compileConfidence: 90, taskCoverage: 70,
    toolSafety: 90, memoryUsefulness: 72, estCostPerRunUsd: 0.05,
    recommendedMode: 'CLI + MCP', archetype: 'compliance-harness',
    template: 'vertical:support', scaffoldReady: true,
  },
  genome: {
    repo_type: 'node_mcp_ci',
    agent_topology: ['triager', 'kb-searcher', 'responder', 'risk-rater', 'compliance-officer'],
    risk_score: 0.40,
    mcp_surface: 'remote',
    test_confidence: 0.75,
    publish_readiness: 0.65,
  },
};

const DEVOPS = {
  score: {
    harnessFit: 88, compileConfidence: 95, taskCoverage: 85,
    toolSafety: 70, memoryUsefulness: 55, estCostPerRunUsd: 0.08,
    recommendedMode: 'CLI', archetype: 'cli-operator-harness',
    template: 'vertical:devops', scaffoldReady: true,
  },
  genome: {
    repo_type: 'python_ops',
    agent_topology: ['incident-commander', 'deployer', 'rollback', 'oncall-pager'],
    risk_score: 0.25,
    mcp_surface: 'local',
    test_confidence: 0.85,
    publish_readiness: 0.9,
  },
};

// ──────────────────────────────────────────────────────────────────────
// INVARIANT VERIFICATION (the gate)
// ──────────────────────────────────────────────────────────────────────

const self = similarity(LEGAL, LEGAL);
const legalVsSupport = similarity(LEGAL, SUPPORT);
const legalVsDevops = similarity(LEGAL, DEVOPS);

const inv1Pass = self.overall === 1;
const inv2Pass = legalVsDevops.overall < legalVsSupport.overall;

const payload = {
  adr: 'ADR-152',
  spike: '_spike-similarity.mjs',
  invariants: {
    selfMatch: { pass: inv1Pass, value: self.overall, expected: 1 },
    verticalAffinity: {
      pass: inv2Pass,
      legalVsDevops: legalVsDevops.overall,
      legalVsSupport: legalVsSupport.overall,
      reason: inv2Pass
        ? `legal:devops (${legalVsDevops.overall}) < legal:support (${legalVsSupport.overall}) — vertical affinity correct`
        : `INVARIANT VIOLATED: legal:devops (${legalVsDevops.overall}) ≥ legal:support (${legalVsSupport.overall})`,
    },
  },
  detail: {
    'similarity(LEGAL, LEGAL)': self,
    'similarity(LEGAL, SUPPORT)': legalVsSupport,
    'similarity(LEGAL, DEVOPS)': legalVsDevops,
  },
  graduates: inv1Pass && inv2Pass,
  generatedAt: new Date().toISOString(),
};

if (ARGS.format === 'json') {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`# ADR-152 §Spike — Genome Similarity Search\n`);
  console.log(`Invariant 1 — selfMatch:`);
  console.log(`  similarity(LEGAL, LEGAL).overall = ${self.overall}`);
  console.log(`  expected: 1`);
  console.log(`  ${inv1Pass ? '✓ PASS' : '✗ FAIL'}`);
  console.log('');
  console.log(`Invariant 2 — verticalAffinity (legal closer to support than to devops):`);
  console.log(`  similarity(LEGAL, SUPPORT).overall = ${legalVsSupport.overall}`);
  console.log(`  similarity(LEGAL, DEVOPS).overall  = ${legalVsDevops.overall}`);
  console.log(`  ${inv2Pass ? '✓ PASS' : '✗ FAIL'} — ${payload.invariants.verticalAffinity.reason}`);
  console.log('');
  console.log(`Per-component breakdown:`);
  console.log(`  LEGAL vs SUPPORT — cosine=${legalVsSupport.components.cosine}  categorical=${legalVsSupport.components.categorical}  jaccard=${legalVsSupport.components.jaccard}`);
  console.log(`  LEGAL vs DEVOPS  — cosine=${legalVsDevops.components.cosine}  categorical=${legalVsDevops.components.categorical}  jaccard=${legalVsDevops.components.jaccard}`);
  console.log('');
  if (payload.graduates) {
    console.log(`✓ Both invariants hold. ADR-152 may graduate Proposed → Accepted.`);
  } else {
    console.log(`✗ Invariant violation. ADR-152 stays Proposed.`);
  }
}

if (!payload.graduates) process.exit(1);
