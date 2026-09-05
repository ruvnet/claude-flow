#!/usr/bin/env node
/**
 * benchmark-multiagent.mjs — Multi-agent task-completion benchmark suite
 *
 * Implements ADR-163 (Dream Cycle 2026-06-20, issue #2427, PR #2428).
 * Mirrors the structure of `benchmark-intelligence.mjs` so output is
 * reproducible and machine-readable.
 *
 * MOTIVATION (from ADR-163)
 *   LangGraph / AutoGen / CrewAI publish task-completion-rate benchmarks
 *   (62 / 58 / 54 % on a 2,000-run independent 2026 benchmark). Ruflo
 *   has no comparable published number. This blocks data-driven tuning
 *   of the 3-tier routing thresholds and creates a credibility gap.
 *
 * WHAT THIS MEASURES (per run)
 *   - Task completion (pass/fail per the task's success criterion)
 *   - Wall-clock time (ms)
 *   - Estimated token count (input + output)
 *   - Estimated cost at standard API rates
 *
 * BACKENDS
 *   --backend mock   — synthetic deterministic runner. No LLM calls.
 *                       Use for: CI smoke, pipeline validation, $0 cost.
 *   --backend ruflo  — real ruflo CLI invocation per task. Costs real $.
 *                       Use for: publishable numbers. Gate behind explicit
 *                       --confirm to prevent surprise bills (~$50-75 for full sweep).
 *
 * TASK CORPUS (5 tasks, matching the structure of the LangGraph/AutoGen/CrewAI
 *              independent 2026 benchmark)
 *   T1: Code generation              single-agent  Tier-2 routing
 *   T2: Multi-file refactor          hierarchical  3 agents
 *   T3: Research synthesis           mesh          4 agents
 *   T4: Security audit               specialized   reviewer + auditor
 *   T5: End-to-end feature           full pipeline architect→coder→tester→reviewer
 *
 * RUN SHAPE
 *   --runs N         — runs per task (default 1 = smoke; ADR-163 specifies 100 for full)
 *   --tasks A,B,C    — subset of {T1,T2,T3,T4,T5} (default: all)
 *
 * USAGE
 *   # smoke (default — mock backend, 1 run/task, no LLM cost)
 *   node scripts/benchmark-multiagent.mjs
 *
 *   # full publishable sweep (ADR-163: 100 runs × 5 tasks × Tier-3 ~= $50-75)
 *   node scripts/benchmark-multiagent.mjs --backend ruflo --runs 100 --confirm
 *
 *   # subset
 *   node scripts/benchmark-multiagent.mjs --tasks T1,T4 --runs 10
 *
 * EXIT CODES
 *   0  ran to completion (any task pass/fail counts as completion)
 *   1  --alert-on-pass-rate-below threshold breached
 *   2  config error or runner crash
 *
 * Created for the ruflo perf benchmark suite (ADR-163).
 * Co-Authored-By: RuFlo <ruv@ruv.net>
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

// ─── Task corpus (mirrors ADR-163 §"Benchmark design") ────────────────────

const TASKS = [
  {
    id: 'T1',
    title: 'Code generation',
    type: 'single-agent',
    tier: 2,
    expectedSwarmSize: 1,
    successCriterion: 'Correct output, ≤2 retries',
    // For mock backend — deterministic per-task expected behavior
    mock: { passRate: 0.78, avgLatencyMs: 2100, avgTokens: 1450, avgCostUsd: 0.0029 },
  },
  {
    id: 'T2',
    title: 'Multi-file refactor',
    type: 'hierarchical',
    tier: 3,
    expectedSwarmSize: 3,
    successCriterion: 'All target files modified, tests pass',
    mock: { passRate: 0.66, avgLatencyMs: 18500, avgTokens: 9800, avgCostUsd: 0.0294 },
  },
  {
    id: 'T3',
    title: 'Research synthesis',
    type: 'mesh',
    tier: 3,
    expectedSwarmSize: 4,
    successCriterion: '≥5 cited sources, coherent output',
    mock: { passRate: 0.71, avgLatencyMs: 12200, avgTokens: 7400, avgCostUsd: 0.0222 },
  },
  {
    id: 'T4',
    title: 'Security audit',
    type: 'specialized',
    tier: 3,
    expectedSwarmSize: 2,
    successCriterion: '≥3 findings categorized',
    mock: { passRate: 0.83, avgLatencyMs: 8400, avgTokens: 5200, avgCostUsd: 0.0156 },
  },
  {
    id: 'T5',
    title: 'End-to-end feature',
    type: 'full-pipeline',
    tier: 3,
    expectedSwarmSize: 4,
    successCriterion: 'Feature works + tests green',
    mock: { passRate: 0.59, avgLatencyMs: 32100, avgTokens: 16200, avgCostUsd: 0.0486 },
  },
];

// ─── CLI arg parsing ──────────────────────────────────────────────────────

const ARGS = (() => {
  const a = {
    backend: 'mock',
    runs: 1,
    tasks: null,         // null = all
    confirm: false,
    alertPassRateBelow: null,
    seed: 42,
    jsonOnly: false,
    outDir: path.join(REPO_ROOT, 'docs/benchmarks/multi-agent'),
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--backend') a.backend = process.argv[++i];
    else if (v === '--runs') a.runs = parseInt(process.argv[++i], 10);
    else if (v === '--tasks') a.tasks = process.argv[++i].split(',').map(t => t.trim().toUpperCase());
    else if (v === '--confirm') a.confirm = true;
    else if (v === '--alert-on-pass-rate-below') a.alertPassRateBelow = parseFloat(process.argv[++i]);
    else if (v === '--seed') a.seed = parseInt(process.argv[++i], 10);
    else if (v === '--json-only') a.jsonOnly = true;
    else if (v === '--out-dir') a.outDir = process.argv[++i];
  }
  return a;
})();

// ─── Safety: real backend requires explicit --confirm ────────────────────

if (ARGS.backend === 'ruflo' && !ARGS.confirm) {
  console.error('benchmark-multiagent: --backend ruflo requires --confirm.');
  console.error('  Full sweep (100 runs × 5 tasks) costs ~$50-75 at Tier-3 rates.');
  console.error('  Pass --confirm to proceed, or use --backend mock for $0 smoke.');
  process.exit(2);
}

if (!['mock', 'ruflo'].includes(ARGS.backend)) {
  console.error(`benchmark-multiagent: --backend must be mock|ruflo (got: ${ARGS.backend})`);
  process.exit(2);
}

const selectedTasks = ARGS.tasks
  ? TASKS.filter(t => ARGS.tasks.includes(t.id))
  : TASKS;

if (selectedTasks.length === 0) {
  console.error(`benchmark-multiagent: --tasks ${ARGS.tasks?.join(',')} matched no tasks`);
  console.error(`  valid: ${TASKS.map(t => t.id).join(', ')}`);
  process.exit(2);
}

// ─── Deterministic seeded RNG (matches benchmark-intelligence pattern) ────

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

// ─── Backends ─────────────────────────────────────────────────────────────

/**
 * Mock backend — deterministic synthetic runner. No LLM calls.
 *
 * Uses each task's `mock.passRate` + jitter to produce a Bernoulli
 * pass/fail and lightly perturbed latency/tokens/cost figures so the
 * output looks like a real benchmark but costs $0 and runs in ms.
 *
 * Use case: CI smoke, pipeline shake-down, regression gate against
 * benchmark-infrastructure breakage.
 */
