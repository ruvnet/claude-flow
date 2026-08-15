#!/usr/bin/env node
/**
 * Dream Cycle 2026-08-14 (DEEP=swarm) — self-contained, git-reproducible benchmark.
 *
 * Evaluates the candidate change to `suggestAgentsForTask` /
 * `hooksPreTask` in v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:
 * the `complexity` bucket hooksPreTask already computes was previously dead
 * for agent-count purposes (every KEYWORD_PATTERNS entry and the fallback
 * path returned 2-3 agents regardless of task size). The candidate scales
 * the recommended agent count down to 1 for low-complexity tasks, exempting
 * any match that includes a safety-relevant role (security-architect,
 * security-auditor).
 *
 * The full v3 TypeScript workspace does not build in this checkout
 * (`node bin/cli.js metaharness ...` -> ERR_MODULE_NOT_FOUND, dist/ absent),
 * so this script extracts BOTH the literal pre-candidate baseline (verbatim
 * from `git show HEAD:v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts`,
 * confirmed byte-for-byte before the candidate patch was applied) and the
 * candidate logic (verbatim from the patched working tree) as standalone,
 * dependency-free functions. `loadRoutingOutcomes` is stubbed to return
 * `[]` — this checkout has no persisted .swarm/routing-outcomes.json, so
 * the stub is not a fidelity gap on this environment; the runtime-learned
 * pattern branch is exercised identically (and produces identical output)
 * by both baseline and candidate regardless.
 *
 * Run: node docs/dream-cycle/evidence/2026-08-14-swarm/bench-agent-count-complexity-gate.mjs
 */

// ---------------------------------------------------------------------------
// Shared: KEYWORD_PATTERNS (identical in baseline and candidate — unchanged)
// ---------------------------------------------------------------------------
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

const ROUTING_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'need', 'should', 'would', 'could']);

function extractKeywords(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !ROUTING_STOPWORDS.has(w));
}

// loadRoutingOutcomes stub — see file header. Real function reads
// .swarm/routing-outcomes.json; empty in this fresh checkout.
function loadRoutingOutcomes() {
  return [];
}

function computeComplexity(description) {
  const descLower = description.toLowerCase();
  if (descLower.includes('complex') || descLower.includes('architecture') || description.length > 200) return 'high';
  if (descLower.includes('simple') || descLower.includes('fix') || description.length < 50) return 'low';
  return 'medium';
}

// ---------------------------------------------------------------------------
// BASELINE — verbatim from `git show HEAD:.../hooks-tools.ts` (pre-candidate)
// ---------------------------------------------------------------------------
function suggestAgentsForTask_BASELINE(task) {
  const taskLower = task.toLowerCase();

  for (const [pattern, result] of Object.entries(KEYWORD_PATTERNS)) {
    if (taskLower.includes(pattern)) {
      return result;
    }
  }

  const taskKeywords = extractKeywords(task);
  if (taskKeywords.length > 0) {
    const outcomes = loadRoutingOutcomes();
    let bestAgent = '';
    let bestOverlap = 0;
    for (const outcome of outcomes) {
      if (!outcome.success || !outcome.agent || !outcome.keywords?.length) continue;
      const overlap = taskKeywords.filter((kw) => outcome.keywords.includes(kw)).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestAgent = outcome.agent;
      }
    }
    if (bestAgent && bestOverlap >= 2) {
      return { agents: [bestAgent], confidence: Math.min(0.6 + bestOverlap * 0.05, 0.85) };
    }
  }

  return { agents: ['coder', 'researcher', 'tester'], confidence: 0.7 };
}

// ---------------------------------------------------------------------------
// CANDIDATE — verbatim from the patched working tree
// ---------------------------------------------------------------------------
const COMPLEXITY_DISCOUNT_PROTECTED_AGENTS = new Set(['security-architect', 'security-auditor']);

function applyComplexityDiscount(result, complexity) {
  if (complexity !== 'low') return result;
  if (result.agents.length <= 1) return result;
  if (result.agents.some((a) => COMPLEXITY_DISCOUNT_PROTECTED_AGENTS.has(a))) return result;
  return { agents: result.agents.slice(0, 1), confidence: result.confidence };
}

