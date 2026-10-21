/**
 * ADR-404 — `ruflo mods install|status|doctor|uninstall` and
 * `ruflo init upgrade --mods` in-process, against a stand-in `claude` on an
 * isolated PATH, HOME and CLAUDE_CONFIG_DIR. Never the real ~/.claude or a
 * real claude.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MOD_PLUGIN_ID } from '../../src/mods/install.js';
import type { Finding } from '../../src/mods/probe.js';
import { modsCommand } from '../../src/commands/mods.js';
import { initCommand } from '../../src/commands/init.js';

let root: string;
let home: string;
const saved = { PATH: process.env.PATH, HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, VITEST: process.env.VITEST, CI: process.env.CI };
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-mods-cmd-'));
  home = mkdtempSync(join(tmpdir(), 'ruflo-mods-cmd-home-'));
  mkdirSync(join(home, 'bin'), { recursive: true });
  process.env.PATH = join(home, 'bin');
  process.env.HOME = home;
  process.env.CLAUDE_CONFIG_DIR = join(home, 'cfg');
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const sub = (cmd: typeof modsCommand, name: string) => cmd.subcommands!.find((s) => s.name === name)!;
const ctx = (flags: Record<string, unknown> = {}) => ({ args: [], flags: { projectRoot: root, ...flags }, cwd: root, interactive: false }) as any;
const findings = async () => (await sub(modsCommand, 'status').action!(ctx({ json: true }))).data as Finding[];
const status = (all: Finding[], name: string) => all.find((f) => f.name === name)?.status;

/**
 * A stand-in claude. `marketplace add|update` leaves a clone carrying
 * ruflo-mods, ruflo-swarm and ruflo-console, or, with
 * mode 'stale', a clone without any of them; `install <id>` records it the
 * way Claude Code does. Every argv is logged.
 */
function fakeClaude(mode: 'ok' | 'stale' | 'fail') {
  const cfg = join(home, 'cfg', 'plugins');
  const node = String.raw`
const fs = require('fs'), path = require('path');
const [, , ...argv] = process.argv;
fs.appendFileSync(${JSON.stringify(join(home, 'calls'))}, argv.join(' ') + '\n');
const cfg = ${JSON.stringify(cfg)};
if (${JSON.stringify(mode)} === 'fail') { process.stderr.write('network down\n'); process.exit(1); }
if (argv[1] === 'marketplace' && argv[3] && argv[3].startsWith('/')) {
  fs.mkdirSync(cfg, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'known_marketplaces.json'), JSON.stringify({ ruflo: { source: { source: 'directory', path: argv[3] }, installLocation: argv[3] } }));
} else if (argv[1] === 'marketplace') {
  const clone = path.join(cfg, 'marketplaces', 'ruflo');
  fs.mkdirSync(path.join(clone, 'plugins'), { recursive: true });
  if (${JSON.stringify(mode)} === 'ok') for (const p of ['ruflo-mods', 'ruflo-swarm', 'ruflo-console']) {
    fs.mkdirSync(path.join(clone, 'plugins', p, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(clone, 'plugins', p, '.claude-plugin', 'plugin.json'), '{}');
  }
  fs.writeFileSync(path.join(cfg, 'known_marketplaces.json'), JSON.stringify({ ruflo: { source: { source: 'github', repo: 'ruvnet/ruflo' }, installLocation: clone } }));
}
if (argv[1] === 'uninstall') {
  const file = path.join(cfg, 'installed_plugins.json');
  const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete rec.plugins[argv[2]];
  fs.writeFileSync(file, JSON.stringify(rec));
}
if (argv[1] === 'install') {
  const file = path.join(cfg, 'installed_plugins.json');
  const rec = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 2, plugins: {} };
  const dir = path.join(cfg, 'cache', argv[2]);
  fs.mkdirSync(dir, { recursive: true });
  rec.plugins[argv[2]] = [{ scope: argv[4], installPath: dir, projectPath: process.cwd() }];
  fs.writeFileSync(file, JSON.stringify(rec));
}
`;
  writeFileSync(join(home, 'bin', 'claude'), `#!${process.execPath}\n${node}`, { mode: 0o755 });
}
// Only the plugin commands; status also asks each claude its --version.
const calls = () => (existsSync(join(home, 'calls')) ? readFileSync(join(home, 'calls'), 'utf8').trim().split('\n').filter((l) => l.startsWith('plugin ')) : []);

