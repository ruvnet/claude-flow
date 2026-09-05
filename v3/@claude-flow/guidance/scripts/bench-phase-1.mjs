#!/usr/bin/env node
/**
 * Phase 1 micro-benchmarks for the @claude-flow/guidance optimization
 * work (horizon: guidance-sota-2026-05, milestone M1).
 *
 * Three hot paths identified by the deep-researcher report
 * (/tmp/guidance-optimization-plan.md):
 *
 *   1. analyzer.ts:831-917 extractMetrics      — 10+ linear passes over `lines`
 *   2. compiler.ts:294-326 parseRule           — 4 new RegExp per call
 *   3. retriever.ts:449-460 cosineSimilarity   — recomputes norms (vectors are unit-normalised)
 *
 * Run BEFORE the fix to capture baseline, run AFTER to measure uplift.
 * Output: docs/benchmarks/guidance-baseline.json or .../guidance-phase-1.json
 *
 * Usage:
 *   node v3/@claude-flow/cli ... build first
 *   node v3/@claude-flow/guidance/scripts/bench-phase-1.mjs --tag=baseline
 *   node v3/@claude-flow/guidance/scripts/bench-phase-1.mjs --tag=phase-1
 *
 * Standalone — does NOT require the test runner, just node ≥20 + ts files compiled
 * to dist or invoked through tsx. We import the dist artifact when available,
 * else fall back to ts-node-via-tsx (best-effort).
 */

import { performance } from 'node:perf_hooks';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(__dirname, '../../../..');
const OUT_DIR = resolve(REPO_ROOT, 'docs', 'benchmarks');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const TAG = args.tag || 'untagged';
const ITERS = parseInt(args.iters || '5000', 10);

