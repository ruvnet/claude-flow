#!/usr/bin/env node
// drift-from-history.mjs — iter 53 — one-command drift detection.
//
// Composes the existing pipeline into the workflow users actually want:
// "did my repo drift since the last audit?" Implementation:
//
//   1. List audit records from `metaharness-audit` memory namespace
//   2. Pick the most recent one (or filter --since Nd to skip recent ones
//      and use an older baseline)
//   3. Run a fresh oia-audit against the current repo state
//   4. Diff via audit-trend → structural distance + severity rollup
//   5. Alert if structural similarity falls below --threshold
//
// Until this iter, doing this required the user to:
//   $ npx ruflo metaharness audit-list --format json
//   $ # ... pick a key by hand from the listing
//   $ npx ruflo metaharness oia-audit --format json > /tmp/curr.json
//   $ npx ruflo metaharness audit-trend --baseline-key X --current-file /tmp/curr.json
// Now it's:
//   $ npx ruflo metaharness drift-from-history --threshold 0.95
//
// USAGE
//   node scripts/drift-from-history.mjs                       # default: last record vs now
//   node scripts/drift-from-history.mjs --baseline-since 7d   # use an audit ≥ 7d old
//   node scripts/drift-from-history.mjs --threshold 0.95      # alert under 0.95 similarity
//   node scripts/drift-from-history.mjs --format json
//   node scripts/drift-from-history.mjs --dry-run             # don't persist current
//
// EXIT CODES
//   0  ok (no drift below --threshold)
//   1  drift below --threshold (alert fired)
//   2  config / input error (no history available, etc.)
//   3  upstream metaharness absent — degraded payload returned

import { spawnSync, spawn } from 'node:child_process';
// iter 78 — share the iter-63 SEVERITY_RANK for the new finding-alert gate
import { rankSeverity } from './_harness.mjs';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const NS = process.env.METAHARNESS_AUDIT_NAMESPACE || 'metaharness-audit';
const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

const ARGS = (() => {
  const a = {
    path: '.', baselineSince: null, baselineKey: null, baselineFile: null,
    threshold: 0.95, dryRun: false, format: 'table',
    // iter 78 — opt-in finding-severity alert gate. Default null (off)
    // preserves iter-53 behavior; set to a severity name to ALSO alert
    // when any introduced finding meets or exceeds that severity.
    alertOnNewSeverity: null,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--path') a.path = process.argv[++i];
    else if (v === '--baseline-since') a.baselineSince = process.argv[++i];
    // iter 66 — explicit baseline-key skips the ONNX-heavy audit-list
    // call entirely. Cron jobs that know the key avoid the ~25s warmup.
    else if (v === '--baseline-key') a.baselineKey = process.argv[++i];
    // iter 67 — baseline-file goes further: no memory call at all.
    // Useful for CI workflows that store last-run audit as an artifact
    // and download it for diff against fresh audit.
    else if (v === '--baseline-file') a.baselineFile = process.argv[++i];
    else if (v === '--threshold') a.threshold = Number(process.argv[++i]);
    else if (v === '--dry-run') a.dryRun = true;
    else if (v === '--format') a.format = process.argv[++i];
    // iter 78 — orthogonal alert: any new finding ≥ this severity triggers
    else if (v === '--alert-on-new-severity') a.alertOnNewSeverity = String(process.argv[++i]).toLowerCase();
  }
  return a;
})();

function emitAndExit(payload, code) {
  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# drift-from-history\n`);
    if (payload.degraded) {
      console.log(`⊘ ${payload.reason}`);
    } else if (payload.error) {
      console.log(`✗ ${payload.error}`);
    } else {
      console.log(`Baseline:        ${payload.baseline?.key ?? payload.baseline?.startedAt}`);
      console.log(`Current:         ${payload.current?.startedAt ?? '(fresh)'}`);
      // iter 96 — surface the timing.path label so users see which
      // fast-path ran (or didn't) at a glance.
      if (payload.timing?.path) {
        const wallMs = payload.timing.parallelWallMs;
        console.log(`Path:            ${payload.timing.path} (wall ${wallMs}ms)`);
      }
      console.log('');
      const sd = payload.drift?.structuralDistance;
      if (sd && sd.verdict !== 'unavailable') {
        console.log(`Structural similarity: ${sd.overall} (${sd.verdict})`);
        console.log(`Distance:              ${sd.distance}`);
      }
      console.log('');
      if (payload.alert?.triggered) {
        console.log(`⚠ ALERT: ${payload.alert.reason}`);
      } else if (payload.alert) {
        console.log(`✓ ${payload.alert.reason}`);
      }
    }
  }
  process.exit(code);
}

function runScriptJson(script, args) {
  const r = spawnSync('node', [join(SCRIPTS_DIR, script), ...args, '--format', 'json'], {
    encoding: 'utf-8',
  });
  const m = /\{[\s\S]*\}/.exec(r.stdout || '');
  const json = m ? JSON.parse(m[0]) : null;
  // audit-list emits {records:[...]} — check that shape too
  const arrM = /\[[\s\S]*\]/.exec(r.stdout || '');
  return { json, exitCode: r.status ?? -1, stdout: r.stdout || '', stderr: r.stderr || '', arrMatch: arrM };
}

