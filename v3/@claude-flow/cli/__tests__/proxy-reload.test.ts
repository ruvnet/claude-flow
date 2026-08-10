/**
 * `ruflo proxy` consent commands notify a running meta-proxy daemon
 * (cognitum-one/meta-proxy#28's fix, mirrored client-side).
 *
 * The Rust proxy loads its config once at boot and never re-reads the file
 * afterward, so `sponsor-enable`/`power-saver-enable`/`training-share-enable`
 * (and their `-disable` counterparts) must call `POST /internal/reload-config`
 * after writing the consent mirror, or an already-running daemon silently
 * ignores the change until restarted.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';
import type { AddressInfo } from 'net';
import type { CommandContext } from '@claude-flow/cli-core/types';

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-reload-test-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

const TEST_TOKEN = 'test-proxy-token-abc123';

function seedConfig(bind: string): void {
  fs.writeFileSync(path.join(stateDir, 'proxy-config.toml'), `bind = "${bind}"\n`, 'utf-8');
  fs.writeFileSync(path.join(stateDir, 'proxy-token'), TEST_TOKEN, 'utf-8');
}

function ctx(flags: Record<string, unknown> = {}): CommandContext {
  return { args: [], flags: { yes: true, _: [], ...flags }, cwd: process.cwd(), interactive: false };
}

/** A minimal stand-in for meta-proxy's /internal/reload-config endpoint. */
async function startMockDaemon(): Promise<{ url: string; bind: string; calls: Array<{ path: string; auth: string | undefined }>; close: () => Promise<void> }> {
  const calls: Array<{ path: string; auth: string | undefined }> = [];
  const server = http.createServer((req, res) => {
    calls.push({ path: req.url ?? '', auth: req.headers.authorization });
    res.statusCode = 204;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const bind = `127.0.0.1:${port}`;
  return {
    url: `http://${bind}`,
    bind,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('ruflo proxy consent commands notify a running daemon', () => {
  it('sponsor-enable calls POST /internal/reload-config with the proxy token', async () => {
    const daemon = await startMockDaemon();
    seedConfig(daemon.bind);
    const { sponsorEnableSub } = await import('../src/commands/proxy.js');
    const result = await sponsorEnableSub.action!(ctx());
    await daemon.close();

    expect(result.success).toBe(true);
    expect(daemon.calls).toHaveLength(1);
    expect(daemon.calls[0].path).toBe('/internal/reload-config');
    expect(daemon.calls[0].auth).toBe(`Bearer ${TEST_TOKEN}`);
  });

  it('sponsor-disable also notifies the running daemon', async () => {
    const daemon = await startMockDaemon();
    seedConfig(daemon.bind);
    const { sponsorEnableSub, sponsorDisableSub } = await import('../src/commands/proxy.js');
    await sponsorEnableSub.action!(ctx());
    daemon.calls.length = 0; // only count the disable call
    const result = await sponsorDisableSub.action!(ctx());
    await daemon.close();

    expect(result.success).toBe(true);
    expect(daemon.calls).toHaveLength(1);
    expect(daemon.calls[0].path).toBe('/internal/reload-config');
  });

  it('power-saver-enable notifies the running daemon', async () => {
    const daemon = await startMockDaemon();
    seedConfig(daemon.bind);
    const { powerSaverEnableSub } = await import('../src/commands/proxy.js');
    const result = await powerSaverEnableSub.action!(ctx());
    await daemon.close();

    expect(result.success).toBe(true);
    expect(daemon.calls).toHaveLength(1);
    expect(daemon.calls[0].path).toBe('/internal/reload-config');
  });

  it('training-share-enable notifies the running daemon', async () => {
    const daemon = await startMockDaemon();
    seedConfig(daemon.bind);
    const { trainingShareEnableSub } = await import('../src/commands/proxy.js');
    const result = await trainingShareEnableSub.action!(ctx());
    await daemon.close();

    expect(result.success).toBe(true);
    expect(daemon.calls).toHaveLength(1);
    expect(daemon.calls[0].path).toBe('/internal/reload-config');
  });

  it('config --cloud --yes notifies the running daemon', async () => {
    const daemon = await startMockDaemon();
    seedConfig(daemon.bind);
    const { configSub } = await import('../src/commands/proxy.js');
    const result = await configSub.action!(ctx({ cloud: true }));
    await daemon.close();

    expect(result.success).toBe(true);
    expect(daemon.calls).toHaveLength(1);
    expect(daemon.calls[0].path).toBe('/internal/reload-config');
  });

  it('config --local-only notifies the running daemon', async () => {
    const daemon = await startMockDaemon();
    seedConfig(daemon.bind);
    const { configSub } = await import('../src/commands/proxy.js');
    const result = await configSub.action!(ctx({ 'local-only': true }));
    await daemon.close();

    expect(result.success).toBe(true);
    expect(daemon.calls).toHaveLength(1);
    expect(daemon.calls[0].path).toBe('/internal/reload-config');
  });

  it('config with no flags (status read) does NOT notify the daemon', async () => {
    const daemon = await startMockDaemon();
    seedConfig(daemon.bind);
    const { configSub } = await import('../src/commands/proxy.js');
    const result = await configSub.action!(ctx({ yes: undefined }));
    await daemon.close();

    expect(result.success).toBe(true);
    expect(daemon.calls).toHaveLength(0);
  });

  it('never fails the command when no daemon is running', async () => {
    // No mock server started at all — proxy-config.toml points at a bind
    // address nothing is listening on.
    seedConfig('127.0.0.1:1'); // reserved port, guaranteed connection-refused
    const { sponsorEnableSub } = await import('../src/commands/proxy.js');
    const result = await sponsorEnableSub.action!(ctx());

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ confirmed: true });
  });

  it('never fails the command when the token file is missing', async () => {
    fs.writeFileSync(path.join(stateDir, 'proxy-config.toml'), 'bind = "127.0.0.1:11435"\n', 'utf-8');
    // No proxy-token file written at all.
    const { sponsorEnableSub } = await import('../src/commands/proxy.js');
    const result = await sponsorEnableSub.action!(ctx());

    expect(result.success).toBe(true);
  });
});
