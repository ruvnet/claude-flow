/**
 * Hook helpers and plugin hook shims launch the ruflo CLI. A home-level
 * helper or a user-level plugin serves every opened project, so the CLI must
 * be resolved from the helper's own install root (or the plugin data / home
 * dir), never from the project: not from <project>/node_modules, not from a
 * relative PATH entry, and not through npx's project-local lookup.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateHookHandler, generateRufloHookCjs } from '../src/init/helpers-generator.js';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, '../../../..');
const require_ = createRequire(import.meta.url);
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A built-looking CLI install whose bin leaves a marker when it runs. */
function plantCli(pkgDir: string, marker: string) {
  mkdirSync(join(pkgDir, 'bin'), { recursive: true });
  mkdirSync(join(pkgDir, 'dist', 'src'), { recursive: true });
  writeFileSync(join(pkgDir, 'bin', 'cli.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, '1');\n`);
  writeFileSync(join(pkgDir, 'dist', 'src', 'index.js'), '');
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-cli-trust-')));
  tempRoots.push(root);
  const home = join(root, 'home');
  const project = join(root, 'project');
  const marker = join(root, 'project-cli-ran');
  mkdirSync(join(home, '.claude', 'helpers'), { recursive: true });
  plantCli(join(project, 'node_modules', '@claude-flow', 'cli'), marker);
  return { root, home, project, marker };
}

function nodeEval(code: string, cwd: string, env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, ['-e', code], { cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 15_000 });
  expect(result.error).toBeUndefined();
  return result;
}

describe('hook-handler.cjs resolves the CLI from its install root', () => {
  for (const [name, source] of [
    ['package', resolve(here, '../.claude/helpers/hook-handler.cjs')],
    ['repository', resolve(REPO, '.claude/helpers/hook-handler.cjs')],
  ] as const) {
    it(`${name}: a home-level helper ignores the project's CLI and pins npx --prefix`, () => {
      const { home, project } = fixture();
      const hook = join(home, '.claude', 'helpers', 'hook-handler.cjs');
      copyFileSync(source, hook);
      const out = nodeEval(
        `const h = require(${JSON.stringify(hook)});` +
        `console.log(JSON.stringify({ bin: h.resolveCliBinForHook(), posix: h.cliSpawnArgs(null, ['hooks', 'x'], 'linux'), win: h.cliSpawnArgs(null, ['hooks', 'x'], 'win32') }));`,
        project, { HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: project },
      );
      const r = JSON.parse(out.stdout.trim().split('\n').pop() as string);
      expect(r.bin).toBeNull();
      expect(r.posix).toEqual(['npx', ['--prefer-offline', '--prefix', home, '@claude-flow/cli', 'hooks', 'x']]);
      expect(r.win).toEqual(['npx.cmd', ['--prefer-offline', '--prefix', home, '@claude-flow/cli', 'hooks', 'x']]);
    });

    it(`${name}: a project-local helper still uses the project's CLI`, () => {
      const { home, project } = fixture();
      const hook = join(project, '.claude', 'helpers', 'hook-handler.cjs');
      mkdirSync(dirname(hook), { recursive: true });
      copyFileSync(source, hook);
      const out = nodeEval(`console.log(require(${JSON.stringify(hook)}).resolveCliBinForHook())`, project, { HOME: home, USERPROFILE: home });
      expect(out.stdout.trim().split('\n').pop()).toBe(join(project, 'node_modules', '@claude-flow', 'cli', 'bin', 'cli.js'));
    });
  }

  it('the generated hook-handler pins its npx refresh to the helper root', () => {
    expect(generateHookHandler()).toContain("'--prefer-offline', '--prefix', path.resolve(helpersDir, '..', '..'), '@claude-flow/cli'");
  });
});

describe('statusline.cjs resolves the CLI from its install root', () => {
  const source = resolve(here, '../.claude/helpers/statusline.cjs');
  // An empty PATH keeps the npx fallback from running; the bin candidates are
  // launched through process.execPath, so they still run if selected.
  const render = (helper: string, home: string, project: string, emptyBin: string) =>
    spawnSync(process.execPath, [helper], {
      cwd: project,
      env: { HOME: home, USERPROFILE: home, CLAUDE_PROJECT_DIR: project, PATH: emptyBin },
      input: '{}',
      encoding: 'utf8',
      timeout: 30_000,
    });

  it("a home-level statusline never runs the project's CLI", () => {
    const { root, home, project, marker } = fixture();
    const emptyBin = join(root, 'empty-bin');
    mkdirSync(emptyBin);
    const helper = join(home, '.claude', 'helpers', 'statusline.cjs');
    copyFileSync(source, helper);
    render(helper, home, project, emptyBin);
    expect(existsSync(marker)).toBe(false);
  });

  it("a project-local statusline still uses the project's CLI (control)", () => {
    const { root, home, project, marker } = fixture();
    const emptyBin = join(root, 'empty-bin');
    mkdirSync(emptyBin);
    const helper = join(project, '.claude', 'helpers', 'statusline.cjs');
    mkdirSync(dirname(helper), { recursive: true });
    copyFileSync(source, helper);
    render(helper, home, project, emptyBin);
    expect(existsSync(marker)).toBe(true);
  });

  it('never interpolates a shell-active install-root path into the delegation command', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'ruflo-cli-trust-')));
    tempRoots.push(root);
    const home = join(root, 'home');
    const injected = join(root, 'injected');
    // The checkout's directory name is chosen by whoever made it.
    const project = join(root, `p$(/usr/bin/touch ${injected})`);
    const emptyBin = join(root, 'empty-bin');
    mkdirSync(emptyBin);
    mkdirSync(home, { recursive: true });
    plantCli(join(project, 'node_modules', '@claude-flow', 'cli'), join(root, 'cli-ran'));
    const helper = join(project, '.claude', 'helpers', 'statusline.cjs');
    mkdirSync(dirname(helper), { recursive: true });
    copyFileSync(source, helper);
    render(helper, home, project, emptyBin);
    expect(existsSync(injected)).toBe(false);
  });
});

