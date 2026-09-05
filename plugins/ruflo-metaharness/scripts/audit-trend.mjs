#!/usr/bin/env node
// audit-trend.mjs — diff two oia-audit records to detect drift over time.
//
// The iter-7 oia-audit composite worker stores timestamped records under
// the `metaharness-audit` memory namespace. This script reads two such
// records and surfaces the delta:
//   - composite worst severity change (clean → low, low → medium, etc.)
//   - per-component (oia / threat-model / mcp-scan) status change
//   - new HIGH-severity findings introduced
//   - findings cleared
//
// Pairs with iter-7's oia-audit + iter-8's weekly cron — accumulated
// records enable drift detection without ad-hoc tooling.
//
// USAGE
//   node scripts/audit-trend.mjs --baseline audit-<ts1>.json --current audit-<ts2>.json
//   node scripts/audit-trend.mjs --baseline-key audit-2026-06-01... --current-key audit-2026-06-15...
//     # pulls both from memory namespace `metaharness-audit`
//   node scripts/audit-trend.mjs ... --alert-on-worsening
//   node scripts/audit-trend.mjs ... --format json
//
// EXIT CODES
//   0  ok (no worsening, or --alert-on-worsening not set)
//   1  --alert-on-worsening AND composite severity worsened
//   2  config error or input not found

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// iter 38 — structural-distance drift via ADR-152 §3.1 production module.
// Falls back to null if either record predates iter-38 oia-audit (no
// fingerprint field) — graceful degradation, never throws.
import { similarity } from './_similarity.mjs';
// iter 63 — shared SEVERITY_RANK from _harness.mjs (was a local literal
// missing info/warn/error/critical, which caused NaN-compare hazards).
import { SEVERITY_RANK, rankSeverity } from './_harness.mjs';

// iter 63 — SEVERITY_RANK moved to _harness.mjs (imported above)
const NS = process.env.AUDIT_TREND_NAMESPACE || 'metaharness-audit';
const CLI_PKG = process.env.CLI_CORE === '1'
  ? '@claude-flow/cli-core@alpha'
  : '@claude-flow/cli@latest';