describe('ADR-404 ruflo mods install (standalone)', () => {
  it('--no-plugin-install writes settings only; status reports, doctor stays green until a clone exists', async () => {
    fakeClaude('ok');
    expect((await sub(modsCommand, 'install').action!(ctx({ pluginInstall: false }))).success).toBe(true);
    expect(calls()).toEqual([]);
    expect((await sub(modsCommand, 'install').action!(ctx({ scope: 'global' }))).success).toBe(false);
    const all = await findings();
    // No clone yet: Claude Code clones it at its next interactive start — a warning, not a failure.
    expect(status(all, 'ruflo marketplace')).toBe('warn');
    expect((await sub(modsCommand, 'doctor').action!(ctx({ json: true }))).success).toBe(true);
    expect((await sub(modsCommand, 'uninstall').action!(ctx())).success).toBe(true);
    expect(read(join(root, '.claude', 'settings.local.json'))).toEqual({});
  });

  it('adds the marketplace at the scope, installs every mod plugin the clone carries', async () => {
    fakeClaude('ok');
    const r = await sub(modsCommand, 'install').action!(ctx());
    expect(r).toMatchObject({ success: true, data: { resolvable: true } });
    expect(calls()).toEqual([
      'plugin marketplace add ruvnet/ruflo --scope local',
      'plugin install ruflo-mods@ruflo --scope local',
      'plugin install ruflo-swarm@ruflo --scope local',
      'plugin install ruflo-console@ruflo --scope local',
    ]);
    const all = await findings();
    expect(status(all, 'plugin ruflo-mods@ruflo')).toBe('pass');
    expect(status(all, 'plugin ruflo-swarm@ruflo')).toBe('pass');
    expect(status(all, 'plugin ruflo-console@ruflo')).toBe('pass');
    // A re-run: the marketplace is known now, so it is updated, not re-added.
    await sub(modsCommand, 'install').action!(ctx());
    expect(calls()[4]).toBe('plugin marketplace update ruflo');
  });

  it('the reported bug: a stale clone fails doctor; install refreshes it and doctor passes', async () => {
    fakeClaude('stale');
    expect(await sub(modsCommand, 'install').action!(ctx())).toMatchObject({ success: true, data: { resolvable: false } });
    let all = await findings();
    expect(all.find((f) => f.name === 'plugin ruflo-mods@ruflo')).toMatchObject({ status: 'fail', message: expect.stringContaining('/ruflo-mods is an unknown command') });
    expect((await sub(modsCommand, 'doctor').action!(ctx({ json: true }))).exitCode).toBe(1);
    fakeClaude('ok');
    expect(await sub(modsCommand, 'install').action!(ctx())).toMatchObject({ success: true, data: { resolvable: true } });
    all = await findings();
    expect(all.filter((f) => f.status === 'fail')).toEqual([]);
    expect((await sub(modsCommand, 'doctor').action!(ctx({ json: true }))).success).toBe(true);
  });

  it('a failed repair prints the manual commands; exit 1 only with --strict', async () => {
    fakeClaude('fail');
    expect(await sub(modsCommand, 'install').action!(ctx())).toMatchObject({ success: true, data: { resolvable: false } });
    expect(await sub(modsCommand, 'install').action!(ctx({ strict: true }))).toMatchObject({ success: false, exitCode: 1 });
    expect(calls()).toHaveLength(2); // stopped at the marketplace step each time
  });

  it('no claude on PATH: settings are still written, the repair is reported as manual', async () => {
    const r = await sub(modsCommand, 'install').action!(ctx({ strict: true }));
    expect(r).toMatchObject({ success: false, exitCode: 1, data: { resolvable: false } });
    expect(read(join(root, '.claude', 'settings.local.json')).enabledPlugins[MOD_PLUGIN_ID]).toBe(true);
  });
});

describe('ADR-404 mods uninstall: claude plugin uninstall exactly what ruflo installed', () => {
  it('uninstalls the plugins ruflo installed, never one installed before, then removes the settings keys', async () => {
    fakeClaude('ok');
    // ruflo-swarm was installed for this project before ruflo touched it.
    const cfg = join(home, 'cfg', 'plugins');
    mkdirSync(join(cfg, 'cache', 'pre'), { recursive: true });
    writeFileSync(join(cfg, 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'ruflo-swarm@ruflo': [{ scope: 'local', installPath: join(cfg, 'cache', 'pre'), projectPath: root }] } }));
    await sub(modsCommand, 'install').action!(ctx());
    expect(read(join(root, '.claude-flow', 'mods', 'install.json')).files[join(root, '.claude', 'settings.local.json')].claudeInstalled).toEqual(['ruflo-mods@ruflo', 'ruflo-console@ruflo']);
    const r = await sub(modsCommand, 'uninstall').action!(ctx());
    expect(r.success).toBe(true);
    expect(calls().filter((c) => c.includes(' uninstall '))).toEqual(['plugin uninstall ruflo-mods@ruflo --scope local', 'plugin uninstall ruflo-console@ruflo --scope local']);
    expect(Object.keys(read(join(cfg, 'installed_plugins.json')).plugins)).toEqual(['ruflo-swarm@ruflo']);
    expect(read(join(root, '.claude', 'settings.local.json'))).toEqual({});
  });
});

