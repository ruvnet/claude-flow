/**
 * #4124: in a pnpm/yarn/bun project `npm audit --json` prints
 * {"error":{"code":"ENOLOCK",...}} and no `vulnerabilities` key. `security
 * scan` (deps phase) and `security cve` read that as a clean tree and exited
 * 0, so a release check got a false all-clear. They must report "could not
 * scan" instead, and the persisted record must not make the statusline CLEAN.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { interpretNpmAudit } from '../src/commands/security.js';
import { getSecurityStatus } from '../src/funnel/local-signals.js';

const CLI_BIN = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const ENOLOCK = JSON.stringify({ error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } });

describe('interpretNpmAudit', () => {
  it('treats an npm error object as could-not-scan, with the right package manager hint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit-4124-'));
    try {
      writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
      const result = interpretNpmAudit(ENOLOCK, dir);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain('ENOLOCK');
        expect(result.reason).toContain('pnpm audit');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects output with no vulnerability report and non-JSON output', () => {
    expect(interpretNpmAudit('{}').ok).toBe(false);
    expect(interpretNpmAudit('{"vulnerabilities":[]}').ok).toBe(false);
    expect(interpretNpmAudit('not json').ok).toBe(false);
  });
  it('accepts a real report, including an empty one', () => {
    expect(interpretNpmAudit(JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} }))).toEqual({ ok: true, vulnerabilities: {} });
  });
});

describe('security scan / cve on a lockfile-less (pnpm) project', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'audit-4124-cli-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pnpm-fixture', version: '1.0.0' }));
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('scan --type deps exits non-zero, says the scan did not run, and persists an incomplete record', () => {
    const res = spawnSync(process.execPath, [CLI_BIN, 'security', 'scan', '--target', dir, '--depth', 'quick', '--type', 'deps'], { encoding: 'utf-8', timeout: 60_000 });
    const out = `${res.stdout}${res.stderr}`;
    expect(res.status).not.toBe(0);
    expect(out).toContain('Dependency scan skipped');
    expect(out).toContain('pnpm audit');
    expect(out).not.toContain('No security issues found!');
    const record = JSON.parse(readFileSync(join(dir, '.claude', 'security-scans', 'scan-deps-quick.json'), 'utf-8'));
    expect(record.incomplete).toBe(true);
    expect(getSecurityStatus(dir).status).toBe('PENDING');
  });

  it('an explicit dependency scan without package.json is incomplete, not CLEAN', () => {
    unlinkSync(join(dir, 'package.json'));
    const res = spawnSync(process.execPath, [CLI_BIN, 'security', 'scan', '--target', dir, '--depth', 'quick', '--type', 'deps'], { encoding: 'utf-8', timeout: 60_000 });
    expect(res.status).toBe(2);
    expect(`${res.stdout}${res.stderr}`).toContain('Dependency scan skipped');
    expect(getSecurityStatus(dir).status).toBe('PENDING');
  });

  it('cve --list exits non-zero instead of printing "No known vulnerabilities"', () => {
    const res = spawnSync(process.execPath, [CLI_BIN, 'security', 'cve', '--list'], { cwd: dir, encoding: 'utf-8', timeout: 60_000 });
    const out = `${res.stdout}${res.stderr}`;
    expect(res.status).not.toBe(0);
    expect(out).not.toContain('No known vulnerabilities');
    expect(out).toContain('Could not check dependencies');
  });
});