const ARGS = (() => {
  const a = {
    baseline: null, current: null,
    baselineKey: null, currentKey: null,
    alertOnWorsening: false, format: 'table',
    // iter 38 — structural-distance gate (ADR-152 §3.1 dep)
    alertOnDistanceBelow: null,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--baseline') a.baseline = process.argv[++i];
    else if (v === '--current') a.current = process.argv[++i];
    else if (v === '--baseline-key') a.baselineKey = process.argv[++i];
    else if (v === '--current-key') a.currentKey = process.argv[++i];
    else if (v === '--alert-on-worsening') a.alertOnWorsening = true;
    else if (v === '--alert-on-distance-below') a.alertOnDistanceBelow = Number(process.argv[++i]);
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function memRetrieve(key) {
  const r = spawnSync('npx', [
    CLI_PKG, 'memory', 'retrieve',
    '--namespace', NS, '--key', key,
  ], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) return null;
  const m = /\{[\s\S]*\}/.exec(r.stdout || '');
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function loadRecord(label, filePath, memKey) {
  if (filePath) {
    if (!existsSync(filePath)) {
      console.error(`audit-trend: ${label} file not found: ${filePath}`);
      process.exit(2);
    }
    try { return JSON.parse(readFileSync(filePath, 'utf-8')); }
    catch (e) {
      console.error(`audit-trend: ${label} file invalid JSON: ${e.message}`);
      process.exit(2);
    }
  }
  if (memKey) {
    const rec = memRetrieve(memKey);
    if (!rec) {
      console.error(`audit-trend: ${label} key not found in namespace ${NS}: ${memKey}`);
      process.exit(2);
    }
    return rec;
  }
  console.error(`audit-trend: --${label} or --${label}-key is required`);
  process.exit(2);
}

function main() {
  const baseline = loadRecord('baseline', ARGS.baseline, ARGS.baselineKey);
  const current  = loadRecord('current',  ARGS.current,  ARGS.currentKey);

  // Sanity: both must look like oia-audit records (composite + components).
  if (!baseline.composite || !current.composite) {
    console.error('audit-trend: snapshots must contain `composite` (from oia-audit.mjs)');
    process.exit(2);
  }

  const baseWorst = String(baseline.composite.worst || 'clean').toLowerCase();
  const currWorst = String(current.composite.worst || 'clean').toLowerCase();
  // iter 63 — safe rankSeverity() eliminates NaN-compare when either
  // severity is unknown (was a latent bug in audit-trend's drift verdict).
  const deltaRank = rankSeverity(currWorst) - rankSeverity(baseWorst);
  const worsened = deltaRank > 0;
  const improved = deltaRank < 0;

  // Per-component status change. Each `components.{oiaManifest, threatModel,
  // mcpScan}` has degraded:bool + exitCode + (for threat-model) json.worst.
  const componentDelta = (label, b, c) => {
    if (!b || !c) return { label, delta: 'missing' };
    if (b.degraded !== c.degraded) {
      return { label, delta: c.degraded ? 'became degraded' : 'recovered from degraded' };
    }
    if (b.exitCode !== c.exitCode) {
      return { label, delta: `exit code ${b.exitCode} → ${c.exitCode}` };
    }
    return { label, delta: 'unchanged' };
  };
  const components = {
    oiaManifest: componentDelta('oia-manifest', baseline.components?.oiaManifest, current.components?.oiaManifest),
    threatModel: componentDelta('threat-model', baseline.components?.threatModel, current.components?.threatModel),
    mcpScan: componentDelta('mcp-scan', baseline.components?.mcpScan, current.components?.mcpScan),
  };

  // mcp-scan findings — what was introduced vs cleared.
  const baseFindings = Array.isArray(baseline.components?.mcpScan?.json?.findings)
    ? baseline.components.mcpScan.json.findings : [];
  const currFindings = Array.isArray(current.components?.mcpScan?.json?.findings)
    ? current.components.mcpScan.json.findings : [];
  const fingerprint = (f) => `${f.severity}:${f.id ?? '-'}:${f.server ?? '-'}:${f.tool ?? '-'}:${(f.message ?? '').slice(0, 80)}`;
  const baseSet = new Set(baseFindings.map(fingerprint));
  const currSet = new Set(currFindings.map(fingerprint));
  const introduced = currFindings.filter((f) => !baseSet.has(fingerprint(f)));
  const cleared    = baseFindings.filter((f) => !currSet.has(fingerprint(f)));

  // iter 38 — structural distance via ADR-152 §3.1 similarity().
  // Both records need a fingerprint (score+genome) — iter-38 oia-audit
  // adds it; older records skip with verdict 'unavailable'.
  let structuralDistance = null;
  if (baseline.fingerprint?.score && baseline.fingerprint?.genome
      && current.fingerprint?.score && current.fingerprint?.genome) {
    const sim = similarity(baseline.fingerprint, current.fingerprint);
    structuralDistance = {
      overall: sim.overall,
      // Distance is the complement of similarity in [0,1]
      distance: Number((1 - sim.overall).toFixed(4)),
      components: sim.components,
      verdict: sim.overall >= 0.95 ? 'near-identical'
        : sim.overall >= 0.80 ? 'minor-drift'
        : sim.overall >= 0.50 ? 'moderate-drift'
        : 'major-drift',
    };
  } else {
    structuralDistance = {
      verdict: 'unavailable',
      reason: 'one or both records predate iter-38 oia-audit fingerprint bundling',
    };
  }

  // Distance alert is independent of severity worsening — a harness can
  // structurally drift while keeping the same worst-severity verdict.
  const distanceAlertTriggered = ARGS.alertOnDistanceBelow != null
    && structuralDistance.overall != null
    && structuralDistance.overall < ARGS.alertOnDistanceBelow;

  const payload = {
    baseline: {
      startedAt: baseline.startedAt,
      composite: baseline.composite,
    },
    current: {
      startedAt: current.startedAt,
      composite: current.composite,
    },
    delta: {
      worst: { baseline: baseWorst, current: currWorst, rankDelta: deltaRank,
        verdict: worsened ? 'worsened' : (improved ? 'improved' : 'unchanged') },
      components,
      findings: {
        introducedCount: introduced.length,
        clearedCount: cleared.length,
        introduced: introduced.slice(0, 20),  // truncate for output sanity
        cleared: cleared.slice(0, 20),
      },
      // iter 38 — structural distance via ADR-152 §3.1
      structuralDistance,
    },
    alert: (ARGS.alertOnWorsening || ARGS.alertOnDistanceBelow != null) ? {
      triggered: worsened || distanceAlertTriggered,
      reasons: [
        ARGS.alertOnWorsening && worsened
          ? `composite worst ${baseWorst} → ${currWorst}` : null,
        distanceAlertTriggered
          ? `structural similarity ${structuralDistance.overall} < threshold ${ARGS.alertOnDistanceBelow}` : null,
      ].filter(Boolean),
    } : null,
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`# audit-trend`);
    console.log('');
    console.log(`Baseline: ${baseline.startedAt}`);
    console.log(`Current:  ${current.startedAt}`);
    console.log('');
    console.log(`| Metric | Baseline | Current | Verdict |`);
    console.log(`|---|---|---|---|`);
    const verdictIcon = worsened ? '⚠ worsened' : (improved ? '✓ improved' : '— unchanged');
    console.log(`| composite worst | ${baseWorst} | ${currWorst} | ${verdictIcon} |`);
    for (const [label, c] of Object.entries(components)) {
      console.log(`| ${label} | — | — | ${c.delta} |`);
    }
    console.log('');
    console.log(`Findings: **+${introduced.length} introduced**, **−${cleared.length} cleared**`);
    if (introduced.length > 0) {
      console.log('');
      console.log('## Introduced findings');
      console.log('');
      console.log('| Severity | Server | Tool | Message |');
      console.log('|---|---|---|---|');
      for (const f of introduced.slice(0, 20)) {
        console.log(`| ${f.severity ?? '-'} | ${f.server ?? '-'} | ${f.tool ?? '-'} | ${(f.message ?? '').slice(0, 80)} |`);
      }
    }
    if (cleared.length > 0) {
      console.log('');
      console.log('## Cleared findings');
      console.log('');
      for (const f of cleared.slice(0, 5)) {
        console.log(`- ${f.severity ?? '-'} ${f.id ?? '-'} (${f.server ?? '-'}/${f.tool ?? '-'})`);
      }
    }
    console.log('');
    // iter 38 — structural distance row
    if (structuralDistance.verdict !== 'unavailable') {
      console.log(`## Structural distance (ADR-152 §3.1)`);
      console.log('');
      console.log(`| Metric | Value |`);
      console.log(`|---|---:|`);
      console.log(`| overall similarity | ${structuralDistance.overall.toFixed(4)} |`);
      console.log(`| distance (1 − sim) | ${structuralDistance.distance.toFixed(4)} |`);
      console.log(`| verdict | **${structuralDistance.verdict}** |`);
      console.log('');
    } else {
      console.log(`Structural distance: _unavailable — ${structuralDistance.reason}_`);
      console.log('');
    }
    if (payload.alert) {
      if (payload.alert.triggered) {
        console.log(`⚠ **ALERT**: ${payload.alert.reasons.join('; ')}`);
      } else {
        console.log(`✓ no alert triggered`);
      }
    }
  }

  if (payload.alert?.triggered) process.exit(1);
}

main();
