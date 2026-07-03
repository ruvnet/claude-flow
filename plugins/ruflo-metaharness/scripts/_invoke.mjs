// _invoke.mjs — shared subprocess/plumbing layer for the metaharness plugin family.
//
// Extracted from the copy-pasted plumbing that had accreted across
// _harness.mjs / _darwin.mjs / _redblue.mjs / gepa.mjs (converged
// security/perf/arch review, 2026-07). The four invocation helpers are now
// thin adapters on top of this module; their exported function signatures
// are unchanged (~15 scripts import them).
//
// WHAT LIVES HERE (the genuinely-shared parts):
//   - DEGRADED_RX             one superset regex (incl. `npm ERR` — previously
//                             only _redblue had it) for "upstream unavailable"
//   - classifyDegraded()      timeout vs not-available distinction, per-package
//                             reason prefix
//   - injectJson()            append --json unless caller opted out / present
//   - parseTrailingJson()     LAST-{...}-block extraction (the _darwin variant;
//                             the old _harness FIRST-block variant was a live
//                             bug — a progress line containing `{...}` would
//                             shadow the final structured result)
//   - ensureCachedInstall()   one-time `npm install --prefix ~/.ruflo/<name>-cache-<pin>`
//                             of a PINNED range — generalizes _redblue.mjs /
//                             gepa.mjs; the versioned dir means pin bumps
//                             invalidate stale caches automatically
//   - findLocalPackageDir()   walk-up node_modules resolution so an already
//                             installed optionalDependency is used for free
//   - importOptionalLibrary() bare-import → cached-install fallback for
//                             library entries (gepa) — never throws on absence
//   - makeDegradedEmitter()   the ADR-150 rule-#3 exit-0 degraded payload
//
// WHAT DOES NOT LIVE HERE (the per-consumer parts):
//   - _redblue's node-direct isMain workaround rationale
//   - _darwin's async streaming (`onProgress`) for long evolve runs
//   - _harness's dual-binary (metaharness + harness) resolution
//
// TEST SEAMS (used by test-graceful-degradation.mjs so the ADR-150 drill
// stays meaningful on machines with a warm cache / local install):
//   - RUFLO_METAHARNESS_CACHE_BASE   overrides ~/.ruflo as the cache root
//   - RUFLO_METAHARNESS_SKIP_LOCAL=1 disables local node_modules resolution

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const INSTALL_TIMEOUT_MS = 180_000; // npm install can be slow on cold cache

// Superset of the three per-file regexes. `npm ERR` (from _redblue) is
// included for everyone: an npm-level failure during a cached install or an
// npx shim means "upstream unavailable", never a ruflo bug.
export const DEGRADED_RX = /could not determine executable|404|not installed|MODULE_NOT_FOUND|ENOTFOUND|getaddrinfo|ECONNREFUSED|ETIMEDOUT|npm ERR/i;

/**
 * Classify a finished subprocess as degraded or healthy.
 * `exitCode === null` means the harness killed it (timeout) — that is a
 * DIFFERENT operational signal from "package not installable", so the two
 * reasons stay distinct: `<prefix>-timeout` vs `<prefix>-not-available`.
 */
export function classifyDegraded(stderr, exitCode, reasonPrefix) {
  if (exitCode === null) return { degraded: true, reason: `${reasonPrefix}-timeout` };
  if (DEGRADED_RX.test(stderr || '')) return { degraded: true, reason: `${reasonPrefix}-not-available` };
  return { degraded: false };
}

/** Append --json unless the caller opted out or already passed it. */
export function injectJson(args, wantJson) {
  if (!wantJson || args.includes('--json')) return [...args];
  return [...args, '--json'];
}

/**
 * Parse the trailing JSON object from mixed stdout. CLIs in this family emit
 * human-readable progress first and a structured JSON object LAST — so grab
 * the last parseable {...} block, falling back to a greedy whole-span match
 * for nested objects the lazy regex fragments.
 */
export function parseTrailingJson(stdout) {
  const s = stdout || '';
  const matches = [...s.matchAll(/\{[\s\S]*?\}/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    try { return JSON.parse(matches[i][0]); } catch { /* try previous */ }
  }
  const greedy = /\{[\s\S]*\}/.exec(s);
  if (greedy) { try { return JSON.parse(greedy[0]); } catch { return null; } }
  return null;
}

/** Cache root — ~/.ruflo unless the test seam overrides it. */
export function cacheBaseDir() {
  return process.env.RUFLO_METAHARNESS_CACHE_BASE || join(homedir(), '.ruflo');
}

/** Minimal `~X.Y.Z` satisfaction check (no semver dep): same major.minor, patch >= Z. */
export function satisfiesTildeRange(version, pinVersion) {
  const pin = /^~(\d+)\.(\d+)\.(\d+)/.exec(String(pinVersion));
  const ver = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version));
  if (!pin || !ver) return false;
  return ver[1] === pin[1] && ver[2] === pin[2] && parseInt(ver[3], 10) >= parseInt(pin[3], 10);
}

/**
 * Walk up node_modules from this plugin's directory AND from $CWD looking
 * for an already-installed copy of `pkg` (e.g. the optionalDependency the
 * user's ruflo install shipped with). Returns the package dir or null.
 * When `pinVersion` is given, only a copy satisfying the pin is accepted —
 * a stale major/minor in an ancestor node_modules is skipped, not used.
 */
