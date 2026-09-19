/**
 * hook-handler.cjs must find a globally-installed CLI before falling back to
 * npx (#3368).
 *
 * `npm install -g ruflo` (the README's global install) puts the CLI at
 * <prefix>/lib/node_modules/ruflo/node_modules/@claude-flow/cli, which none
 * of resolveCliBinForHook()'s project-relative candidates cover. Every
 * SessionStart on such a machine therefore spawned
 * `npx --prefer-offline @claude-flow/cli hooks refresh-*`: a second copy of
 * the CLI that follows the registry's latest instead of the pinned version,
 * and cannot start offline on a cold npx cache.
 *
 * Each end-to-end case builds a fake install layout in a temp dir, puts an
 * `npx` trap first on PATH (it only logs its argv; the real npx is never
 * reachable), runs the hook exactly as Claude Code's SessionStart does, and
 * asserts which binary the two detached refreshes actually ran. The
 * "resolves" cases fail on the unfixed helper (both refreshes hit the npx
 * trap); the "still" cases pin behaviour the fix must not change.
 *
 * Hermetic: every case points HOME at an empty dir and sets npm's prefix
 * explicitly (npm_config_prefix, or a sandbox ~/.npmrc), so the host's own
 * npm config and global installs can never leak into a result.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// The shipped copy; hook-handler-artifact-parity.test.ts keeps the repo's
// dogfood copy byte-identical to it.
const HOOK_HANDLER = path.resolve(here, '../.claude/helpers/hook-handler.cjs');

const sandboxes: string[] = [];
afterAll(() => {
  for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
});

interface Sandbox { root: string; home: string; project: string; hook: string; trap: string; noPrefix: string }

function sandbox(): Sandbox {
  // realpath: macOS tmpdir() is a symlink (/var -> /private/var), and the
  // resolver reports realpath'd locations.
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'hook-global-cli-')));
  sandboxes.push(root);
  const home = path.join(root, 'home'); // empty: no ~/.npmrc, no ~/.claude/plugins checkout
  const project = path.join(root, 'project');
  const helpers = path.join(project, '.claude', 'helpers');
  const trap = path.join(root, 'trap');
  const noPrefix = path.join(root, 'empty-npm-prefix');
  for (const d of [home, helpers, trap, noPrefix]) mkdirSync(d, { recursive: true });
  const hook = path.join(helpers, 'hook-handler.cjs');
  copyFileSync(HOOK_HANDLER, hook);
  writeFileSync(path.join(trap, 'npx'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$NPX_LOG"\n');
  chmodSync(path.join(trap, 'npx'), 0o755);
  return { root, home, project, hook, trap, noPrefix };
}

function write(file: string, content: string, mode?: number) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (mode) chmodSync(file, mode);
}

/** A built @claude-flow/cli whose bin/cli.js records how it was invoked. */
function fakeCli(dir: string, { built = true } = {}): string {
  const bin = path.join(dir, 'bin', 'cli.js');
  write(path.join(dir, 'package.json'), '{"name":"@claude-flow/cli","version":"3.42.4"}');
  write(bin,
    "require('fs').appendFileSync(process.env.CLI_LOG, " +
    "JSON.stringify({ bin: __filename, args: process.argv.slice(2) }) + '\\n');\n", 0o755);
  if (built) write(path.join(dir, 'dist', 'src', 'index.js'), 'export {};\n');
  return bin;
}

/** A package with a bin entry, linked from binDir the way npm/yarn/bun link it. */
function linkedPackage(pkgDir: string, name: string, entry: string, binDir: string) {
  write(path.join(pkgDir, 'package.json'), JSON.stringify({ name }));
  if (!existsSync(path.join(pkgDir, entry))) write(path.join(pkgDir, entry), '// entry\n', 0o755);
  mkdirSync(binDir, { recursive: true });
  const command = name === 'ruflo' ? 'ruflo' : 'claude-flow';
  symlinkSync(path.relative(binDir, path.join(pkgDir, entry)), path.join(binDir, command));
}

/** `npm install -g ruflo` under `prefix`: bin/ruflo -> lib/node_modules/ruflo, CLI nested. */
function npmGlobalRuflo(prefix: string, opts?: { built?: boolean }): string {
  const pkg = path.join(prefix, 'lib', 'node_modules', 'ruflo');
  const cli = fakeCli(path.join(pkg, 'node_modules', '@claude-flow', 'cli'), opts);
  linkedPackage(pkg, 'ruflo', 'bin/ruflo.js', path.join(prefix, 'bin'));
  return cli;
}

