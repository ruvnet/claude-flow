/**
 * #3557 follow-up — `plugins upgrade` must apply the same trust policy as
 * `plugins install`. It used to copy the new version's `claude-flow` hooks and
 * commands straight into the manifest (so hooks withheld at install got
 * registered on upgrade), and it kept running lifecycle scripts for any install
 * recorded with scriptsRun:true.
 *
 * Drives REAL npm against local tarballs (no network): the mock only rewrites
 * `<pkg>@<version>` to that version's tarball and delegates to the real
 * execFile, so npm itself decides whether postinstall runs.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const PKG = 'ruflo-upgrade-probe-3557';
const state: { tarballs: Record<string, string> } = { tarballs: {} };

vi.mock('child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('child_process')>();
  return {
    ...real,
    execFile: (file: string, args: string[], opts: unknown, cb: (...a: unknown[]) => void) => {
      const mapped = args.map((a) => state.tarballs[a] ?? a);
      return real.execFile(file, mapped, opts as object, cb as never);
    },
  };
});

import { PluginManager } from '../src/plugins/manager.js';

describe('#3557 plugins upgrade re-applies the trust policy', () => {
  let work: string;
  let sentinel: string;

  function pack(version: string, claudeFlow: Record<string, unknown>, withPostinstall: boolean): string {
    const src = path.join(work, `src-${version}`);
    fs.mkdirSync(src);
    fs.writeFileSync(
      path.join(src, 'package.json'),
      JSON.stringify({
        name: PKG,
        version,
        ...(withPostinstall
          ? { scripts: { postinstall: `node -e "require('fs').writeFileSync('${sentinel}', '${version}')"` } }
          : {}),
        'claude-flow': claudeFlow,
      }),
    );
    const out = execFileSync('npm', ['pack', '--pack-destination', work, '--ignore-scripts', '--json'], {
      cwd: src,
      encoding: 'utf-8',
    });
    return path.join(work, JSON.parse(out)[0].filename);
  }

  async function freshManager(label: string): Promise<PluginManager> {
    const manager = new PluginManager(fs.mkdtempSync(path.join(work, `${label}-`)));
    await manager.initialize();
    return manager;
  }

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-upgrade-3557-'));
    sentinel = path.join(work, 'POSTINSTALL_RAN');
    // 1.0.0: benign — default permission set only.
    state.tarballs[`${PKG}@1.0.0`] = pack('1.0.0', { permissions: ['memory:read'], hooks: ['pre-task'], commands: ['probe'] }, false);
    // 2.0.0 / 3.0.0: elevated permissions, an extra hook, and a postinstall script.
    const elevated = { trustLevel: 'untrusted', permissions: ['shell:exec'], hooks: ['pre-task', 'post-edit'], commands: ['probe'] };
    state.tarballs[`${PKG}@2.0.0`] = pack('2.0.0', elevated, true);
    state.tarballs[`${PKG}@3.0.0`] = pack('3.0.0', elevated, true);
  }, 120000);

  afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

  beforeEach(() => {
    fs.rmSync(sentinel, { force: true });
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('an upgrade that newly declares elevated permissions withholds its hooks and skips its scripts', async () => {
    const manager = await freshManager('benign');
    const installed = await manager.installFromNpm(PKG, '1.0.0', { verify: true });
    expect(installed.plugin!.hooks).toEqual(['pre-task']);

    const result = await manager.upgrade(PKG, '2.0.0');

    expect(result.success).toBe(true);
    expect(result.plugin!.version).toBe('2.0.0');
    expect(result.plugin!.hooks).toEqual([]);
    expect(result.plugin!.commands).toEqual([]);
    expect(result.plugin!.withheld).toEqual(
      expect.objectContaining({ hooks: ['pre-task', 'post-edit'], commands: ['probe'] }),
    );
    expect(result.plugin!.permissions).toEqual(['shell:exec']);
    expect(result.plugin!.scriptsRun).toBe(false);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect((await manager.getPlugin(PKG))!.hooks).toEqual([]);
  }, 120000);

  it('hooks withheld at install stay withheld on upgrade', async () => {
    const manager = await freshManager('withheld');
    const installed = await manager.installFromNpm(PKG, '2.0.0', { verify: true });
    expect(installed.plugin!.hooks).toEqual([]);
    expect(installed.plugin!.withheld).toBeDefined();

    const result = await manager.upgrade(PKG, '3.0.0');

    expect(result.success).toBe(true);
    expect(result.plugin!.hooks).toEqual([]);
    expect(result.plugin!.withheld!.hooks).toEqual(['pre-task', 'post-edit']);
    expect(fs.existsSync(sentinel)).toBe(false);
  }, 120000);

  it('a recorded scriptsRun:true (e.g. from registry vouching) does not run the new version\'s scripts', async () => {
    const manager = await freshManager('vouched');
    // An earlier install vouched as "official" ran scripts and registered hooks.
    const installed = await manager.installFromNpm(PKG, '2.0.0', { verify: true, registryTrustLevel: 'official' });
    expect(installed.plugin!.scriptsRun).toBe(true);
    expect(installed.plugin!.hooks).toEqual(['pre-task', 'post-edit']);
    fs.rmSync(sentinel, { force: true });

    const result = await manager.upgrade(PKG, '3.0.0');

    expect(result.success).toBe(true);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(result.plugin!.scriptsRun).toBe(false);
    expect(result.plugin!.hooks).toEqual([]);
    expect(result.warnings!.join(' ')).toMatch(/Install scripts were skipped.*--trust/);
  }, 120000);

  it('--trust on the upgrade runs scripts and registers the hooks', async () => {
    const manager = await freshManager('trusted');
    await manager.installFromNpm(PKG, '1.0.0', { verify: true });

    const result = await manager.upgrade(PKG, '2.0.0', { trust: true });

    expect(result.success).toBe(true);
    expect(fs.readFileSync(sentinel, 'utf-8')).toBe('2.0.0');
    expect(result.plugin!.scriptsRun).toBe(true);
    expect(result.plugin!.hooks).toEqual(['pre-task', 'post-edit']);
    expect(result.plugin!.withheld).toBeUndefined();
  }, 120000);
});
