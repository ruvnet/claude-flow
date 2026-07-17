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
    const { proxyConsoleGuidance } = await import('../src/commands/proxy-lifecycle.js');
    const lines = proxyConsoleGuidance({ installed: false, running: false, pid: null, stalePidFile: false }).join('\n');

    expect(lines).toContain('npx ruflo@latest proxy install --yes');
    expect(lines).toContain('Meta-Proxy v0.4.0');
    expect(lines).not.toContain('auth login');
  });
});