type Env = Record<string, string | undefined>;

async function runSessionRestore(sb: Sandbox, pathDirs: string[], env: Env = {}) {
  const npxLog = path.join(sb.root, 'npx.log');
  const cliLog = path.join(sb.root, 'cli.log');
  const fullEnv: Env = {
    HOME: sb.home,
    USERPROFILE: sb.home,
    PATH: [sb.trap, ...pathDirs].join(path.delimiter),
    npm_config_prefix: sb.noPrefix, // overridden (or removed) per case
    RUFLO_NO_AUTO_ENABLE: '1',
    NPX_LOG: npxLog,
    CLI_LOG: cliLog,
    ...env,
  };
  for (const k of Object.keys(fullEnv)) if (fullEnv[k] === undefined) delete fullEnv[k];
  const run = spawnSync(process.execPath, [sb.hook, 'session-restore'], {
    cwd: sb.project, input: '', encoding: 'utf8', timeout: 15_000, env: fullEnv as NodeJS.ProcessEnv,
  });
  expect(run.status).toBe(0);
  const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean) : []);
  // Both refreshes are detached + unref'd; wait for them to record.
  for (let waited = 0; waited < 10_000; waited += 50) {
    if (read(npxLog).length + read(cliLog).length >= 2) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return { npx: read(npxLog), cli: read(cliLog).map((l) => JSON.parse(l) as { bin: string; args: string[] }) };
}

type Result = Awaited<ReturnType<typeof runSessionRestore>>;

function expectRanCli(result: Result, bin: string) {
  expect(result.npx, 'no refresh may fall back to npx').toEqual([]);
  expect(result.cli.map((c) => c.bin)).toEqual([bin, bin]);
  expect(result.cli.map((c) => c.args)).toEqual(expect.arrayContaining([
    ['hooks', 'refresh-funnel', '--quiet'],
    ['hooks', 'refresh-advisor', '--quiet'],
  ]));
}

function expectFellBackToNpx(result: Result) {
  expect(result.cli).toEqual([]);
  expect(result.npx.sort()).toEqual([
    '--prefer-offline @claude-flow/cli hooks refresh-advisor --quiet',
    '--prefer-offline @claude-flow/cli hooks refresh-funnel --quiet',
  ]);
}

