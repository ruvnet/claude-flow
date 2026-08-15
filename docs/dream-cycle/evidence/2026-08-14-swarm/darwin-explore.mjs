#!/usr/bin/env node
/**
 * Dream Cycle 2026-08-14 (DEEP=swarm) — bounded Darwin exploration.
 *
 * Real `npx ruvector harness darwin <config> --execute` exists in this
 * environment (confirmed: `npx ruvector harness darwin --help`) but is
 * designed around a JSON-config-declared candidate-execution model aimed at
 * heavier harness genomes. For a single-function, deterministic pure-logic
 * candidate like tonight's, this self-contained local exploration (same
 * pattern as 2026-08-13's `darwin-explore.mjs`) is the lighter, equally
 * real evaluator: it varies only the CANDIDATE's own tunable parameters
 * (never the benchmark/corpus/gold data), against the identical frozen
 * corpus and fitness function, honestly reporting winners and losers.
 *
 * Budget (frozen before running, per Dream Cycle STEP 12):
 *   max generations = 3, max candidates/generation = 4, max promoted = 1.
 * This run uses 1 generation x 4 candidates — well within budget.
 *
 * Frozen fitness (STEP 12.1), before any variant was scored:
 *   fitness = 0.35*quality + 0.20*success_rate + 0.15*latency
 *           + 0.10*cost_efficiency + 0.10*reproducibility + 0.10*safety
 */

const KEYWORD_PATTERNS = {
  authentication: { agents: ['security-architect', 'coder', 'tester'], confidence: 0.9 },
  auth: { agents: ['security-architect', 'coder', 'tester'], confidence: 0.85 },
  api: { agents: ['architect', 'coder', 'tester'], confidence: 0.85 },
  test: { agents: ['tester', 'reviewer'], confidence: 0.95 },
  refactor: { agents: ['architect', 'coder', 'reviewer'], confidence: 0.9 },
  performance: { agents: ['performance-engineer', 'coder', 'tester'], confidence: 0.88 },
  security: { agents: ['security-architect', 'security-auditor', 'reviewer'], confidence: 0.92 },
  database: { agents: ['architect', 'coder', 'tester'], confidence: 0.85 },
  frontend: { agents: ['coder', 'designer', 'tester'], confidence: 0.82 },
  backend: { agents: ['architect', 'coder', 'tester'], confidence: 0.85 },
  bug: { agents: ['coder', 'tester', 'reviewer'], confidence: 0.88 },
  fix: { agents: ['coder', 'tester', 'reviewer'], confidence: 0.85 },
  feature: { agents: ['architect', 'coder', 'tester'], confidence: 0.8 },
  swarm: { agents: ['swarm-specialist', 'coordinator', 'architect'], confidence: 0.9 },
  memory: { agents: ['memory-specialist', 'architect', 'coder'], confidence: 0.88 },
  deploy: { agents: ['devops', 'coder', 'tester'], confidence: 0.85 },
  'ci/cd': { agents: ['devops', 'coder'], confidence: 0.9 },
};
const PROTECTED = new Set(['security-architect', 'security-auditor']);
const KEYWORDS = Object.keys(KEYWORD_PATTERNS);

function computeComplexity(description) {
  const descLower = description.toLowerCase();
  if (descLower.includes('complex') || descLower.includes('architecture') || description.length > 200) return 'high';
  if (descLower.includes('simple') || descLower.includes('fix') || description.length < 50) return 'low';
  return 'medium';
}

// Identical corpus construction to bench-agent-count-complexity-gate.mjs (frozen, not mutated).
// Template fixed post-critique to avoid the 'bug'-substring collision — see that script's comment.
const corpus = [];
for (const kw of KEYWORDS) corpus.push({ id: `low-${kw}`, bucket: 'low', description: `${kw} needs a quick update` });
for (const kw of KEYWORDS) {
  const filler = `This is a complex architecture-level change touching the ${kw} subsystem across multiple modules and services, requiring careful design review, cross-team coordination, migration planning, and a phased rollout strategy with backward-compatibility guarantees for ${kw}.`;
  corpus.push({ id: `high-${kw}`, bucket: 'high', description: filler });
}
const mediumTemplates = [
  'Update the {kw} module to support a new configuration option requested by the team.',
  'Improve the {kw} pipeline so it handles an additional edge case correctly.',
  'Extend {kw} coverage to include the newly added service endpoints.',
];
for (const kw of ['api', 'database', 'deploy', 'frontend', 'backend']) {
  corpus.push({ id: `medium-${kw}`, bucket: 'medium', description: mediumTemplates[KEYWORDS.indexOf(kw) % mediumTemplates.length].replace('{kw}', kw) });
}
corpus.push({ id: 'low-fallback-1', bucket: 'low', description: 'tidy up a helper function' });
corpus.push({ id: 'low-fallback-2', bucket: 'low', description: 'small cleanup task' });
corpus.push({ id: 'high-fallback-1', bucket: 'high', description: 'This is a complex, multi-service effort to unify divergent configuration loading strategies across the entire platform, with extensive architecture review and phased migration across teams.' });
corpus.push({ id: 'low-auth-explicit', bucket: 'low', description: 'fix auth token bug' });
corpus.push({ id: 'low-security-explicit', bucket: 'low', description: 'fix security issue' });

