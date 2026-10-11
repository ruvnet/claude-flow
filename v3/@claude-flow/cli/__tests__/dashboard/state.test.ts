import { chmodSync, mkdirSync, symlinkSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateKeyPair } from '../../src/dashboard/protocol/index.js';
import { AUDIT_FILE, AUDIT_KEEP, AUDIT_MAX_BYTES, AuditLog, DeviceSeq, KEY_FILE, loadKey, normalizeBaseUrl, saveKey, SEQ_BLOCK, stateDir, wipeState } from '../../src/dashboard/state.js';

const dirs: string[] = [];
const mk = () => { const d = join(mkdtempSync(join(tmpdir(), 'rfstate-')), 'h'); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe('state files', () => {
  it('writes the key 0600 inside a 0700 dir and reads it back', () => {
    const h = mk(); const k = generateKeyPair().privateKey;
    saveKey(h, k);
    expect(statSync(join(h, KEY_FILE)).mode & 0o777).toBe(0o600);
    expect(statSync(h).mode & 0o777).toBe(0o700);
    expect(loadKey(h)).toBe(k);
  });
  it.each([0o640, 0o644, 0o604, 0o660, 0o666])('refuses a key file with mode %o', mode => {
    const h = mk(); saveKey(h, generateKeyPair().privateKey);
    chmodSync(join(h, KEY_FILE), mode);
    expect(() => loadKey(h)).toThrowError(/accessible by group\/other/);
  });
  it('refuses missing or malformed keys', () => {
    const h = mk(); expect(() => loadKey(h)).toThrowError(/not found/);
    saveKey(h, 'not-a-key'); expect(() => loadKey(h)).toThrowError(/malformed/);
  });
  it('refuses a symlinked key', () => {
    const h = mk(); saveKey(h, generateKeyPair().privateKey);
    const real = join(h, 'real'); writeFileSync(real, generateKeyPair().privateKey, { mode: 0o600 });
    rmSync(join(h, KEY_FILE)); symlinkSync(real, join(h, KEY_FILE));
    expect(() => loadKey(h)).toThrow();
  });
  it('wipeState removes key/config/counters but keeps the audit log', () => {
    const h = mk(); saveKey(h, generateKeyPair().privateKey); new DeviceSeq(h).take(); new AuditLog(h).write('x');
    wipeState(h);
    expect(existsSync(join(h, KEY_FILE))).toBe(false);
    expect(existsSync(join(h, 'device-seq.json'))).toBe(false);
    expect(existsSync(join(h, AUDIT_FILE))).toBe(true);
  });
  it('honours RUFLO_DASHBOARD_HOME', () => {
    const prev = process.env.RUFLO_DASHBOARD_HOME; process.env.RUFLO_DASHBOARD_HOME = '/tmp/xyz-home';
    expect(stateDir()).toBe('/tmp/xyz-home'); process.env.RUFLO_DASHBOARD_HOME = prev; if (prev === undefined) delete process.env.RUFLO_DASHBOARD_HOME;
  });
});

describe('base URL rules', () => {
  it('allows https anywhere and http only on loopback', () => {
    expect(normalizeBaseUrl('https://flo.example.com/some/path')).toBe('https://flo.example.com');
    expect(normalizeBaseUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(normalizeBaseUrl('http://localhost:3000')).toBe('http://localhost:3000');
    for (const bad of ['http://flo.example.com', 'http://10.0.0.5', 'ws://127.0.0.1', 'file:///etc/passwd', 'nonsense']) expect(() => normalizeBaseUrl(bad)).toThrow();
  });
});

describe('sequence persistence', () => {
  it('is strictly increasing across restarts (block reservation never reuses a number)', () => {
    const h = mk(); const seen: number[] = [];
    let s = new DeviceSeq(h);
    for (let i = 0; i < 7; i++) seen.push(s.take());
    s = new DeviceSeq(h); // simulated crash/restart
    for (let i = 0; i < SEQ_BLOCK + 5; i++) seen.push(s.take());
    s = new DeviceSeq(h);
    seen.push(s.take());
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
  });
});

describe('audit log', () => {
  it('is append-only, 0600, masks secrets and never stores keys', () => {
    const h = mk(); const a = new AuditLog(h);
    a.write('command', { objective: 'use token sk-abcdefghijklmnopqrstuvwx now' }); a.write('second');
    const p = join(h, AUDIT_FILE);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    const lines = readFileSync(p, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[masked]'); expect(lines[0]).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });
});

describe('audit rotation (L11)', () => {
  it('rotates at the size cap, keeps a bounded number of 0600 files and loses nothing newest', () => {
    const h = mk(); const a = new AuditLog(h); const p = join(h, AUDIT_FILE); mkdirSync(h, { recursive: true });
    writeFileSync(p, 'x'.repeat(AUDIT_MAX_BYTES), { mode: 0o600 });
    a.write('after-1');
    expect(statSync(p + '.1').size).toBe(AUDIT_MAX_BYTES); expect(readFileSync(p, 'utf8')).toContain('after-1');
    for (let i = 0; i < AUDIT_KEEP + 2; i++) { writeFileSync(p, 'y'.repeat(AUDIT_MAX_BYTES), { mode: 0o600 }); a.write('n' + i); }
    for (let i = 1; i <= AUDIT_KEEP; i++) expect(existsSync(`${p}.${i}`)).toBe(true);
    expect(existsSync(`${p}.${AUDIT_KEEP + 1}`)).toBe(false);
    expect(statSync(p + '.1').mode & 0o777).toBe(0o600);
  });
});
