import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallbackServer } from '../../security/src/oauth/callback-server.js';
const exchangeCode = vi.hoisted(() => vi.fn());
const scenario = vi.hoisted(() => ({ state: 'expected' }));
vi.mock('../src/auth/security-bridge.js', () => ({
  loadSecurityOAuth: async () => ({
    CallbackServer: { bind: async () => {
      const server = await CallbackServer.bind();
      return { redirectUri: server.redirectUri, awaitCallback: () => server.awaitCallback(3_000) };
    } },
    generatePkce: () => ({ state: 'expected', codeChallenge: 'challenge', codeVerifier: 'verifier' }),
    authorizeUrl: (redirect: string) => redirect,
    openBrowser: async (url: string) => {
      // Complete the real loopback callback before openBrowser returns.
      const response = await fetch(`${url}?code=received&state=${scenario.state}`, { signal: AbortSignal.timeout(2_000) });
      await response.text();
    },
    exchangeCode,
  }),
}));
import { browserLogin, StateMismatchError } from '../src/auth/client.js';
beforeEach(() => { exchangeCode.mockReset(); scenario.state = 'expected'; });
describe('browser login callback boundary', () => {
  it('exchanges an early callback only after validating its state', async () => {
    exchangeCode.mockResolvedValue({ access_token: 'access', token_type: 'Bearer' });
    await expect(browserLogin(() => {})).resolves.toEqual({ tokens: { access_token: 'access', token_type: 'Bearer' }, method: 'pkce' });
    expect(exchangeCode).toHaveBeenCalledWith('received', 'verifier', expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/));
  }, 10_000);
  it('rejects a mismatched callback state without exchanging its code', async () => {
    scenario.state = 'mismatched';
    await expect(browserLogin(() => {})).rejects.toBeInstanceOf(StateMismatchError);
    expect(exchangeCode).not.toHaveBeenCalled();
  }, 10_000);
});
