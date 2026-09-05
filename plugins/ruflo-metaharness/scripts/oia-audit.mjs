#!/usr/bin/env node
// oia-audit.mjs — composite Phase-2 worker (ADR-150).
//
// Bundles three MetaHarness static-analysis surfaces into one timestamped
// audit record:
//   - harness oia-manifest   (Open Infrastructure Architecture L1-L9 alignment)
//   - harness threat-model   (categorized MCP-surface threat report)
//   - harness mcp-scan       (per-server/tool policy + permissions + deps)
//
// The combined record is stored in the `metaharness-audit` memory
// namespace, keyed by ISO timestamp. Designed to be invoked on a cron
// schedule (e.g. weekly) so audit drift is visible over time.
//
// USAGE
//   node scripts/oia-audit.mjs                      # run + store
//   node scripts/oia-audit.mjs --path <dir>         # audit specific dir
//   node scripts/oia-audit.mjs --dry-run            # don't write to memory
//   node scripts/oia-audit.mjs --alert-on-worst high
//                                                  # exit 1 if threat-model worst >= high
//   node scripts/oia-audit.mjs --format json
//
// EXIT CODES
//   0  audit OK (or degraded)
//   1  --alert-on-worst threshold exceeded
//   2  config error or audit failure

import { spawnSync } from 'node:child_process';
// iter 63 — SEVERITY_RANK + rankSeverity consolidated to _harness.mjs
// (was local in iter 62; now shared with audit-trend + mcp-scan).
import { runHarness, runMetaharness, runHarnessAsync, runMetaharnessAsync, emitDegradedJsonAndExit, parseMcpScanText, SEVERITY_RANK, rankSeverity } from './_harness.mjs';

// iter 63 — SEVERITY_RANK + rankSeverity moved to _harness.mjs (single
// source of truth). The local copy from iter 62 is gone; the imports
// at the top of this file provide the same names.
const NS = process.env.OIA_AUDIT_NAMESPACE || 'metaharness-audit';
const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

