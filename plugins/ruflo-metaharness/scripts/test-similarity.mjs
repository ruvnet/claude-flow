#!/usr/bin/env node
// test-similarity.mjs — unit tests for the iter-36 production module
// `_similarity.mjs` (ADR-152 §3.1).
//
// The spike (_spike-similarity.mjs) verifies the two architectural
// invariants on synthetic fixtures. This test exercises each public
// function in isolation: projectToVec, cosine, categoricalAgreement,
// jaccard, similarity, opts.weights override, opts.perDimension shape.
//
// CONTRACT EACH FUNCTION MUST SATISFY
//   - input contract documented in _similarity.mjs holds
//   - missing optional fields default safely (graceful, never throws)
//   - numerical results are deterministic (no floats from Math.random)
//   - return shapes match ADR-152 §"return shape"
//
// USAGE
//   node scripts/test-similarity.mjs
//   node scripts/test-similarity.mjs --format json
//
// EXIT
//   0  all unit tests pass
//   1  at least one test failed

import {
  projectToVec, cosine, categoricalAgreement, jaccard, similarity,
} from './_similarity.mjs';
// iter 64 — also test the iter-63 shared severity primitives
import { SEVERITY_RANK, rankSeverity, parseMcpScanText } from './_harness.mjs';
import { parseTrailingJson } from './_invoke.mjs';

const ARGS = (() => {
  const a = { format: 'table' };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--format') a.format = process.argv[++i];
  }
  return a;
})();

let passed = 0, failed = 0;
const failures = [];

function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failures.push(label); failed++; }
}

function approx(a, b, eps = 0.0001) {
  return Math.abs(a - b) < eps;
}

// ──────────────────────────────────────────────────────────────────
// FIXTURES — share two harness shapes across all tests
// ──────────────────────────────────────────────────────────────────

const A = {
  score: {
    harnessFit: 80, compileConfidence: 100, taskCoverage: 70, toolSafety: 90,
    memoryUsefulness: 50, estCostPerRunUsd: 0.05, recommendedMode: 'CLI + MCP',
    archetype: 'typescript-sdk-harness', template: 'vertical:coding',
  },
  genome: {
    repo_type: 'node_mcp_ci',
    agent_topology: ['maintainer', 'tester', 'security'],
    risk_score: 0.3, test_confidence: 0.85, publish_readiness: 0.9,
  },
};

const B = {
  score: {
    harnessFit: 60, compileConfidence: 80, taskCoverage: 50, toolSafety: 70,
    memoryUsefulness: 30, estCostPerRunUsd: 0.02, recommendedMode: 'CLI',
    archetype: 'python-agent-harness', template: 'vertical:devops',
  },
  genome: {
    repo_type: 'python_ops',
    agent_topology: ['deployer', 'rollback'],
    risk_score: 0.1, test_confidence: 0.6, publish_readiness: 0.5,
  },
};

// ──────────────────────────────────────────────────────────────────
console.log(`# test-similarity — _similarity.mjs unit tests (iter 39)\n`);

console.log('Phase 1 — projectToVec');
const vA = projectToVec(A);
assert(Array.isArray(vA), 'returns an array');
assert(vA.length === 9, 'returns 9-dim vector (ADR-152 §Decision Table 1)');
assert(approx(vA[0], 0.80), 'index 0 = harnessFit/100 (80 → 0.80)');
assert(approx(vA[1], 1.00), 'index 1 = compileConfidence/100 (100 → 1.00)');
assert(approx(vA[2], 0.70), 'index 2 = taskCoverage/100');
assert(approx(vA[3], 0.90), 'index 3 = toolSafety/100');
assert(approx(vA[4], 0.50), 'index 4 = memoryUsefulness/100');
assert(approx(vA[5], 0.30), 'index 5 = risk_score (already 0..1)');
assert(approx(vA[6], 0.85), 'index 6 = test_confidence');
assert(approx(vA[7], 0.90), 'index 7 = publish_readiness');
// Missing-field defaults safely (graceful degradation)
const vEmpty = projectToVec({});
assert(vEmpty.length === 9, 'empty input still returns 9-dim');
assert(vEmpty.every((x) => typeof x === 'number'), 'all elements numeric (no NaN propagation)');
const vNoGenome = projectToVec({ score: A.score });
assert(approx(vNoGenome[5], 0), 'missing genome → risk_score=0 default');
assert(approx(vNoGenome[0], 0.80), 'missing genome does not corrupt score-derived indices');

