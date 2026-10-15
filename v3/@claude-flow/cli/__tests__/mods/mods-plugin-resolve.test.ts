/**
 * ADR-404 — whether Claude Code can load the enabled ruflo mod plugins
 * (marketplace clone missing, stale, fresh; plugin pending; cached install),
 * and the repair `mods install` / `init` run. Mock-first: a fake filesystem
 * and a fake execFile; nothing here reads the real ~/.claude or runs claude.
 */
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';

import {
  claudeConfigDir,
  cloneHas,
  installedState,
  marketplaceState,
  pluginManifestIn,
  repairCommands,
  resolveFindings,
  type ReadFs,
} from '../../src/mods/plugin-resolve.js';
import { repairPluginInstall, INSTALL_TIMEOUT_MS, MARKETPLACE_TIMEOUT_MS, type Exec } from '../../src/mods/plugin-repair.js';
import { MOD_PLUGINS } from '../../src/mods/install.js';
import { probeMods } from '../../src/mods/probe.js';

const CFG = '/cfg';
const ROOT = '/work/proj';
const CLONE = join(CFG, 'plugins', 'marketplaces', 'ruflo');
const CACHE = join(CFG, 'plugins', 'cache', 'ruflo', 'ruflo-mods', '0.1.0');
const manifest = (name: string) => join(CLONE, 'plugins', name, '.claude-plugin', 'plugin.json');

/** A fake filesystem: paths that exist, and the text of the files among them. */
function fakeFs(files: Record<string, unknown>, dirs: string[] = []): ReadFs {
  const exists = new Set([...Object.keys(files), ...dirs]);
  return {
    exists: (p) => exists.has(p),
    readText: (p) => (p in files ? (typeof files[p] === 'string' ? (files[p] as string) : JSON.stringify(files[p])) : undefined),
  };
}

const known = { [join(CFG, 'plugins', 'known_marketplaces.json')]: { ruflo: { source: { source: 'github', repo: 'ruvnet/ruflo' }, installLocation: CLONE } } };
const fresh = { [manifest('ruflo-mods')]: '{}', [manifest('ruflo-swarm')]: '{}', [manifest('ruflo-console')]: '{}' };
const staleOnlySwarm = { [manifest('ruflo-swarm')]: '{}' };
const installedHere = (entry: Record<string, unknown> = {}) => ({
  [join(CFG, 'plugins', 'installed_plugins.json')]: { version: 2, plugins: { 'ruflo-mods@ruflo': [{ scope: 'local', installPath: CACHE, projectPath: ROOT, ...entry }] } },
});
const byName = (findings: ReturnType<typeof resolveFindings>) => Object.fromEntries(findings.map((f) => [f.name, f]));

describe('ADR-404 plugin resolution: the marketplace clone', () => {
  it('missing, then found via known_marketplaces.json, else the default clone path', () => {
    expect(marketplaceState(CFG, fakeFs({}))).toEqual({ known: false, location: null });
    expect(marketplaceState(CFG, fakeFs(known, [CLONE]))).toEqual({ known: true, location: CLONE, source: { source: 'github', repo: 'ruvnet/ruflo' } });
    expect(marketplaceState(CFG, fakeFs({}, [CLONE]))).toEqual({ known: false, location: CLONE });
  });

  it("finds a plugin through the clone's marketplace.json source, else plugins/<name>", () => {
    const catalog = { [join(CLONE, '.claude-plugin', 'marketplace.json')]: { plugins: [{ name: 'ruflo-mods', source: './elsewhere/mods' }] } };
    expect(pluginManifestIn(CLONE, 'ruflo-mods@ruflo', fakeFs(catalog))).toBe(join(CLONE, 'elsewhere', 'mods', '.claude-plugin', 'plugin.json'));
    expect(pluginManifestIn(CLONE, 'ruflo-swarm@ruflo', fakeFs(catalog))).toBe(manifest('ruflo-swarm'));
    expect(cloneHas({ known: true, location: CLONE }, 'ruflo-mods@ruflo', fakeFs(fresh))).toBe(true);
  });

  it('respects CLAUDE_CONFIG_DIR', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '/x' }, '/home/u')).toBe('/x');
    expect(claudeConfigDir({}, '/home/u')).toBe(join('/home/u', '.claude'));
  });
});

