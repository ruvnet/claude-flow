/**
 * doctor's checkProxyProcess (ADR-307) — the /status-endpoint wiring added
 * after finding the original implementation only did PID liveness (its own
 * doc comment claimed it hit /status but never actually did). The real
 * response shape (`{version, data_plane, bind, sponsored_available,
 * proxy_token_valid}`) was confirmed against the real v0.1.0 binary; this
 * file mocks `fetch` to cover the comparison/parsing logic without spawning
 * a real process per test.
 *
 * Result shape: `doctorCommand.action(ctx)` -> `{success, data: {results: HealthCheck[]}}`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { doctorCommand } from '../src/commands/doctor.js';

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;
let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-proxy-status-test-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
  fetchSpy?.mockRestore();
  fetchSpy = null;
});

function ctxFor(component: string) {
  return {
    flags: { component },
    args: [],
    config: {} as Record<string, unknown>,
  } as unknown as Parameters<NonNullable<typeof doctorCommand.action>>[0];
}

async function findProxyProcessCheck() {
  const result = await doctorCommand.action!(ctxFor('proxy'));
  const checks = (result?.data as { results?: Array<{ name: string; status: string; message: string; fix?: string }> })?.results ?? [];
  const check = checks.find((c) => c.name.startsWith('Meta LLM Proxy process'));
  if (!check) throw new Error('proxy process check not found in results');
  return check;
}

/** A PID guaranteed to pass process.kill(pid, 0) — this test's own process. */
function writeLivePidFile() {
  fs.writeFileSync(path.join(stateDir, 'proxy.pid'), String(process.pid));
}

describe('checkProxyProcess — /status wiring', () => {
  it('reports data_plane from a real-shaped /status response', async () => {
    writeLivePidFile();
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ version: '0.1.0', data_plane: 'passthrough:anthropic', bind: '127.0.0.1:11435', sponsored_available: false, proxy_token_valid: true }),
        { status: 200 },
      ),
    );
    fs.writeFileSync(path.join(stateDir, 'proxy-token'), 'fake-token');

    const check = await findProxyProcessCheck();
    expect(check.status).toBe('pass');
    expect(check.message).toContain('data plane: passthrough:anthropic');
  });

  it('warns when the running process reports a different version than the install manifest', async () => {
    writeLivePidFile();
    fs.writeFileSync(path.join(stateDir, 'proxy-token'), 'fake-token');
    fs.mkdirSync(path.join(stateDir, 'proxy'), { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'proxy', 'install-manifest.json'),
      JSON.stringify({ version: '9.9.9', sha256: 'x', verifiedAt: 'x', pubkeyFingerprint: 'x' }),
    );
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: '0.1.0', data_plane: 'local' }), { status: 200 }),
    );

    const check = await findProxyProcessCheck();
    expect(check.status).toBe('warn');
    expect(check.message).toContain('reports v0.1.0');
    expect(check.message).toContain('installed binary is v9.9.9');
  });

  it('passes on a live process with no proxy-token, skipping the /status call', async () => {
    writeLivePidFile();
    fetchSpy = vi.spyOn(globalThis, 'fetch');

    const check = await findProxyProcessCheck();
    expect(check.status).toBe('pass');
    expect(check.message).toContain('no proxy-token to query /status');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still passes (not fails) when /status is unreachable — PID liveness already succeeded', async () => {
    writeLivePidFile();
    fs.writeFileSync(path.join(stateDir, 'proxy-token'), 'fake-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const check = await findProxyProcessCheck();
    expect(check.status).toBe('pass');
    expect(check.message).toContain('/status unreachable');
  });

  it('warns (not fails) on a non-2xx /status response', async () => {
    writeLivePidFile();
    fs.writeFileSync(path.join(stateDir, 'proxy-token'), 'fake-token');
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500 }));

    const check = await findProxyProcessCheck();
    expect(check.status).toBe('warn');
    expect(check.message).toContain('HTTP 500');
  });

  it('never spawns the binary or calls fetch when nothing is running', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    const check = await findProxyProcessCheck();
    expect(check.status).toBe('warn');
    expect(check.message).toContain('not running');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
