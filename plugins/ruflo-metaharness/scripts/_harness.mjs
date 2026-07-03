// _harness.mjs — shared invocation helper for the metaharness/harness CLIs.
//
// All ruflo-metaharness skills shell out to the upstream CLI rather than
// linking the library — this honors ADR-150's architectural constraint
// (MetaHarness must remain a removable augmentation, never a required
// runtime dep) while still giving us "deep integration" through a single
// vetted bridge that every skill imports from.
//
// CONTRACT
//   - `runMetaharness(args, opts)` — invoke the `metaharness` binary
//   - `runHarness(args, opts)`     — invoke the sibling `harness` binary
//   - both return `{ stdout, stderr, exitCode, json|null, durationMs, degraded, reason? }`
//   - `--json` flag is appended automatically when `opts.json !== false`
//   - subprocess hard timeout (default 60s) — captured in opts.timeoutMs
//   - when the package cannot be resolved/installed, returns degraded result
//     with `degraded: true, reason: 'metaharness-not-available'` — never
//     throws (ADR-150 graceful-degradation rule #3). A subprocess killed by
//     the timeout reports `reason: 'metaharness-timeout'` instead (matches
//     the sibling _darwin/_redblue helpers).
//
// SECURITY + PERF (supersedes the iter-27 npx-with-@latest-dist-tag path)
// =========================================================================
// The pre-consolidation implementation shelled to `npx -y` with the @latest
// dist-tag. Two problems, both fixed here:
//   1. SECURITY (HIGH): @latest means a compromised upstream publish executes
//      arbitrary code on user machines on the very next skill invocation.
//      The version is now PINNED to METAHARNESS_PIN_VERSION (tilde range —
//      patch updates only) and only bumped deliberately, in lock-step with
//      optionalDependencies in @claude-flow/cli + ruflo package.json.
//   2. PERF: @latest forced an npm-registry metadata check on EVERY call.
//      Resolution is now (a) an already-installed local metaharness
//      satisfying the pin (walk-up node_modules — free), then (b) a ONE-TIME
//      `npm install --prefix ~/.ruflo/metaharness-cache-<pin>` versioned
//      cache (same proven pattern as _redblue.mjs / gepa.mjs), after which
//      every call is a plain `node <abs-path-to-cli>` spawn — zero network.
//
// BOTH BINARIES: the `metaharness` package ships two bins (`metaharness`
// and `harness`); their entry paths are read from the resolved package.json
// bin map rather than hardcoded, so upstream layout changes inside the
// pinned range cannot silently break us.

import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  classifyDegraded,
  ensureCachedInstall,
  findLocalPackageDir,
  injectJson,
  makeDegradedEmitter,
  parseTrailingJson,
} from './_invoke.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;

// Pinned semver range. Bump in lock-step with optionalDependencies in
// @claude-flow/cli/package.json + ruflo/package.json. NEVER @latest.
const METAHARNESS_PKG = 'metaharness';
const METAHARNESS_PIN_VERSION = '~0.3.0';

const REASON_NOT_AVAILABLE = 'metaharness-not-available';

/**
 * Resolve absolute paths for the two bins shipped by the metaharness
 * package. Memoized per process — the whole point is that after the first
 * resolution (or one-time cache install) every call is local-only.
 */
let RESOLVED = null;
function resolveMetaharnessBins() {
  if (RESOLVED) return RESOLVED;
  // (a) already-installed local copy satisfying the pin — free.
  const localDir = findLocalPackageDir(METAHARNESS_PKG, METAHARNESS_PIN_VERSION);
  if (localDir) {
    const bins = readBinMap(localDir);
    if (bins) return (RESOLVED = { ok: true, bins, source: 'local' });
  }
  // (b) one-time versioned cache install of the pinned range.
  const cached = ensureCachedInstall({ pkg: METAHARNESS_PKG, pinVersion: METAHARNESS_PIN_VERSION });
  if (!cached.ok) {
    return (RESOLVED = {
      ok: false,
      reason: REASON_NOT_AVAILABLE,
      stderr: cached.stderr ?? cached.error ?? '',
      stdout: cached.stdout ?? '',
    });
  }
  const bins = readBinMap(cached.pkgDir);
  if (!bins) {
    return (RESOLVED = {
      ok: false,
      reason: REASON_NOT_AVAILABLE,
      stderr: `metaharness package at ${cached.pkgDir} is missing the expected bin map (metaharness + harness)`,
      stdout: '',
    });
  }
  return (RESOLVED = { ok: true, bins, source: 'cache' });
}