// Symlinks and a /bin/sh trap: these are the POSIX layouts. The Windows npm
// layout is covered below through resolveGlobalCliBin() directly.
describe.skipIf(process.platform === 'win32')('hook-handler.cjs — global CLI before npx (#3368)', () => {
  describe('via npm\'s global prefix', () => {
    it('resolves `npm i -g ruflo` with the prefix set in ~/.npmrc and its bin/ NOT on PATH (the reported setup)', { timeout: 30_000 }, async () => {
      const sb = sandbox();
      const prefix = path.join(sb.root, 'npm-global');
      const cli = npmGlobalRuflo(prefix);
      write(path.join(sb.home, '.npmrc'), `prefix=${prefix}\n`);
      expectRanCli(await runSessionRestore(sb, [], { npm_config_prefix: undefined }), cli);
    });

    it('resolves `npm i -g claude-flow` (umbrella bundles v3/@claude-flow/cli; its own bin/cli.js has no dist)', { timeout: 30_000 }, async () => {
      const sb = sandbox();
      const prefix = path.join(sb.root, 'npm-global');
      const pkg = path.join(prefix, 'lib', 'node_modules', 'claude-flow');
      const cli = fakeCli(path.join(pkg, 'v3', '@claude-flow', 'cli'));
      write(path.join(pkg, 'bin', 'cli.js'), '// umbrella proxy; must not be picked (no dist beside it)\n', 0o755);
      expectRanCli(await runSessionRestore(sb, [], { npm_config_prefix: prefix }), cli);
    });

    it('resolves `npm i -g @claude-flow/cli` (the package is the CLI itself)', { timeout: 30_000 }, async () => {
      const sb = sandbox();
      const prefix = path.join(sb.root, 'npm-global');
      const cli = fakeCli(path.join(prefix, 'lib', 'node_modules', '@claude-flow', 'cli'));
      expectRanCli(await runSessionRestore(sb, [], { NPM_CONFIG_PREFIX: prefix, npm_config_prefix: undefined }), cli);
    });
  });

  describe('via PATH', () => {
    it('resolves a `ruflo` on PATH installed under a prefix npm is no longer configured for', { timeout: 30_000 }, async () => {
      const sb = sandbox();
      const other = path.join(sb.root, 'other-prefix');
      const cli = npmGlobalRuflo(other);
      expectRanCli(await runSessionRestore(sb, [path.join(other, 'bin')]), cli);
    });

    it('resolves a yarn/bun global (dependency hoisted beside ruflo, not nested)', { timeout: 30_000 }, async () => {
      const sb = sandbox();
      const globalDir = path.join(sb.root, 'bun', 'install', 'global', 'node_modules');
      const cli = fakeCli(path.join(globalDir, '@claude-flow', 'cli'));
      linkedPackage(path.join(globalDir, 'ruflo'), 'ruflo', 'bin/ruflo.js', path.join(sb.root, 'bun', 'bin'));
      expectRanCli(await runSessionRestore(sb, [path.join(sb.root, 'bun', 'bin')]), cli);
    });
  });

  describe('unchanged behaviour', () => {
    it('still prefers a project-local install over a global one', { timeout: 30_000 }, async () => {
      const sb = sandbox();
      const local = fakeCli(path.join(sb.project, 'node_modules', '@claude-flow', 'cli'));
      const prefix = path.join(sb.root, 'npm-global');
      npmGlobalRuflo(prefix);
      expectRanCli(await runSessionRestore(sb, [path.join(prefix, 'bin')], { npm_config_prefix: prefix }), local);
    });

    it('still falls back to npx when the global CLI has no compiled dist', { timeout: 30_000 }, async () => {
      const sb = sandbox();
      const prefix = path.join(sb.root, 'npm-global');
      npmGlobalRuflo(prefix, { built: false });
      expectFellBackToNpx(await runSessionRestore(sb, [path.join(prefix, 'bin')], { npm_config_prefix: prefix }));
    });

    it('still falls back to npx when there is no global install at all', { timeout: 30_000 }, async () => {
      const sb = sandbox();
      expectFellBackToNpx(await runSessionRestore(sb, []));
    });

    it('never trusts a relative PATH entry, so a bare `./ruflo` is not picked up', { timeout: 30_000 }, async () => {
      const sb = sandbox();
      const pkg = path.join(sb.project, 'vendor', 'ruflo');
      fakeCli(path.join(pkg, 'node_modules', '@claude-flow', 'cli'));
      linkedPackage(pkg, 'ruflo', 'bin/ruflo.js', sb.project); // ./ruflo in the project root
      expectFellBackToNpx(await runSessionRestore(sb, ['.']));
    });
  });
});