type Shim = {
  npxPrefix?: (env?: NodeJS.ProcessEnv) => string;
  resolveCommandPath: (cmd: string, env?: NodeJS.ProcessEnv, platform?: string) => string | null;
};

describe('ruflo-hook.cjs plugin shims', () => {
  const shims = ['plugins/ruflo-core/scripts/ruflo-hook.cjs', 'plugin/scripts/ruflo-hook.cjs', '.claude-plugin/scripts/ruflo-hook.cjs'];

  for (const rel of shims) {
    it(`${rel}: ignores relative PATH entries and pins the npx prefix`, () => {
      // The shims run main() on load unless told they are imported for a test
      // (ruflo-core reads RUFLO_HOOK_UNIT_TEST, the others a global flag).
      const unitTest = process.env.RUFLO_HOOK_UNIT_TEST;
      process.env.RUFLO_HOOK_UNIT_TEST = '1';
      (globalThis as Record<string, unknown>).__RUFLO_HOOK_IMPORT_ONLY__ = true;
      const shim = require_(resolve(REPO, rel)) as Shim;
      delete (globalThis as Record<string, unknown>).__RUFLO_HOOK_IMPORT_ONLY__;
      if (unitTest === undefined) delete process.env.RUFLO_HOOK_UNIT_TEST;
      else process.env.RUFLO_HOOK_UNIT_TEST = unitTest;
      const { root, home } = fixture();
      const absBin = join(root, 'abs-bin');
      mkdirSync(absBin);
      const rufloAbs = join(absBin, 'ruflo');
      writeFileSync(rufloAbs, '#!/bin/sh\n');
      chmodSync(rufloAbs, 0o755);

      // A relative entry that would resolve against the cwd is skipped
      // (posix and win32 forms); an absolute entry still resolves.
      expect(shim.resolveCommandPath('ruflo', { PATH: `.${':'}relative-dir` }, 'linux')).toBeNull();
      expect(shim.resolveCommandPath('ruflo', { PATH: `.;relative-dir`, PATHEXT: '.CMD' }, 'win32')).toBeNull();
      expect(shim.resolveCommandPath('ruflo', { PATH: `.:${absBin}` }, 'linux')).toBe(rufloAbs);

      expect(shim.npxPrefix?.({ CLAUDE_PLUGIN_DATA: '/plugin/data' })).toBe('/plugin/data');
      expect(shim.npxPrefix?.({ HOME: home })).toBeTypeOf('string');
    });
  }

  it('the generated ruflo-hook.cjs pins its npx fallback to the helper root', () => {
    expect(generateRufloHookCjs()).toContain("'--prefer-offline', '--yes', '--prefix', path.resolve(__dirname, '..', '..'), 'ruflo@latest'");
  });
});
