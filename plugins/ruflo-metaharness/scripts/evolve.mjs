#!/usr/bin/env node
// evolve.mjs — wrapper around `metaharness-darwin evolve <repo>`.
//
// ADR-153: Darwin Mode is the WRITE layer that closes the loop ADR-150's
// READ layer (score / genome / mcp-scan / threat-model / oia-audit) opens.
// score+genome tell you where the harness IS; darwin evolve tells you which
// mutation makes it provably better, without retraining the foundation model.
//
// SAFETY (ADR-153 §"Safety model"):
//   - Variant generation + sandbox happen under <repo>/.metaharness/variants/,
//     never in the repo root. Upstream `inspectVariant()` rejects nested dirs,
//     symlinks, secret-shaped strings, shell-out / network / dynamic-eval
//     before any variant runs. Exit code 99 is reserved for "safety-disqualified".
//   - --confirm is REQUIRED. Without it the script prints a plan and exits 0
//     (mirrors mint.mjs convention). This is in addition to upstream's safety
//     layer — defense in depth at the ruflo boundary.
//   - Default --generations 3 --children 3 (small) — anything larger is opt-in.
//     Real evolutions are minutes-to-hours; ruflo's default sandbox config
//     errs toward "show me the mechanism works" over "find a winner today".
//
// USAGE
//   node scripts/evolve.mjs --repo .                                       # dry-run plan
//   node scripts/evolve.mjs --repo . --confirm                             # actually evolve
//   node scripts/evolve.mjs --repo . --confirm --generations 5 --children 3
//   node scripts/evolve.mjs --repo . --confirm --sandbox mock              # no real tests
//   node scripts/evolve.mjs --repo . --confirm --selection pareto
//   node scripts/evolve.mjs --repo . --confirm --diagnose                  # + GEPA failure diagnosis
//
// --diagnose (GEPA failure diagnosis — the natural-language-diagnosis trick
// from GEPA, scoped modestly): after the evolve run completes, the losing /
// failed variants' transcripts are run through darwin's gepa
// `analyzeTranscript` + `classifyFailure` ops and a `diagnosis` section
// (failure classes + counts + dominant class per variant) is appended to the
// emitted JSON report. UPSTREAM SHAPE NOTE (verified against darwin 0.8.0):
// `metaharness-darwin evolve --json` emits a TEXT leaderboard on stdout — no
// JSON, no transcripts. The per-variant run records live at
// `<repo>/.metaharness/runs/<id>.json` as sandbox exec traces
// ({taskId, exitCode, stdout, stderr}), which are NOT gepa {actionRaw, obs}
// transcripts. So the diagnosis layer (a) uses gepa-shaped transcripts when
// a run record embeds them (agent-sandbox / future upstream), (b) falls back
// to the champion's transcript, and (c) otherwise emits
// `diagnosis: {available: false, reason, traceSummary}` with a mechanical
// per-variant trace summary — it NEVER fails the run.
//
// EXIT CODES
//   0  evolved OK (or dry-run, or degraded — MetaHarness Darwin not available)
//   1  --alert-on-no-improvement and champion did not beat parent
//   2  config error or evolution failure
//   99 reserved — upstream "safety-disqualified" (propagated)

import { runDarwinAsync, emitDarwinDegradedJsonAndExit, importGepa } from './_darwin.mjs';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ARGS = (() => {
  const a = {
    repo: '.',
    generations: 3,
    children: 3,
    concurrency: 2,
    seed: null,
    sandbox: 'real',
    selection: null,
    crossover: false,
    epistasis: false,
    curriculum: false,
    riskBudget: null,
    fdr: null,
    tie: null,
    bench: null,
    mutator: 'deterministic',
    ruvllmUrl: null,
    ruvllmModel: null,
    confirm: false,
    alertOnNoImprovement: false,
    diagnose: false,
    format: 'json',
    timeoutMs: null,  // computed below if unset
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--repo') a.repo = process.argv[++i];
    else if (v === '--generations') a.generations = parseInt(process.argv[++i], 10);
    else if (v === '--children') a.children = parseInt(process.argv[++i], 10);
    else if (v === '--concurrency') a.concurrency = parseInt(process.argv[++i], 10);
    else if (v === '--seed') a.seed = parseInt(process.argv[++i], 10);
    else if (v === '--sandbox') a.sandbox = process.argv[++i];
    else if (v === '--selection') a.selection = process.argv[++i];
    else if (v === '--crossover') a.crossover = true;
    else if (v === '--epistasis') a.epistasis = true;
    else if (v === '--curriculum') a.curriculum = true;
    else if (v === '--risk-budget') a.riskBudget = parseInt(process.argv[++i], 10);
    else if (v === '--fdr') a.fdr = parseFloat(process.argv[++i]);
    else if (v === '--tie') a.tie = process.argv[++i];
    else if (v === '--bench') a.bench = process.argv[++i];
    else if (v === '--mutator') a.mutator = process.argv[++i];
    else if (v === '--ruvllm-url') a.ruvllmUrl = process.argv[++i];
    else if (v === '--ruvllm-model') a.ruvllmModel = process.argv[++i];
    else if (v === '--confirm') a.confirm = true;
    else if (v === '--alert-on-no-improvement') a.alertOnNoImprovement = true;
    else if (v === '--diagnose') a.diagnose = true;
    else if (v === '--format') a.format = process.argv[++i];
    else if (v === '--timeout-ms') a.timeoutMs = parseInt(process.argv[++i], 10);
  }
  return a;
})();

