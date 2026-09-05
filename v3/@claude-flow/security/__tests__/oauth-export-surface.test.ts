import { describe, expect, it } from 'vitest';
import * as security from '../src/index.js';

describe('OAuth public export surface', () => {
  it('exports every primitive required by ruflo auth', () => {
    for (const name of [
      'authorizeUrl',
      'exchangeCode',
      'refreshToken',
      'exchangeManualCode',
      'generatePkce',
      'CallbackServer',
      'openBrowser',
      'createKeychainAdapter',
      'OAuthError',
    ] as const) {
      expect(security[name]).toBeTypeOf('function');
    }
    expect(security.OOB_REDIRECT_URI).toBeTypeOf('string');
  });
});