console.log('\nPhase 2 — cosine');
assert(approx(cosine(vA, vA), 1), 'cosine(x, x) === 1');
assert(approx(cosine([1, 0], [0, 1]), 0), 'orthogonal vectors → 0');
assert(approx(cosine([0, 0, 0], [1, 1, 1]), 0), 'zero vector → 0 (graceful divide-by-zero)');
assert(cosine([1, 2], [1, 2, 3]) === 0, 'length mismatch → 0 (graceful)');
assert(cosine(null, vA) === 0, 'null input → 0 (graceful)');
const cosAB = cosine(vA, projectToVec(B));
assert(cosAB >= 0 && cosAB <= 1, 'output bounded to [0, 1] for nonneg vectors');

console.log('\nPhase 3 — categoricalAgreement');
assert(approx(categoricalAgreement(A, A), 1), 'identical input → 1 (all 4 enums match)');
assert(approx(categoricalAgreement(A, B), 0), 'A vs B → 0 (all 4 enums differ)');
assert(approx(categoricalAgreement({}, {}), 0), 'both empty → 0 (no matches counted)');
// Partial match — 2 of 4 fields agree
const partial = {
  score: { archetype: A.score.archetype, template: 'different', recommendedMode: A.score.recommendedMode },
  genome: { repo_type: 'different' },
};
assert(approx(categoricalAgreement(A, partial), 0.5),
  '2-of-4 partial match → 0.5 (archetype + recommendedMode)');

console.log('\nPhase 4 — jaccard');
assert(approx(jaccard(A, A), 1), 'identical topology → 1');
assert(approx(jaccard(A, B), 0), 'disjoint topology → 0');
assert(approx(jaccard({ genome: {} }, { genome: {} }), 1),
  'both empty topology → 1 (set-equality convention)');
const overlap = {
  genome: { agent_topology: ['maintainer', 'tester', 'extra'] },
};
// A has {maintainer, tester, security}; overlap has {maintainer, tester, extra}
// |A ∩ B|=2, |A ∪ B|=4 → 2/4 = 0.5
assert(approx(jaccard(A, overlap), 0.5), 'partial topology overlap → |∩|/|∪|');

console.log('\nPhase 5 — similarity composite + return shape');
const sAA = similarity(A, A);
assert(typeof sAA === 'object' && sAA !== null, 'returns object');
assert(typeof sAA.overall === 'number', 'overall is numeric');
assert(approx(sAA.overall, 1), 'similarity(X, X).overall === 1');
assert(typeof sAA.components === 'object', 'components present');
assert(approx(sAA.components.cosine, 1), 'components.cosine === 1 on self-match');
assert(approx(sAA.components.categorical, 1), 'components.categorical === 1');
assert(approx(sAA.components.jaccard, 1), 'components.jaccard === 1');
assert(typeof sAA.weights === 'object', 'weights echoed in return');
assert(approx(sAA.weights.cosine, 0.6), 'default cosine weight = 0.6 (ADR-152)');
assert(approx(sAA.weights.categorical, 0.25), 'default categorical weight = 0.25');
assert(approx(sAA.weights.jaccard, 0.15), 'default jaccard weight = 0.15');
assert(approx(sAA.weights.cosine + sAA.weights.categorical + sAA.weights.jaccard, 1),
  'default weights sum to 1');

