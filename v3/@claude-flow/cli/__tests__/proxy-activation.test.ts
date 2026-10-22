import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let stateDir: string;
let previousState: string | undefined;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-proxy-activation-'));
  previousState = process.env.RUFLO_STATE_DIR;
  process.env.RUFLO_STATE_DIR = stateDir;
  vi.resetModules();
  vi.doMock('../src/funnel/index.js', () => ({ funnelStateDir: () => stateDir }));
});

afterEach(() => {
  if (previousState === undefined) delete process.env.RUFLO_STATE_DIR;
  else process.env.RUFLO_STATE_DIR = previousState;
  fs.rmSync(stateDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('effective Meta-Proxy activation', () => {
  it('rejects a non-loopback bind before any version request', async () => {
    const { probeEffectiveProxy } = await import('../src/proxy/activation.js');
    fs.writeFileSync(path.join(stateDir, 'proxy-config.toml'), 'bind = "0.0.0.0:11435"\n');
    let fetched = false;
    await expect(probeEffectiveProxy(async () => {
      fetched = true;
      return new Response('{}');
    })).rejects.toThrow(/non-loopback/i);
    expect(fetched).toBe(false);
  });

  it('serializes two installer callers with the shared lease', async () => {
    const { acquireProxyInstallLease } = await import('../src/proxy/activation.js');
    const releaseFirst = await acquireProxyInstallLease();
    let waited = false;
    const releaseSecond = await acquireProxyInstallLease(async () => {
      waited = true;
      releaseFirst();
    });
    expect(waited).toBe(true);
    expect(fs.existsSync(path.join(stateDir, 'meta-proxy-install.lock'))).toBe(true);
    releaseSecond();
  });
});
