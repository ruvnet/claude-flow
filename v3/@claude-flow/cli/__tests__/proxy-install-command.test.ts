/**
 * `proxy install` defaults to the reviewed, signed Meta-Proxy v0.4.0
 * release. `--release` remains an explicit override; the default must still
 * pass through the normal consent gate and signature-verifying installer.
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

  it('uses v0.4.0 when confirmed without a release override', async () => {
    const installProxy = vi.fn().mockResolvedValue({ version: '0.4.0', binaryPath: '/tmp/meta-proxy', sha256: 'abc' });
    vi.doMock('../src/proxy/install.js', () => ({ installProxy, uninstallProxy: vi.fn() }));

    const installSub = await getInstallSub();
    const result = await installSub.action!(ctxWithFlags({ yes: true }));

    expect(result?.success).toBe(true);
    expect(installProxy).toHaveBeenCalledWith(expect.objectContaining({ version: '0.4.0' }));
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
