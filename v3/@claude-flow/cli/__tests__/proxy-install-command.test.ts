/**
 * `proxy install` defaults to the reviewed, signed Meta-Proxy release pinned
 * by `DEFAULT_PROXY_RELEASE`. `--release` remains an explicit override; the
 * default must still pass through the normal consent gate and
 * signature-verifying installer.
 *
 * These assertions read the pin from the module rather than hardcoding a
 * version, so a bump cannot leave the tests asserting a stale release.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CommandContext } from '../src/types.js';

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-install-cmd-test-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
  vi.resetModules();
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function ctxWithFlags(flags: Record<string, unknown>): CommandContext {
  return { args: [], flags: { _: [], ...flags }, cwd: process.cwd(), interactive: false };
}

async function getInstallSub() {
  const { proxyLifecycleSubcommands } = await import('../src/commands/proxy-lifecycle.js');
  const sub = proxyLifecycleSubcommands.find((c) => c.name === 'install');
  if (!sub) throw new Error('install subcommand not found');
  return sub;
}

describe('proxy install - pinned release default', () => {
  it('without --release shows disclosure without recording consent', async () => {
    const installSub = await getInstallSub();
    const result = await installSub.action!(ctxWithFlags({}));

    expect(result?.success).toBe(true);
    expect((result?.data as { confirmed?: boolean } | undefined)?.confirmed).toBe(false);
    const { hasConsent } = await import('../src/funnel/index.js');
    expect(hasConsent('proxy-install')).toBe(false);
  });

  it('uses the pinned release when confirmed without a release override', async () => {
    const installProxy = vi.fn();
    // Register the mock BEFORE importing proxy-lifecycle.js — that module
    // imports the installer at load time, so importing it first binds the
    // real one and the test performs an actual download.
    vi.doMock('../src/proxy/install.js', () => ({ installProxy, uninstallProxy: vi.fn() }));

    const { DEFAULT_PROXY_RELEASE } = await import('../src/commands/proxy-lifecycle.js');
    installProxy.mockResolvedValue({ version: DEFAULT_PROXY_RELEASE, binaryPath: '/tmp/meta-proxy', sha256: 'abc' });

    const installSub = await getInstallSub();
    const result = await installSub.action!(ctxWithFlags({ yes: true }));

    expect(result?.success).toBe(true);
    expect(installProxy).toHaveBeenCalledWith(expect.objectContaining({ version: DEFAULT_PROXY_RELEASE }));
  });

  it('honors an explicit release override', async () => {
    const installProxy = vi.fn().mockResolvedValue({ version: '9.9.9', binaryPath: '/tmp/meta-proxy', sha256: 'abc' });
    vi.doMock('../src/proxy/install.js', () => ({ installProxy, uninstallProxy: vi.fn() }));

    const installSub = await getInstallSub();
    const result = await installSub.action!(ctxWithFlags({ release: '9.9.9', yes: true }));

    expect(result?.success).toBe(true);
    expect(installProxy).toHaveBeenCalledWith(expect.objectContaining({ version: '9.9.9' }));
  });
});
