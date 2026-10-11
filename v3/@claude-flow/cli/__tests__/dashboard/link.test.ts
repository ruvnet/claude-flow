import { existsSync, readFileSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { link } from '../../src/dashboard/link.js';
import { AUDIT_FILE, CONFIG_FILE, KEY_FILE, loadConfig, loadKey, StateError } from '../../src/dashboard/state.js';
import { FakeDashboard } from './_support/fake-server.js';
import { Rig } from './_support/harness.js';

const noSleep = async () => undefined;
const tmp = () => mkdtempSync(join(tmpdir(), 'rflink-'));
const servers: FakeDashboard[] = [];
const dirs: string[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await s.stop(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const mk = async (o = {}) => { const s = await new FakeDashboard(o).start(); servers.push(s); const home = join(tmp(), 'h'); dirs.push(home); return { s, home }; };

describe('link', () => {
  it('pairs, pins the server key, stores config + key with safe modes, and never prints the key', async () => {
    const { s, home } = await mk();
    const lines: string[] = [];
    const cfg = await link({ home, baseUrl: s.baseUrl, name: 'my laptop', sleep: noSleep, out: l => lines.push(l) });
    expect(cfg.serverPublicKey).toBe(s.serverKeys.publicKey);
    expect(cfg.deviceId).toBe(s.deviceId);
    expect(cfg.level).toBe('read');
    expect(cfg.autoApprove).toBe(false);
    expect(lines.join('\n')).toMatch(/ABCD2345/);
    expect(lines.join('\n')).toContain(`${s.baseUrl}/link`);
    expect(lines.join('\n')).toMatch(/mission objectives.*ADR titles/);
    const key = loadKey(home);
    expect(lines.join('\n')).not.toContain(key);
    expect(readFileSync(join(home, CONFIG_FILE), 'utf8')).not.toContain(key);
    expect(statSync(join(home, KEY_FILE)).mode & 0o777).toBe(0o600);
    expect(statSync(home).mode & 0o777).toBe(0o700);
    expect(s.codeRequests[0]).toMatchObject({ name: 'my laptop' });
    expect(loadConfig(home)?.enabled).toBe(true);
  });

  it('honours slow_down by backing off before the next poll', async () => {
    const { s, home } = await mk({ slowDownOnce: true });
    const waits: number[] = [];
    await link({ home, baseUrl: s.baseUrl, sleep: async ms => { waits.push(ms); } });
    expect(waits[0]).toBe(1000);
    expect(Math.max(...waits)).toBeGreaterThanOrEqual(6000);
  });

  it.each([['deny', 'denied'], ['expire', 'expired']] as const)('reports %s clearly and stores nothing', async (result, code) => {
    const { s, home } = await mk({ pairingResult: result });
    await expect(link({ home, baseUrl: s.baseUrl, sleep: noSleep })).rejects.toMatchObject({ code });
    expect(existsSync(join(home, KEY_FILE))).toBe(false);
    expect(existsSync(join(home, CONFIG_FILE))).toBe(false);
  });

  it('times out when never approved', async () => {
    const { s, home } = await mk({ pairingResult: 'never' });
    let t = 1_000_000;
    await expect(link({ home, baseUrl: s.baseUrl, sleep: async () => { t += 400_000; }, now: () => t })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('refuses insecure (non-loopback http) and credentialed base URLs', async () => {
    const home = join(tmp(), 'h'); dirs.push(home);
    await expect(link({ home, baseUrl: 'http://dashboard.example.com', sleep: noSleep })).rejects.toBeInstanceOf(StateError);
    await expect(link({ home, baseUrl: 'https://user:pw@dashboard.example.com', sleep: noSleep })).rejects.toBeInstanceOf(StateError);
    await expect(link({ home, baseUrl: 'ftp://x', sleep: noSleep })).rejects.toBeInstanceOf(StateError);
  });

  it('refuses a connectUrl on another host', async () => {
    const { s, home } = await mk();
    const f: typeof fetch = async (u, init) => {
      const r = await fetch(u, init);
      if (String(u).endsWith('/token')) { const j = await r.json() as Record<string, unknown>; if (j.status === 'approved') j.connectUrl = 'wss://evil.example.com/connect'; return new Response(JSON.stringify(j)); }
      return r;
    };
    await expect(link({ home, baseUrl: s.baseUrl, sleep: noSleep, fetchImpl: f })).rejects.toMatchObject({ code: 'bad_url' });
    expect(existsSync(join(home, KEY_FILE))).toBe(false);
  });

  it('does not write an audit log for link failures that never produced a device', async () => {
    const { s, home } = await mk({ pairingResult: 'deny' });
    await link({ home, baseUrl: s.baseUrl, sleep: noSleep }).catch(() => undefined);
    expect(existsSync(join(home, AUDIT_FILE))).toBe(false);
  });

  it('Rig helper links with the requested level', async () => {
    const r = await Rig.create({}, 'manage');
    expect(r.cfg.level).toBe('manage');
    await r.cleanup();
  });
});
