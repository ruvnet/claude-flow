import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => {
  const login = async () => ({ tokens: { access_token: 'access', token_type: 'Bearer', expires_in: 3600 }, method: 'pkce' as const });
  return { browserLogin: vi.fn(login), manualLogin: vi.fn(login) };
});

vi.mock('../src/auth/security-bridge.js', () => ({
  loadSecurityOAuth: vi.fn(), SecurityPackageMissingError: class extends Error {},
}));
vi.mock('../src/output.js', () => ({
  output: { writeln: vi.fn(), printSuccess: vi.fn(), printError: vi.fn() },
}));
vi.mock('../src/funnel/index.js', () => ({
  // An interactive terminal, so login is not refused.
  isInteractive: () => true,
  isCI: () => false,
  hasConsent: vi.fn(), recordConsent: vi.fn(), revokeConsent: vi.fn(),
}));
vi.mock('../src/auth/client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/auth/client.js')>()),
  browserLogin: mocks.browserLogin,
  manualLogin: mocks.manualLogin,
  // No SSH or container hint, so only the flag can pick the manual flow.
  isProbablyHeadless: () => false,
}));

import { CommandParser } from '../src/parser.js';
import { authCommand } from '../src/commands/auth.js';

let stateDir: string;
beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'ruflo-auth-no-browser-'));
  process.env.RUFLO_STATE_DIR = stateDir;
});
afterEach(() => {
  vi.clearAllMocks();
  delete process.env.RUFLO_STATE_DIR;
  rmSync(stateDir, { recursive: true, force: true });
});

async function runLogin(flags: string[]) {
  const parser = new CommandParser();
  parser.registerCommand(authCommand);
  const parsed = parser.parse(['auth', 'login', ...flags]);
  const login = authCommand.subcommands!.find((command) => command.name === 'login')!;
  const result = await login.action!({ args: [], flags: parsed.flags, cwd: stateDir, interactive: true });
  expect(result).toMatchObject({ success: true });
}

describe('auth login --no-browser through the real command parser', () => {
  it('uses the manual copy-paste flow', async () => {
    await runLogin(['--no-browser']);
    expect(mocks.manualLogin).toHaveBeenCalledTimes(1);
    expect(mocks.browserLogin).not.toHaveBeenCalled();
  });

  it('still opens the browser without the flag', async () => {
    await runLogin([]);
    expect(mocks.browserLogin).toHaveBeenCalledTimes(1);
    expect(mocks.manualLogin).not.toHaveBeenCalled();
  });
});
