/**
 * Windows hook argv integrity — command re-execution through cmd.exe.
 *
 * A private report found that ruflo-hook.cjs forwards hook-derived values
 * (a Bash tool's `command`, a file path) through `spawnSync(..., {shell:true})`
 * on Windows, where cmd.exe re-tokenizes them. PR #3322 fixed exactly one of
 * the four copies of that shim — `plugins/ruflo-core/scripts/ruflo-hook.cjs`.
 * The other three, including the one `ruflo init` writes into every user
 * project, kept the unescaped `spawnSync(bin, args, {shell: win32})`.
 *
 * The fix has two layers, and they are tested very differently:
 *
 *   - Layer 1, resolveInvocation(), maps a command to a real executable —
 *     and on Windows maps npm's .cmd shim to the package's own .js entry —
 *     so the spawn is `node <entry>` with shell:false. Because it takes
 *     `platform` and `env` as arguments, the Windows branch is fully
 *     exercisable from a Linux/macOS CI run: the .cmd is *resolved past*,
 *     never executed, and the recorded argv proves the round trip. That is
 *     what most of this file does.
 *
 *   - Layer 2, escapeCmdArg(), guards the residual path where layer 1 finds
 *     no entrypoint. It is only assertable as a string transform here; real
 *     cmd.exe execution remains an open follow-up gate on the issue. This is
 *     the asymmetry that motivates preferring layer 1.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, chmodSync, realpathSync } from 'fs';
import { createRequire } from 'module';
import { tmpdir } from 'os';
import path from 'path';
import { generateRufloHookCjs } from '../src/init/helpers-generator';

const REPO = path.resolve(__dirname, '../../../..');
const require_ = createRequire(__filename);

/** The committed copies of the shim that must not diverge. */
const COPIES = [
  'plugins/ruflo-core/scripts/ruflo-hook.cjs',
  '.claude-plugin/scripts/ruflo-hook.cjs',
  'plugin/scripts/ruflo-hook.cjs',
];

/**
 * The functions all four copies must hold in common. escapeCmdArg is layer 2;
 * the three resolvers are layer 1, and this recurred precisely because a fix
 * reached one copy and not its siblings — so both layers are pinned, not just
 * the one that happened to be patched first.
 */
const SHARED = ['escapeCmdArg', 'resolveCommandPath', 'resolveNpmShim', 'resolveInvocation'] as const;

