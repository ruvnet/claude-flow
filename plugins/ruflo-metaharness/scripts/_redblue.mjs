// _redblue.mjs — invocation helper for `@metaharness/redblue`.
//
// Sibling of `_darwin.mjs` / `_harness.mjs`. Targets the `redblue` binary
// from the standalone `@metaharness/redblue@~0.1.4` package.
//
// Subcommands surfaced (matches redblue 0.1.x):
//   - `redblue init   [--out redblue.yaml]`
//   - `redblue run    [--config redblue.yaml] [--tests N] [--patch] [--mock-judge] [--out report.json]`
//   - `redblue attack <prompt|tools|data|all> [--count N]`
//   - `redblue patch  [--config redblue.yaml] [--mock-judge]`
//   - `redblue report --in report.json`
//
// UPSTREAM BUG WORKAROUND
// -----------------------
// @metaharness/redblue@0.1.1's CLI bootstrap is:
//     const isMain = import.meta.url === `file://${process.argv[1]}`;
//     if (isMain) { dispatch(...) }
// When npx links `redblue` → `dist/cli/index.js`, process.argv[1] is the
// symlink path but import.meta.url is the resolved real path, so the
// check fails silently — the binary exits 0 with no output, no file,
// no error. Darwin's CLI doesn't suffer this (calls main() unconditionally).
//
// Workaround: install the package once into a ruflo-owned cache dir
// (~/.ruflo/redblue-cache) and invoke `node <abs_path>/dist/cli/index.js`
// directly. argv[1] then equals the real path and isMain becomes true.
//
// Track upstream fix at: github.com/ruvnet/agent-harness-generator/issues
// (file separately — when fixed, we can drop the cached-install path and
// go back to the `npx -y -p ...` pattern used by _darwin.mjs).
//
// CONTRACT (matches runMetaharness/runDarwin):
//   - returns `{ stdout, stderr, exitCode, durationMs, degraded, reason? }`
//   - subprocess hard timeout (default 120s; --mock-judge runs are seconds)
//   - on install failure / MODULE_NOT_FOUND / network failure, returns
//     `degraded: true, reason: 'metaharness-redblue-not-available'`
//   - never throws — ADR-150 graceful-degradation rule #3
//
// SAFETY NOTE
//   redblue itself enforces hard safety boundaries in `src/config/safety.ts`
//   (no real creds, no live targets, no shell, no eval, no arbitrary network).
//   This wrapper does NOT relax those — it only forwards argv with shell:false.
//   `--mock-judge` is the $0 CI path; the real model judge gates on
//   $OPENROUTER_API_KEY which we never inject.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 180_000;  // npm install can be slow on cold cache

// Pinned semver range. Bump in lock-step with optionalDependencies in
// @claude-flow/cli/package.json + ruflo/package.json.
const REDBLUE_PIN = '@metaharness/redblue@~0.1.4';
const REDBLUE_PKG = '@metaharness/redblue';
const REDBLUE_PIN_VERSION = '~0.1.4';

// Cache dir is versioned by the pin so bumping REDBLUE_PIN_VERSION
// invalidates stale installs — ensureInstalled() short-circuits on
// existsSync(RESOLVED_CLI), so an unversioned dir would keep serving
// the old package forever after a pin bump.
const CACHE_DIR = join(
  homedir(), '.ruflo', `redblue-cache-${REDBLUE_PIN_VERSION.replace(/[~^]/g, '')}`,
);
const RESOLVED_CLI = join(
  CACHE_DIR, 'node_modules', '@metaharness', 'redblue', 'dist', 'cli', 'index.js',
);

const DEGRADED_RX = /could not determine executable|404|not installed|MODULE_NOT_FOUND|ENOTFOUND|getaddrinfo|ECONNREFUSED|ETIMEDOUT|npm ERR/i;

function ensureInstalled() {
  if (existsSync(RESOLVED_CLI)) return { ok: true };
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
  } catch (e) {
    return { ok: false, reason: 'cache-dir-create-failed', error: String(e) };
  }
  // Use `npm install --prefix` so the package lands in a known location;
  // this avoids npx's symlinked shim entirely (the upstream bin-bootstrap bug).
  // shell:false; argv only.
  const r = spawnSync('npm', [
    'install',
    '--no-audit', '--no-fund', '--no-package-lock',
    '--prefix', CACHE_DIR,
    `${REDBLUE_PKG}@${REDBLUE_PIN_VERSION}`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: INSTALL_TIMEOUT_MS,
    shell: process.platform === 'win32',
  });
  if (r.status !== 0 || !existsSync(RESOLVED_CLI)) {
    return {
      ok: false,
      reason: 'install-failed',
      stderr: (r.stderr || '').slice(0, 600),
      stdout: (r.stdout || '').slice(0, 600),
    };
  }
  return { ok: true };
}

function classifyDegraded(stderr, exitCode) {
  if (exitCode === null) return { degraded: true, reason: 'metaharness-redblue-timeout' };
  if (DEGRADED_RX.test(stderr)) return { degraded: true, reason: 'metaharness-redblue-not-available' };
  return { degraded: false };
}

/**
 * Sync invocation. `redblue` runs are bounded by `max_cost_usd` and
 * `max_runtime_minutes` from the config, so sync is fine for the CLI
 * wrapper. The default --mock-judge fixture path completes in seconds.
 */
export function runRedblue(args, opts = {}) {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 1. Ensure redblue is installed in our cache dir (one-time install).
  const install = ensureInstalled();
  if (!install.ok) {
    return {
      stdout: install.stdout ?? '',
      stderr: install.stderr ?? install.error ?? '',
      exitCode: 127,
      durationMs: Date.now() - start,
      degraded: true,
      reason: install.reason === 'install-failed'
        ? 'metaharness-redblue-not-available'
        : `metaharness-redblue-${install.reason}`,
    };
  }

  // 2. Invoke `node <real-path-to-cli> <args>` so upstream's isMain check
  //    succeeds (argv[1] matches import.meta.url).
  const r = spawnSync('node', [RESOLVED_CLI, ...args], {
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
  const classified = classifyDegraded(stderr, r.status);
  if (classified.degraded) {
    return {
      stdout, stderr,
      exitCode: r.status ?? 127,
      durationMs,
      degraded: true,
      reason: classified.reason,
    };
  }
  return {
    stdout, stderr,
    exitCode: r.status ?? 0,
    durationMs,
    degraded: false,
  };
}

/**
 * Match the existing `emit*DegradedJsonAndExit` shape used by sibling
 * scripts so MCP tool consumers see one contract.
 */
export function emitRedblueDegradedJsonAndExit(reason) {
  const payload = {
    degraded: true,
    reason,
    hint: 'Install with `npm i -D ' + REDBLUE_PIN + '` or run `npx -y ' + REDBLUE_PIN + ' --help` to verify network access.',
    generatedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload, null, 2));
  // Exit 0 — ADR-150 architectural constraint #3.
  process.exit(0);
}

export const REDBLUE_VERSION_PIN = REDBLUE_PIN;
export const REDBLUE_CACHE_DIR = CACHE_DIR;