/**
 * iter 58 — async variant. Drift-from-history's audit-list (memory query)
 * and oia-audit (fresh subprocess chain) are mutually independent and
 * can race. This shaves ~2-5s off every drift check by overlapping the
 * subprocess wait time.
 */
function runScriptJsonAsync(script, args) {
  return new Promise((resolve) => {
    const p = spawn('node', [join(SCRIPTS_DIR, script), ...args, '--format', 'json'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    p.stdout?.on('data', (d) => { stdout += d.toString(); });
    p.stderr?.on('data', (d) => { stderr += d.toString(); });
    p.on('close', (code) => {
      const m = /\{[\s\S]*\}/.exec(stdout);
      let json = null;
      if (m) { try { json = JSON.parse(m[0]); } catch { /* leave null */ } }
      resolve({ json, exitCode: code ?? -1, stdout, stderr });
    });
    p.on('error', () => resolve({ json: null, exitCode: 127, stdout, stderr: 'spawn-failed' }));
  });
}

async function main() {
  // iter 58 — parallelize audit-list + oia-audit. They're mutually
  // independent (audit-list queries memory, oia-audit runs fresh
  // metaharness subprocesses) so racing them shaves ~2-5s off every
  // drift check. The audit-trend step still serializes after because
  // it consumes both prior outputs.
  const listArgs = ['--limit', '50'];
  if (ARGS.baselineSince) listArgs.push('--since', ARGS.baselineSince);
  const auditArgs = ['--path', ARGS.path];
  if (ARGS.dryRun) auditArgs.push('--dry-run');

  // iter 65 — measure parallel batch wall-clock so a future iter that
  // accidentally serializes (await audit-list; await oia-audit) doesn't
  // silently regress. timing.parallelSpeedup is surfaced in payload.
  // iter 66 — when --baseline-key is provided, skip audit-list entirely
  // (it's ~25s of ONNX warmup for what would be one record lookup).
  // Run oia-audit alone in that case.
  const parallelStart = Date.now();
  const listStart = Date.now();
  const auditStart = Date.now();
  let listResult;
  let auditResult;
  let skippedAuditList = false;
  let usedBaselineFile = false;
  if (ARGS.baselineFile) {
    // iter 67 fast-fast path — baseline already on disk. Skip
    // audit-list AND skip memory roundtrip when running audit-trend.
    skippedAuditList = true;
    usedBaselineFile = true;
    listResult = {
      json: { records: [{ key: `file:${ARGS.baselineFile}`, startedAt: null }] },
      exitCode: 0, stdout: '', stderr: '', durationMs: 0,
    };
    auditResult = await runScriptJsonAsync('oia-audit.mjs', auditArgs);
    auditResult.durationMs = Date.now() - auditStart;
  } else if (ARGS.baselineKey) {
    skippedAuditList = true;
    // Synthesize a list result containing the user-provided key.
    // No memory call needed — drift-from-history's downstream code
    // only reads the `key` field from the picked record.
    listResult = {
      json: { records: [{ key: ARGS.baselineKey, startedAt: null }] },
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 0,
    };
    auditResult = await runScriptJsonAsync('oia-audit.mjs', auditArgs);
    auditResult.durationMs = Date.now() - auditStart;
  } else {
    [listResult, auditResult] = await Promise.all([
      runScriptJsonAsync('audit-list.mjs', listArgs)
        .then((r) => ({ ...r, durationMs: Date.now() - listStart })),
      runScriptJsonAsync('oia-audit.mjs', auditArgs)
        .then((r) => ({ ...r, durationMs: Date.now() - auditStart })),
    ]);
  }
  const parallelWallMs = Date.now() - parallelStart;
  const parallelSumMs = (listResult.durationMs || 0) + (auditResult.durationMs || 0);

  if (listResult.exitCode !== 0) {
    emitAndExit({
      error: `audit-list failed (exit ${listResult.exitCode})`,
      stderrTail: listResult.stderr.slice(-200),
    }, 2);
  }
  const records = listResult.json?.records ?? listResult.json?.entries ?? [];
  if (records.length === 0) {
    // iter 57 + iter 58 — disambiguate "no history yet" (exit 2) from
    // "metaharness absent" (exit 3). Use the audit we already ran
    // (iter 58 fused the probe into the parallel batch) — no extra
    // subprocess needed.
    if (auditResult.json?.degraded === true) {
      emitAndExit({
        degraded: true,
        reason: auditResult.json.reason || 'metaharness-not-available',
        hint: 'Install metaharness to enable drift detection.',
      }, 3);
    }
    emitAndExit({
      error: 'no audit records found in namespace ' + NS,
      hint: 'Run `ruflo metaharness oia-audit` at least once to seed history.',
    }, 2);
  }
  // Pick the most recent record (records are typically newest-first; if not,
  // sort by startedAt). Each record's key is in the entry.
  const sorted = [...records].sort((a, b) =>
    String(b.startedAt ?? b.key ?? '').localeCompare(String(a.startedAt ?? a.key ?? '')));
  const baseline = sorted[0];
  if (!baseline?.key) {
    emitAndExit({
      error: 'audit record has no `key` field — cannot reference',
      sample: baseline,
    }, 2);
  }

  // Step 2: run fresh oia-audit (write to temp file so audit-trend can read it)
  const tmp = mkdtempSync(join(tmpdir(), 'drift-from-history-'));
  const currPath = join(tmp, 'current.json');
  try {
    // iter 58 — reuse auditResult from the parallel batch above instead
    // of re-running oia-audit. Saves the ~600ms-3s the second run took.
    if (!auditResult.json || auditResult.exitCode !== 0) {
      emitAndExit({
        error: `oia-audit failed (exit ${auditResult.exitCode})`,
        stderrTail: auditResult.stderr.slice(-200),
      }, 2);
    }
    if (auditResult.json.degraded === true) {
      emitAndExit({
        degraded: true,
        reason: auditResult.json.reason || 'metaharness-not-available',
      }, 3);
    }
    writeFileSync(currPath, JSON.stringify(auditResult.json));

    // Step 3: audit-trend
    // iter 67 — when --baseline-file was given, pass it through as
    // audit-trend's --baseline file input instead of --baseline-key.
    // Avoids the memory roundtrip on the trend leg too.
    const trendArgs = usedBaselineFile
      ? [
          '--baseline', ARGS.baselineFile,
          '--current', currPath,
          '--alert-on-distance-below', String(ARGS.threshold),
        ]
      : [
          '--baseline-key', baseline.key,
          '--current', currPath,
          '--alert-on-distance-below', String(ARGS.threshold),
        ];
    const trendResult = runScriptJson('audit-trend.mjs', trendArgs);
    if (!trendResult.json) {
      emitAndExit({
        error: `audit-trend produced no JSON (exit ${trendResult.exitCode})`,
        stderrTail: trendResult.stderr.slice(-200),
      }, 2);
    }
    const trend = trendResult.json;
    let alertTriggered = trendResult.exitCode === 1;
    const alertReasons = trend.alert?.reasons ? [...trend.alert.reasons] : [];

    // iter 78 — orthogonal finding-severity gate: any introduced
    // finding ≥ --alert-on-new-severity triggers regardless of
    // structural-distance threshold. Catches the "security regression
    // that didn't move the genome much" case.
    let elevatedFindings = [];
    if (ARGS.alertOnNewSeverity) {
      const threshold = rankSeverity(ARGS.alertOnNewSeverity);
      const introduced = trend?.delta?.findings?.introduced ?? [];
      elevatedFindings = introduced.filter((f) => rankSeverity(f.severity) >= threshold);
      if (elevatedFindings.length > 0) {
        alertTriggered = true;
        alertReasons.push(
          `${elevatedFindings.length} new finding(s) at or above ${ARGS.alertOnNewSeverity} severity`,
        );
      }
    }

    const payload = {
      adr: 'ADR-150 + ADR-152 §3.1',
      command: 'drift-from-history',
      // iter 65 — parallel batch metrics. parallelSpeedup>1 means
      // audit-list + oia-audit raced; ~1.0 means serial regression.
      timing: {
        parallelWallMs,
        parallelSumMs,
        parallelSpeedup: parallelSumMs > 0
          ? Math.round((parallelSumMs / Math.max(parallelWallMs, 1)) * 100) / 100
          : 0,
        // iter 66 — when true, audit-list was skipped via --baseline-key.
        // Fastpath drops wall-clock from ~26s to ~1s (avoids ONNX warmup).
        skippedAuditList,
        // iter 67 — when true, baseline came from a file instead of memory.
        // Skips audit-list AND the audit-trend memory roundtrip.
        usedBaselineFile,
        // iter 95 — derived path label for cleaner consumer code:
        //   'slow' — default (no fast-path arg); audit-list ran
        //   'key'  — --baseline-key skipped audit-list, baseline came from memory
        //   'file' — --baseline-file skipped audit-list AND memory roundtrip
        path: usedBaselineFile ? 'file' : (skippedAuditList ? 'key' : 'slow'),
      },
      baseline: {
        key: baseline.key,
        startedAt: baseline.startedAt ?? null,
      },
      current: {
        startedAt: auditResult.json.startedAt,
        composite: auditResult.json.composite,
      },
      drift: trend.delta,
      alert: {
        threshold: ARGS.threshold,
        // iter 78 — orthogonal gates surfaced: similarity threshold AND
        // new-finding-severity. Either can flip triggered=true.
        newSeverityThreshold: ARGS.alertOnNewSeverity,
        triggered: alertTriggered,
        reasons: alertReasons,
        // Keep .reason for backward-compat with consumers that read it as a string
        reason: alertReasons.length > 0
          ? alertReasons.join('; ')
          : (alertTriggered ? `similarity < ${ARGS.threshold}` : `similarity ≥ ${ARGS.threshold} — OK`),
        elevatedFindings,
      },
      generatedAt: new Date().toISOString(),
    };
    emitAndExit(payload, alertTriggered ? 1 : 0);
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error('drift-from-history crashed:', e.message || e);
  process.exit(2);
});