/** Read both bin entry points from the package's bin map. */
function readBinMap(pkgDir) {
  try {
    const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
    const bin = pj.bin || {};
    if (!bin.metaharness || !bin.harness) return null;
    const metaharness = join(pkgDir, bin.metaharness);
    const harness = join(pkgDir, bin.harness);
    if (!existsSync(metaharness) || !existsSync(harness)) return null;
    return { metaharness, harness };
  } catch {
    return null;
  }
}

function degradedResult(resolved, start) {
  return {
    stdout: resolved.stdout ?? '',
    stderr: resolved.stderr ?? '',
    exitCode: 127,
    json: null,
    durationMs: Date.now() - start,
    degraded: true,
    reason: resolved.reason ?? REASON_NOT_AVAILABLE,
  };
}

/**
 * Async variant (iter 56) — used by oia-audit.mjs to parallelize its 5
 * subprocess calls, dropping worst-case wall-clock from 5×TIMEOUT to
 * 1×TIMEOUT. Identical return shape to the sync path.
 */
function execBinAsync(binName, args, opts = {}) {
  const start = Date.now();
  const resolved = resolveMetaharnessBins();
  if (!resolved.ok) return Promise.resolve(degradedResult(resolved, start));
  return new Promise((resolve) => {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const wantJson = opts.json !== false;
    const argv = injectJson(args, wantJson);
    const p = spawn('node', [resolved.bins[binName], ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      shell: false,
    });
    let stdout = '', stderr = '';
    p.stdout?.on('data', (d) => { stdout += d.toString(); });
    p.stderr?.on('data', (d) => { stderr += d.toString(); });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { p.kill('SIGTERM'); } catch { /* ignore */ }
    }, timeoutMs);
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({
        stdout, stderr: stderr + String(e?.message ?? e),
        exitCode: 127, json: null, durationMs: Date.now() - start,
        degraded: true, reason: REASON_NOT_AVAILABLE,
      });
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const classified = classifyDegraded(stderr, timedOut ? null : code, 'metaharness');
      if (classified.degraded) {
        resolve({
          stdout, stderr,
          exitCode: code ?? 127, json: null, durationMs,
          degraded: true, reason: classified.reason,
        });
        return;
      }
      resolve({
        stdout, stderr,
        exitCode: code ?? 0,
        json: wantJson ? parseTrailingJson(stdout) : null,
        durationMs,
        degraded: false,
      });
    });
  });
}

/** Sync invocation of one of the two resolved bins via `node <abs-path>`. */
function execBin(binName, args, opts = {}) {
  const start = Date.now();
  const resolved = resolveMetaharnessBins();
  if (!resolved.ok) return degradedResult(resolved, start);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wantJson = opts.json !== false;
  const argv = injectJson(args, wantJson);
  const r = spawnSync('node', [resolved.bins[binName], ...argv], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: timeoutMs,
    cwd: opts.cwd,  // iter 27 — let callers redirect $CWD (mint.mjs needs this)
    env: { ...process.env, ...(opts.env || {}) },
    shell: false,
  });
  const durationMs = Date.now() - start;
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  const classified = classifyDegraded(stderr, r.status, 'metaharness');
  if (classified.degraded) {
    return {
      stdout, stderr,
      exitCode: r.status ?? 127,
      json: null,
      durationMs,
      degraded: true,
      reason: classified.reason,
    };
  }
  return {
    stdout, stderr,
    exitCode: r.status ?? 0,
    json: wantJson ? parseTrailingJson(stdout) : null,
    durationMs,
    degraded: false,
  };
}

