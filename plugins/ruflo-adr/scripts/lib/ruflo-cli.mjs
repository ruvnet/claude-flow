// ruflo-cli.mjs — which ruflo CLI adr-index / adr-reindex / adr-verify run (#3558).
//
// Every memory call used to be `npx @claude-flow/cli@latest …`, even on a
// machine where ruflo is installed. A plugin installed from the
// Claude Code marketplace is copied to
// ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/ with no CLI next
// to it, so each call — one `memory store` per ADR and per edge —
//   - resolved `latest` through the npm registry (a round trip per call;
//     offline it fails and the record is lost);
//   - could run a DIFFERENT @claude-flow/cli than the one the user installed
//     or pinned: another memory backend / schema than the `ruflo memory
//     search` that must find these records (#2781, #3306), including a
//     release published minutes earlier.
//
// Resolution order, first hit wins (ruflo-metaharness/_invoke.mjs
// resolveRufloCli() from #3366, plus ruflo-core's PATH preference):
//   1. CLI_CORE=1 is ignored by this plugin (#2781), so there is no
//      cli-core step: writer and reader must stay on the same store.
//   2. a built @claude-flow/cli that ships this plugin (<cli>/plugins/<plugin>;
//      only ruflo-metaharness is published there today) or a repo checkout
//      (<repo>/v3/@claude-flow/cli), with #3366's guards: package.json named
//      @claude-flow/cli AND bin/cli.js AND dist/src/index.js.
//   3. a `ruflo`, then `claude-flow`, executable on PATH (fs-only probe).
//   4. null → the unchanged `npx @claude-flow/cli@latest` fallback.
//
// TEST SEAMS (same style as ruflo-metaharness's RUFLO_METAHARNESS_SKIP_LOCAL),
// so a test that stubs npx cannot pick up a developer's built checkout or
// installed ruflo instead:
//   - RUFLO_PLUGIN_SKIP_LOCAL_CLI=1  disables step 2
//   - RUFLO_PLUGIN_SKIP_PATH_CLI=1   disables step 3

import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLI_PKG } from './index-records.mjs';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Case-insensitive env lookup — Windows env keys are not case-stable (`Path`). */
function envValue(env, name) {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

/** bin/cli.js of a built @claude-flow/cli at `dir`, else null (#3366 guards). */
function builtCliBin(dir) {
  try {
    const bin = join(dir, 'bin', 'cli.js');
    const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    if (pj.name === '@claude-flow/cli' && existsSync(bin) && existsSync(join(dir, 'dist', 'src', 'index.js'))) return bin;
  } catch { /* not this layout */ }
  return null;
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

let RUFLO_CLI;
/** `{ command, args, shell, source }` for an installed ruflo CLI, or null (→ npx). Memoized. */
export function resolveRufloCli() {
  if (RUFLO_CLI !== undefined) return RUFLO_CLI;
  const candidates = process.env.RUFLO_PLUGIN_SKIP_LOCAL_CLI === '1' ? [] : [
    join(PLUGIN_ROOT, '..', '..'),                              // published: <cli>/plugins/<plugin>
    join(PLUGIN_ROOT, '..', '..', 'v3', '@claude-flow', 'cli'), // repo checkout / marketplace clone
  ];
  for (const dir of candidates) {
    const bin = builtCliBin(dir);
    if (bin) return (RUFLO_CLI = { command: process.execPath, args: [bin], shell: false, source: 'local' });
  }
  RUFLO_CLI = process.env.RUFLO_PLUGIN_SKIP_PATH_CLI === '1' ? null : findRufloOnPath();
  return RUFLO_CLI;
}

/**
 * spawnSync `npx <npxArgs>` — unless npxArgs[0] is CLI_PKG and an installed
 * ruflo CLI resolves, which then runs with the rest of the argv and no shell.
 */
export function spawnCliSync(npxArgs, options = {}) {
  const cli = npxArgs[0] === CLI_PKG ? resolveRufloCli() : null;
  if (cli) return spawnSync(cli.command, [...cli.args, ...npxArgs.slice(1)], { ...options, shell: false });
  return spawnSync('npx', npxArgs, options);
}