const ARGS = (() => {
  const a = { path: '.', format: 'json', dryRun: false, alertWorst: null };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--path') a.path = process.argv[++i];
    else if (v === '--dry-run') a.dryRun = true;
    else if (v === '--alert-on-worst') a.alertWorst = String(process.argv[++i] || '').toLowerCase();
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

// iter 47 — the `harness` and `metaharness` CLIs both have `score` /
// `genome` subcommands but with DIFFERENT output schemas. For the
// fingerprint to be consumable by _similarity.mjs (which expects the
// metaharness CLI shape: harnessFit/compileConfidence/agent_topology),
// we need to dispatch to runMetaharness for score+genome, not runHarness.
// iter 56 — annotated runOne result is identical for sync/async paths.
function annotateOne(r, label) {
  let json = r.json;
  if (label === 'mcp-scan' && !json && !r.degraded && r.stdout) {
    const parsed = parseMcpScanText(r.stdout);
    json = { findings: parsed.findings, summary: parsed.summary, rawStdout: r.stdout.slice(0, 400) };
  }
  return {
    label,
    exitCode: r.exitCode,
    degraded: r.degraded,
    reason: r.degraded ? r.reason : null,
    json,
    durationMs: r.durationMs,
    stderrTail: r.degraded ? (r.stderr || '').slice(-200) : null,
  };
}

function runOne(args, label, engine = 'harness') {
  const r = engine === 'metaharness' ? runMetaharness(args) : runHarness(args);
  return annotateOne(r, label);
}

// iter 56 — parallel variant. The composite audit's 5 subprocess calls
// are mutually independent (each scans the same path read-only), so
// they can run concurrently. Worst-case wall-clock drops from
// 5×DEFAULT_TIMEOUT_MS (sequential) to 1×DEFAULT_TIMEOUT_MS (parallel)
// — the iter-55-flagged gap (oia-audit timeout under unreachable
// registry) is closed by this.
async function runAllParallel(path) {
  const tasks = [
    runHarnessAsync(['oia-manifest', path]).then((r) => ['oiaManifest', annotateOne(r, 'oia-manifest')]),
    runHarnessAsync(['threat-model', path]).then((r) => ['threatModel', annotateOne(r, 'threat-model')]),
    runHarnessAsync(['mcp-scan', path]).then((r) => ['mcpScan', annotateOne(r, 'mcp-scan')]),
    runMetaharnessAsync(['score', path]).then((r) => ['score', annotateOne(r, 'score')]),
    runMetaharnessAsync(['genome', path]).then((r) => ['genome', annotateOne(r, 'genome')]),
  ];
  const results = await Promise.all(tasks);
  return Object.fromEntries(results);
}

function persist(payload) {
  const key = `audit-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'store',
    '--namespace', NS,
    '--key', key,
    '--value', JSON.stringify(payload),
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  return {
    ok: r.status === 0,
    namespace: NS,
    key,
    error: r.status === 0 ? null : (r.stderr || '').slice(0, 200),
  };
}

async function main() {
  if (ARGS.alertWorst !== null && !SEVERITY_RANK.hasOwnProperty(ARGS.alertWorst)) {
    console.error(`oia-audit: --alert-on-worst must be one of clean|low|medium|high; got ${ARGS.alertWorst}`);
    process.exit(2);
  }

  const startedAt = new Date().toISOString();
  const wallStart = Date.now();
  // iter 56 — run the 5 sub-audits in parallel (was sequential pre-iter-56).
  // Worst-case wall-clock improves from 5×TIMEOUT to 1×TIMEOUT in the
  // unreachable-registry case; the happy path improves from sum-of-durations
  // to max-of-durations (typically ~2-4× faster).
  const all = await runAllParallel(ARGS.path);
  const wallMs = Date.now() - wallStart;
  const { oiaManifest: oia, threatModel: tm, mcpScan: mcp, score, genome } = all;

  // If all FIVE say "metaharness not available", surface the degraded
  // payload exactly once and exit 0 (architectural constraint #3).
  if (oia.degraded && tm.degraded && mcp.degraded && score.degraded && genome.degraded) {
    emitDegradedJsonAndExit('metaharness-not-available');
    return;
  }

  // Aggregate the worst-severity signal across mcp-scan + threat-model.
  // iter 62 — safe lookup using `?? 0` so unknown severities don't
  // silently bump composite via NaN-comparison (was: `acc | undefined`
  // → reduce never updated). Now any [WARN]/[CRITICAL]/[ERROR] finding
  // correctly elevates composite worst.
  const tmWorst = String(tm.json?.worst || 'clean').toLowerCase();
  const mcpFindings = Array.isArray(mcp.json?.findings) ? mcp.json.findings : [];
  // iter 63 — rankSeverity() from _harness.mjs handles unknown-severity
  // safely (returns 0 instead of undefined) so the reduce never sees NaN.
  const mcpWorst = mcpFindings.reduce((acc, f) => {
    const s = String(f.severity || 'low').toLowerCase();
    return rankSeverity(s) > rankSeverity(acc) ? s : acc;
  }, 'clean');
  const compositeWorst = rankSeverity(tmWorst) > rankSeverity(mcpWorst) ? tmWorst : mcpWorst;

  let alertTriggered = false;
  let alertReason = null;
  if (ARGS.alertWorst !== null) {
    const threshold = rankSeverity(ARGS.alertWorst);
    const compositeRank = rankSeverity(compositeWorst);
    if (compositeRank >= threshold && threshold > 0) {
      alertTriggered = true;
      alertReason = `composite worst=${compositeWorst} ≥ ${ARGS.alertWorst}`;
    }
  }

  // iter 59 — surface parallelization metrics. wallMs is the actual
  // time the 5 subprocess race took (max of components); the sum of
  // component.durationMs is what a SERIAL implementation would have
  // taken. A future smoke gate compares them to catch silent
  // serialization regression.
  const sumComponentMs = Object.values(all).reduce(
    (a, c) => a + (c?.durationMs ?? 0), 0);
  const payload = {
    path: ARGS.path,
    startedAt,
    finishedAt: new Date().toISOString(),
    timing: {
      wallMs,
      sumComponentMs,
      parallelSpeedup: sumComponentMs > 0
        ? Math.round((sumComponentMs / Math.max(wallMs, 1)) * 100) / 100 : 0,
    },
    composite: { worst: compositeWorst, threatModelWorst: tmWorst, mcpScanWorst: mcpWorst },
    components: { oiaManifest: oia, threatModel: tm, mcpScan: mcp, score, genome },
    // iter 38 — denormalized harness fingerprint for cheap similarity().
    // Mirrors the shape `_similarity.mjs::similarity()` expects so
    // audit-trend can call it without reshuffling components.
    fingerprint: {
      score: score?.json && !score.degraded ? score.json : null,
      genome: genome?.json && !genome.degraded ? genome.json : null,
    },
    alert: ARGS.alertWorst !== null ? {
      threshold: ARGS.alertWorst,
      triggered: alertTriggered,
      reason: alertReason || `composite worst=${compositeWorst} < ${ARGS.alertWorst} — OK`,
    } : null,
    persisted: null,
  };

  if (!ARGS.dryRun) {
    payload.persisted = persist(payload);
  }

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# oia-audit — ${ARGS.path}`);
    console.log('');
    console.log(`| Component | Exit | Degraded | Duration |`);
    console.log(`|---|---:|:---:|---:|`);
    console.log(`| oia-manifest | ${oia.exitCode} | ${oia.degraded ? '⚠' : '✓'} | ${oia.durationMs}ms |`);
    console.log(`| threat-model | ${tm.exitCode} | ${tm.degraded ? '⚠' : '✓'} | ${tm.durationMs}ms |`);
    console.log(`| mcp-scan | ${mcp.exitCode} | ${mcp.degraded ? '⚠' : '✓'} | ${mcp.durationMs}ms |`);
    console.log('');
    console.log(`Composite worst severity: **${compositeWorst}** (tm=${tmWorst}, mcp=${mcpWorst})`);
    if (payload.persisted) {
      console.log(`Persisted: ${payload.persisted.ok ? `${payload.persisted.namespace}:${payload.persisted.key}` : `FAILED: ${payload.persisted.error}`}`);
    }
    if (payload.alert) {
      console.log('');
      console.log(payload.alert.triggered ? `⚠ **ALERT**: ${payload.alert.reason}` : `✓ ${payload.alert.reason}`);
    }
  }

  if (alertTriggered) process.exit(1);
}

main().catch((e) => {
  console.error('oia-audit crashed:', e?.message ?? e);
  process.exit(2);
});
