/** Bare `ruflo proxy` should be an actionable lifecycle dashboard, not the
 * unrelated sponsored-capacity status command. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const writeln = vi.fn();

vi.mock('../src/output.js', () => ({
  output: {
    writeln,
    printJson: vi.fn(),
    printInfo: vi.fn(),
    printSuccess: vi.fn(),
    printError: vi.fn(),
    printWarning: vi.fn(),
    createSpinner: vi.fn(),
  },
}));

let stateDir: string;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-console-guidance-test-'));
  savedEnv = { ...process.env };
  process.env.RUFLO_STATE_DIR = stateDir;
  writeln.mockClear();
});

afterEach(() => {
  process.env = savedEnv;
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function renderedLines(): string[] {
  return writeln.mock.calls.map(([line]) => String(line));
}

describe('bare proxy console guidance', () => {
  it('tells a user with an installed but stopped proxy exactly how to start it', async () => {
    const { proxyBinaryPath } = await import('../src/proxy/paths.js');
    fs.mkdirSync(path.dirname(proxyBinaryPath()), { recursive: true });
    fs.writeFileSync(proxyBinaryPath(), 'test binary marker');

    const { proxyCommand } = await import('../src/commands/proxy.js');
    const result = await proxyCommand.action!({ args: [], flags: { _: [] }, cwd: stateDir, interactive: false });
    const lines = renderedLines().join('\n');

    expect(result).toMatchObject({ success: true, data: { installed: true, running: false } });
    expect(lines).toContain('Meta Proxy');
    expect(lines).toContain('npx ruflo@latest proxy start --service');
    expect(lines).toContain('npx ruflo@latest auth login');
    expect(lines).not.toContain('Sponsored downtime consent');
    expect(lines).not.toContain('Rate-limit flag');
  });

  it('gives installation guidance before the proxy exists', async () => {
    const { proxyConsoleGuidance, DEFAULT_PROXY_RELEASE } = await import('../src/commands/proxy-lifecycle.js');
    const lines = proxyConsoleGuidance({
      installed: false,
      running: false,
      pid: null,
      stalePidFile: false,
      version: null,
    }).join('\n');

    expect(lines).toContain('npx ruflo@latest proxy install --yes');
    // Assert against the constant, not a literal — a hardcoded version here
    // would have to be edited on every pin bump, which is how the advertised
    // version drifted from the installed one in the first place.
    expect(lines).toContain(`Meta-Proxy v${DEFAULT_PROXY_RELEASE}`);
    expect(lines).not.toContain('auth login');
  });
});

/**
 * A pin bump is only worth making if it reaches people who already installed
 * the old one. Their entry point is this guidance, so the drift signal is
 * asserted here rather than left to manual inspection.
 */
describe('pin-drift guidance for an existing install', () => {
  const installedAt = (version: string | null) => ({
    installed: true,
    running: false,
    pid: null,
    stalePidFile: false,
    version,
  });

  it('names the installed release, the pin, and the command that closes the gap', async () => {
    const { proxyUpdateGuidance, DEFAULT_PROXY_RELEASE } = await import('../src/commands/proxy-lifecycle.js');

    const lines = proxyUpdateGuidance(installedAt('0.4.0')).join('\n');

    expect(lines).toContain('installed v0.4.0');
    expect(lines).toContain(`current pin v${DEFAULT_PROXY_RELEASE}`);
    expect(lines).toContain('npx ruflo@latest proxy update');
  });

  it('stays silent when the installed release already matches the pin', async () => {
    const { proxyUpdateGuidance, DEFAULT_PROXY_RELEASE } = await import('../src/commands/proxy-lifecycle.js');

    expect(proxyUpdateGuidance(installedAt(DEFAULT_PROXY_RELEASE))).toEqual([]);
  });

  /** Unknown is not "current" — claiming either way from no evidence is the bug. */
  it('stays silent when the installed release is unknown', async () => {
    const { proxyUpdateGuidance } = await import('../src/commands/proxy-lifecycle.js');

    expect(proxyUpdateGuidance(installedAt(null))).toEqual([]);
  });

  it('stays silent when nothing is installed', async () => {
    const { proxyUpdateGuidance } = await import('../src/commands/proxy-lifecycle.js');

    expect(proxyUpdateGuidance({ ...installedAt('0.4.0'), installed: false })).toEqual([]);
  });

  it('surfaces the drift through the console guidance a running proxy shows', async () => {
    const { proxyConsoleGuidance } = await import('../src/commands/proxy-lifecycle.js');

    const lines = proxyConsoleGuidance({ ...installedAt('0.4.0'), running: true, pid: 4242 }).join('\n');

    expect(lines).toContain('Meta Proxy is ready.');
    expect(lines).toContain('An update is available');
  });
});

describe('getProxyStatus version reporting', () => {
  it('reads the installed release from the install manifest', async () => {
    const { proxyBinaryPath, proxyInstallManifestPath } = await import('../src/proxy/paths.js');
    fs.mkdirSync(path.dirname(proxyBinaryPath()), { recursive: true });
    fs.writeFileSync(proxyBinaryPath(), 'test binary marker');
    fs.mkdirSync(path.dirname(proxyInstallManifestPath()), { recursive: true });
    fs.writeFileSync(proxyInstallManifestPath(), JSON.stringify({ version: '0.4.0', sha256: 'abc' }));

    const { getProxyStatus } = await import('../src/proxy/lifecycle.js');

    expect(getProxyStatus()).toMatchObject({ installed: true, version: '0.4.0' });
  });

  it('reports an unreadable manifest as unknown rather than throwing', async () => {
    const { proxyBinaryPath, proxyInstallManifestPath } = await import('../src/proxy/paths.js');
    fs.mkdirSync(path.dirname(proxyBinaryPath()), { recursive: true });
    fs.writeFileSync(proxyBinaryPath(), 'test binary marker');
    fs.mkdirSync(path.dirname(proxyInstallManifestPath()), { recursive: true });
    fs.writeFileSync(proxyInstallManifestPath(), 'not json{');

    const { getProxyStatus } = await import('../src/proxy/lifecycle.js');

    expect(getProxyStatus()).toMatchObject({ installed: true, version: null });
  });

  it('reports no version when nothing is installed', async () => {
    const { getProxyStatus } = await import('../src/proxy/lifecycle.js');

    expect(getProxyStatus()).toMatchObject({ installed: false, version: null });
  });
});
