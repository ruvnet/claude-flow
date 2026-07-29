#!/usr/bin/env node
// mcp-scan.mjs — wrapper around `harness mcp-scan <path>`.
//
// Static security scan of the harness's declared MCP surface. Reads
// .mcp/servers.json + .harness/claims.json. Pure-read, no dispatch.
//
// USAGE
//   node scripts/mcp-scan.mjs                           # current dir
//   node scripts/mcp-scan.mjs --path <dir>
//   node scripts/mcp-scan.mjs --fail-on high            # exit 1 if any HIGH finding (default)
//   node scripts/mcp-scan.mjs --fail-on medium          # also fail on MEDIUM
//   node scripts/mcp-scan.mjs --format json
//
// EXIT CODES
//   0  no findings at or above --fail-on (or degraded)
//   1  at least one finding ≥ --fail-on severity
//   2  config error or scan failure

// iter 50 — parseMcpScanText extracted to _harness.mjs so oia-audit
// can use the same parser without duplicating logic.
// iter 63 — SEVERITY_RANK also moves to _harness.mjs (single source of
// truth; previously this file had a literal that diverged from oia-audit's).
import { runHarness, emitDegradedJsonAndExit, parseMcpScanText, SEVERITY_RANK, rankSeverity } from './_harness.mjs';

const ARGS = (() => {
  const a = { path: '.', format: 'json', failOn: 'high' };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--path') a.path = process.argv[++i];
    else if (v === '--fail-on') a.failOn = String(process.argv[++i] || 'high').toLowerCase();
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

function main() {
  if (!SEVERITY_RANK[ARGS.failOn]) {
    console.error(`mcp-scan: --fail-on must be one of low|medium|high; got ${ARGS.failOn}`);
    process.exit(2);
  }
  const r = runHarness(['mcp-scan', ARGS.path]);
  if (r.degraded) { emitDegradedJsonAndExit(r.reason); return; }
  if (!r.json && r.exitCode !== 0 && r.exitCode !== 1) {
    // Non-zero verdict exits are valid when accompanied by structured JSON.
    // Without a payload, exit codes other than the historical findings=1
    // remain invocation failures.
    console.error(`mcp-scan: harness exited ${r.exitCode}`);
    if (r.stderr) console.error(r.stderr.slice(0, 400));
    process.exit(2);
  }
  // Older `harness mcp-scan` releases emitted text even with --json. Keep
  // the text parser as a backwards-compatible fallback, but prefer current
  // structured findings when the upstream command supplies them.
  const parsed = parseMcpScanText(r.stdout);
  // iter 124 — normalize finding shape so consumers see a stable contract.
  // Upstream metaharness@0.1.x JSON path emits {id, severity, title, detail};
  // our parseMcpScanText emits {severity, message}. Project both into a
  // unified {severity, message, title?, detail?} so audit-trend's fingerprint
  // diff and test-mcp-tools' assertions don't care which path produced them.
  const rawFindings = Array.isArray(r.json?.findings) ? r.json.findings : parsed.findings;
  const findings = rawFindings.map((f) => ({
    ...f,
    message: typeof f.message === 'string' && f.message
      ? f.message
      : (f.title || f.detail || ''),
  }));
  const payload = {
    ...(r.json ?? {}),
    findings,
    summary: r.json?.summary ?? parsed.summary,
    rawStdout: r.stdout.slice(0, 400),
  };
  const threshold = SEVERITY_RANK[ARGS.failOn];
  // iter 63 — rankSeverity() safe lookup. Pre-iter-63 `undefined >= 3`
  // was false → unknown-severity findings (e.g., warn / error) were
  // silently excluded from the offending set, weakening --fail-on alerts.
  const offending = findings.filter((f) => rankSeverity(f.severity) >= threshold);

  const alert = {
    threshold: ARGS.failOn,
    triggered: offending.length > 0,
    offendingCount: offending.length,
    reason: offending.length > 0
      ? `${offending.length} finding(s) at or above ${ARGS.failOn} severity`
      : `no findings at or above ${ARGS.failOn} severity — OK`,
  };

  if (ARGS.format === 'json') {
    // iter 112 — generatedAt for consistency with other --format json outputs
    console.log(JSON.stringify({
      ...payload, durationMs: r.durationMs, alert,
      generatedAt: new Date().toISOString(),
    }, null, 2));
  } else {
    console.log(`# harness mcp-scan — ${ARGS.path}`);
    console.log('');
    console.log(`Total findings: ${findings.length}`);
    console.log(`| Severity | ID | Server | Tool | Message |`);
    console.log(`|---|---|---|---|---|`);
    for (const f of findings.slice(0, 50)) {
      console.log(`| ${f.severity} | ${f.id ?? '—'} | ${f.server ?? '—'} | ${f.tool ?? '—'} | ${f.message ?? ''} |`);
    }
    console.log('');
    console.log(alert.triggered ? `⚠ **ALERT**: ${alert.reason}` : `✓ ${alert.reason}`);
  }

  if (alert.triggered) process.exit(1);
}

main();