function safetyChecks() {
  const repoPath = resolve(ARGS.repo);
  if (!existsSync(repoPath)) {
    console.error(`evolve: repo path does not exist: ${repoPath}`);
    process.exit(2);
  }
  if (ARGS.generations < 1 || ARGS.generations > 50) {
    console.error('evolve: --generations must be 1..50 (ruflo cap; upstream supports more)');
    process.exit(2);
  }
  if (ARGS.children < 1 || ARGS.children > 20) {
    console.error('evolve: --children must be 1..20 (ruflo cap)');
    process.exit(2);
  }
  if (ARGS.concurrency < 1 || ARGS.concurrency > 8) {
    console.error('evolve: --concurrency must be 1..8 (ruflo cap)');
    process.exit(2);
  }
  if (!['real', 'mock', 'agent'].includes(ARGS.sandbox)) {
    console.error(`evolve: --sandbox must be real|mock|agent (got: ${ARGS.sandbox})`);
    process.exit(2);
  }
  if (ARGS.selection && !['quality-diversity', 'behavioral-diversity', 'niche-steering', 'clade', 'pareto'].includes(ARGS.selection)) {
    console.error(`evolve: --selection must be one of quality-diversity|behavioral-diversity|niche-steering|clade|pareto`);
    process.exit(2);
  }
  if (!['deterministic', 'ruvllm'].includes(ARGS.mutator)) {
    console.error(`evolve: --mutator must be deterministic|ruvllm`);
    process.exit(2);
  }
  return repoPath;
}

// ---------------------------------------------------------------------------
// --diagnose support (GEPA failure diagnosis)
// ---------------------------------------------------------------------------

/** True when `arr` looks like a gepa transcript: [{actionRaw?, obs?}, ...]. */
function looksLikeGepaTranscript(arr) {
  return Array.isArray(arr) && arr.length > 0 &&
    arr.every((e) => e && typeof e === 'object' && ('actionRaw' in e || 'obs' in e));
}

/**
 * Pull every gepa-shaped transcript out of one run record. Upstream darwin
 * 0.8.0 run records carry sandbox exec traces (NOT gepa transcripts), but a
 * record MAY embed `transcript` arrays (agent sandbox / future upstream) —
 * accept `record.transcript`, `record.traces[i].transcript`, or `traces`
 * itself when its entries are {actionRaw, obs}-shaped.
 */
function extractGepaTranscripts(record) {
  const out = [];
  if (looksLikeGepaTranscript(record?.transcript)) {
    out.push({ taskId: null, exitCode: null, entries: record.transcript });
  }
  const traces = Array.isArray(record?.traces) ? record.traces : [];
  if (looksLikeGepaTranscript(traces)) {
    out.push({ taskId: null, exitCode: null, entries: traces });
  } else {
    for (const t of traces) {
      if (looksLikeGepaTranscript(t?.transcript)) {
        out.push({ taskId: t.taskId ?? null, exitCode: t.exitCode ?? null, entries: t.transcript });
      }
    }
  }
  return out;
}

/** Mechanical per-variant summary of sandbox exec traces (the always-available fallback signal). */
function summarizeTraces(record) {
  const traces = Array.isArray(record?.traces) ? record.traces : [];
  return {
    tasks: traces.length,
    failed: traces.filter((t) => t?.exitCode !== 0).length,
    timedOut: traces.filter((t) => t?.timedOut === true).length,
    blockedActions: traces.reduce((n, t) => n + (Array.isArray(t?.blockedActions) ? t.blockedActions.length : 0), 0),
  };
}

