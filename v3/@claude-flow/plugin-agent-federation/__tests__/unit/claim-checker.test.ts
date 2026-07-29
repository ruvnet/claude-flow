import { describe, expect, it, vi } from 'vitest';
import { createFederationClaimChecker } from '../../src/application/claim-checker.js';

describe('createFederationClaimChecker', () => {
  it('preserves existing installations in explicit legacy mode', () => {
    const checker = createFederationClaimChecker();
    expect(checker.mode).toBe('legacy');
    expect(checker.checkClaim('federation:admin')).toBe(true);
  });

  it('observes missing grants without changing current behavior', () => {
    const onObservation = vi.fn();
    const checker = createFederationClaimChecker({
      mode: 'observe',
      grantedClaims: ['federation:read'],
      onObservation,
    });

    expect(checker.checkClaim('federation:read')).toBe(true);
    expect(checker.checkClaim('federation:write')).toBe(true);
    expect(onObservation).toHaveBeenNthCalledWith(1, 'federation:read', true);
    expect(onObservation).toHaveBeenNthCalledWith(2, 'federation:write', false);
  });

  it('defaults to deny for an unconfigured claim in enforce mode', () => {
    const checker = createFederationClaimChecker({
      mode: 'enforce',
      grantedClaims: ['federation:read'],
    });

    expect(checker.checkClaim('federation:read')).toBe(true);
    expect(checker.checkClaim('federation:write')).toBe(false);
  });

  it('rejects an unknown configured claim', () => {
    expect(() =>
      createFederationClaimChecker({
        mode: 'enforce',
        grantedClaims: ['federation:root'],
      }),
    ).toThrow('Unknown federation claim');
  });
});