describe('ADR-404 mods install --source local (dogfooding)', () => {
  const checkout = () => {
    const dir = join(home, 'ruflo-checkout');
    for (const p of ['ruflo-mods', 'ruflo-swarm', 'ruflo-console']) {
      mkdirSync(join(dir, 'plugins', p, '.claude-plugin'), { recursive: true });
      writeFileSync(join(dir, 'plugins', p, '.claude-plugin', 'plugin.json'), '{}');
    }
    mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'ruflo', plugins: [] }));
    return dir;
  };

  it('declares a directory marketplace, adds it, installs nothing (plugins load live), and doctor reports the source', async () => {
    fakeClaude('ok');
    const dir = checkout();
    const r = await sub(modsCommand, 'install').action!(ctx({ source: 'local', marketplacePath: dir }));
    expect(r).toMatchObject({ success: true, data: { resolvable: true } });
    expect(read(join(root, '.claude', 'settings.local.json')).extraKnownMarketplaces.ruflo).toEqual({ source: { source: 'directory', path: dir } });
    expect(calls()).toEqual([`plugin marketplace add ${dir} --scope local`]);
    const all = await findings();
    expect(all.find((f) => f.name === 'ruflo marketplace')).toMatchObject({ status: 'pass', message: expect.stringContaining(`directory ${dir}`) });
    expect(status(all, 'plugin ruflo-mods@ruflo')).toBe('pass');
  });

  it('refuses a directory that is not the ruflo marketplace', async () => {
    const r = await sub(modsCommand, 'install').action!(ctx({ source: 'local', marketplacePath: home }));
    expect(r).toMatchObject({ success: false, exitCode: 1 });
    expect(existsSync(join(root, '.claude', 'settings.local.json'))).toBe(false);
  });

  it('warns when this project declares one source but Claude Code knows ruflo by another', async () => {
    fakeClaude('ok');
    await sub(modsCommand, 'install').action!(ctx()); // github, known
    const dir = checkout();
    const local = join(root, '.claude', 'settings.local.json');
    const s = read(local);
    s.extraKnownMarketplaces.ruflo = { source: { source: 'directory', path: dir } };
    writeFileSync(local, JSON.stringify(s));
    const all = await findings();
    expect(all.find((f) => f.name === 'ruflo marketplace')).toMatchObject({ status: 'warn', message: expect.stringContaining('one ruflo marketplace per config dir') });
  });
});

describe('ADR-404 amendment: ruflo init upgrade --mods', () => {
  const upgrade = sub(initCommand, 'upgrade');
  const settingsFile = () => join(root, '.claude', 'settings.json');
  const userSettings = {
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
    env: { MY_VAR: 'keep' },
    enabledPlugins: { 'mine@elsewhere': true, 'ruflo-swarm@ruflo': false },
    permissions: { allow: ['Bash(ls)'] },
  };
  beforeEach(() => {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(userSettings, null, 2));
  });

  it('merges the mod keys into the committed settings, keeps every user key, installs at project scope; a re-run changes nothing', async () => {
    delete process.env.VITEST;
    delete process.env.CI;
    fakeClaude('ok');
    expect((await upgrade.action!(ctx({ mods: true }))).success).toBe(true);
    const after = read(settingsFile());
    expect(after.hooks).toEqual(userSettings.hooks);
    expect(after.permissions).toEqual(userSettings.permissions);
    expect(after.env).toEqual({ MY_VAR: 'keep', CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: '1' });
    expect(after.enabledPlugins).toEqual({ 'mine@elsewhere': true, 'ruflo-swarm@ruflo': false, 'ruflo-mods@ruflo': true, 'ruflo-console@ruflo': true });
    expect(after.extraKnownMarketplaces.ruflo.source).toEqual({ source: 'github', repo: 'ruvnet/ruflo' });
    expect(calls()).toContain('plugin install ruflo-mods@ruflo --scope project');
    // A plugin the user set to false is never installed (claude plugin install would flip it on).
    expect(calls().join('\n')).not.toContain('ruflo-swarm');

    const text = readFileSync(settingsFile(), 'utf8');
    const again = await upgrade.action!(ctx({ mods: true }));
    expect(readFileSync(settingsFile(), 'utf8')).toBe(text);
    expect((again.data as { settingsUpdated?: string[] }).settingsUpdated ?? []).not.toContain('env.CLAUDE_CODE_ENABLE_FUNCTION_HOOKS = "1"');

    await sub(modsCommand, 'uninstall').action!(ctx());
    expect(read(settingsFile())).toEqual(userSettings);
  });

  it('--add-missing and --settings include mods; --no-mods opts out', async () => {
    expect((await upgrade.action!(ctx({ settings: true, mods: false }))).success).toBe(true);
    expect(read(settingsFile()).enabledPlugins[MOD_PLUGIN_ID]).toBeUndefined();
    expect((await upgrade.action!(ctx({ settings: true }))).success).toBe(true);
    expect(read(settingsFile()).enabledPlugins[MOD_PLUGIN_ID]).toBe(true);
  });

  it('under a test runner (VITEST) the claude step is skipped, never run', async () => {
    fakeClaude('ok');
    const r = await upgrade.action!(ctx({ mods: true }));
    expect(r.success).toBe(true);
    expect(calls()).toEqual([]);
  });
});
