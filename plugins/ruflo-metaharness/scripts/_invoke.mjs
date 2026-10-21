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
//   - parseTrailingJson()     complete trailing-object extraction (progress
//                             lines before the JSON are ignored, while nested
//                             objects remain part of the root payload)
//   - ensureCachedInstall()   one-time `npm install --prefix ~/.ruflo/<name>-cache-<pin>`
//                             of a PINNED range — generalizes _redblue.mjs /
//                             gepa.mjs; the versioned dir means pin bumps
//                             invalidate stale caches automatically
//   - findLocalPackageDir()   walk-up node_modules resolution so an already
//                             installed optionalDependency is used for free
//   - resolvePackageBin()     realpath'd bin-map entry of a resolved package
//                             (#3366 — lets _darwin/_redblue run the installed
//                             copy instead of npx / a cache install)
//   - importOptionalLibrary() bare-import → cached-install fallback for
//                             library entries (gepa) — never throws on absence
//   - makeDegradedEmitter()   the ADR-150 rule-#3 exit-0 degraded payload
//   - runRufloCli()           `memory store|list|retrieve` through the ruflo CLI
//                             that ships this plugin (#3366), else an installed
//                             `ruflo` / `claude-flow` on PATH (#3558) — replaces
//                             `npx @claude-flow/cli@latest` in 4 scripts
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
//   - RUFLO_PLUGIN_SKIP_LOCAL_CLI=1  resolveRufloCli() skips the shipping CLI /
//                                    repo checkout (#3558; same name in
//                                    ruflo-cost-tracker and ruflo-adr)
//   - RUFLO_PLUGIN_SKIP_PATH_CLI=1   resolveRufloCli() skips `ruflo` /
//                                    `claude-flow` on PATH (#3558)

import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
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
 * human-readable progress first and a structured JSON object LAST.
 *
 * Trying candidate opening braces against the complete trailing substring is
 * intentional. A regex that selects the "last parseable {...} block" returns
 * the final nested finding from pretty-printed payloads instead of the root
 * object, silently discarding findings[], worst, and other security fields.
 */
