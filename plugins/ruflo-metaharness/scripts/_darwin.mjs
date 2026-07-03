// _darwin.mjs — shared invocation helper for the `@metaharness/darwin` CLI.
//
// Mirrors `_harness.mjs` for the umbrella `metaharness` / `harness` binaries,
// but targets the separate darwin binary (`metaharness-darwin`) which is
// published as its own npm package (`@metaharness/darwin@~0.8.0`).
//
// Shared plumbing (degraded classification, --json injection, trailing-JSON
// parse, degraded emitter) lives in `_invoke.mjs`. What stays here is the
// genuinely-darwin part: the ASYNC STREAMING variant (`runDarwinAsync`) that
// long `evolve` runs need for per-generation progress visibility.
//
// Three subcommands surfaced (matches darwin 0.8.x — same verbs as 0.3.x,
// with GEPA-engine evolve flags added upstream: --selection modes,
// --crossover, --epistasis, --curriculum, --mutator ruvllm, --sandbox):
//   - `metaharness-darwin evolve <repo> [...]`         — harness self-improvement
//   - `metaharness-darwin bench <create|verify> ...`   — bench-suite lifecycle
//   - `metaharness-darwin security bench [...]`        — Darwin Shield (upstream ADR-155)
//
// CONTRACT (identical to runMetaharness/runHarness):
//   - returns `{ stdout, stderr, exitCode, json|null, durationMs, degraded, reason? }`
//   - `--json` is appended automatically when `opts.json !== false`
//   - subprocess hard timeout (default 60s, override with opts.timeoutMs)
//   - on MODULE_NOT_FOUND / network failure / "not installed", returns
//     `degraded: true, reason: 'metaharness-darwin-not-available'` — never throws
//     (ADR-150 graceful-degradation rule #3; ADR-153 §"Architecture" constraint 3)
//
// IMPORTANT — evolve has long timeouts:
//   `evolve` is the only long-running verb in the metaharness family. A real
//   evolution with --generations 10 --children 5 --concurrency 2 takes
//   minutes-to-hours, NOT seconds. Callers MUST pass an explicit `timeoutMs`
//   matched to their --generations × --children × sandbox cost; the 60s
//   default is for `bench verify` and `security bench --population 2 --cycles 1`
//   smoke shapes only.

import { spawnSync, spawn } from 'node:child_process';
import {
  classifyDegraded,
  importOptionalLibrary,
  injectJson,
  makeDegradedEmitter,
  parseTrailingJson,
} from './_invoke.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;

// Pinned semver range. Bump in lock-step with optionalDependencies in
// @claude-flow/cli/package.json + ruflo/package.json. The `~` allows
// patch upgrades without re-pinning.
const DARWIN_PKG = '@metaharness/darwin';
const DARWIN_PIN_VERSION = '~0.8.0';
const DARWIN_PIN = `${DARWIN_PKG}@${DARWIN_PIN_VERSION}`;

const REASON_PREFIX = 'metaharness-darwin';

function buildArgv(args, wantJson) {
  // `metaharness-darwin` historically does NOT take --json on every
  // subcommand (some emit plain text reports — security bench in
  // particular is markdown). We still append --json for callers that
  // explicitly request it, but never silently inject it on subcommands
  // that don't accept it. The shape that does support --json is the
  // single-verb `evolve` and `bench verify`.
  return injectJson(args, wantJson);
}

// darwin's evolve emits a final JSON object at end of stdout when --json
// is passed; everything before is human-readable progress. Grab the LAST
// {...} block, not the first — the first may be a per-generation log line.
// (This last-block parse is now the family-wide shared implementation.)
const maybeParseJson = parseTrailingJson;

/**
 * Sync invocation. Use for short subcommands (`bench verify`, smoke shapes).
 * Async variant below for long-running `evolve` calls.
 */
export function runDarwin(args, opts = {}) {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wantJson = opts.json !== false;
  const argv = buildArgv(args, wantJson);
  const r = spawnSync('npx', ['-y', '-p', DARWIN_PIN, 'metaharness-darwin', ...argv], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: timeoutMs,
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    shell: process.platform === 'win32',
  });
  const durationMs = Date.now() - start;
  const stdout = r.stdout || '';
  const stderr = r.stderr || '';
  const classified = classifyDegraded(stderr, r.status, REASON_PREFIX);
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
    json: wantJson ? maybeParseJson(stdout) : null,
    durationMs,
    degraded: false,
  };
}

/**
 * Async invocation with streaming. Required for `evolve` because the run
 * can take 10+ minutes and the caller wants progress visibility.
 *
 * If `opts.onProgress(line)` is provided, called once per stderr line.
 * darwin writes per-generation progress to stderr, structured result to
 * stdout. Cancellable via opts.signal (AbortSignal).
 */
export function runDarwinAsync(args, opts = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const wantJson = opts.json !== false;
    const argv = buildArgv(args, wantJson);
    const p = spawn('npx', ['-y', '-p', DARWIN_PIN, 'metaharness-darwin', ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      shell: process.platform === 'win32',
    });
    let stdout = '', stderr = '', stderrBuf = '';
    p.stdout?.on('data', (d) => { stdout += d.toString(); });
    p.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (opts.onProgress) {
        stderrBuf += s;
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop() ?? '';
        for (const line of lines) opts.onProgress(line);
      }
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { p.kill('SIGTERM'); } catch { /* ignore */ }
    }, timeoutMs);
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => {
        try { p.kill('SIGTERM'); } catch { /* ignore */ }
      }, { once: true });
    }
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr: stderr + String(e?.message ?? e),
        exitCode: 127, json: null, durationMs: Date.now() - start,
        degraded: true, reason: `${REASON_PREFIX}-not-available`,
      });
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const classified = classifyDegraded(stderr, timedOut ? null : code, REASON_PREFIX);
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
        json: wantJson ? maybeParseJson(stdout) : null,
        durationMs,
        degraded: false,
      });
    });
  });
}

/**
 * Match the existing `emitDegradedJsonAndExit` shape used by the
 * metaharness-umbrella scripts so MCP tool consumers see one contract.
 * Exit 0 — ADR-150 architectural constraint: ruflo continues to function
 * when MetaHarness is absent. Same posture as the umbrella scripts.
 */
export const emitDarwinDegradedJsonAndExit = makeDegradedEmitter(DARWIN_PKG, DARWIN_PIN_VERSION);

export const DARWIN_VERSION_PIN = DARWIN_PIN;

/**
 * Resolver for the darwin GEPA LIBRARY entry (`@metaharness/darwin/gepa`).
 * Lives here (not in gepa.mjs) because gepa.mjs is a CLI script that runs
 * main() on import — this module is the import-safe home for the darwin
 * pin. Used by gepa.mjs (genome/validate/render/analyze ops) and by
 * evolve.mjs --diagnose (failure-class analysis of run transcripts).
 * Returns the module namespace or null. Never throws on absence.
 */
export function importGepa() {
  return importOptionalLibrary({
    specifier: '@metaharness/darwin/gepa',
    pkg: DARWIN_PKG,
    pinVersion: DARWIN_PIN_VERSION,
    entryRelPath: 'dist/gepa/index.js',
  });
}