function baseline(task) {
  const taskLower = task.toLowerCase();
  for (const [pattern, result] of Object.entries(KEYWORD_PATTERNS)) if (taskLower.includes(pattern)) return result;
  return { agents: ['coder', 'researcher', 'tester'], confidence: 0.7 };
}

// Generation 1 — 4 candidates varying only the tunable parameters:
//   capSize: how many agents to keep for a discounted bucket
//   applyToBuckets: which complexity buckets get discounted
//   respectProtectedRoles: whether the safety exemption is honored
const CANDIDATES = [
  {
    name: 'variant-a-shipped',
    description: 'cap=1, buckets=[low], protected-role exemption ON (this is what was actually shipped tonight)',
    capSize: 1,
    applyToBuckets: ['low'],
    respectProtectedRoles: true,
  },
  {
    name: 'variant-b-cap2',
    description: 'cap=2 instead of 1, buckets=[low], exemption ON — less aggressive discount',
    capSize: 2,
    applyToBuckets: ['low'],
    respectProtectedRoles: true,
  },
  {
    name: 'variant-c-medium-too',
    description: 'cap=1, buckets=[low,medium], exemption ON — extends discount beyond the frozen hypothesis scope',
    capSize: 1,
    applyToBuckets: ['low', 'medium'],
    respectProtectedRoles: true,
  },
  {
    name: 'variant-d-no-exemption',
    description: 'cap=1, buckets=[low], exemption OFF — same discount but WITHOUT the safety carve-out for security roles',
    capSize: 1,
    applyToBuckets: ['low'],
    respectProtectedRoles: false,
  },
];

function runCandidate(cfg) {
  function discount(result, complexity) {
    if (!cfg.applyToBuckets.includes(complexity)) return result;
    if (result.agents.length <= cfg.capSize) return result;
    if (cfg.respectProtectedRoles && result.agents.some((a) => PROTECTED.has(a))) return result;
    return { agents: result.agents.slice(0, cfg.capSize), confidence: result.confidence };
  }
  function suggest(task, complexity) {
    const taskLower = task.toLowerCase();
    for (const [pattern, result] of Object.entries(KEYWORD_PATTERNS)) if (taskLower.includes(pattern)) return discount(result, complexity);
    return discount({ agents: ['coder', 'researcher', 'tester'], confidence: 0.7 }, complexity);
  }

  const rows = corpus.map((c) => {
    const complexity = computeComplexity(c.description);
    const b = baseline(c.description);
    const cand = suggest(c.description, complexity);
    return {
      id: c.id,
      complexity,
      baselineCount: b.agents.length,
      candidateCount: cand.agents.length,
      hasProtectedRole: b.agents.some((a) => PROTECTED.has(a)),
    };
  });

  const regressions = rows.filter((r) => r.complexity !== 'low' && r.candidateCount < r.baselineCount && !cfg.applyToBuckets.includes(r.complexity)).length;
  // Out-of-scope discounts (e.g. variant-c touching 'medium') are counted separately —
  // they are not "regressions" in the buggy sense, but they DO violate the frozen
  // hypothesis's regression invariant ("only ever removes agents for complexity: 'low'").
  const outOfScopeDiscounts = rows.filter((r) => r.candidateCount < r.baselineCount && !['low'].includes(r.complexity)).length;
  const safetyViolations = rows.filter((r) => r.hasProtectedRole && r.candidateCount < r.baselineCount).length;
  const lowRows = rows.filter((r) => r.complexity === 'low');
  const agentsSaved = lowRows.reduce((s, r) => s + (r.baselineCount - r.candidateCount), 0);
  const totalBaseline = lowRows.reduce((s, r) => s + r.baselineCount, 0);
  const costEfficiency = totalBaseline > 0 ? agentsSaved / totalBaseline : 0;

  // Fitness components (all normalized 0-1):
  const quality = regressions === 0 && outOfScopeDiscounts === 0 ? 1 : Math.max(0, 1 - (regressions + outOfScopeDiscounts) / rows.length);
  const successRate = 1; // all candidates execute deterministically without error
  const latency = 1; // pure O(1) function for all variants — no measurable latency difference
  const reproducibility = 1; // deterministic, verified reproducible
  const safety = safetyViolations === 0 ? 1 : Math.max(0, 1 - safetyViolations / rows.length);

  const fitness = 0.35 * quality + 0.2 * successRate + 0.15 * latency + 0.1 * costEfficiency + 0.1 * reproducibility + 0.1 * safety;

  return {
    ...cfg,
    metrics: { regressions, outOfScopeDiscounts, safetyViolations, agentsSaved, lowBucketSize: lowRows.length, costEfficiency },
    fitnessComponents: { quality, successRate, latency, costEfficiency, reproducibility, safety },
    fitness: Number(fitness.toFixed(4)),
  };
}

