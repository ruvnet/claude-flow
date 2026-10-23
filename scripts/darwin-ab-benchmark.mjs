#!/usr/bin/env node
// darwin-ab-benchmark.mjs — paired Darwin Mode evolution benchmark.
//
//   A (control):    mutator = deterministic    (no LLM, no key)
//   B (treatment):  mutator = OpenRouterMutator (uses OPENROUTER_API_KEY env)
//
// Same target harness, same seed, same generations/children/sandbox config.
// Only the mutator differs. Records each run's baseline + champion
// finalScore + telemetry into docs/benchmarks/darwin-ab/<ts>-{A,B}.json,
// then prints a summary table.
//
// SECURITY (per project memory `feedback_dont_expose_keys`):
//   - Reads OPENROUTER_API_KEY from process.env or GCP Secret Manager.
//   - NEVER prints the key. Echoes length + 4-char prefix only.
//   - Passes via env to the subprocess, never via argv or stdout.
//   - Cleans up by NOT writing the key to any artifact file.
//
// USAGE
//   # 1. Fetch key into env (one of):
//   export OPENROUTER_API_KEY="$(gcloud secrets versions access latest --secret=openrouter-api-key)"
//   # or pre-set in the calling shell
//
//   # 2. Run
//   node scripts/darwin-ab-benchmark.mjs --target /tmp/test-harness --generations 2 --children 3
//   node scripts/darwin-ab-benchmark.mjs --target /tmp/test-harness --generations 2 --children 3 --sandbox mock
//
// EXIT CODES
//   0  both runs completed (regardless of who won)
//   1  A or B failed to complete
//   2  config error (missing key, missing target, etc.)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'docs/benchmarks/darwin-ab');

const ARGS = (() => {
  const a = {
    target: null,
    generations: 2,
    children: 3,
    concurrency: 2,
    seed: 42,
    sandbox: 'mock',  // default mock — fast, reproducible; flip to 'real' for production benchmark
    model: 'google/gemini-2.5-flash',
    skipA: false,
    skipB: false,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--target') a.target = process.argv[++i];
    else if (v === '--generations') a.generations = parseInt(process.argv[++i], 10);
    else if (v === '--children') a.children = parseInt(process.argv[++i], 10);
    else if (v === '--concurrency') a.concurrency = parseInt(process.argv[++i], 10);
    else if (v === '--seed') a.seed = parseInt(process.argv[++i], 10);
    else if (v === '--sandbox') a.sandbox = process.argv[++i];
    else if (v === '--model') a.model = process.argv[++i];
    else if (v === '--skip-a') a.skipA = true;
    else if (v === '--skip-b') a.skipB = true;
  }
  return a;
})();