function suggestAgentsForTask_CANDIDATE(task, complexity = 'medium') {
  const taskLower = task.toLowerCase();

  for (const [pattern, result] of Object.entries(KEYWORD_PATTERNS)) {
    if (taskLower.includes(pattern)) {
      return applyComplexityDiscount(result, complexity);
    }
  }

  const taskKeywords = extractKeywords(task);
  if (taskKeywords.length > 0) {
    const outcomes = loadRoutingOutcomes();
    let bestAgent = '';
    let bestOverlap = 0;
    for (const outcome of outcomes) {
      if (!outcome.success || !outcome.agent || !outcome.keywords?.length) continue;
      const overlap = taskKeywords.filter((kw) => outcome.keywords.includes(kw)).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestAgent = outcome.agent;
      }
    }
    if (bestAgent && bestOverlap >= 2) {
      return { agents: [bestAgent], confidence: Math.min(0.6 + bestOverlap * 0.05, 0.85) };
    }
  }

  return applyComplexityDiscount({ agents: ['coder', 'researcher', 'tester'], confidence: 0.7 }, complexity);
}

// ---------------------------------------------------------------------------
// Corpus — real task descriptions spanning low/medium/high complexity.
// Includes: all 17 KEYWORD_PATTERNS entries at minimal (<50 char) length
// (-> low), the same 17 phrased as long architecture-flavored descriptions
// (-> high), a handful of medium-length generic descriptions, and 2
// unmatched-keyword control prompts (exercise the fallback path).
// ---------------------------------------------------------------------------
const KEYWORDS = Object.keys(KEYWORD_PATTERNS);

const corpus = [];

// (1) Low-complexity: short, minimal task per keyword (<50 chars, matches 'low' bucket via
// the length<50 rule, independent of any 'fix'/'simple' substring). Template deliberately
// avoids the substrings of any OTHER KEYWORD_PATTERNS entry so each row exercises its own
// labeled keyword — an earlier draft used "fix ${kw} bug", whose trailing "bug" substring
// silently out-matched 6/17 keywords (fix/feature/swarm/memory/deploy/ci-cd) against the
// 'bug' pattern instead, per KEYWORD_PATTERNS iteration order; caught by tonight's
// independent adversarial critic (see adversarial-critique.md) and fixed here.
for (const kw of KEYWORDS) {
  corpus.push({ id: `low-${kw}`, bucket: 'low', description: `${kw} needs a quick update` });
}

// (2) High-complexity: long, architecture-flavored, same keyword root (>200 chars)
for (const kw of KEYWORDS) {
  const filler =
    `This is a complex architecture-level change touching the ${kw} subsystem across multiple ` +
    `modules and services, requiring careful design review, cross-team coordination, migration ` +
    `planning, and a phased rollout strategy with backward-compatibility guarantees for ${kw}.`;
  corpus.push({ id: `high-${kw}`, bucket: 'high', description: filler });
}

// (3) Medium: generic descriptions, 50-200 chars, no 'simple'/'fix'/'complex'/'architecture'
const mediumTemplates = [
  'Update the {kw} module to support a new configuration option requested by the team.',
  'Improve the {kw} pipeline so it handles an additional edge case correctly.',
  'Extend {kw} coverage to include the newly added service endpoints.',
];
for (const kw of ['api', 'database', 'deploy', 'frontend', 'backend']) {
  const t = mediumTemplates[KEYWORDS.indexOf(kw) % mediumTemplates.length].replace('{kw}', kw);
  corpus.push({ id: `medium-${kw}`, bucket: 'medium', description: t });
}

// (4) Fallback path controls: no KEYWORD_PATTERNS match, short vs long
corpus.push({ id: 'low-fallback-1', bucket: 'low', description: 'tidy up a helper function' });
corpus.push({ id: 'low-fallback-2', bucket: 'low', description: 'small cleanup task' });
corpus.push({
  id: 'high-fallback-1',
  bucket: 'high',
  description:
    'This is a complex, multi-service effort to unify divergent configuration loading strategies ' +
    'across the entire platform, with extensive architecture review and phased migration across teams.',
});