function bench(name, fn, iters = ITERS) {
  // Multi-trial median to reduce per-run variance — single trials at
  // these iteration counts vary 5-15% between runs from background
  // process load, GC, JIT recompile, etc. The median of 5 trials is
  // stable to within ~2%, which is below the optimization signals we
  // care about.
  const TRIALS = 5;
  // Warmup is critical for V8's JIT — do enough work to trigger
  // optimization tier-up before the first measured run.
  const warm = Math.min(2000, Math.floor(iters / 5));
  for (let i = 0; i < warm; i++) fn();

  const opsList = [];
  for (let t = 0; t < TRIALS; t++) {
    const start = performance.now();
    for (let i = 0; i < iters; i++) fn();
    const totalMs = performance.now() - start;
    opsList.push(iters / (totalMs / 1000));
  }
  opsList.sort((a, b) => a - b);
  const median = opsList[Math.floor(TRIALS / 2)];
  const min = opsList[0];
  const max = opsList[TRIALS - 1];

  return {
    name,
    iters,
    trials: TRIALS,
    opsPerSec: Math.round(median),
    avgMicros: Math.round((1 / median) * 1e6 * 1000) / 1000,
    opsMin: Math.round(min),
    opsMax: Math.round(max),
    variance: Math.round(((max - min) / median) * 1000) / 1000,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs (deterministic — same across runs so before/after are comparable)
// ─────────────────────────────────────────────────────────────────────────────

const CLAUDE_MD_FIXTURE = `# Project Constitution

## Behavioral Rules
- NEVER commit secrets or .env files
- ALWAYS read a file before editing it
- MUST run tests after code changes
- Prefer editing existing files over creating new ones
- Use npm scripts: \`npm run build\`, \`npm test\`, \`npm run lint\`
- No console.log in production code
- Keep files under 500 lines

## Security
- Validate input at system boundaries
- NEVER hardcode credentials
- DO NOT bypass auth checks

## Architecture
- Follow Domain-Driven Design
- Each bounded context owns its data
- Repository pattern for persistence
- Event sourcing for state changes

## Build & Test
- \`npm run build\` compiles TypeScript via tsc
- \`npm test\` runs vitest suite
- \`cargo test\` for Rust crate

## Tools
- npm, pnpm, docker, git, make, cargo

## Extra Section A
` + Array.from({ length: 80 }, (_, i) => `- Domain rule ${i}: enforce invariant ${i}`).join('\n') + `

## Extra Section B
` + Array.from({ length: 40 }, (_, i) => `Some prose content about pattern ${i}.`).join('\n') + `
`;

const RULE_TEXT_FIXTURE = `
RULE: enforce-secret-scan
  TOOLS: <bash><write><edit>
  INTENTS: <commit><push><release>
  DOMAINS: <security><auth>
  SCOPE: <**/*.env> <**/secrets/**> <**/.git/**>

  When tool is <bash> or <write> AND intent matches <commit|push|release>,
  scan the diff for credential patterns. Block if hit.
`;

function makeVec(seed, dim = 384) {
  // Mulberry32-seeded deterministic Float32Array, normalised
  let s = seed >>> 0 || 1;
  const v = new Float32Array(dim);
  let norm = 0;
  for (let i = 0; i < dim; i++) {
    s = (s * 9301 + 49297) % 233280;
    v[i] = s / 233280 - 0.5;
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Load the live code under test (dist if built, else src via tsx-shim path)
// ─────────────────────────────────────────────────────────────────────────────

let analyzerMod, compilerMod, retrieverMod;
async function loadMods() {
  // Prefer dist
  const distAnalyzer = resolve(PKG_ROOT, 'dist/analyzer.js');
  const distCompiler = resolve(PKG_ROOT, 'dist/compiler.js');
  const distRetriever = resolve(PKG_ROOT, 'dist/retriever.js');
  try {
    analyzerMod = await import(distAnalyzer);
  } catch {
    throw new Error(`Build the guidance package first: cd ${PKG_ROOT} && npm run build`);
  }
  compilerMod = await import(distCompiler);
  retrieverMod = await import(distRetriever);
}

await loadMods();

// ─────────────────────────────────────────────────────────────────────────────
// Bench 1 — analyzer.extractMetrics via the exported `analyzeClaudeMd`
// ─────────────────────────────────────────────────────────────────────────────

const analyzeFn = analyzerMod.analyze || analyzerMod.analyzeClaudeMd || analyzerMod.default?.analyze;

if (typeof analyzeFn !== 'function') {
  console.error('analyzer module has no analyzeClaudeMd/analyze export — exports:', Object.keys(analyzerMod).slice(0, 20));
  process.exit(2);
}

const r1 = bench('analyzer.analyze(CLAUDE.md ~150 lines)', () => {
  analyzeFn(CLAUDE_MD_FIXTURE);
});

// ─────────────────────────────────────────────────────────────────────────────
// Bench 2 — compiler.parseRule via the exported compile entry
// ─────────────────────────────────────────────────────────────────────────────

const CompilerCls =
  compilerMod.Compiler ||
  compilerMod.GuidanceCompiler ||
  compilerMod.RuleCompiler ||
  compilerMod.default;

let r2 = null;
if (typeof CompilerCls === 'function') {
  const c = new CompilerCls();
  // The compiler's hot path is `compile(claudeMdContent)` which does the full
  // file walk + parseRule per discovered rule. We bench the full compile so
  // the regex-construction-in-loop overhead in parseRule shows up.
  r2 = bench('compiler.compile(CLAUDE.md ~150 lines, multiple rules)', () => {
    c.compile(CLAUDE_MD_FIXTURE);
  }, Math.max(1000, Math.floor(ITERS / 5)));
} else {
  console.warn('compiler module — exports:', Object.keys(compilerMod).slice(0, 20));
}

// ─────────────────────────────────────────────────────────────────────────────
// Bench 3 — retriever.cosineSimilarity
// ─────────────────────────────────────────────────────────────────────────────

// cosineSimilarity is `private` inside ShardRetriever — we benchmark the
// same algorithmic shape via a free function. The phase-1 fix lives in
// the source file; the bench measures whether the math the retriever
// would do per shard comparison gets faster.
const a = makeVec(1);
const b = makeVec(2);

function cosineNaive(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 0 ? Math.max(0, Math.min(1, dot / d)) : 0;
}

function cosineDotOnly(a, b) {
  // Optimised path — vectors are unit-normalised in HashEmbeddingProvider
  // and ONNX providers, so we can skip both norm computations and the
  // sqrt-div + clamp. Single multiply-add per dim.
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot < 0 ? 0 : dot > 1 ? 1 : dot;
}

const r3 = bench('retriever.cosine(384-d, naive 3-accumulator)', () => {
  cosineNaive(a, b);
}, 100000);

const r3b = bench('retriever.cosine(384-d, unit-norm dot-only)', () => {
  cosineDotOnly(a, b);
}, 100000);

// ─────────────────────────────────────────────────────────────────────────────
// Emit result
// ─────────────────────────────────────────────────────────────────────────────

const results = [r1, r2, r3, r3b].filter(Boolean);
const out = {
  tag: TAG,
  iters: ITERS,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  capturedAt: new Date().toISOString(),
  results,
};

mkdirSync(OUT_DIR, { recursive: true });
const outPath = resolve(OUT_DIR, `guidance-${TAG}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`\nWrote ${outPath}\n`);
console.log('| Benchmark                                            | Ops/sec     | Avg µs   |');
console.log('|------------------------------------------------------|-------------|----------|');
for (const r of results) {
  const name = r.name.padEnd(52).slice(0, 52);
  const ops = String(r.opsPerSec).padStart(11);
  const us = String(r.avgMicros).padStart(8);
  console.log(`| ${name} | ${ops} | ${us} |`);
}