function safetyChecks() {
  if (!ARGS.target) {
    console.error('darwin-ab: --target <path> is required');
    process.exit(2);
  }
  const targetAbs = resolve(ARGS.target);
  if (!existsSync(targetAbs)) {
    console.error(`darwin-ab: target does not exist: ${targetAbs}`);
    process.exit(2);
  }
  if (!ARGS.skipB && !process.env.OPENROUTER_API_KEY) {
    console.error('darwin-ab: B run needs OPENROUTER_API_KEY in env');
    console.error('darwin-ab: hint: export OPENROUTER_API_KEY="$(gcloud secrets versions access latest --secret=openrouter-api-key)"');
    process.exit(2);
  }
  if (!['real', 'mock', 'agent'].includes(ARGS.sandbox)) {
    console.error(`darwin-ab: --sandbox must be real|mock|agent (got: ${ARGS.sandbox})`);
    process.exit(2);
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  return targetAbs;
}

// Sanitize a key for logging — length + 4-char prefix only. Per memory rule.
function safeKeyEcho(key) {
  if (!key) return '(missing)';
  return `${key.slice(0, 4)}…(len=${key.length})`;
}

async function runEvolution(label, targetAbs, mutator) {
  const start = Date.now();
  const workRoot = join(targetAbs, '.metaharness', `ab-${label}`);
  if (!existsSync(workRoot)) mkdirSync(workRoot, { recursive: true });

  // Programmatic API — gives us access to OpenRouterMutator that the CLI
  // does not surface. Dynamic import means the file fails gracefully on
  // hosts that don't have @metaharness/darwin installed.
  let darwinPkg;
  try {
    darwinPkg = await import('@metaharness/darwin');
  } catch (e) {
    return {
      label,
      ok: false,
      reason: 'metaharness-darwin-not-installed',
      hint: 'npm install @metaharness/darwin@~0.3.1',
      durationMs: Date.now() - start,
    };
  }

  const { evolve, OpenRouterMutator } = darwinPkg;
  if (!evolve) {
    return {
      label,
      ok: false,
      reason: 'evolve-export-missing',
      durationMs: Date.now() - start,
    };
  }

  const config = {
    repoRoot: targetAbs,
    workRoot,
    generations: ARGS.generations,
    childrenPerGeneration: ARGS.children,
    tasks: [],  // empty — sandbox mode 'mock' uses DEFAULT_MOCK_TASKS
    promotionDelta: 0.0,  // accept any improvement (B's wins should be small early)
    concurrency: ARGS.concurrency,
    sandboxMode: ARGS.sandbox,
    seed: ARGS.seed,
  };

  if (mutator === 'openrouter') {
    if (!OpenRouterMutator) {
      return {
        label,
        ok: false,
        reason: 'OpenRouterMutator-export-missing',
        durationMs: Date.now() - start,
      };
    }
    const mut = new OpenRouterMutator({ model: ARGS.model });
    config.generator = mut;
  }
  // For mutator === 'deterministic', leave config.generator undefined —
  // upstream falls back to the deterministic template-based mutator.

  console.error(`[${label}] starting evolve (mutator=${mutator}, sandbox=${ARGS.sandbox}, gens=${ARGS.generations}, children=${ARGS.children}, seed=${ARGS.seed})`);

  let result;
  try {
    result = await evolve(config);
  } catch (e) {
    return {
      label,
      ok: false,
      reason: 'evolve-threw',
      error: String(e?.message ?? e),
      durationMs: Date.now() - start,
    };
  }

  const durationMs = Date.now() - start;

  // Extract telemetry from OpenRouterMutator if used (cost / token tracking).
  const mutatorTelemetry = mutator === 'openrouter' && config.generator?.telemetry
    ? config.generator.telemetry
    : null;

  return {
    label,
    ok: true,
    mutator,
    sandbox: ARGS.sandbox,
    seed: ARGS.seed,
    shape: { generations: ARGS.generations, children: ARGS.children, concurrency: ARGS.concurrency },
    baselineScore: result.baseline?.finalScore ?? null,
    championScore: result.winner?.finalScore ?? null,
    delta: (result.winner?.finalScore != null && result.baseline?.finalScore != null)
      ? result.winner.finalScore - result.baseline.finalScore
      : null,
    archiveSize: result.archive?.length ?? 0,
    lineageDepth: result.lineage?.length ?? 0,
    mutatorTelemetry,
    durationMs,
    workRoot,
  };
}

async function main() {
  const targetAbs = safetyChecks();
  const startedAt = new Date().toISOString().replace(/[:.]/g, '-');

  // Echo key safely (length + 4-char prefix only — NEVER the value).
  if (!ARGS.skipB) {
    console.error(`OPENROUTER_API_KEY: ${safeKeyEcho(process.env.OPENROUTER_API_KEY)}`);
  }
  console.error(`Target harness:     ${targetAbs}`);
  console.error(`Output dir:         ${OUT_DIR}`);
  console.error('');

  const results = {};
  if (!ARGS.skipA) {
    results.A = await runEvolution('A', targetAbs, 'deterministic');
  }
  if (!ARGS.skipB) {
    results.B = await runEvolution('B', targetAbs, 'openrouter');
  }

  // Persist each result to its own JSON artifact.
  for (const [label, r] of Object.entries(results)) {
    const outPath = join(OUT_DIR, `${startedAt}-${label}.json`);
    writeFileSync(outPath, JSON.stringify(r, null, 2));
    console.error(`[${label}] wrote ${outPath}`);
  }

  // Summary table.
  console.log('');
  console.log('## Darwin Mode A/B benchmark — summary');
  console.log('');
  console.log(`Target:    ${targetAbs}`);
  console.log(`Sandbox:   ${ARGS.sandbox}`);
  console.log(`Seed:      ${ARGS.seed}`);
  console.log(`Shape:     generations=${ARGS.generations}, children=${ARGS.children}, concurrency=${ARGS.concurrency}`);
  console.log(`Model (B): ${ARGS.model}`);
  console.log('');
  console.log('| Arm | Mutator | Baseline | Champion | Δ | Archive | Duration | Cost USD |');
  console.log('|---|---|---:|---:|---:|---:|---:|---:|');
  for (const [label, r] of Object.entries(results)) {
    if (!r.ok) {
      console.log(`| ${label} | ${r.label ?? '?'} | — | — | — | — | ${(r.durationMs / 1000).toFixed(1)}s | — |  (${r.reason})`);
      continue;
    }
    const cost = r.mutatorTelemetry?.costUSD?.toFixed(4) ?? '$0.0000';
    console.log(`| ${label} | ${r.mutator} | ${r.baselineScore?.toFixed(4) ?? '—'} | ${r.championScore?.toFixed(4) ?? '—'} | ${r.delta != null ? (r.delta >= 0 ? '+' : '') + r.delta.toFixed(4) : '—'} | ${r.archiveSize} | ${(r.durationMs / 1000).toFixed(1)}s | ${cost} |`);
  }

  const ok = Object.values(results).every((r) => r.ok);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`darwin-ab: ${e?.message ?? e}`);
  process.exit(2);
});
