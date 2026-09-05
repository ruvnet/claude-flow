/**
 * ADR-306 demand-driven access-token refresh. These tests use an isolated
 * state directory and an in-memory keychain double; no real credential store
 * or Cognitum endpoint is touched.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const secrets = new Map<string, string>();
const events: string[] = [];
const refreshTokenMock = vi.fn();
const setSecretMock = vi.fn(async (_service: string, account: string, value: string) => {
  events.push('persist-refresh-token');
  secrets.set(account, value);
});

class MockOAuthError extends Error {
  constructor(message: string, public readonly code: 'network' | 'protocol' | 'unexpected_shape') {
    super(message);
  }
}

vi.mock('../src/auth/security-bridge.js', () => ({
  loadSecurityOAuth: async () => ({
    refreshToken: refreshTokenMock,
    createKeychainAdapter: async () => ({
      isAvailable: async () => true,
      getSecret: async (_service: string, account: string) => secrets.get(account) ?? null,
      setSecret: setSecretMock,
      deleteSecret: async () => {},
    }),
    OAuthError: MockOAuthError,
  }),
}));

import { setProfile, getProfile } from '../src/auth/state.js';
import { getSessionToken, setSessionToken, clearSessionToken } from '../src/auth/session.js';
import {
  ACCESS_TOKEN_REFRESH_WINDOW_MS,
  getValidAccessToken,
  NotLoggedInError,
  SessionOnlyExpiredError,
} from '../src/auth/client.js';
import { recordConsent } from '../src/funnel/index.js';
import type { CommandContext } from '../src/types.js';

let stateDir: string;
let serial = 0;

function profileName(label: string): string {
  serial += 1;
  return `${label}-${serial}`;
}

function writeProfile(name: string, keychainRef: string | null): void {
  setProfile(name, {
    accountId: 'before@example.test',
    scopes: ['account.create'],
    accessTokenExpiresAt: new Date(Date.now() - 1_000).toISOString(),
    keychainRef,
    profile: name,
    loginMethod: 'pkce',
    linkedAt: new Date(Date.now() - 60_000).toISOString(),
  });
  recordConsent('account', true, 'auth-token-refresh-test');
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'ruflo-auth-refresh-'));
  process.env.RUFLO_STATE_DIR = stateDir;
  secrets.clear();
  events.length = 0;
  refreshTokenMock.mockReset();
  setSecretMock.mockClear();
});

afterEach(() => {
  delete process.env.RUFLO_STATE_DIR;
  rmSync(stateDir, { recursive: true, force: true });
});

describe('getValidAccessToken', () => {
  it('returns a cached token without touching the keychain or network', async () => {
    const name = profileName('cached');
    writeProfile(name, name);
    setSessionToken(name, 'cached-access', Date.now() + ACCESS_TOKEN_REFRESH_WINDOW_MS + 10_000);

    await expect(getValidAccessToken(name)).resolves.toBe('cached-access');
    expect(refreshTokenMock).not.toHaveBeenCalled();
    expect(setSecretMock).not.toHaveBeenCalled();
    clearSessionToken(name);
  });

  it('rejects an unknown profile with an actionable login error', async () => {
    const name = profileName('missing');
    await expect(getValidAccessToken(name)).rejects.toBeInstanceOf(NotLoggedInError);
  });

  it('fails cleanly when an expired session-only profile cannot refresh', async () => {
    const name = profileName('session-only');
    writeProfile(name, null);
    await expect(getValidAccessToken(name)).rejects.toBeInstanceOf(SessionOnlyExpiredError);
    expect(refreshTokenMock).not.toHaveBeenCalled();
  });

  it('persists a rotated refresh token before publishing the new access token', async () => {
    const name = profileName('rotate');
    writeProfile(name, name);
    secrets.set(name, 'old-refresh');
    refreshTokenMock.mockImplementation(async (value: string) => {
      expect(value).toBe('old-refresh');
      events.push('refresh-response');
      return {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        token_type: 'Bearer',
        expires_in: 900,
        account_email: 'after@example.test',
      };
    });

    await expect(getValidAccessToken(name)).resolves.toBe('new-access');
    expect(events).toEqual(['refresh-response', 'persist-refresh-token']);
    expect(secrets.get(name)).toBe('new-refresh');
    expect(getSessionToken(name)).toBe('new-access');
    expect(getProfile(name)?.accountId).toBe('after@example.test');
    clearSessionToken(name);
  });

  it('does not cache the access token when rotated-token persistence fails', async () => {
    const name = profileName('rotation-failure');
    writeProfile(name, name);
    secrets.set(name, 'old-refresh');
    refreshTokenMock.mockResolvedValue({
      access_token: 'must-not-escape',
      refresh_token: 'new-refresh',
      token_type: 'Bearer',
      expires_in: 900,
    });
    setSecretMock.mockRejectedValueOnce(new Error('keychain write failed'));

    await expect(getValidAccessToken(name)).rejects.toThrow('keychain write failed');
    expect(getSessionToken(name)).toBeNull();
  });
});

describe('auth status --check consumer', () => {
  it('uses the demand-driven accessor without exposing the token', async () => {
    const name = profileName('status-check');
    writeProfile(name, null);
    setSessionToken(name, 'never-return-this-token', Date.now() + ACCESS_TOKEN_REFRESH_WINDOW_MS + 10_000);
    const { authCommand } = await import('../src/commands/auth.js');
    const status = authCommand.subcommands?.find((command) => command.name === 'status');
    if (!status?.action) throw new Error('auth status subcommand not found');
    const ctx: CommandContext = {
      args: [],
      flags: { _: [], profile: name, check: true, json: true },
      cwd: process.cwd(),
      interactive: false,
    };

    const result = await status.action(ctx);
    const profiles = (result?.data as { profiles?: Array<Record<string, unknown>> })?.profiles ?? [];
    expect(profiles[0]?.credentialStatus).toBe('valid');
    expect(JSON.stringify(result?.data)).not.toContain('never-return-this-token');
    clearSessionToken(name);
  });
});