export function findLocalPackageDir(pkg, pinVersion) {
  if (process.env.RUFLO_METAHARNESS_SKIP_LOCAL === '1') return null;
  const segments = pkg.split('/');
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  const seen = new Set();
  for (const start of starts) {
    let dir = start;
    for (;;) {
      if (!seen.has(dir)) {
        seen.add(dir);
        const candidate = join(dir, 'node_modules', ...segments);
        const pj = join(candidate, 'package.json');
        if (existsSync(pj)) {
          if (!pinVersion) return candidate;
          try {
            const version = JSON.parse(readFileSync(pj, 'utf-8')).version;
            if (satisfiesTildeRange(version, pinVersion)) return candidate;
          } catch { /* unreadable — keep walking */ }
        }
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/**
 * One-time versioned cache install of a PINNED range. Generalizes
 * gepa.mjs:98-121 / _redblue.mjs:72-102. The cache dir is
 * `<base>/<shortname>-cache-<pin-digits>` (e.g. redblue-cache-0.1.4,
 * darwin-cache-0.8.0, metaharness-cache-0.3.0) so existing caches created
 * by the pre-consolidation helpers remain valid, and bumping the pin
 * invalidates stale installs automatically.
 *
 * @param {object} spec
 * @param {string} spec.pkg          npm package name (may be scoped)
 * @param {string} spec.pinVersion   tilde range, e.g. '~0.3.0'
 * @param {string} [spec.cliRelPath] path inside the package that must exist
 *                                   post-install (also returned as cliPath)
 * @param {number} [spec.timeoutMs]  install timeout (default 180s)
 * @returns {{ok:true, cacheDir:string, pkgDir:string, cliPath:string|null} |
 *           {ok:false, reason:string, stderr?:string, stdout?:string, error?:string}}
 */
export function ensureCachedInstall({ pkg, pinVersion, cliRelPath, timeoutMs = INSTALL_TIMEOUT_MS }) {
  const short = pkg.split('/').pop();
  const cacheDir = join(cacheBaseDir(), `${short}-cache-${pinVersion.replace(/[~^]/g, '')}`);
  const pkgDir = join(cacheDir, 'node_modules', ...pkg.split('/'));
  const cliPath = cliRelPath ? join(pkgDir, cliRelPath) : null;
  const probe = cliPath ?? join(pkgDir, 'package.json');
  if (existsSync(probe)) return { ok: true, cacheDir, pkgDir, cliPath };
  try {
    mkdirSync(cacheDir, { recursive: true });
  } catch (e) {
    return { ok: false, reason: 'cache-dir-create-failed', error: String(e) };
  }
  // `npm install --prefix` puts the package in a known location; this both
  // avoids npx's symlinked bin shim (the _redblue isMain upstream bug) and
  // removes the per-call registry check that `npx -y pkg@latest` forced.
  // shell:false; argv only.
  const r = spawnSync('npm', [
    'install',
    '--no-audit', '--no-fund', '--no-package-lock',
    '--prefix', cacheDir,
    `${pkg}@${pinVersion}`,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: timeoutMs,
    shell: process.platform === 'win32',
  });
  if (r.status !== 0 || !existsSync(probe)) {
    return {
      ok: false,
      reason: 'install-failed',
      stderr: (r.stderr || '').slice(0, 600),
      stdout: (r.stdout || '').slice(0, 600),
    };
  }
  return { ok: true, cacheDir, pkgDir, cliPath };
}

/**
 * Import an optional LIBRARY entry (as opposed to spawning a CLI):
 *   1. bare `import(specifier)` — free when the optional dep is installed in
 *      an ancestor node_modules;
 *   2. versioned cache install + file-URL import of `entryRelPath`.
 * Returns the module namespace or null. Never throws on absence / stale
 * installs (ERR_PACKAGE_PATH_NOT_EXPORTED covers pre-subpath versions).
 */
export async function importOptionalLibrary({ specifier, pkg, pinVersion, entryRelPath }) {
  try {
    return await import(specifier);
  } catch (e) {
    const msg = String(e?.message ?? e);
    const recoverable = /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|is not defined by "exports"/i;
    if (!recoverable.test(msg)) throw e;
  }
  const r = ensureCachedInstall({ pkg, pinVersion, cliRelPath: entryRelPath });
  if (!r.ok || !r.cliPath) return null;
  try {
    return await import(pathToFileURL(r.cliPath).href);
  } catch {
    return null;
  }
}

/**
 * Build the per-package `emit*DegradedJsonAndExit(reason)` helper. Emits the
 * structured degraded payload and exits 0 — ADR-150 architectural constraint
 * rule #3: ruflo continues to function when MetaHarness is absent.
 */
export function makeDegradedEmitter(pkg, pinVersion) {
  return function emitDegradedAndExit(reason) {
    const payload = {
      degraded: true,
      reason,
      hint: `Install with \`npm i -D ${pkg}@${pinVersion}\` (pinned range — this plugin never fetches @latest) or verify network access for the one-time cache install.`,
      generatedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exit(0);
  };
}
