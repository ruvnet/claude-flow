import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setProfile } from '../src/auth/state.js';
import { setSessionToken, clearSessionToken } from '../src/auth/session.js';
import { recordConsent } from '../src/funnel/index.js';
import { refreshInjectedToken, removeInjectedToken } from '../src/proxy/token-bridge.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ruflo-token-bridge-'));
  process.env.RUFLO_STATE_DIR = dir;
});

afterEach(() => {
  clearSessionToken('default');
  delete process.env.RUFLO_STATE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('proxy injected-token bridge', () => {
  it('atomically writes an access-token-only envelope and config path', async () => {
    const expiresAt = Date.now() + 10 * 60_000;
    setProfile('default', {
      accountId: 'test@example.com', scopes: ['account.create'],
      accessTokenExpiresAt: new Date(expiresAt).toISOString(), keychainRef: null,
      profile: 'default', loginMethod: 'pkce', linkedAt: new Date().toISOString(),
    });
    recordConsent('account', true, 'test');
    setSessionToken('default', 'access-only-secret', expiresAt);

    await expect(refreshInjectedToken()).resolves.toBe(true);
    const envelope = JSON.parse(readFileSync(join(dir, 'proxy-injected-token.json'), 'utf8'));
    expect(envelope).toEqual({ schemaVersion: 1, accessToken: 'access-only-secret', expiresAt: new Date(expiresAt).toISOString() });
    expect(readFileSync(join(dir, 'proxy-config.toml'), 'utf8')).toContain('ruflo_injected_token_path');
    expect(readFileSync(join(dir, 'proxy-config.toml'), 'utf8')).not.toContain('access-only-secret');
    if (process.platform !== 'win32') expect(statSync(join(dir, 'proxy-injected-token.json')).mode & 0o077).toBe(0);
  });

  it('removes the handoff when no authenticated profile is available', async () => {
    removeInjectedToken();
    await expect(refreshInjectedToken()).resolves.toBe(false);
  });
});