export function runMetaharness(args, opts) {
  return execBin('metaharness', args, opts);
}

export function runHarness(args, opts) {
  // The `harness` binary ships inside the same `metaharness` package —
  // resolved from the package.json bin map above.
  return execBin('harness', args, opts);
}

export function runMetaharnessAsync(args, opts) {
  return execBinAsync('metaharness', args, opts);
}

export function runHarnessAsync(args, opts) {
  return execBinAsync('harness', args, opts);
}

/**
 * iter 63 — single source of truth for severity ranks across the
 * metaharness plugin family. Pre-iter-63, three scripts (oia-audit,
 * audit-trend, mcp-scan) maintained their own SEVERITY_RANK literal,
 * each missing different keys, each producing different NaN-compare
 * behavior on unknown severities. Iter 62 fixed oia-audit; iter 63
 * propagates the fix and consolidates.
 *
 * Mapping rationale:
 *   clean / info     → 0  (no harm)
 *   low              → 1
 *   medium / warn    → 2
 *   high / error     → 3
 *   critical         → 4  (explicit elevation above high)
 *
 * `rankSeverity(s)` is the safe accessor — returns 0 for any unknown
 * string instead of `undefined`, eliminating the NaN-compare hazard
 * (`undefined > 3` evaluates to false → unknown severities silently
 * ignored in reduce expressions).
 */
export const SEVERITY_RANK = Object.freeze({
  clean: 0, info: 0,
  low: 1,
  medium: 2, warn: 2,
  high: 3, error: 3,
  critical: 4,
});

export function rankSeverity(s) {
  if (s == null) return 0;
  return SEVERITY_RANK[String(s).toLowerCase()] ?? 0;
}

/**
 * iter 50 — parse `harness mcp-scan` text output into structured findings.
 *
 * Upstream `harness mcp-scan` emits plain text even with --json:
 *
 *     harness mcp-scan — <path>
 *
 *       [INFO] No MCP security issues found
 *              Policy is default-deny with safe capability grants and an audit log.
 *
 *     Result: INFO (1 finding, 0 high)
 *
 * Closes the iter-49-flagged gap where audit-trend.mjs reads
 * `json.findings` expecting an array, but mcp-scan's r.json was null.
 * Used by BOTH mcp-scan.mjs (the wrapper) and oia-audit.mjs (composite
 * audit) so the structured-findings invariant holds across the pipeline.
 */
export function parseMcpScanText(stdout) {
  const findings = [];
  const lines = (stdout || '').split('\n');
  let current = null;
  for (const line of lines) {
    const m = /^\s*\[([A-Z]+)\]\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) findings.push(current);
      current = { severity: m[1].toLowerCase(), message: m[2] };
    } else if (current && /^\s{6,}\S/.test(line)) {
      const cont = line.trim();
      if (cont) current.message += ' ' + cont;
    } else if (current && line.trim() === '') {
      findings.push(current);
      current = null;
    }
  }
  if (current) findings.push(current);
  const resultMatch = /Result:\s+([A-Z]+)\s+\((\d+)\s+finding/i.exec(stdout);
  const summary = resultMatch ? {
    overallSeverity: resultMatch[1].toLowerCase(),
    totalCount: parseInt(resultMatch[2], 10),
  } : null;
  return { findings, summary };
}

// Convenience emitter for skill scripts — keep the boilerplate out of
// each skill so they focus on argument parsing + exit-code semantics.
// Exit 0 — ADR-150 architectural constraint says ruflo continues to
// function when MetaHarness is absent. Skills emit a structured
// degraded payload rather than failing.
export const emitDegradedJsonAndExit = makeDegradedEmitter(METAHARNESS_PKG, METAHARNESS_PIN_VERSION);

export const METAHARNESS_VERSION_PIN = `${METAHARNESS_PKG}@${METAHARNESS_PIN_VERSION}`;

/** Expose resolution for diagnostics/tests (which path served the bins). */
export function metaharnessResolution() {
  const r = resolveMetaharnessBins();
  return r.ok ? { ok: true, source: r.source, bins: r.bins } : { ok: false, reason: r.reason };
}