console.log('\nPhase 6 — similarity opts.weights override');
const reweighted = similarity(A, B, { weights: { cosine: 0, categorical: 0, jaccard: 1 } });
const jacOnly = jaccard(A, B);
assert(approx(reweighted.overall, jacOnly),
  'opts.weights cosine=0/cat=0/jac=1 → overall === jaccard');
const reweighted2 = similarity(A, A, { weights: { cosine: 0.5, categorical: 0.3, jaccard: 0.2 } });
assert(approx(reweighted2.overall, 1),
  'self-match holds under any weight scheme');

console.log('\nPhase 7 — similarity opts.perDimension shape');
const sPD = similarity(A, B, { perDimension: true });
assert(typeof sPD.perDimension === 'object', 'perDimension included when requested');
assert('numeric.harnessFit' in sPD.perDimension,
  'perDimension exposes each numeric feature by name');
assert('categorical.archetype' in sPD.perDimension,
  'perDimension exposes each categorical field by name');
assert('set.agent_topology' in sPD.perDimension,
  'perDimension exposes the set-typed feature');
const hf = sPD.perDimension['numeric.harnessFit'];
assert(hf.a === 80 && hf.b === 60, 'perDimension preserves raw a/b values');
assert(typeof hf.contribution === 'number', 'perDimension has numeric contribution');
const sNoPD = similarity(A, B);
assert(!('perDimension' in sNoPD), 'perDimension omitted by default');

console.log('\nPhase 8 — round-trip with the iter-35 spike fixtures (regression anchor)');
// Hard-coded spike numbers from `_spike-similarity.mjs` — ANY change
// here means the production module drifted from the spike's frozen
// invariants (catches future weight or normalization changes).
const LEGAL = {
  score: { harnessFit: 78, compileConfidence: 92, taskCoverage: 65, toolSafety: 88, memoryUsefulness: 70, estCostPerRunUsd: 0.04, recommendedMode: 'CLI + MCP', archetype: 'compliance-harness', template: 'vertical:legal' },
  genome: { repo_type: 'node_mcp_ci', agent_topology: ['contract-analyst', 'redline-reviewer', 'risk-rater', 'compliance-officer'], risk_score: 0.45, test_confidence: 0.7, publish_readiness: 0.6 },
};
const SUPPORT = {
  score: { harnessFit: 75, compileConfidence: 90, taskCoverage: 70, toolSafety: 90, memoryUsefulness: 72, estCostPerRunUsd: 0.05, recommendedMode: 'CLI + MCP', archetype: 'compliance-harness', template: 'vertical:support' },
  genome: { repo_type: 'node_mcp_ci', agent_topology: ['triager', 'kb-searcher', 'responder', 'risk-rater', 'compliance-officer'], risk_score: 0.40, test_confidence: 0.75, publish_readiness: 0.65 },
};
const sLS = similarity(LEGAL, SUPPORT);
assert(sLS.overall === 0.8296,
  `LEGAL × SUPPORT overall must be exactly 0.8296 (got ${sLS.overall})`);
assert(sLS.components.cosine === 0.9987,
  `LEGAL × SUPPORT cosine must be 0.9987 (got ${sLS.components.cosine})`);
assert(sLS.components.categorical === 0.75,
  `LEGAL × SUPPORT categorical must be 0.75 (got ${sLS.components.categorical})`);
assert(sLS.components.jaccard === 0.2857,
  `LEGAL × SUPPORT jaccard must be 0.2857 (got ${sLS.components.jaccard})`);