function runOneMock(task, rng) {
  const passed = rng() < task.mock.passRate;
  const jitter = (mean, frac = 0.15) => Math.max(0, mean * (1 + (rng() - 0.5) * 2 * frac));
  return {
    passed,
    latencyMs: Math.round(jitter(task.mock.avgLatencyMs)),
    tokens: Math.round(jitter(task.mock.avgTokens)),
    costUsd: Number(jitter(task.mock.avgCostUsd).toFixed(4)),
    failureReason: passed ? null : 'mock-bernoulli',
  };
}

/**
 * Ruflo backend — real CLI invocation. Spawns `node bin/cli.js task <T#>`
 * (would need a task-runner binding — for now, this is stubbed and will
 * exit 2 with a clear "not implemented" until the orchestration bridge is wired).
 *
 * This is the path to publishable numbers but requires:
 *   (a) a `ruflo bench-task <id>` subcommand that runs a single task end-to-end
 *   (b) cost tracking (which we already have via cost-tracker plugin)
 *   (c) explicit user --confirm because $50-75 per full sweep
 *
 * Tracked as follow-up — out of scope for the smoke-validation PR that
 * lands this script. Until wired, --backend ruflo prints a clear error
 * and exits 2 so CI can opt out cleanly.
 */
function runOneRuflo(_task, _rng) {
  console.error('benchmark-multiagent: --backend ruflo is not yet wired to a real');
  console.error('  task runner. The infrastructure (cost-tracker, hooks_route,');
  console.error('  swarm_init) exists but needs a `ruflo bench-task <id>` subcommand');
  console.error('  to drive it from this script. Tracked as a follow-up to ADR-163.');
  console.error('  For now, use --backend mock for the pipeline smoke.');
  process.exit(2);
}

const runOne = ARGS.backend === 'mock' ? runOneMock : runOneRuflo;

// ─── Main loop ────────────────────────────────────────────────────────────