describe('ADR-404 plugin resolution: installed for this project', () => {
  it('local scope counts only for its own project, and only while its cache dir exists', () => {
    expect(installedState(ROOT, CFG, 'ruflo-mods@ruflo', fakeFs(installedHere(), [CACHE]))).toMatchObject({ installed: true, scope: 'local' });
    expect(installedState('/work/other', CFG, 'ruflo-mods@ruflo', fakeFs(installedHere(), [CACHE])).installed).toBe(false);
    expect(installedState(ROOT, CFG, 'ruflo-mods@ruflo', fakeFs(installedHere())).installed).toBe(false);
  });

  it('user scope counts everywhere; a malformed record is not installed', () => {
    expect(installedState('/x', CFG, 'ruflo-mods@ruflo', fakeFs(installedHere({ scope: 'user', projectPath: undefined }), [CACHE])).installed).toBe(true);
    expect(installedState(ROOT, CFG, 'ruflo-mods@ruflo', fakeFs({ [join(CFG, 'plugins', 'installed_plugins.json')]: '{ broken' })).installed).toBe(false);
  });
});

describe('ADR-404 plugin resolution: findings', () => {
  it('the reported bug: a stale clone and no cached install FAILS with the exact commands', () => {
    const f = byName(resolveFindings(ROOT, 'local', CFG, fakeFs({ ...known, ...staleOnlySwarm }, [CLONE])));
    expect(f['plugin ruflo-mods@ruflo']).toMatchObject({ status: 'fail', message: expect.stringContaining('/ruflo-mods is an unknown command') });
    expect(f['plugin ruflo-mods@ruflo']!.fix).toBe(`cd "${ROOT}" && claude plugin marketplace update ruflo && claude plugin install ruflo-mods@ruflo --scope local && claude plugin install ruflo-swarm@ruflo --scope local && claude plugin install ruflo-console@ruflo --scope local`);
    expect(f['plugin ruflo-swarm@ruflo']!.status).toBe('pass');
  });

  it('ruflo-console is required: a clone without it is stale (fail), never pending', () => {
    expect(MOD_PLUGINS.find((p) => p.id === 'ruflo-console@ruflo')!.required).toBe(true);
    const f = byName(resolveFindings(ROOT, 'project', CFG, fakeFs({ ...known, [manifest('ruflo-mods')]: '{}', [manifest('ruflo-swarm')]: '{}' }, [CLONE])));
    expect(f['plugin ruflo-console@ruflo']).toMatchObject({ status: 'fail' });
    expect(f['plugin ruflo-console@ruflo']!.message).not.toContain('pending');
  });

  it('no clone yet: warn (Claude Code clones it at its next interactive start); the fix adds it at the same scope', () => {
    const f = byName(resolveFindings(ROOT, 'project', CFG, fakeFs({})));
    expect(f['ruflo marketplace']).toMatchObject({ status: 'warn', message: expect.stringContaining('headless -p runs do not') });
    expect(f['ruflo marketplace']!.fix).toContain('claude plugin marketplace add ruvnet/ruflo --scope project');
    expect(Object.values(f).some((x) => x.status === 'fail')).toBe(false);
  });

  it('a fresh clone loads the plugin without any install record', () => {
    const f = byName(resolveFindings(ROOT, 'local', CFG, fakeFs({ ...known, ...fresh }, [CLONE])));
    expect(f['plugin ruflo-mods@ruflo']).toMatchObject({ status: 'pass', message: 'loads from the marketplace clone' });
  });

  it('a stale clone with a cached install still loads: warn, not fail', () => {
    const f = byName(resolveFindings(ROOT, 'local', CFG, fakeFs({ ...known, ...staleOnlySwarm, ...installedHere() }, [CLONE, CACHE])));
    expect(f['plugin ruflo-mods@ruflo']!.status).toBe('warn');
  });

  it('only plugins enabled in settings are checked', () => {
    const f = byName(resolveFindings(ROOT, 'local', CFG, fakeFs({ ...known, ...fresh }, [CLONE]), ['ruflo-mods@ruflo']));
    expect(Object.keys(f)).toEqual(['ruflo marketplace', 'plugin ruflo-mods@ruflo']);
  });

  it('repairCommands quotes the project root and installs every required plugin', () => {
    const cmds = repairCommands('/a b/c', 'local', true);
    expect(cmds[0]).toBe('cd "/a b/c"');
    expect(cmds.join('\n')).toContain('claude plugin install ruflo-console@ruflo --scope local');
  });
});

