/**
 * #3557 follow-up — an untrusted plugin's npm lifecycle scripts must not run
 * on a default install. This drives REAL npm against a local tarball (no
 * network): the mock only rewrites the package spec to the tarball path and
 * delegates to the real execFile, so npm itself decides whether postinstall runs.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const PKG = 'ruflo-script-probe-3557';
const state: { tarball: string } = { tarball: '' };

vi.mock('child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('child_process')>();
  return {
    ...real,
    execFile: (file: string, args: string[], opts: unknown, cb: (...a: unknown[]) => void) => {
      const mapped = args.map((a) => (a === PKG ? state.tarball : a));
      return real.execFile(file, mapped, opts as object, cb as never);
    },
  };
});

import { PluginManager } from '../src/plugins/manager.js';

describe('#3557 install scripts are skipped for untrusted plugins', () => {
  let work: string;
  let sentinel: string;

  beforeAll(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-scripts-3557-'));
    sentinel = path.join(work, 'POSTINSTALL_RAN');
    const src = path.join(work, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(
      path.join(src, 'package.json'),
      JSON.stringify({
        name: PKG,
        version: '1.0.0',
        scripts: {
          postinstall: `node -e "require('fs').writeFileSync('${sentinel}', 'ran')"`,
        },
        'claude-flow': { trustLevel: 'untrusted', permissions: ['shell:exec'], hooks: ['pre-task'] },
      }),
    );
    const out = execFileSync('npm', ['pack', '--pack-destination', work, '--ignore-scripts', '--json'], {
      cwd: src,
      encoding: 'utf-8',
    });
    state.tarball = path.join(work, JSON.parse(out)[0].filename);
  }, 60000);

  afterAll(() => fs.rmSync(work, { recursive: true, force: true }));

  beforeEach(() => {
    fs.rmSync(sentinel, { force: true });
  });

  it('a default install does NOT run postinstall and records scriptsRun:false', async () => {
    const base = fs.mkdtempSync(path.join(work, 'default-'));
    const manager = new PluginManager(base);
    await manager.initialize();

    const result = await manager.installFromNpm(PKG, undefined, { verify: true });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(base, '.claude-flow', 'plugins', 'node_modules', PKG, 'package.json'))).toBe(true);
    expect(fs.existsSync(sentinel)).toBe(false);
    expect(result.plugin!.scriptsRun).toBe(false);
    expect(result.plugin!.hooks).toEqual([]);
    expect(result.warnings!.join(' ')).toMatch(/Install scripts were skipped.*--trust/);
  }, 120000);

  it('with --trust, postinstall runs and scriptsRun:true is recorded', async () => {
    const base = fs.mkdtempSync(path.join(work, 'trusted-'));
    const manager = new PluginManager(base);
    await manager.initialize();

    const result = await manager.installFromNpm(PKG, undefined, { verify: true, trust: true });

    expect(result.success).toBe(true);
    expect(fs.existsSync(sentinel)).toBe(true);
    expect(result.plugin!.scriptsRun).toBe(true);
    expect(result.plugin!.hooks).toEqual(['pre-task']);
  }, 120000);
});
