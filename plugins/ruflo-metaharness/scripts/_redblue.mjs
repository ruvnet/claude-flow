// _redblue.mjs — invocation helper for `@metaharness/redblue`.
//
// Sibling of `_darwin.mjs` / `_harness.mjs`. Targets the `redblue` binary
// from the standalone `@metaharness/redblue@~0.1.4` package. Shared plumbing
// (degraded classification, versioned cache install, degraded emitter) lives
// in `_invoke.mjs`; what stays here is the genuinely-redblue part: the
// node-direct invocation rationale below.
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
// (~/.ruflo/redblue-cache-<pin>, via _invoke.ensureCachedInstall) and invoke
// `node <abs_path>/dist/cli/index.js` directly. argv[1] then equals the real
// path and isMain becomes true.
//
// Track upstream fix at: github.com/ruvnet/agent-harness-generator/issues
// (file separately — when fixed, we could go back to a bin-shim pattern,
// though the node-direct cached path is now the family-wide standard anyway).
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
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  classifyDegraded,
  ensureCachedInstall,
  makeDegradedEmitter,
} from './_invoke.mjs';

const DEFAULT_TIMEOUT_MS = 120_000;

// Pinned semver range. Bump in lock-step with optionalDependencies in
// @claude-flow/cli/package.json + ruflo/package.json.
const REDBLUE_PKG = '@metaharness/redblue';
const REDBLUE_PIN_VERSION = '~0.1.4';
const REDBLUE_PIN = `${REDBLUE_PKG}@${REDBLUE_PIN_VERSION}`;

const REASON_PREFIX = 'metaharness-redblue';

// Cache dir is versioned by the pin so bumping REDBLUE_PIN_VERSION
// invalidates stale installs (handled inside ensureCachedInstall). The
// resolved layout matches the pre-consolidation helper so existing caches
// keep serving.
const CLI_REL_PATH = join('dist', 'cli', 'index.js');

/**
 * Sync invocation. `redblue` runs are bounded by `max_cost_usd` and
 * `max_runtime_minutes` from the config, so sync is fine for the CLI
 * wrapper. The default --mock-judge fixture path completes in seconds.
 */
export function runRedblue(args, opts = {}) {
  const start = Date.now();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 1. Ensure redblue is installed in our cache dir (one-time install).
  const install = ensureCachedInstall({
    pkg: REDBLUE_PKG,
    pinVersion: REDBLUE_PIN_VERSION,
    cliRelPath: CLI_REL_PATH,
  });
  if (!install.ok) {
    return {
      stdout: install.stdout ?? '',
      stderr: install.stderr ?? install.error ?? '',
      exitCode: 127,
      durationMs: Date.now() - start,
      degraded: true,
      reason: install.reason === 'install-failed'
        ? `${REASON_PREFIX}-not-available`
        : `${REASON_PREFIX}-${install.reason}`,
    };
  }

  // 2. Invoke `node <real-path-to-cli> <args>` so upstream's isMain check
  //    succeeds (argv[1] matches import.meta.url).
  const r = spawnSync('node', [install.cliPath, ...args], {
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
 * scripts so MCP tool consumers see one contract. Exit 0 — ADR-150
 * architectural constraint #3.
 */
export const emitRedblueDegradedJsonAndExit = makeDegradedEmitter(REDBLUE_PKG, REDBLUE_PIN_VERSION);

export const REDBLUE_VERSION_PIN = REDBLUE_PIN;
export const REDBLUE_CACHE_DIR = join(
  homedir(), '.ruflo', `redblue-cache-${REDBLUE_PIN_VERSION.replace(/[~^]/g, '')}`,
);
