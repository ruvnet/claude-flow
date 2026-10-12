/**
 * ADR-404 hardening — `ruflo mods doctor` names each broken state with a one-line repair that actually
 * repairs it, `--strict` makes a warning fail, and `ruflo mods install` is one operation: when the
 * record cannot be written the settings are put back (nothing half-installed).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ENABLE_ENV, INSTALL_RECORD, installMod, MOD_PLUGIN_ID, MOD_PLUGIN_IDS } from '../../src/mods/install.js';
import { probeMods, type Finding } from '../../src/mods/probe.js';
import { hasFailureOrStrictWarning } from '../../src/commands/mods.js';

let root: string;
let home: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ruflo-mods-hard-'));
  home = mkdtempSync(join(tmpdir(), 'ruflo-mods-hard-home-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const settingsPath = (name = 'settings.local.json') => join(root, '.claude', name);
const writeSettings = (value: unknown, name = 'settings.local.json') => {
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(settingsPath(name), JSON.stringify(value));
};
const probe = (extra: Record<string, unknown> = {}): Finding[] =>
  probeMods({ projectRoot: root, home, configDir: join(home, '.claude'), env: {}, managedPath: join(home, 'none.json'), installs: [], ...extra });
const named = (findings: Finding[], name: string) => findings.find((f) => f.name === name);

describe('doctor: a plugin switched off is not repaired by `mods install`', () => {
  it('names the plugin as disabled and repairs it with `claude plugin enable`, not `ruflo mods install`', () => {
    writeSettings({ enabledPlugins: { [MOD_PLUGIN_ID]: false } });
    const f = named(probe(), 'ruflo-mods plugin')!;
    expect(f.status).toBe('warn');
    expect(f.message).toMatch(/disabled/i);
    expect(f.fix).toContain('claude plugin enable ruflo-mods@ruflo');
    expect(f.fix).not.toContain('ruflo mods install');
  });

  it('a plugin that is installed for this project but enabled nowhere says so', () => {
    const cfg = join(home, '.claude');
    const cache = join(cfg, 'plugins', 'cache', 'ruflo', 'ruflo-mods', '1.0.0');
    mkdirSync(cache, { recursive: true });
    mkdirSync(join(cfg, 'plugins'), { recursive: true });
    writeFileSync(join(cfg, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { [MOD_PLUGIN_ID]: [{ scope: 'user', installPath: cache }] } }));
    const f = named(probe(), 'ruflo-mods plugin')!;
    expect(f.status).toBe('warn');
    expect(f.message).toMatch(/installed .*not enabled/i);
    expect(f.fix).toMatch(/claude plugin enable ruflo-mods@ruflo|ruflo mods install/);
  });
});

describe('doctor: a partial install', () => {
  it('flags mods enabled without the swarm and console plugins, with `ruflo mods install` as the repair', () => {
    writeSettings({ enabledPlugins: { [MOD_PLUGIN_ID]: true }, env: { [ENABLE_ENV]: '1' }, extraKnownMarketplaces: { ruflo: { source: { source: 'github', repo: 'ruvnet/ruflo' } } } });
    const f = named(probe(), 'partial install')!;
    expect(f).toBeDefined();
    expect(f.status).toBe('warn');
    expect(f.message).toContain('ruflo-swarm@ruflo');
    expect(f.message).toContain('ruflo-console@ruflo');
    expect(f.fix).toBe('ruflo mods install');
  });

  it('flags a plugin enabled with no marketplace declared anywhere', () => {
    writeSettings({ enabledPlugins: Object.fromEntries(MOD_PLUGIN_IDS.map((id) => [id, true])), env: { [ENABLE_ENV]: '1' } });
    const f = named(probe(), 'partial install')!;
    expect(f.status).toBe('warn');
    expect(f.message).toMatch(/marketplace/);
  });

  it('flags keys the install record says ruflo added but the settings file no longer has', () => {
    installMod(root, 'local');
    const file = settingsPath();
    const s = JSON.parse(readFileSync(file, 'utf8'));
    delete s.enabledPlugins['ruflo-console@ruflo'];
    writeFileSync(file, JSON.stringify(s));
    const f = named(probe(), 'partial install')!;
    expect(f.status).toBe('warn');
    expect(f.message).toContain('ruflo-console@ruflo');
  });

  it('is quiet after a complete install and when nothing is installed at all', () => {
    expect(named(probe(), 'partial install')).toBeUndefined();
    installMod(root, 'local');
    expect(named(probe(), 'partial install')?.status ?? 'pass').toBe('pass');
  });
});

describe('doctor: every non-passing finding carries a one-line repair', () => {
  it('a fresh project with the mod enabled but nothing cloned, nothing cached and function hooks unproven', () => {
    installMod(root, 'local');
    const bad = probe().filter((f) => f.status !== 'pass');
    expect(bad.length).toBeGreaterThan(0);
    for (const f of bad) {
      // The only findings allowed without a command are engine-side facts a person cannot change.
      if (f.name === 'function hooks' && /serves function hooks OFF/.test(f.message)) continue;
      expect(f.fix, `${f.name}: ${f.message}`).toBeTruthy();
      expect(f.fix!.includes('\n'), `${f.name} fix is one line`).toBe(false);
    }
  });
});

describe('doctor --strict', () => {
  const warn: Finding = { name: 'x', status: 'warn', message: 'm', fix: 'f' };
  const pass: Finding = { name: 'y', status: 'pass', message: 'm' };
  const fail: Finding = { name: 'z', status: 'fail', message: 'm', fix: 'f' };
  it('fails on a warning only when strict; always fails on a failure', () => {
    expect(hasFailureOrStrictWarning([pass, warn], false)).toBe(false);
    expect(hasFailureOrStrictWarning([pass, warn], true)).toBe(true);
    expect(hasFailureOrStrictWarning([pass, fail], false)).toBe(true);
    expect(hasFailureOrStrictWarning([pass], true)).toBe(false);
  });
});

describe('install is one operation', () => {
  it('puts the settings back when the install record cannot be written', () => {
    writeSettings({ hooks: { Stop: [] }, env: { KEEP: 'x' } });
    const before = readFileSync(settingsPath(), 'utf8');
    // The record's folder cannot be created: .claude-flow is a file.
    writeFileSync(join(root, '.claude-flow'), 'not a folder');
    expect(() => installMod(root, 'local')).toThrow();
    expect(readFileSync(settingsPath(), 'utf8')).toBe(before);
  });

  it('removes a settings file it created when the record cannot be written', () => {
    writeFileSync(join(root, '.claude-flow'), 'not a folder');
    expect(existsSync(settingsPath())).toBe(false);
    expect(() => installMod(root, 'local')).toThrow();
    expect(existsSync(settingsPath())).toBe(false);
  });

  it('a second run changes nothing and writes no second backup', () => {
    installMod(root, 'local');
    const first = readFileSync(settingsPath(), 'utf8');
    const record = readFileSync(join(root, INSTALL_RECORD), 'utf8');
    const again = installMod(root, 'local');
    expect(again.added).toEqual({ plugins: [], marketplace: false, env: false });
    expect(again.backup).toBeUndefined();
    expect(readFileSync(settingsPath(), 'utf8')).toBe(first);
    expect(readFileSync(join(root, INSTALL_RECORD), 'utf8')).toBe(record);
  });
});

void chmodSync;