/**
 * Build the `diagnosis` section for the emitted report. Never throws and
 * never affects the run's exit code — any internal failure degrades to
 * `{available: false, reason}`.
 */
async function buildDiagnosis(repoPath) {
  try {
    const metaDir = join(repoPath, '.metaharness');
    const runsDir = join(metaDir, 'runs');
    if (!existsSync(runsDir)) {
      return { available: false, reason: 'no-run-records: <repo>/.metaharness/runs does not exist' };
    }
    let winnerId = null;
    try {
      winnerId = JSON.parse(readFileSync(join(metaDir, 'reports', 'winner.json'), 'utf-8'))?.variant?.id ?? null;
    } catch { /* winner unknown — treat all variants as candidates */ }

    const records = [];
    for (const f of readdirSync(runsDir).filter((f) => f.endsWith('.json')).slice(0, 100)) {
      try {
        records.push({ id: f.replace(/\.json$/, ''), rec: JSON.parse(readFileSync(join(runsDir, f), 'utf-8')) });
      } catch { /* skip unreadable record */ }
    }
    if (records.length === 0) {
      return { available: false, reason: 'no-run-records: <repo>/.metaharness/runs contains no parseable records' };
    }

    // Losing/failed variants are the primary diagnosis targets; the champion
    // is the fallback when no loser exposes a transcript.
    const losers = records.filter((r) =>
      r.id !== winnerId &&
      (r.rec?.score?.promoted === false ||
       (Array.isArray(r.rec?.traces) && r.rec.traces.some((t) => t?.exitCode !== 0 || t?.timedOut))));
    const champion = records.filter((r) => r.id === winnerId);

    let scope = 'losing-variants';
    let pool = losers.map((r) => ({ ...r, transcripts: extractGepaTranscripts(r.rec) }))
      .filter((r) => r.transcripts.length > 0);
    if (pool.length === 0) {
      scope = 'champion-fallback';
      pool = champion.map((r) => ({ ...r, transcripts: extractGepaTranscripts(r.rec) }))
        .filter((r) => r.transcripts.length > 0);
    }

    if (pool.length === 0) {
      // Verified upstream shape (darwin 0.8.0): run records are sandbox exec
      // traces, not gepa transcripts. Emit the mechanical trace summary so
      // --diagnose still yields signal.
      const target = losers.length ? losers : records;
      return {
        available: false,
        reason: 'no-gepa-transcripts: run records contain sandbox exec traces ({taskId, exitCode, stdout, stderr}), not gepa {actionRaw, obs} transcripts',
        traceSummary: Object.fromEntries(target.map((r) => [r.id, summarizeTraces(r.rec)])),
      };
    }

    const gepa = await importGepa();
    if (!gepa || typeof gepa.analyzeTranscript !== 'function') {
      return { available: false, reason: 'metaharness-darwin-gepa-not-available' };
    }

    const classLabel = (n) => {
      const raw = gepa.FAILURE_CLASSES?.[n];
      return raw ? String(raw).split(' (')[0] : `class-${n}`;
    };

    const totals = {};
    const variants = [];
    for (const r of pool) {
      const classes = {};
      for (const t of r.transcripts) {
        const analysis = gepa.analyzeTranscript(t.entries);
        const cls = typeof gepa.classifyFailure === 'function'
          ? gepa.classifyFailure({ goldResolved: t.exitCode === 0, analysis })
          : -1;
        const label = classLabel(cls);
        classes[label] = (classes[label] || 0) + 1;
        totals[label] = (totals[label] || 0) + 1;
      }
      const dominantClass = Object.entries(classes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      variants.push({ id: r.id, transcripts: r.transcripts.length, failureClasses: classes, dominantClass });
    }

    return { available: true, scope, variants, totals };
  } catch (e) {
    return { available: false, reason: `diagnosis-failed: ${e?.message ?? e}` };
  }
}

// Compute a sensible timeout from the search shape if caller didn't specify.
// Rough budget: each variant ~= 30s (sandbox test command + safety inspect),
// total ~= generations × children × per-variant / concurrency.
function defaultTimeoutMs() {
  const perVariantMs = ARGS.sandbox === 'mock' ? 2_000 : 60_000;
  const variants = ARGS.generations * ARGS.children;
  const parallelism = Math.min(ARGS.concurrency, variants);
  const wall = Math.ceil(variants / parallelism) * perVariantMs;
  // Add 30s overhead for npm install + initial profile + final report.
  return Math.max(60_000, wall + 30_000);
}

async function main() {
  const repoPath = safetyChecks();

  const plan = {
    binary: 'metaharness-darwin evolve',
    repo: repoPath,
    generations: ARGS.generations,
    children: ARGS.children,
    concurrency: ARGS.concurrency,
    sandbox: ARGS.sandbox,
    selection: ARGS.selection,
    crossover: ARGS.crossover,
    epistasis: ARGS.epistasis,
    curriculum: ARGS.curriculum,
    mutator: ARGS.mutator,
    diagnose: ARGS.diagnose,
    estVariants: ARGS.generations * ARGS.children,
    timeoutMs: ARGS.timeoutMs ?? defaultTimeoutMs(),
    output: `${repoPath}/.metaharness/{archive.json, lineage.json, variants/, runs/, reports/winner.json}`,
  };

  if (!ARGS.confirm) {
    const payload = {
      success: true,
      data: { plan, dryRun: true, message: 'Pass --confirm to run the evolution.' },
      generatedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  }

  const cliArgs = ['evolve', repoPath,
    '--generations', String(ARGS.generations),
    '--children', String(ARGS.children),
    '--concurrency', String(ARGS.concurrency),
    '--sandbox', ARGS.sandbox,
    '--mutator', ARGS.mutator,
  ];
  if (ARGS.seed != null) cliArgs.push('--seed', String(ARGS.seed));
  if (ARGS.selection) cliArgs.push('--selection', ARGS.selection);
  if (ARGS.crossover) cliArgs.push('--crossover');
  if (ARGS.epistasis) cliArgs.push('--epistasis');
  if (ARGS.curriculum) cliArgs.push('--curriculum');
  if (ARGS.riskBudget != null) cliArgs.push('--risk-budget', String(ARGS.riskBudget));
  if (ARGS.fdr != null) cliArgs.push('--fdr', String(ARGS.fdr));
  if (ARGS.tie) cliArgs.push('--tie', ARGS.tie);
  if (ARGS.bench) cliArgs.push('--bench', ARGS.bench);
  if (ARGS.ruvllmUrl) cliArgs.push('--ruvllm-url', ARGS.ruvllmUrl);
  if (ARGS.ruvllmModel) cliArgs.push('--ruvllm-model', ARGS.ruvllmModel);

  // Forward progress lines to stderr so the user sees per-generation activity
  // (subprocess-of-an-MCP-tool case: this still surfaces in the agent log).
  const r = await runDarwinAsync(cliArgs, {
    timeoutMs: plan.timeoutMs,
    onProgress: (line) => { if (line.trim()) process.stderr.write(`[evolve] ${line}\n`); },
  });

  if (r.degraded) {
    emitDarwinDegradedJsonAndExit(r.reason);
    return;
  }

  // Upstream exit code 99 = safety-disqualified — propagate verbatim so
  // CI gates can distinguish "evolution failed" from "evolution surfaced
  // a safety-tripping mutation". This is a designed-in tripwire, not an
  // error the ruflo layer should remap.
  if (r.exitCode === 99) {
    const payload = {
      success: false,
      data: { safetyDisqualified: true, hint: 'A variant tripped the safety inspection layer. See <repo>/.metaharness/runs/ for which surface and pattern.' },
      stderrTail: r.stderr.slice(-400),
      durationMs: r.durationMs,
      generatedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(99);
  }

  if (r.exitCode !== 0) {
    const payload = {
      success: false,
      data: { exitCode: r.exitCode, stderrTail: r.stderr.slice(-400) },
      generatedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(2);
  }

  const champion = r.json || {};
  const noImprovement = champion.parentScore != null && champion.championScore != null &&
                        champion.championScore <= champion.parentScore;

  const payload = {
    success: true,
    data: {
      ...champion,
      plan,
      durationMs: r.durationMs,
      improved: !noImprovement,
    },
    generatedAt: new Date().toISOString(),
  };

  // GEPA failure diagnosis — opt-in, additive, never fails the run.
  if (ARGS.diagnose) {
    payload.data.diagnosis = await buildDiagnosis(repoPath);
  }

  console.log(JSON.stringify(payload, null, 2));
  if (ARGS.alertOnNoImprovement && noImprovement) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(`evolve: unexpected failure: ${e?.message ?? e}`);
  process.exit(2);
});
