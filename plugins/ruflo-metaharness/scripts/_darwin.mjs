// _darwin.mjs — shared invocation helper for the `@metaharness/darwin` CLI.
//
// Mirrors `_harness.mjs` for the umbrella `metaharness` / `harness` binaries,
// but targets the separate darwin binary (`metaharness-darwin`) which is
// published as its own npm package (`@metaharness/darwin@~0.10.2`).
//
// Shared plumbing (degraded classification, --json injection, trailing-JSON
// parse, degraded emitter) lives in `_invoke.mjs`. What stays here is the
// genuinely-darwin part: the ASYNC STREAMING variant (`runDarwinAsync`) that
// long `evolve` runs need for per-generation progress visibility.
//
// Three subcommands surfaced (matches darwin 0.8.x-0.10.x — same verbs as
// 0.3.x, with GEPA-engine evolve flags added upstream: --selection modes,
// --crossover, --epistasis, --curriculum, --mutator ruvllm, --sandbox;
// 0.10.x only ADDS `evolve-numeric`, which this helper does not surface):
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
//
// RESOLUTION (#3366 — was `npx -y -p @metaharness/darwin@<pin>` on every call)
//   Same order as _harness.mjs: (a) an installed @metaharness/darwin that
//   satisfies the pin (the @claude-flow/cli optionalDependency — free), then
//   (b) the one-time versioned `~/.ruflo/darwin-cache-<pin>` install that gepa
//   already shares, then `process.execPath <abs bin>` with shell:false. The
//   npx path had npm resolve the range on every evolve / bench /
//   security-bench call (registry or npx cache state), ignored the copy ruflo
//   ships, and could run a different darwin than the gepa import in the same
//   plugin. (a) searches ruflo's own tree only — see findLocalPackageDir's
//   `fromCwd` in _invoke.mjs.

import { spawnSync, spawn } from 'node:child_process';
import {
  classifyDegraded,
  ensureCachedInstall,
  findLocalPackageDir,
  importOptionalLibrary,
  injectJson,
  makeDegradedEmitter,
  packageBinRelPath,
  parseTrailingJson,
  resolvePackageBin,
} from './_invoke.mjs';

const DEFAULT_TIMEOUT_MS = 60_000;

// Pinned semver range. The `~` allows patch upgrades without re-pinning.
// Must cover the `@metaharness/darwin` optionalDependency range in
// v3/@claude-flow/cli/package.json (`~0.10.2`). It sat at ~0.8.0 while that
// range moved to ~0.9.0 (#2958) and ~0.10.2 (#3262), because the pin-drift
// guard only compared MH_DARWIN_PIN (distill-oracle.ts). This range picks
// the darwin version the evolve / bench / security-bench tools run and the
// gepa cache fallback installs; scripts/check-metaharness-pins.mjs now fails
// when it no longer covers the declared range.
const DARWIN_PKG = '@metaharness/darwin';
const DARWIN_PIN_VERSION = '~0.10.2';
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

const DARWIN_BIN = 'metaharness-darwin';

/**
 * Absolute path of the `metaharness-darwin` bin (see RESOLUTION above).
 * Memoized per process, like _harness.mjs resolveMetaharnessBins().
 */
let RESOLVED = null;
function resolveDarwinBin() {
  if (RESOLVED) return RESOLVED;
  // fromCwd:false — this lookup ends in a spawn of the bin with argv that
  // comes from MCP input, so it only searches the ruflo install that owns
  // this plugin, never the tool's cwd or its ancestors (see _invoke.mjs).
  const localDir = findLocalPackageDir(DARWIN_PKG, DARWIN_PIN_VERSION, { fromCwd: false });
  const localBin = localDir ? resolvePackageBin(localDir, DARWIN_BIN) : null;
  if (localBin) return (RESOLVED = { ok: true, bin: localBin, source: 'local' });
  let cached = ensureCachedInstall({ pkg: DARWIN_PKG, pinVersion: DARWIN_PIN_VERSION });
  let cachedBin = cached.ok ? resolvePackageBin(cached.pkgDir, DARWIN_BIN) : null;
  // The default cache probe is `<pkgDir>/package.json`, so a half-written
  // cache — npm killed by the 180s install timeout, or two first calls
  // installing into the same prefix — would count as installed forever and
  // degrade every later call. npx repaired that by re-resolving; re-run the
  // install once, probing the bin file itself, then give up (#3366).
  if (cached.ok && !cachedBin) {
    cached = ensureCachedInstall({
      pkg: DARWIN_PKG,
      pinVersion: DARWIN_PIN_VERSION,
      cliRelPath: packageBinRelPath(cached.pkgDir, DARWIN_BIN) ?? 'dist/cli.js',
    });
    cachedBin = cached.ok ? resolvePackageBin(cached.pkgDir, DARWIN_BIN) : null;
  }
  if (cachedBin) return (RESOLVED = { ok: true, bin: cachedBin, source: 'cache' });
  return (RESOLVED = {
    ok: false,
    stdout: cached.stdout ?? '',
    stderr: cached.stderr ?? cached.error ?? `${DARWIN_PIN} has no ${DARWIN_BIN} bin`,
  });
}

/** Same degraded shape the npx path produced when the package was unreachable. */
function unavailable(resolved, start) {
  return {
    stdout: resolved.stdout, stderr: resolved.stderr,
    exitCode: 127, json: null, durationMs: Date.now() - start,
    degraded: true, reason: `${REASON_PREFIX}-not-available`,
  };
}

/**
 * Sync invocation. Use for short subcommands (`bench verify`, smoke shapes).
 * Async variant below for long-running `evolve` calls.
 */
export function runDarwin(args, opts = {}) {
  const start = Date.now();
  const resolved = resolveDarwinBin();
  if (!resolved.ok) return unavailable(resolved, start);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const wantJson = opts.json !== false;
  const argv = buildArgv(args, wantJson);
  const r = spawnSync(process.execPath, [resolved.bin, ...argv], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: timeoutMs,
    cwd: opts.cwd,
    env: { ...process.env, ...(opts.env || {}) },
    shell: false,
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
    const resolved = resolveDarwinBin();
    if (!resolved.ok) { resolve(unavailable(resolved, start)); return; }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const wantJson = opts.json !== false;
    const argv = buildArgv(args, wantJson);
    const p = spawn(process.execPath, [resolved.bin, ...argv], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env || {}) },
      shell: false,
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
