/** `ruflo dashboard` command surface (ADR-482): default off, gating, link lifecycle, registration. */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import dashboardCommand, { runDashboard, setDashboardDeps } from '../../src/commands/dashboard.js';
import { KEY_FILE } from '../../src/dashboard/state.js';
import { RUFLO_CLI_COMMANDS } from '../../src/mcp-tools/capability-brain.js';
import { hasCommand } from '../../src/commands/index.js';
import { FakeDashboard } from './_support/fake-server.js';

let srv: FakeDashboard | undefined; let root = ''; let home = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'rfdashcmd-')); home = join(root, 'h'); setDashboardDeps({ rufloVersion: async () => '3.55.0', sleep: async () => undefined }); });
afterEach(async () => { setDashboardDeps(null); await srv?.stop(); srv = undefined; rmSync(root, { recursive: true, force: true }); });

describe('ruflo dashboard', () => {
  it('is registered as a top-level command with all subcommands', () => {
    expect(dashboardCommand.name).toBe('dashboard');
    expect(dashboardCommand.subcommands?.map(s => s.name)).toEqual(['link', 'status', 'enable', 'disable', 'set', 'unlink', 'run']);
    expect(RUFLO_CLI_COMMANDS).toContain('dashboard');
    expect(hasCommand('dashboard')).toBe(true);
  });

  it('is OFF by default: not linked, and run refuses without connecting', async () => {
    expect(await runDashboard('status', { home }, root)).toMatchObject({ success: true, data: { linked: false } });
    expect(await runDashboard('run', { home }, root)).toMatchObject({ success: false, exitCode: 1, message: expect.stringMatching(/not linked/) });
  });

  it('link -> status -> disable gates run -> set validates -> unlink wipes the key', async () => {
    srv = await new FakeDashboard().start();
    expect(await runDashboard('link', { home, url: srv.baseUrl, name: 'cmd box' }, root)).toMatchObject({ success: true });
    expect(existsSync(join(home, KEY_FILE))).toBe(true);
    expect(await runDashboard('link', { home, url: srv.baseUrl }, root)).toMatchObject({ success: false, message: expect.stringMatching(/already linked/) });
    expect(await runDashboard('status', { home }, root)).toMatchObject({ data: { linked: true, enabled: true, level: 'read', autoApprove: false } });
    await runDashboard('disable', { home }, root);
    expect(await runDashboard('run', { home }, root)).toMatchObject({ success: false, message: expect.stringMatching(/disabled/) });
    expect(await runDashboard('set', { home, level: 'root' }, root)).toMatchObject({ success: false });
    expect(await runDashboard('set', { home, level: 'write', autoApprove: 'true' }, root)).toMatchObject({ success: true });
    expect(await runDashboard('status', { home }, root)).toMatchObject({ data: { level: 'write', autoApprove: true } });
    expect(await runDashboard('unlink', { home }, root)).toMatchObject({ success: true, data: { wasLinked: true, notified: true } });
    expect(existsSync(join(home, KEY_FILE))).toBe(false);
  });

  it('refuses insecure dashboard URLs', async () => {
    expect(await runDashboard('link', { home, url: 'http://dashboard.example.com' }, root)).toMatchObject({ success: false, message: expect.stringMatching(/https/) });
  });
});