// (5) Explicit safety-invariant probes: security/auth keywords forced into the low bucket
// via 'fix'/short length, to directly test that the protected-role exemption holds.
corpus.push({ id: 'low-auth-explicit', bucket: 'low', description: 'fix auth token bug' });
corpus.push({ id: 'low-security-explicit', bucket: 'low', description: 'fix security issue' });

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const rows = corpus.map((c) => {
  const complexity = computeComplexity(c.description);
  const baseline = suggestAgentsForTask_BASELINE(c.description);
  const candidate = suggestAgentsForTask_CANDIDATE(c.description, complexity);
  return {
    id: c.id,
    expectedBucket: c.bucket,
    computedComplexity: complexity,
    description: c.description,
    baselineAgents: baseline.agents,
    candidateAgents: candidate.agents,
    baselineCount: baseline.agents.length,
    candidateCount: candidate.agents.length,
    delta: candidate.agents.length - baseline.agents.length,
    hasProtectedRole: baseline.agents.some((a) => COMPLEXITY_DISCOUNT_PROTECTED_AGENTS.has(a)),
  };
});

function meanBy(items, bucket) {
  const filtered = items.filter((r) => r.computedComplexity === bucket);
  if (filtered.length === 0) return { n: 0, baselineMean: null, candidateMean: null };
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  return {
    n: filtered.length,
    baselineMean: sum(filtered.map((r) => r.baselineCount)) / filtered.length,
    candidateMean: sum(filtered.map((r) => r.candidateCount)) / filtered.length,
  };
}

const byBucket = {
  low: meanBy(rows, 'low'),
  medium: meanBy(rows, 'medium'),
  high: meanBy(rows, 'high'),
};

// Regression check: no row where computedComplexity !== 'low' has candidateCount < baselineCount.
const regressions = rows.filter((r) => r.computedComplexity !== 'low' && r.candidateCount < r.baselineCount);

// Safety-invariant check: no row with a protected role in the baseline agent list should have
// candidateCount < baselineCount (i.e. the discount must never fire when a protected role matched).
const safetyViolations = rows.filter((r) => r.hasProtectedRole && r.candidateCount < r.baselineCount);

const lowRows = rows.filter((r) => r.computedComplexity === 'low');
const agentsSavedOnLowBucket = lowRows.reduce((sum, r) => sum + (r.baselineCount - r.candidateCount), 0);
const totalBaselineAgentsOnLowBucket = lowRows.reduce((sum, r) => sum + r.baselineCount, 0);
const relativeAgentCountReductionOnLowBucket = totalBaselineAgentsOnLowBucket > 0
  ? agentsSavedOnLowBucket / totalBaselineAgentsOnLowBucket
  : 0;

const receipt = {
  hypothesis:
    'Given a corpus of task descriptions spanning low/medium/high complexity, when suggestAgentsForTask ' +
    'discounts the agent-count recommendation to 1 for low-complexity matches (excluding safety-relevant ' +
    'roles), then mean recommended-agent-count for low-complexity tasks drops while medium/high are unchanged.',
  corpusSize: rows.length,
  byBucket,
  regressionCount: regressions.length,
  regressions,
  safetyViolationCount: safetyViolations.length,
  safetyViolations,
  agentsSavedOnLowBucket,
  lowBucketSize: lowRows.length,
  relativeAgentCountReductionOnLowBucket: `${(relativeAgentCountReductionOnLowBucket * 100).toFixed(1)}%`,
  tokenCostProxyNote:
    'This receipt measures agent-COUNT reduction directly, which is what the candidate actually changes. ' +
    'It does NOT re-measure end-to-end token cost per agent (that would require real model calls). ADR-333 ' +
    '(docs/dream-cycles/2026-07-30-performance-sota.md, arXiv 2607.26922, Grade A) separately measured a ' +
    '~7.4x token-cost gap between a 5-agent pipeline and a 2-call baseline for comparable tasks; if each ' +
    'discounted agent carries a roughly similar per-agent token cost, the agent-count reduction above is ' +
    'directionally consistent with a real token saving on the low-complexity tail, but that composition is ' +
    'NOT independently verified tonight — flagged as Grade C (plausible, unverified) accordingly.',
  verdict: regressions.length === 0 && safetyViolations.length === 0 && agentsSavedOnLowBucket > 0 ? 'ACCEPT' : 'REJECT',
  rows,
};

console.log(JSON.stringify(receipt, null, 2));