describe('hook-handler.cjs — resolveGlobalCliBin() / npmGlobalPrefix() units (#3368)', () => {
  // Load a sandbox copy: it has no router/session/intelligence siblings to
  // side-effect on require, and require() never runs main() (require.main guard).
  function load(sb: Sandbox) {
    return createRequire(import.meta.url)(sb.hook) as {
      resolveGlobalCliBin: (env: Env, platform?: string, execPath?: string) => string | null;
      npmGlobalPrefix: (env: Env, platform?: string, execPath?: string) => string | null;
    };
  }

  // npm on Windows puts ruflo.cmd (plus sh/ps1 shims) straight into the
  // prefix, beside node_modules\ruflo, with no lib/ level and nothing to
  // realpath. Same layout resolveNpmShim() in ruflo-hook.cjs maps.
  it('maps the Windows npm layout via the prefix and via ruflo.cmd on PATH', () => {
    const sb = sandbox();
    const { resolveGlobalCliBin } = load(sb);
    const prefix = path.join(sb.root, 'AppData', 'Roaming', 'npm');
    write(path.join(prefix, 'ruflo.cmd'), '@ECHO off\r\n');
    const cli = fakeCli(path.join(prefix, 'node_modules', 'ruflo', 'node_modules', '@claude-flow', 'cli'));
    const base = { USERPROFILE: sb.home };
    expect(resolveGlobalCliBin({ ...base, npm_config_prefix: prefix }, 'win32')).toBe(cli);
    expect(resolveGlobalCliBin({ ...base, npm_config_prefix: sb.noPrefix, Path: prefix }, 'win32')).toBe(cli);
    expect(resolveGlobalCliBin({ ...base, npm_config_prefix: sb.noPrefix, PATH: sb.home }, 'win32')).toBeNull();
  });

  it('reads the prefix the way npm does: env over ~/.npmrc, last line wins, ~ and ${VAR} expanded', () => {
    const sb = sandbox();
    const { npmGlobalPrefix } = load(sb);
    const npmrc = path.join(sb.home, '.npmrc');
    const env = { HOME: sb.home, BASE: '/opt/base' };
    write(npmrc, '; comment\n//registry.npmjs.org/:_authToken=secret\nprefix=/first\nprefix = ~/.npm-global\n');
    expect(npmGlobalPrefix(env, 'darwin')).toBe(path.join(sb.home, '.npm-global'));
    expect(npmGlobalPrefix({ ...env, npm_config_prefix: '/from-env' }, 'darwin')).toBe(path.resolve('/from-env'));
    expect(npmGlobalPrefix({ ...env, NPM_CONFIG_PREFIX: '/from-env-upper' }, 'darwin')).toBe(path.resolve('/from-env-upper'));
    write(npmrc, 'prefix="${BASE}/npm"\r\n');
    expect(npmGlobalPrefix(env, 'darwin')).toBe(path.resolve('/opt/base/npm'));
    const custom = path.join(sb.root, 'custom-npmrc');
    write(custom, 'prefix=/via-userconfig\n');
    expect(npmGlobalPrefix({ ...env, npm_config_userconfig: custom }, 'darwin')).toBe(path.resolve('/via-userconfig'));
    expect(npmGlobalPrefix({ ...env, npm_config_prefix: 'relative/dir' }, 'darwin')).toBeNull();
  });

  it('keeps an undefined ${VAR} literal, as npm does, instead of anchoring the path at the root', () => {
    const sb = sandbox();
    const { npmGlobalPrefix } = load(sb);
    const env = { HOME: sb.home };
    write(path.join(sb.home, '.npmrc'), 'prefix=${NOT_SET}/npm-global\n');
    // Left literal the value is relative, so it is rejected — not turned into
    // "/npm-global" next to the drive root.
    expect(npmGlobalPrefix(env, 'darwin')).not.toBe(path.resolve('/npm-global'));
    expect(npmGlobalPrefix(env, 'darwin')).toBeNull();
    // `${VAR?}` is npm's "empty if unset" form.
    write(path.join(sb.home, '.npmrc'), 'prefix=/opt${NOT_SET?}/npm\n');
    expect(npmGlobalPrefix(env, 'darwin')).toBe(path.resolve('/opt/npm'));
  });

  it('ignores an inline comment and any key below a [section] header', () => {
    const sb = sandbox();
    const { npmGlobalPrefix } = load(sb);
    const env = { HOME: sb.home };
    write(path.join(sb.home, '.npmrc'), 'prefix=/opt/one ; trailing comment\n');
    expect(npmGlobalPrefix(env, 'darwin')).toBe(path.resolve('/opt/one'));
    write(path.join(sb.home, '.npmrc'), 'prefix=/opt/one\n[scope]\nprefix=/opt/sectioned\n');
    expect(npmGlobalPrefix(env, 'darwin')).toBe(path.resolve('/opt/one'));
  });

  // Steps 3 and 4 of npmGlobalPrefix(): the builtin npmrc in npm's own
  // package (Homebrew keeps npm outside the node keg, which is why
  // process.execPath alone is not enough) and npm's default prefix.
  it('follows the `npm` link beside node to npm\'s builtin npmrc (the Homebrew keg case)', () => {
    const sb = sandbox();
    const { npmGlobalPrefix, resolveGlobalCliBin } = load(sb);
    const keg = path.join(sb.root, 'Cellar', 'node', '26.8.2');
    const prefix = path.join(sb.root, 'brew-prefix');
    const npmPkg = path.join(prefix, 'lib', 'node_modules', 'npm');
    write(path.join(npmPkg, 'bin', 'npm-cli.js'), '// npm\n');
    write(path.join(keg, 'bin', 'node'), '// node\n', 0o755);
    symlinkSync(path.join(npmPkg, 'bin', 'npm-cli.js'), path.join(keg, 'bin', 'npm'));
    write(path.join(npmPkg, 'npmrc'), `prefix = ${prefix}\n`);
    const execPath = path.join(keg, 'bin', 'node');
    const env = { HOME: sb.home };
    expect(npmGlobalPrefix(env, 'darwin', execPath)).toBe(prefix);
    // …and the whole lookup finds a global install with no env hint and no PATH.
    const cli = npmGlobalRuflo(prefix);
    expect(resolveGlobalCliBin(env, 'darwin', execPath)).toBe(cli);
  });

  it('falls back to $PREFIX, then to the directory above node/bin, when no npmrc sets one', () => {
    const sb = sandbox();
    const { npmGlobalPrefix } = load(sb);
    const execPath = path.join(sb.root, 'nvm', 'v26', 'bin', 'node');
    write(execPath, '// node\n', 0o755);
    expect(npmGlobalPrefix({ HOME: sb.home }, 'darwin', execPath)).toBe(path.join(sb.root, 'nvm', 'v26'));
    expect(npmGlobalPrefix({ HOME: sb.home, PREFIX: path.join(sb.root, 'from-prefix-env') }, 'darwin', execPath))
      .toBe(path.join(sb.root, 'from-prefix-env'));
  });

  it('reads the Windows builtin npmrc beside node.exe and expands ${APPDATA}', () => {
    const sb = sandbox();
    const { npmGlobalPrefix } = load(sb);
    const nodeDir = path.join(sb.root, 'Program Files', 'nodejs');
    write(path.join(nodeDir, 'node_modules', 'npm', 'npmrc'), 'prefix=${APPDATA}\\npm\n');
    const appData = path.join(sb.root, 'AppData', 'Roaming');
    const execPath = path.join(nodeDir, 'node.exe');
    // Windows path separators only resolve on win32, so assert that the
    // ${APPDATA} expansion happened rather than the exact joined form.
    expect(npmGlobalPrefix({ USERPROFILE: sb.home, APPDATA: appData }, 'win32', execPath))
      .toContain(appData);
    // With APPDATA unset the value stays literal, so it is relative and rejected.
    expect(npmGlobalPrefix({ USERPROFILE: sb.home }, 'win32', execPath)).toBeNull();
  });

  // The PATH lookup only trusts a symlink into a package that names itself.
  it('ignores a `ruflo` on PATH that is a wrapper script or a version-manager shim', () => {
    const sb = sandbox();
    const { resolveGlobalCliBin } = load(sb);
    const env = { HOME: sb.home, npm_config_prefix: sb.noPrefix };
    // A built CLI sitting in a stray node_modules above the shim's target,
    // e.g. left by an `npm i @claude-flow/cli` in a home directory.
    fakeCli(path.join(sb.root, 'stray', 'node_modules', '@claude-flow', 'cli'));
    const binDir = path.join(sb.root, 'stray', 'volta', 'bin');
    mkdirSync(binDir, { recursive: true });
    write(path.join(sb.root, 'stray', 'volta', 'volta-shim'), '#!/bin/sh\n', 0o755);
    symlinkSync(path.join(sb.root, 'stray', 'volta', 'volta-shim'), path.join(binDir, 'ruflo'));
    expect(resolveGlobalCliBin({ ...env, PATH: binDir }, 'darwin')).toBeNull();
  });

  // WSL appends the Windows PATH, which includes %APPDATA%\npm — where npm
  // writes an extensionless `ruflo` sh shim beside node_modules\ruflo.
  it('does not apply the Windows folder layout on POSIX (WSL keeps its own CLI)', () => {
    const sb = sandbox();
    const { resolveGlobalCliBin } = load(sb);
    const winPrefix = path.join(sb.root, 'mnt', 'c', 'Users', 'me', 'AppData', 'Roaming', 'npm');
    write(path.join(winPrefix, 'ruflo'), '#!/bin/sh\n', 0o755); // npm's sh shim, not a symlink
    fakeCli(path.join(winPrefix, 'node_modules', 'ruflo', 'node_modules', '@claude-flow', 'cli'));
    const env = { HOME: sb.home, npm_config_prefix: sb.noPrefix, PATH: winPrefix };
    expect(resolveGlobalCliBin(env, 'linux')).toBeNull();
    expect(resolveGlobalCliBin(env, 'win32')).not.toBeNull();
  });
});