console.log('\nPhase 9 — iter-63 shared SEVERITY_RANK + rankSeverity()');
// Known severities — full vocab the iter-50 parser produces
assert(SEVERITY_RANK.clean === 0, 'rank.clean === 0');
assert(SEVERITY_RANK.info === 0, 'rank.info === 0 (informational, no harm)');
assert(SEVERITY_RANK.low === 1, 'rank.low === 1');
assert(SEVERITY_RANK.medium === 2, 'rank.medium === 2');
assert(SEVERITY_RANK.warn === 2, 'rank.warn === 2 (warn ≈ medium)');
assert(SEVERITY_RANK.high === 3, 'rank.high === 3');
assert(SEVERITY_RANK.error === 3, 'rank.error === 3 (error ≈ high)');
assert(SEVERITY_RANK.critical === 4, 'rank.critical === 4 (elevated above high)');

// Object.freeze blocks mutation — anti-tamper guard
const before = SEVERITY_RANK.high;
let mutated = false;
try { SEVERITY_RANK.high = 999; mutated = SEVERITY_RANK.high !== before; } catch { /* strict mode throws */ }
assert(!mutated, 'SEVERITY_RANK frozen — mutation does not stick');

// rankSeverity safe accessor
assert(rankSeverity('info') === 0, 'rankSeverity("info") === 0');
assert(rankSeverity('CRITICAL') === 4, 'rankSeverity case-insensitive ("CRITICAL" → 4)');
assert(rankSeverity('Warn') === 2, 'rankSeverity case-insensitive ("Warn" → 2)');
assert(rankSeverity('unknown') === 0, 'rankSeverity("unknown") === 0 (no NaN)');
assert(rankSeverity(null) === 0, 'rankSeverity(null) === 0');
assert(rankSeverity(undefined) === 0, 'rankSeverity(undefined) === 0');
assert(rankSeverity('') === 0, 'rankSeverity("") === 0');
assert(rankSeverity(' high ') === 0,
  'rankSeverity does not strip whitespace (returns 0 for non-normalized input)');

// Rollup pattern mirrors oia-audit's reduce
function rollup(findings) {
  return findings.reduce((acc, f) => {
    const s = String(f.severity || 'low').toLowerCase();
    return rankSeverity(s) > rankSeverity(acc) ? s : acc;
  }, 'clean');
}
assert(rollup([{ severity: 'info' }]) === 'clean',
  'rollup info-only stays clean');
assert(rollup([{ severity: 'warn' }]) === 'warn',
  'rollup warn-only elevates to warn (was NaN-ignored pre-iter-63)');
assert(rollup([{ severity: 'critical' }, { severity: 'info' }]) === 'critical',
  'rollup with critical elevates above info');
assert(rollup([{ severity: 'low' }, { severity: 'warn' }, { severity: 'high' }, { severity: 'critical' }]) === 'critical',
  'rollup picks max across mixed severities');
assert(rollup([{ severity: 'unknown-strange-value' }]) === 'clean',
  'rollup with unknown severity stays clean (safe default)');

console.log('\nPhase 10 — iter-50 parseMcpScanText edge cases');

// Empty input — graceful return shape
const empty = parseMcpScanText('');
assert(Array.isArray(empty.findings) && empty.findings.length === 0,
  'parseMcpScanText("") → findings:[]');
assert(empty.summary === null, 'parseMcpScanText("") → summary:null');

// null / undefined safe
const nullParsed = parseMcpScanText(null);
assert(Array.isArray(nullParsed.findings) && nullParsed.findings.length === 0,
  'parseMcpScanText(null) → findings:[]');
const undefParsed = parseMcpScanText(undefined);
assert(Array.isArray(undefParsed.findings) && undefParsed.findings.length === 0,
  'parseMcpScanText(undefined) → findings:[]');

// Single finding — happy path
const single = parseMcpScanText(`harness mcp-scan — /repo

  [INFO] No MCP security issues found

Result: INFO (1 finding, 0 high)
`);
assert(single.findings.length === 1, 'single [INFO] block → 1 finding');
assert(single.findings[0].severity === 'info', 'severity lowercased');
assert(single.findings[0].message === 'No MCP security issues found',
  'message extracted');
assert(single.summary?.overallSeverity === 'info',
  'summary.overallSeverity from Result: line');
