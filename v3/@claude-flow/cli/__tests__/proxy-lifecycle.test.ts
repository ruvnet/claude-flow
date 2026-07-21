/**
 * proxy/lifecycle.ts — PID-file/status logic, isolated via RUFLO_STATE_DIR.
 * The actual process spawn/stop/log-redirect round trip against the real
 * meta-proxy v0.1.0 binary was verified manually during implementation
 * (start -> status -> real log content -> stop; double-start correctly
 * rejected; a stale PID file correctly recovered from) — not re-asserted
 * here since spawning a real 5MB binary per test run is not something CI
 * should depend on. This file covers the deterministic logic around it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-lifecycle-test-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe('getProxyStatus', () => {
  it('reports not-installed and not-running on a fresh state dir', async () => {
    const { getProxyStatus } = await import('../src/proxy/lifecycle.js');
    expect(getProxyStatus()).toEqual({ installed: false, running: false, pid: null, stalePidFile: false });
  });

  it('reports installed once a binary file exists at the expected path', async () => {
    const { proxyBinaryPath } = await import('../src/proxy/paths.js');
    fs.mkdirSync(path.dirname(proxyBinaryPath()), { recursive: true });
    fs.writeFileSync(proxyBinaryPath(), 'not a real binary, just a marker file');

    const { getProxyStatus } = await import('../src/proxy/lifecycle.js');
    expect(getProxyStatus().installed).toBe(true);
  });

  it('reports a stale PID file as not-running (using a PID from a dead process)', async () => {
    const { proxyPidFilePath } = await import('../src/proxy/paths.js');
    // A PID essentially guaranteed not to be alive on any real system.
    fs.writeFileSync(proxyPidFilePath(), '999999999');

    const { getProxyStatus } = await import('../src/proxy/lifecycle.js');
    const status = getProxyStatus();
    expect(status.running).toBe(false);
    expect(status.pid).toBeNull();
    expect(status.stalePidFile).toBe(true);
  });

  it('reports running when the PID file points at the current process (a real, live PID)', async () => {
    const { proxyPidFilePath } = await import('../src/proxy/paths.js');
    fs.writeFileSync(proxyPidFilePath(), String(process.pid));

    const { getProxyStatus } = await import('../src/proxy/lifecycle.js');
    const status = getProxyStatus();
    expect(status.running).toBe(true);
    expect(status.pid).toBe(process.pid);
  });

  it('treats a malformed PID file as a stale PID file, not a crash', async () => {
    const { proxyPidFilePath } = await import('../src/proxy/paths.js');
    fs.writeFileSync(proxyPidFilePath(), 'not-a-number');

    const { getProxyStatus } = await import('../src/proxy/lifecycle.js');
    const status = getProxyStatus();
    expect(status.running).toBe(false);
    expect(status.stalePidFile).toBe(true);
  });
});

describe('stopProxy', () => {
  it('is a harmless no-op when nothing is running', async () => {
    const { stopProxy } = await import('../src/proxy/lifecycle.js');
    const result = await stopProxy();
    expect(result).toEqual({ wasRunning: false, pid: null });
  });
});

describe('readProxyLogTail', () => {
  it('returns an empty string when no log file exists yet', async () => {
    const { readProxyLogTail } = await import('../src/proxy/lifecycle.js');
    expect(readProxyLogTail()).toBe('');
  });

  it('returns the full content when under the tail-size bound', async () => {
    const { proxyLogFilePath } = await import('../src/proxy/paths.js');
    fs.writeFileSync(proxyLogFilePath(), 'line one\nline two\n');

    const { readProxyLogTail } = await import('../src/proxy/lifecycle.js');
    expect(readProxyLogTail()).toBe('line one\nline two\n');
  });

  it('bounds reads to the last N bytes on a large log file', async () => {
    const { proxyLogFilePath } = await import('../src/proxy/paths.js');
    const big = 'x'.repeat(200) + 'TAIL-MARKER';
    fs.writeFileSync(proxyLogFilePath(), big);

    const { readProxyLogTail } = await import('../src/proxy/lifecycle.js');
    const tail = readProxyLogTail(50);
    expect(tail.length).toBe(50);
    expect(tail.endsWith('TAIL-MARKER')).toBe(true);
  });
});

describe('watchProxyLog', () => {
  it('throws a clear error when no log file exists yet, rather than a raw ENOENT', async () => {
    const { watchProxyLog } = await import('../src/proxy/lifecycle.js');
    expect(() => watchProxyLog(() => {})).toThrow(/no log file yet/);
  });
});
