import { describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { CallbackServer, CallbackTimeoutError } from '../src/oauth/callback-server.js';

function send(url: string, method = 'GET'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, agent: false }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode!));
    });
    req.setTimeout(2_000, () => req.destroy(new Error('request timed out')));
    req.on('error', reject);
    req.end();
  });
}

describe('OAuth loopback callback routing', () => {
  for (const [path, method, status] of [['/favicon.ico', 'GET', 404], ['/oauth/callback', 'POST', 405]] as const) {
    it(`ignores ${method} ${path} and still receives the OAuth callback`, async () => {
      const server = await CallbackServer.bind();
      const result = server.awaitCallback(3_000).catch(error => error);
      try {
        expect(await send(`http://127.0.0.1:${server.port}${path}`, method)).toBe(status);
        expect(await send(`${server.redirectUri}?code=legitimate&state=expected`)).toBe(200);
        expect(await result).toEqual({ code: 'legitimate', state: 'expected', error: null });
      } finally { await result; }
    });
  }
  it('retains a callback received before awaitCallback is called', async () => {
    const server = await CallbackServer.bind();
    try {
      expect(await send(`${server.redirectUri}?code=early&state=original`)).toBe(200);
      expect(await server.awaitCallback(500)).toEqual({ code: 'early', state: 'original', error: null });
    } finally { await server.awaitCallback(500).catch(() => {}); }
  });
  it('still times out when no callback arrives', async () => {
    const server = await CallbackServer.bind();
    await expect(server.awaitCallback(10)).rejects.toBeInstanceOf(CallbackTimeoutError);
  });
});