function fnOf(source: string, name: string, label: string): string {
  const m = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`).exec(source);
  if (!m) throw new Error(`no ${name}() in ${label} — the Windows argv fix is incomplete in this copy`);
  return m[0];
}

type HookModule = {
  invokeHook: (bin: string, binArgs: string[], hookArgs: string[], stdin: string, opts?: any) => boolean;
  resolveCommandPath: (cmd: string, env?: any, platform?: string) => string | null;
  resolveInvocation: (bin: string, binArgs: string[], opts?: any) => { command: string; args: string[] } | null;
  resolveNpmShim: (shimPath: string) => { command: string; args: string[] } | null;
};

let tmp: string;
/** The shim as `ruflo init` writes it — the copy under test. */
let hook: HookModule;

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'ruflo-hook-667-'));
  const generated = path.join(tmp, 'ruflo-hook.cjs');
  writeFileSync(generated, generateRufloHookCjs());
  (globalThis as any).__RUFLO_HOOK_IMPORT_ONLY__ = true;
  hook = require_(generated) as HookModule;
  delete (globalThis as any).__RUFLO_HOOK_IMPORT_ONLY__;
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/**
 * Build the layout npm actually creates on Windows: sibling .cmd / .ps1 /
 * extensionless shims, and the package itself with a recording JS entry.
 * `global` is `<prefix>/ruflo.cmd` + `<prefix>/node_modules/ruflo`;
 * `local` is `node_modules/.bin/ruflo.cmd` + `node_modules/ruflo`.
 */
function npmLayout(opts: {
  dir: string; command: string; packageName: string; entry: string; layout: 'global' | 'local';
}) {
  const prefix = path.join(tmp, opts.dir);
  const shimDir = opts.layout === 'local' ? path.join(prefix, 'node_modules', '.bin') : prefix;
  const packageDir = path.join(prefix, 'node_modules', opts.packageName);
  const entryPath = path.join(packageDir, opts.entry);
  const argvFile = path.join(prefix, 'argv.json');

  mkdirSync(path.dirname(entryPath), { recursive: true });
  mkdirSync(shimDir, { recursive: true });
  // Sibling shims that must never be executed — if any of them runs, the
  // resolver picked a shell path instead of the package entrypoint.
  writeFileSync(path.join(shimDir, `${opts.command}.cmd`), '@echo off\r\nexit /b 3\r\n');
  writeFileSync(path.join(shimDir, `${opts.command}.ps1`), 'throw "must not execute"\r\n');
  writeFileSync(path.join(shimDir, opts.command), '#!/bin/sh\nexit 99\n');
  writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: opts.packageName, bin: { [opts.command]: opts.entry } }),
  );
  writeFileSync(
    entryPath,
    '#!/usr/bin/env node\n' +
      "require('fs').writeFileSync(process.env.RUFLO_TEST_ARGV_FILE, JSON.stringify(process.argv.slice(2)));\n",
  );
  chmodSync(entryPath, 0o755);

  return {
    entryPath,
    argvFile,
    env: { ...process.env, PATH: shimDir, PATHEXT: '.COM;.EXE;.BAT;.CMD', RUFLO_TEST_ARGV_FILE: argvFile },
  };
}

describe('ruflo-hook.cjs windows argv — the shell is removed, not merely escaped', () => {
  it.each(SHARED)('all four copies share a byte-identical %s()', (fn) => {
    const sources = new Map<string, string>();
    for (const rel of COPIES) sources.set(rel, readFileSync(path.join(REPO, rel), 'utf8'));
    sources.set('init-generated', generateRufloHookCjs());

    const bodies = new Map([...sources].map(([label, src]) => [label, fnOf(src, fn, label)]));
    expect(
      new Set(bodies.values()).size,
      `${fn}() diverged across copies:\n${[...bodies.keys()].join('\n')}`,
    ).toBe(1);
  });

  it('no copy still probes PATH through a shell', () => {
    for (const rel of COPIES) {
      const code = readFileSync(path.join(REPO, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(code, `${rel} still uses execSync`).not.toContain('execSync');
      expect(code, `${rel} still has the pre-fix spawn`).not.toContain('spawnSync(bin, args, {');
    }
  });

  it('never probes PATH through a shell, and never spawns the pre-fix unescaped form', () => {
    const src = generateRufloHookCjs();
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // The old `execSync('where ' + cmd)` probe spawned a shell on every hook.
    expect(code).not.toContain('execSync');
    // The pre-fix spawn must be gone, not merely supplemented.
    expect(code).not.toContain('spawnSync(bin, args, {');
    // The resolved path is explicitly shell-free.
    expect(code).toContain('shell: false');
  });

  // ---- Layer 1: the Windows branch, proved without Windows ----

  it.each([
    { command: 'ruflo', packageName: 'ruflo', entry: 'bin/ruflo.js', binArgs: [] as string[] },
    { command: 'claude-flow', packageName: 'claude-flow', entry: 'bin/cli.js', binArgs: [] as string[] },
    // npx lives in the `npm` package — the command and package names differ.
    { command: 'npx', packageName: 'npm', entry: 'bin/npx-cli.js', binArgs: ['--prefer-offline', '--yes', 'ruflo@latest'] },
  ])('$command: a simulated win32 .cmd shim resolves to the package entry, no shell', ({ command, packageName, entry, binArgs }) => {
    for (const layout of ['global', 'local'] as const) {
      const l = npmLayout({ dir: `${command}-${layout} with spaces`, command, packageName, entry, layout });

      // The resolver reaches the package's own .js, run under this node.
      const invocation = hook.resolveInvocation(command, binArgs, { platform: 'win32', env: l.env });
      expect(invocation, `${command}/${layout} did not resolve`).not.toBeNull();
      expect(invocation!.command).toBe(process.execPath);
      // resolveNpmShim() canonicalises via realpath (macOS /var -> /private/var).
      expect(realpathSync(invocation!.args[0])).toBe(realpathSync(l.entryPath));

      // And the value survives to the CLI byte-for-byte.
      const payload = 'x & calc.exe | %USERPROFILE% "q" ^ !v! <in >out; a,b (c)\nsecond line';
      const ok = hook.invokeHook(command, binArgs, ['hooks', 'post-command', '-c', payload], '{}', {
        platform: 'win32',
        env: l.env,
      });
      expect(ok, `${command}/${layout} invocation failed`).toBe(true);
      expect(JSON.parse(readFileSync(l.argvFile, 'utf8'))).toEqual([
        ...binArgs, 'hooks', 'post-command', '-c', payload,
      ]);
    }
  });

  it('refuses a manifest whose bin escapes the package directory', () => {
    const prefix = path.join(tmp, 'escaping-manifest');
    const packageDir = path.join(prefix, 'node_modules', 'ruflo');
    mkdirSync(packageDir, { recursive: true });
    mkdirSync(path.join(prefix, 'outside'), { recursive: true });
    writeFileSync(path.join(prefix, 'outside', 'evil.js'), '');
    writeFileSync(
      path.join(packageDir, 'package.json'),
      JSON.stringify({ name: 'ruflo', bin: { ruflo: '../../outside/evil.js' } }),
    );
    writeFileSync(path.join(prefix, 'ruflo.cmd'), '@echo off\r\n');
    expect(hook.resolveNpmShim(path.join(prefix, 'ruflo.cmd'))).toBeNull();
  });

  // ---- Layer 1 on this host, for real ----

  it.skipIf(process.platform === 'win32')('passes a metacharacter payload to a real child process byte-for-byte', () => {
    const prefix = path.join(tmp, 'posix-real');
    mkdirSync(path.join(prefix, 'bin'), { recursive: true });
    const argvFile = path.join(prefix, 'argv.json');
    const cli = path.join(prefix, 'bin', 'ruflo');
    writeFileSync(
      cli,
      // Absolute shebang: PATH is stripped to the fake bin dir below, so
      // `#!/usr/bin/env node` would not find node.
      `#!${process.execPath}\n` +
        `require('fs').writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));\n`,
    );
    chmodSync(cli, 0o755);

    const payload = 'x & calc.exe | $(id) `id` "q" ^ !v! <in >out; a,b (c)';
    const ok = hook.invokeHook('ruflo', [], ['hooks', 'post-command', '-c', payload], '{}', {
      env: { ...process.env, PATH: path.join(prefix, 'bin') },
    });
    expect(ok).toBe(true);
    expect(JSON.parse(readFileSync(argvFile, 'utf8'))).toEqual(['hooks', 'post-command', '-c', payload]);
  });
});