function main() {
  const startedAt = new Date().toISOString();
  const rng = makeRng(ARGS.seed);

  const perTask = [];
  for (const task of selectedTasks) {
    const runs = [];
    for (let i = 0; i < ARGS.runs; i++) {
      runs.push(runOne(task, rng));
    }
    const passes = runs.filter(r => r.passed).length;
    const passRate = passes / runs.length;
    const avg = (key) => runs.reduce((s, r) => s + r[key], 0) / runs.length;

    perTask.push({
      task: task.id,
      title: task.title,
      type: task.type,
      runs: runs.length,
      passes,
      passRate,
      avgLatencyMs: Math.round(avg('latencyMs')),
      avgTokens: Math.round(avg('tokens')),
      avgCostUsd: Number(avg('costUsd').toFixed(4)),
      totalCostUsd: Number((avg('costUsd') * runs.length).toFixed(4)),
    });
  }

  const overall = {
    totalRuns: perTask.reduce((s, t) => s + t.runs, 0),
    totalPasses: perTask.reduce((s, t) => s + t.passes, 0),
    overallPassRate: perTask.reduce((s, t) => s + t.passes, 0) / perTask.reduce((s, t) => s + t.runs, 0),
    totalCostUsd: Number(perTask.reduce((s, t) => s + t.totalCostUsd, 0).toFixed(4)),
    avgLatencyMs: Math.round(perTask.reduce((s, t) => s + t.avgLatencyMs, 0) / perTask.length),
  };

  const report = {
    schemaVersion: 'ruflo.multiagent.v1',
    adr: 'ADR-163',
    backend: ARGS.backend,
    seed: ARGS.seed,
    runsPerTask: ARGS.runs,
    startedAt,
    finishedAt: new Date().toISOString(),
    perTask,
    overall,
    // ADR-163 §"Target": ≥65 % overall to beat LangGraph's 62 %
    targets: {
      langGraph: { passRate: 0.62, costPerTask: 0.08, source: 'Independent 2026 benchmark, Grade B' },
      autoGen: { passRate: 0.58, costPerTask: 0.10, source: 'Same' },
      crewAi: { passRate: 0.54, costPerTask: 0.12, source: 'Same' },
      rufloTarget: { passRate: 0.65 },
    },
    note: ARGS.backend === 'mock'
      ? 'MOCK backend — synthetic deterministic Bernoulli. No LLM calls. Use --backend ruflo --confirm for publishable numbers.'
      : 'REAL backend — values reflect actual measured runs.',
  };

  // Write artifact
  if (!fs.existsSync(ARGS.outDir)) fs.mkdirSync(ARGS.outDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, '-');
  const artifactPath = path.join(ARGS.outDir, `multiagent-${ARGS.backend}-${stamp}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify(report, null, 2));

  // Pretty-print
  if (!ARGS.jsonOnly) {
    console.log('');
    console.log(`## Multi-agent benchmark — ${ARGS.backend} backend, ${ARGS.runs} run(s)/task, seed ${ARGS.seed}`);
    console.log('');
    console.log('| Task | Title | Pass | Pass-rate | Latency | Tokens | Cost USD |');
    console.log('|------|-------|-----:|----------:|--------:|-------:|---------:|');
    for (const t of perTask) {
      console.log(`| ${t.task} | ${t.title} | ${t.passes}/${t.runs} | ${(t.passRate * 100).toFixed(1)}% | ${t.avgLatencyMs} ms | ${t.avgTokens} | $${t.avgCostUsd.toFixed(4)} |`);
    }
    console.log('');
    console.log(`**Overall pass-rate: ${(overall.overallPassRate * 100).toFixed(1)}%** | Total cost: $${overall.totalCostUsd} | Total runs: ${overall.totalRuns}`);
    console.log('');
    console.log('**Comparison vs published 2026 competitor numbers:**');
    console.log('| Framework | Pass-rate | Cost/Task | Source |');
    console.log('|---|---:|---:|---|');
    console.log(`| LangGraph | 62.0% | $0.08 | Independent 2026 benchmark, Grade B |`);
    console.log(`| AutoGen | 58.0% | ~$0.10 | Same |`);
    console.log(`| CrewAI | 54.0% | ~$0.12 | Same |`);
    const ourCost = perTask.length > 0 ? (overall.totalCostUsd / overall.totalRuns).toFixed(4) : 'n/a';
    console.log(`| **Ruflo (this run, ${ARGS.backend})** | **${(overall.overallPassRate * 100).toFixed(1)}%** | **$${ourCost}** | This run |`);
    console.log('');
    console.log(`Artifact: ${path.relative(REPO_ROOT, artifactPath)}`);
    if (ARGS.backend === 'mock') {
      console.log('');
      console.log('> ⚠️  MOCK backend — synthetic Bernoulli, NOT publishable.');
      console.log('> Run with --backend ruflo --runs 100 --confirm for publishable numbers (~$50-75).');
    }
  }

  console.log('');
  console.log('===BENCH_JSON===');
  console.log(JSON.stringify(report));

  if (ARGS.alertPassRateBelow !== null && overall.overallPassRate < ARGS.alertPassRateBelow) {
    process.exit(1);
  }
  process.exit(0);
}

try {
  main();
} catch (e) {
  console.error(`benchmark-multiagent: ${e?.message ?? e}`);
  process.exit(2);
}