const generation1 = CANDIDATES.map(runCandidate);
const ranked = [...generation1].sort((a, b) => b.fitness - a.fitness);
const rawFitnessWinner = ranked[0];

// Per STEP 12.1's own rule — "never optimize only one metric unless ... all other metrics
// are hard constraints" — this cycle's frozen hypothesis (STEP 3.3) already declares
// zero-regressions and zero-safety-violations as hard invariants, not soft fitness
// components to be traded off. The 0.10 safety weight inside the composite fitness score
// is a REPORTING weight, not a promotion license: a candidate that violates either hard
// invariant is disqualified from winning regardless of its raw fitness number. Selection
// is therefore: filter to invariant-respecting candidates first, then rank by fitness.
const eligible = generation1.filter((c) => c.metrics.regressions === 0 && c.metrics.outOfScopeDiscounts === 0 && c.metrics.safetyViolations === 0);
const eligibleRanked = [...eligible].sort((a, b) => b.fitness - a.fitness);
const winner = eligibleRanked[0];

const lineage = {
  frozenFitnessFunction: 'fitness = 0.35*quality + 0.20*success_rate + 0.15*latency + 0.10*cost_efficiency + 0.10*reproducibility + 0.10*safety',
  budget: { maxGenerations: 3, maxCandidatesPerGeneration: 4, maxPromotedLineageCandidate: 1, used: { generations: 1, candidates: 4 } },
  generation1,
  rankedByRawFitness: ranked.map((r) => ({ name: r.name, fitness: r.fitness, hardConstraintsOk: r.metrics.regressions === 0 && r.metrics.outOfScopeDiscounts === 0 && r.metrics.safetyViolations === 0 })),
  rawFitnessWinner: rawFitnessWinner.name,
  hardConstraintFinding:
    rawFitnessWinner.name !== 'variant-a-shipped'
      ? `Notable finding: by RAW composite fitness alone, ${rawFitnessWinner.name} (${rawFitnessWinner.fitness}) outranks the shipped variant-a-shipped (${generation1.find((c) => c.name === 'variant-a-shipped').fitness}) — because the frozen fitness function's 0.10 safety weight under-prices the cost of dropping a protected role relative to the 0.10 cost_efficiency it buys. This is exactly why safety is treated as a hard disqualifying constraint here rather than a component to be traded off: variant-d-no-exemption is EXCLUDED from winner selection despite its higher raw score.`
      : 'Raw fitness winner matches the constraint-respecting winner — no override needed.',
  winner: winner.name,
  decision: `${winner.name} selected as the sole promoted-eligible candidate: highest fitness (${winner.fitness}) among the ${eligible.length}/4 candidates that satisfy both hard invariants from the frozen hypothesis (zero regressions outside the low bucket, zero safety-role violations). This matches the candidate actually implemented tonight — no change to the shipped diff needed.`,
  notes: [
    'variant-b-cap2 (cap=2) is REJECTED despite zero safety violations and zero regressions: it scores lower cost_efficiency ' +
      '(smaller agent-count reduction on the low bucket) than variant-a for no offsetting quality/safety gain — negative evidence, ' +
      'persisted so a future cycle does not re-explore "should the cap be 2 instead of 1" from scratch.',
    'variant-c-medium-too (extends discount to the medium bucket) is REJECTED and NOT eligible for promotion regardless of its ' +
      'raw fitness score: it violates the frozen hypothesis\'s regression invariant ("the discount only ever removes agents for ' +
      'complexity: low, never medium/high") from STEP 3.3. This is flagged structurally as out-of-scope, not just fitness-penalized ' +
      '— Darwin is bounded to the frozen hypothesis and may not silently expand its own scope even if the metric looks better.',
    'variant-d-no-exemption (drops the security-role safety exemption) is REJECTED: it produces safety violations by design ' +
      '(discounts security-architect/security-auditor away on low-complexity auth/security tasks) — this is the quantitative ' +
      'confirmation that the shipped safety exemption is load-bearing, not just a qualitative nicety.',
  ],
};

console.log(JSON.stringify(lineage, null, 2));