export function parseTrailingJson(stdout) {
  const s = String(stdout || '').trimEnd();
  for (let i = s.lastIndexOf('{'); i >= 0; i = s.lastIndexOf('{', i - 1)) {
    try { return JSON.parse(s.slice(i)); } catch { /* try the enclosing object */ }
  }
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
 *
 * `{ fromCwd: false }` (#3366) searches ONLY the ruflo install that owns this
 * plugin. The $CWD walk reaches every ancestor of the tool's working
 * directory, i.e. directories the user's project — or anything above it —
 * controls. That is tolerable for the pre-existing `metaharness` lookup,
 * which this PR does not change, but the two lookups added here (_darwin,
 * _redblue) END IN A SPAWN of the package's bin with MCP-supplied argv, so
 * they stay inside ruflo's own tree and fall back to the pinned cache
 * install instead.
 */
export function findLocalPackageDir(pkg, pinVersion, { fromCwd = true } = {}) {
  if (process.env.RUFLO_METAHARNESS_SKIP_LOCAL === '1') return null;
  const segments = pkg.split('/');
  const starts = fromCwd
    ? [dirname(fileURLToPath(import.meta.url)), process.cwd()]
    : [dirname(fileURLToPath(import.meta.url))];
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
 * Absolute path of `binName` from the package.json `bin` map of an already
 * resolved package dir (findLocalPackageDir / ensureCachedInstall), or null.
 * Read from the bin map rather than hardcoded, same as _harness.mjs.
 *
 * REALPATH'd on purpose (#3366): pnpm and other symlinked layouts hand us a
 * symlinked package dir, and @metaharness/redblue's CLI only dispatches when
 * `import.meta.url === file://${process.argv[1]}` (see _redblue.mjs) — Node
 * reports import.meta.url as the REAL path, so argv[1] has to be one too or
 * the CLI exits 0 having done nothing.
 */
export function resolvePackageBin(pkgDir, binName) {
  const rel = packageBinRelPath(pkgDir, binName);
  if (!rel) return null;
  try {
    const abs = join(pkgDir, rel);
    return existsSync(abs) ? realpathSync(abs) : null;
  } catch {
    return null;
  }
}

/** The package.json `bin` entry for `binName`, as declared (relative), or null. */
export function packageBinRelPath(pkgDir, binName) {
  try {
    const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
    const rel = typeof pj.bin === 'string' ? pj.bin : pj.bin?.[binName];
    return rel || null;
  } catch {
    return null;
  }
}

/**
 * One-time versioned cache install of a PINNED range. Generalizes
 * gepa.mjs:98-121 / _redblue.mjs:72-102. The cache dir is
 * `<base>/<shortname>-cache-<pin-digits>` (e.g. redblue-cache-0.1.4,
 * darwin-cache-0.10.2, metaharness-cache-0.4.1) so existing caches created
 * by the pre-consolidation helpers remain valid, and bumping the pin
 * invalidates stale installs automatically (the pre-bump darwin-cache-0.8.0
 * and metaharness-cache-0.3.0 dirs are simply no longer selected).
 *
 * @param {object} spec
 * @param {string} spec.pkg          npm package name (may be scoped)
 * @param {string} spec.pinVersion   tilde range, e.g. '~0.4.1'
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

// ---------------------------------------------------------------------------
// The ruflo CLI that ships this plugin (#3366)
// ---------------------------------------------------------------------------
// audit-list / audit-trend / oia-audit / similarity read and write the
// `metaharness-audit` memory namespace through the ruflo CLI. They used to
// spawn `npx @claude-flow/cli@latest memory …`, which on every call:
//   - resolved `latest` through the npm registry (the "metadata check on
//     EVERY call" _harness.mjs removed for its own npx path); without registry
//     access it fails, so oia_audit reports `persisted: false` and audit_list
//     silently reports 0 records;
//   - could run a DIFFERENT @claude-flow/cli than the one that spawned the
//     tool (npx cache vs registry skew — #3306), i.e. another memory backend /
//     schema than the MCP server's own memory_* tools see;
//   - cold-fetched the whole CLI when the npx cache was empty (#3145, #3154).
// The plugin is published INSIDE @claude-flow/cli
// (<cli>/plugins/ruflo-metaharness/scripts — see prepare-publish.mjs), and the
// MCP server / `ruflo metaharness` dispatcher locate it by walking up from
// their own dist/, so the owning CLI is two directories above this plugin.
// It is run with process.execPath + bin/cli.js (the mcp-launch.cjs /
// daemon-autostart.ts pattern). A candidate only counts when dist/src/index.js
// exists next to bin/cli.js — mcp-launch.cjs resolveLocalCliBin()'s guard
// against an unbuilt checkout — AND its package.json is named
// @claude-flow/cli, a check added here so an unrelated directory two levels up
// can never qualify.
// #3558: a Claude Code marketplace install copies the plugin to
// ~/.claude/plugins/cache/<marketplace>/ruflo-metaharness/<version>/, where
// neither candidate exists, so every memory call still went to npx @latest on
// a machine with ruflo installed. A `ruflo`, then `claude-flow`, found on
// PATH (ruflo-core ruflo-hook.cjs's order) is now tried before npx.
// Unchanged:
//   - CLI_CORE=1 still opts into `npx @claude-flow/cli-core@alpha` (ADR-100);
//   - no usable local CLI and no ruflo on PATH still falls back to
//     `npx @claude-flow/cli@latest`.
const PLUGIN_SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Case-insensitive env lookup — Windows env keys are not case-stable (`Path`). */
function envValue(env, name) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

/**
 * npm's Windows shim (`<prefix>/ruflo.cmd`, or `node_modules/.bin/ruflo.cmd`)
 * cannot be spawned without a shell (CVE-2024-27980), so map it to the entry
 * it wraps: the package's own `bin` field, which must resolve inside the
 * package — ruflo-core's resolveNpmShim(). null when it is not such a shim.
 */
function npmShimEntry(shim, name) {
  try {
    const shimDir = dirname(shim);
    const pkgDir = basename(shimDir).toLowerCase() === '.bin'
      ? join(shimDir, '..', name)
      : join(shimDir, 'node_modules', name);
    const pj = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
    const declared = typeof pj.bin === 'string' ? pj.bin : pj.bin?.[name];
    if (typeof declared !== 'string') return null;
    const entry = realpathSync(join(pkgDir, declared));
    const rel = relative(realpathSync(pkgDir), entry);
    if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || !statSync(entry).isFile()) return null;
    return entry;
  } catch { return null; }
}

/**
 * `ruflo`, then `claude-flow`, on PATH → `{ command, args, shell, source }`,
 * else null. fs-only like ruflo-core's resolveCommandPath(): no `which` /
 * `where` shell per call. Relative PATH entries (including the empty one) are
 * skipped so a `ruflo` file inside the project being worked on is never run.
 * On win32 only an npm shim that maps to its JS entry counts; anything else
 * is skipped rather than run through cmd.exe. `env` / `platform` are
 * parameters so the win32 branch is testable on POSIX.
 */
export function findRufloOnPath(env = process.env, platform = process.platform) {
  const dirs = (envValue(env, 'PATH') || '')
    .split(platform === 'win32' ? ';' : delimiter)
    .filter((d) => isAbsolute(d));
  for (const name of ['ruflo', 'claude-flow']) {
    for (const dir of dirs) {
      if (platform === 'win32') {
        const shim = join(dir, `${name}.cmd`);
        const entry = existsSync(shim) ? npmShimEntry(shim, name) : null;
        if (entry) return { command: process.execPath, args: [entry], shell: false, source: 'path' };
        continue;
      }
      const file = join(dir, name);
      try {
        accessSync(file, constants.X_OK);
        if (statSync(file).isFile()) return { command: file, args: [], shell: false, source: 'path' };
      } catch { /* keep searching */ }
    }
  }
  return null;
}

let RUFLO_CLI = null;
/** `{ command, args, shell, source }` for invoking the ruflo CLI. Memoized. */
export function resolveRufloCli() {
  if (RUFLO_CLI) return RUFLO_CLI;
  if (process.env.CLI_CORE === '1') {
    return (RUFLO_CLI = { command: 'npx', args: ['@claude-flow/cli-core@alpha'], shell: process.platform === 'win32', source: 'npx-cli-core' });
  }
  const candidates = process.env.RUFLO_PLUGIN_SKIP_LOCAL_CLI === '1' ? [] : [
    join(PLUGIN_SCRIPTS_DIR, '..', '..', '..'),                              // published: <cli>/plugins/ruflo-metaharness/scripts
    join(PLUGIN_SCRIPTS_DIR, '..', '..', '..', 'v3', '@claude-flow', 'cli'), // repo checkout / marketplace clone
  ];
  for (const dir of candidates) {
    try {
      const bin = join(dir, 'bin', 'cli.js');
      const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
      if (pj.name === '@claude-flow/cli' && existsSync(bin) && existsSync(join(dir, 'dist', 'src', 'index.js'))) {
        return (RUFLO_CLI = { command: process.execPath, args: [bin], shell: false, source: 'local' });
      }
    } catch { /* not this layout — try the next */ }
  }
  const onPath = process.env.RUFLO_PLUGIN_SKIP_PATH_CLI === '1' ? null : findRufloOnPath();
  if (onPath) return (RUFLO_CLI = onPath);
  return (RUFLO_CLI = { command: 'npx', args: ['@claude-flow/cli@latest'], shell: process.platform === 'win32', source: 'npx' });
}

/** spawnSync the ruflo CLI with `args` (e.g. ['memory', 'list', …]); same result shape as before. */
export function runRufloCli(args, opts = {}) {
  const cli = resolveRufloCli();
  return spawnSync(cli.command, [...cli.args, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    shell: cli.shell,
    ...opts,
  });
}
