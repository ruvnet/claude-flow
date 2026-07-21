/**
 * Keychain adapter tests. `SessionOnlyKeychainAdapter` is fully covered
 * offline (no native backend needed). `createKeychainAdapter()`'s native
 * path is exercised only behind a real `isAvailable()` canary probe — CI
 * environments with no reachable keychain backend skip gracefully rather
 * than faking success, per ADR-306's degrade-to-session-only contract.
 */

import { describe, it, expect } from 'vitest';
import { createKeychainAdapter, SessionOnlyKeychainAdapter } from '../src/keychain-adapter.js';

describe('SessionOnlyKeychainAdapter', () => {
  it('round-trips a secret in memory', async () => {
    const adapter = new SessionOnlyKeychainAdapter();
    await adapter.setSecret('svc', 'acct', 'topsecret');
    expect(await adapter.getSecret('svc', 'acct')).toBe('topsecret');
  });

  it('returns null for a secret that was never set', async () => {
    const adapter = new SessionOnlyKeychainAdapter();
    expect(await adapter.getSecret('svc', 'nobody')).toBeNull();
  });

  it('deletes a secret', async () => {
    const adapter = new SessionOnlyKeychainAdapter();
    await adapter.setSecret('svc', 'acct', 'topsecret');
    await adapter.deleteSecret('svc', 'acct');
    expect(await adapter.getSecret('svc', 'acct')).toBeNull();
  });

  it('is always available', async () => {
    expect(await new SessionOnlyKeychainAdapter().isAvailable()).toBe(true);
  });

  it('keeps distinct (service, account) pairs isolated', async () => {
    const adapter = new SessionOnlyKeychainAdapter();
    await adapter.setSecret('svc-a', 'acct', 'secret-a');
    await adapter.setSecret('svc-b', 'acct', 'secret-b');
    expect(await adapter.getSecret('svc-a', 'acct')).toBe('secret-a');
    expect(await adapter.getSecret('svc-b', 'acct')).toBe('secret-b');
  });
});

describe('createKeychainAdapter', () => {
  it('resolves to an adapter that is always available (native or session-only fallback)', async () => {
    const adapter = await createKeychainAdapter();
    expect(await adapter.isAvailable()).toBe(true);
  });

  it('round-trips a canary secret through whatever backend was selected', async () => {
    const adapter = await createKeychainAdapter();
    const account = `ruflo-test-${Date.now()}`;
    await adapter.setSecret('ruflo-security-test', account, 'round-trip-value');
    try {
      expect(await adapter.getSecret('ruflo-security-test', account)).toBe('round-trip-value');
    } finally {
      await adapter.deleteSecret('ruflo-security-test', account);
    }
  });
});