assert(single.summary?.totalCount === 1,
  'summary.totalCount === 1 from "(1 finding,"');

// Newer metaharness releases align severity labels to a fixed-width column.
// Keep parsing the legacy compact form above while accepting `[LOW ]`.
const padded = parseMcpScanText(`harness mcp-scan — /repo

  [LOW ] 8 unpinned dependency range(s)
         Floating ranges weaken supply-chain reproducibility.

Result: LOW (1 finding, 0 high)
`);
assert(padded.findings.length === 1, 'padded [LOW ] block → 1 finding');
assert(padded.findings[0].severity === 'low',
  'padded severity lowercased without trailing whitespace');
assert(padded.findings[0].message.includes('8 unpinned dependency range(s)') &&
       padded.findings[0].message.includes('supply-chain reproducibility'),
  'padded finding message and continuation extracted');

// Continuation line — indented text appends to previous finding
const cont = parseMcpScanText(`
  [HIGH] Exposed credential path
         Detected in .mcp/servers.json line 12
         Recommended action: rotate immediately

Result: HIGH (1 finding, 1 high)
`);
assert(cont.findings.length === 1, 'finding with continuation = 1 entry');
assert(cont.findings[0].severity === 'high', 'HIGH lowercased to high');
assert(cont.findings[0].message.includes('Detected in') &&
       cont.findings[0].message.includes('rotate immediately'),
  'continuation lines appended to message');

// Multiple findings — distinct entries
const multi = parseMcpScanText(`
  [WARN] First issue
  [HIGH] Second issue
  [CRITICAL] Third issue

Result: HIGH (3 findings, 2 high)
`);
assert(multi.findings.length === 3, 'multiple findings = 3 entries');
assert(multi.findings.map((f) => f.severity).join(',') === 'warn,high,critical',
  'severities preserved in order');
assert(multi.summary?.totalCount === 3, 'multi summary totalCount === 3');

// No Result: line — summary stays null but findings still parsed
const noResult = parseMcpScanText(`  [INFO] Lone finding\n`);
assert(noResult.findings.length === 1, 'no Result: line → still parses findings');
assert(noResult.summary === null, 'no Result: line → summary === null');

// Mixed-case severity in source — parser is intentionally strict: regex
// captures `[A-Z]+` so mixed-case 'Warn' WON'T match. This is the
// documented contract — upstream emits all-uppercase markers.
const mixed = parseMcpScanText('  [Warn] Something\n  [HIGH] Other\n');
assert(mixed.findings.length === 1,
  'strict regex skips mixed-case [Warn], captures [HIGH] only');
assert(mixed.findings[0].severity === 'high',
  'strict regex captured the uppercase entry');

console.log('\nPhase 11 — complete trailing JSON extraction');

const nestedJson = parseTrailingJson(`progress: scanning {not-json}
{
  "dir": "/repo",
  "findings": [
    { "id": "allow-shell", "severity": "high" },
    { "id": "no-audit-log", "severity": "medium" }
  ],
  "worst": "high"
}
`);
assert(nestedJson?.dir === '/repo', 'mixed stdout returns root JSON object');
assert(nestedJson?.findings?.length === 2,
  'nested findings remain attached to root payload');
assert(nestedJson?.findings?.[1]?.id === 'no-audit-log',
  'extractor does not return the last nested object');
assert(nestedJson?.worst === 'high', 'root-level severity is preserved');
assert(parseTrailingJson('progress only {not-json}') === null,
  'non-JSON progress braces return null');

// ──────────────────────────────────────────────────────────────────
const summary = {
  passed, failed,
  failures,
  total: passed + failed,
  graduates: failed === 0,
};

console.log(`\n${passed} passed, ${failed} failed`);
if (ARGS.format === 'json') {
  console.log(JSON.stringify(summary, null, 2));
}
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('\n✓ All _similarity.mjs unit tests pass (ADR-152 §3.1 production contract).');
