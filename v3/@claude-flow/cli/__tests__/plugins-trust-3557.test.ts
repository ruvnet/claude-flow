/**
 * #3557 — `plugins install --verify` must enforce declared trust/permissions
 * and registry checksums instead of being parsed and ignored.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';

// Every npm call goes through child_process.execFile. The mock records calls
// and fakes `npm pack` by writing a tarball whose bytes the test controls.
const npmCalls: string[][] = [];
let packBytes = Buffer.from('tarball-bytes');
vi.mock('child_process', () => ({
  execFile: (file: string, args: string[], _opts: unknown, cb: (e: unknown, r?: unknown) => void) => {
    const npmArgs = file === 'cmd.exe' ? args.slice(4) : args;
    npmCalls.push(npmArgs);
    if (npmArgs[0] === 'pack') {
      const dest = npmArgs[npmArgs.indexOf('--pack-destination') + 1];
      fs.writeFileSync(path.join(dest, 'evil-plugin-1.0.0.tgz'), packBytes);
      cb(null, { stdout: JSON.stringify([{ filename: 'evil-plugin-1.0.0.tgz' }]), stderr: '' });
      return;
    }
    cb(null, { stdout: '', stderr: '' });
  },
}));

import { PluginManager } from '../src/plugins/manager.js';
import {
  DEFAULT_PLUGIN_PERMISSIONS,
  evaluatePluginTrust,
  parseSha256Checksum,
  readDeclaredTrust,
} from '../src/plugins/trust-policy.js';

function makeLocalPlugin(root: string, name: string, extra: Record<string, unknown>): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      'claude-flow': { hooks: ['pre-task'], commands: ['probe'], ...extra },
    }),
  );
  return dir;
}

function readManifest(base: string): Record<string, any> {
  const p = path.join(base, '.claude-flow', 'plugins', 'installed.json');
  if (!fs.existsSync(p)) return { plugins: {} };
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

describe('#3557 plugin install trust enforcement', () => {
  let base: string;
  let manager: PluginManager;

  beforeEach(async () => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-trust-3557-'));
    manager = new PluginManager(base);
    await manager.initialize();
    npmCalls.length = 0;
    packBytes = Buffer.from('tarball-bytes');
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it("Martin's repro: an untrusted local plugin with elevated permissions registers no hooks by default, and the manifest records trust + permissions", async () => {
    const dir = makeLocalPlugin(base, 'evil-probe', {
      trustLevel: 'untrusted',
      permissions: ['filesystem:write', 'network:all', 'shell:exec', 'secrets:read'],
    });

    const result = await manager.installFromLocal(dir, { verify: true });

    expect(result.success).toBe(true);
    expect(result.plugin!.hooks).toEqual([]);
    expect(result.plugin!.commands).toEqual([]);

    const entry = readManifest(base).plugins['evil-probe'];
    expect(entry.trustLevel).toBe('untrusted');
    expect(entry.permissions).toEqual(['filesystem:write', 'network:all', 'shell:exec', 'secrets:read']);
    expect(entry.hooks).toEqual([]);
    expect(entry.withheld.hooks).toEqual(['pre-task']);
    expect(entry.withheld.commands).toEqual(['probe']);
    expect(entry.withheld.reasons.join(' ')).toMatch(/untrusted/);
    expect(entry.withheld.reasons.join(' ')).toMatch(/shell:exec/);
  });

  it('with no options at all, a local install still enforces (secure default)', async () => {
    const dir = makeLocalPlugin(base, 'evil-default', { trustLevel: 'untrusted', permissions: ['shell:exec'] });
    const result = await manager.installFromLocal(dir);
    expect(result.plugin!.hooks).toEqual([]);
  });

  it('--trust registers the hooks and commands of the same plugin', async () => {
    const dir = makeLocalPlugin(base, 'evil-trusted', {
      trustLevel: 'untrusted',
      permissions: ['filesystem:write', 'network:all', 'shell:exec', 'secrets:read'],
    });

    const result = await manager.installFromLocal(dir, { verify: true, trust: true });

    expect(result.success).toBe(true);
    const entry = readManifest(base).plugins['evil-trusted'];
    expect(entry.hooks).toEqual(['pre-task']);
    expect(entry.commands).toEqual(['probe']);
    expect(entry.trustLevel).toBe('untrusted');
    expect(entry.withheld).toBeUndefined();
  });

  it('a benign plugin (default permission set only) installs as before, with trust recorded', async () => {
    const dir = makeLocalPlugin(base, 'benign', { trustLevel: 'community', permissions: [...DEFAULT_PLUGIN_PERMISSIONS] });

    const result = await manager.installFromLocal(dir, { verify: true });

    expect(result.success).toBe(true);
    const entry = readManifest(base).plugins['benign'];
    expect(entry.hooks).toEqual(['pre-task']);
    expect(entry.commands).toEqual(['probe']);
    expect(entry.permissions).toEqual(['memory:read']);
    expect(entry.trustLevel).toBe('community');
    expect(entry.verification).toBe('policy');
    expect(entry.withheld).toBeUndefined();
  });

  it('--no-verify keeps the old behaviour but marks verification as skipped', async () => {
    const dir = makeLocalPlugin(base, 'evil-noverify', { trustLevel: 'untrusted', permissions: ['shell:exec'] });

    const result = await manager.installFromLocal(dir, { verify: false });

    expect(result.decision!.verificationSkipped).toBe(true);
    const entry = readManifest(base).plugins['evil-noverify'];
    expect(entry.hooks).toEqual(['pre-task']);
    expect(entry.verification).toBe('skipped');
    expect(entry.permissions).toEqual(['shell:exec']);
  });

  it('a registry checksum mismatch fails closed: nothing is installed and nothing is recorded', async () => {
    const expected = createHash('sha256').update('the-bytes-the-registry-published').digest('hex');
    packBytes = Buffer.from('tampered-bytes');

    const result = await manager.installFromNpm('evil-plugin', undefined, {
      verify: true,
      expectedChecksum: `sha256:${expected}`,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Checksum mismatch/);
    expect(npmCalls.some((a) => a[0] === 'install')).toBe(false);
    expect(readManifest(base).plugins['evil-plugin']).toBeUndefined();
  });

  it('a matching registry checksum installs from the exact tarball that was hashed', async () => {
    const expected = createHash('sha256').update(packBytes).digest('hex');

    const result = await manager.installFromNpm('evil-plugin', undefined, {
      verify: true,
      expectedChecksum: `sha256:${expected}`,
      registryTrustLevel: 'official',
    });

    expect(result.success).toBe(true);
    const install = npmCalls.find((a) => a[0] === 'install')!;
    expect(install[install.length - 1]).toMatch(/evil-plugin-1\.0\.0\.tgz$/);
    expect(result.plugin!.verification).toBe('checksum');
  });

  it('a placeholder registry checksum is not treated as verified; it warns and falls back to npm integrity', async () => {
    const result = await manager.installFromNpm('evil-plugin', undefined, {
      verify: true,
      expectedChecksum: 'sha256:abc123neural',
    });

    expect(result.success).toBe(true);
    expect(result.plugin!.verification).toBe('npm-integrity');
    expect(result.warnings!.join(' ')).toMatch(/not a verifiable sha256/);
    expect(npmCalls.some((a) => a[0] === 'pack')).toBe(false);
  });
});

describe('#3557 trust-policy helpers', () => {
  it('reads trust from the claude-flow block, falling back to top-level fields', () => {
    expect(readDeclaredTrust({ 'claude-flow': { trustLevel: 'untrusted', permissions: ['shell:exec'] } }))
      .toEqual({ trustLevel: 'untrusted', permissions: ['shell:exec'] });
    expect(readDeclaredTrust({ trustLevel: 'community', permissions: ['memory:read'] }))
      .toEqual({ trustLevel: 'community', permissions: ['memory:read'] });
    expect(readDeclaredTrust({})).toEqual({ trustLevel: undefined, permissions: [] });
  });

  it('a registry-vouched (official/verified) plugin is allowed without --trust', () => {
    const d = evaluatePluginTrust(
      { permissions: ['memory', 'hooks'] },
      { verify: true, trust: false, registryTrustLevel: 'official' },
    );
    expect(d.allowed).toBe(true);
  });

  it('only a well-formed sha256 digest is verifiable', () => {
    expect(parseSha256Checksum(`sha256:${'a'.repeat(64)}`)).toBe('a'.repeat(64));
    expect(parseSha256Checksum('sha256:abc123neural')).toBeNull();
    expect(parseSha256Checksum(undefined)).toBeNull();
  });
});