describe('ADR-404 mods status distinguishes enabled-in-settings from loadable', () => {
  it('probeMods adds the resolution findings only once the plugin is enabled', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const root = mkdtempSync(join(tmpdir(), 'ruflo-mods-resolve-'));
    try {
      const probe = () => probeMods({ projectRoot: root, home: root, env: {}, managedPath: join(root, 'none'), installs: [], configDir: CFG, fs: fakeFs({ ...known, ...staleOnlySwarm }, [CLONE]) });
      expect(probe().map((f) => f.name)).not.toContain('plugin ruflo-mods@ruflo');
      mkdirSync(join(root, '.claude'), { recursive: true });
      writeFileSync(join(root, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'ruflo-mods@ruflo': true } }));
      const findings = probe();
      expect(findings.find((f) => f.name === 'ruflo-mods plugin')!.message).toMatch(/^enabled in settings/);
      expect(findings.find((f) => f.name === 'plugin ruflo-mods@ruflo')).toMatchObject({ status: 'fail', fix: expect.stringContaining('--scope local') });
      expect(findings.map((f) => f.name)).not.toContain('plugin ruflo-swarm@ruflo'); // not enabled here
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('ADR-404 repair', () => {
  type Call = { file: string; args: readonly string[]; cwd: string; timeout: number };
  /** Exit codes in call order; after the marketplace step the clone holds `afterMarket`. */
  const harness = (codes: number[], afterMarket: Record<string, unknown>) => {
    const calls: Call[] = [];
    let files: Record<string, unknown> = {};
    const fs: ReadFs = { exists: (p) => fakeFs(files, files === afterMarket ? [CLONE] : []).exists(p), readText: (p) => fakeFs(files).readText(p) };
    const exec: Exec = async (file, args, opts) => {
      calls.push({ file, args, cwd: opts.cwd, timeout: opts.timeout });
      const code = codes[calls.length - 1] ?? 0;
      if (args[1] === 'marketplace' && code === 0) files = afterMarket;
      return { code, stdout: code === 0 ? 'ok' : '', stderr: code === 0 ? '' : 'Marketplace not reachable' };
    };
    return { exec, calls, fs };
  };

  it('adds the unknown marketplace at the scope, then installs every mod plugin the clone carries', async () => {
    const { exec, calls, fs } = harness([], { ...known, ...fresh });
    const r = await repairPluginInstall({ projectRoot: ROOT, scope: 'project', configDir: CFG, claude: '/bin/claude', exec, env: {}, fs });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => [c.args.join(' '), c.cwd, c.timeout])).toEqual([
      ['plugin marketplace add ruvnet/ruflo --scope project', ROOT, MARKETPLACE_TIMEOUT_MS],
      ['plugin install ruflo-mods@ruflo --scope project', ROOT, INSTALL_TIMEOUT_MS],
      ['plugin install ruflo-swarm@ruflo --scope project', ROOT, INSTALL_TIMEOUT_MS],
      ['plugin install ruflo-console@ruflo --scope project', ROOT, INSTALL_TIMEOUT_MS],
    ]);
    expect(calls.flatMap((c) => c.args)).not.toContain('-y');
  });

  it('a required plugin still missing after the update is a failure', async () => {
    const { exec, fs } = harness([], { ...known, ...staleOnlySwarm });
    const r = await repairPluginInstall({ projectRoot: ROOT, scope: 'local', configDir: CFG, claude: '/bin/claude', exec, env: {}, fs });
    expect(r.ok).toBe(false);
    expect(r.steps.find((s) => s.argv.includes('ruflo-mods@ruflo'))).toMatchObject({ state: 'failed' });
  });

  it('a failed marketplace step stops everything; a failed install is collected and the rest still run', async () => {
    const first = harness([1], { ...known, ...fresh });
    const stop = await repairPluginInstall({ projectRoot: ROOT, scope: 'local', configDir: CFG, claude: '/bin/claude', exec: first.exec, env: {}, fs: first.fs });
    expect(stop.ok).toBe(false);
    expect(first.calls).toHaveLength(1);
    const second = harness([0, 1, 0], { ...known, ...fresh });
    const collected = await repairPluginInstall({ projectRoot: ROOT, scope: 'local', configDir: CFG, claude: '/bin/claude', exec: second.exec, env: {}, fs: second.fs });
    expect(collected.ok).toBe(false);
    expect(second.calls).toHaveLength(4);
  });

  it('an exec that throws is a failed step, not a crash', async () => {
    const exec: Exec = async () => {
      throw new Error('spawn ENOENT');
    };
    const r = await repairPluginInstall({ projectRoot: ROOT, scope: 'local', configDir: CFG, claude: '/missing', exec, env: {}, fs: fakeFs({}) });
    expect(r).toMatchObject({ ok: false, steps: [{ state: 'failed', output: 'spawn ENOENT' }] });
  });
});
