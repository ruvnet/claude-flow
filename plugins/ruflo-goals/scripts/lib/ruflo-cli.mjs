// ruflo-cli.mjs — which ruflo CLI research-list.mjs runs (#3558).
//
// research-list.mjs ran `npx -y @claude-flow/cli@latest` for the namespace
// listing and again for EVERY research record. A plugin installed from the
// Claude Code marketplace is copied to
// ~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/ with no CLI next
// to it, so each call resolved `latest` through the npm registry and could run
// a different @claude-flow/cli (and memory store) than the one the user
// installed and that deep-research wrote with.
//
// Same resolution as ruflo-adr/scripts/lib/ruflo-cli.mjs, first hit wins:
//   1. a built @claude-flow/cli that ships this plugin, or a repo checkout
//      (<repo>/v3/@claude-flow/cli), guarded by package.json name AND
//      bin/cli.js AND dist/src/index.js;
//   2. a `ruflo`, then `claude-flow`, executable on PATH (fs-only probe);
//   3. otherwise the unchanged `npx -y @claude-flow/cli@latest`.
//
// TEST SEAMS (shared with ruflo-adr): RUFLO_PLUGIN_SKIP_LOCAL_CLI=1 disables
// step 1, RUFLO_PLUGIN_SKIP_PATH_CLI=1 disables step 2.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_PKG = '@claude-flow/cli@latest';

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
 * Run the ruflo CLI with `cliArgs` (e.g. ['memory', 'list', ...]): the
 * installed one when it resolves, else `npx -y @claude-flow/cli@latest`,
 * exactly as before. Never a shell.
 */
export function runCli(cliArgs, options = {}) {
  const cli = resolveRufloCli();
  if (cli) return spawnSync(cli.command, [...cli.args, ...cliArgs], { ...options, shell: false });
  return spawnSync('npx', ['-y', CLI_PKG, ...cliArgs], { ...options, shell: false });
}
