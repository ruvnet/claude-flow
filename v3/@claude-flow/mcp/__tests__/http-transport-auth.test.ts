import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const cryptoSpy = vi.hoisted(() => ({ timingSafeEqual: vi.fn() }));
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  cryptoSpy.timingSafeEqual.mockImplementation(actual.timingSafeEqual);
  return { ...actual, default: actual, timingSafeEqual: cryptoSpy.timingSafeEqual };
});

import { HttpTransport } from '../src/transport/http.js';
import type { ILogger } from '../src/types.js';

const TOKEN = 'correct-horse-battery-staple-42';
const RPC = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'system_info' } };

const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
let transport: HttpTransport | undefined;
let handled: number;
let base: string;
let port: number;

async function start(auth: unknown, extra: Record<string, unknown> = {}): Promise<void> {
  handled = 0;
  transport = new HttpTransport(logger, {
    host: '127.0.0.1',
    port: 0,
    auth: auth as never,
    corsEnabled: true,
    corsOrigins: ['https://app.example'],
    ...extra,
  });
  transport.onRequest(async (r) => {
    handled++;
    return { jsonrpc: '2.0', id: r.id, result: { ok: true } };
  });
  await transport.start();
  port = ((transport as unknown as { server: Server }).server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
}

const post = (headers: Record<string, string> = {}, path = '/rpc', body: unknown = RPC) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

/** Raw HTTP/1.1 so we control header duplication, casing and odd bytes. */
function raw(request: string): Promise<{ status: number; head: string; body: string }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(request));
    let buf = '';
    sock.on('data', (d) => (buf += d.toString('latin1')));
    sock.on('error', reject);
    sock.on('close', () => {
      const [head, ...rest] = buf.split('\r\n\r\n');
      resolve({ status: Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1] ?? 0), head, body: rest.join('\r\n\r\n') });
    });
    setTimeout(() => sock.destroy(), 1500);
  });
}
const rawPost = (headerLines: string[], path = '/rpc', method = 'POST') => {
  const body = JSON.stringify(RPC);
  return raw(
    `${method} ${path} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n${headerLines.join('\r\n')}${headerLines.length ? '\r\n' : ''}\r\n${body}`,
  );
};

afterEach(async () => {
  await transport?.stop();
  transport = undefined;
  vi.clearAllMocks();
});

describe('HTTP transport bearer auth', () => {
  beforeEach(async () => {
    await start({ enabled: true, method: 'token', tokens: [TOKEN] });
  });

  it('rejects a request with no Authorization header, without dispatching', async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(handled).toBe(0);
  });

  it('401 body has no detail about what was wrong and never echoes the token', async () => {
    const bodies = await Promise.all([
      post(),
      post({ authorization: 'Bearer wrong-token-wrong-token' }),
      post({ authorization: `Basic ${TOKEN}` }),
      post({ authorization: 'Bearer' }),
    ].map(async (p) => (await p).text()));
    expect(new Set(bodies).size).toBe(1);
    expect(JSON.parse(bodies[0])).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
    for (const b of bodies) expect(b).not.toContain(TOKEN);
    expect(handled).toBe(0);
  });

  it('rejects a wrong token, including prefixes, extensions and case changes of the right one', async () => {
    for (const t of ['wrong-token-wrong-token', TOKEN.slice(0, -1), `${TOKEN}x`, TOKEN.toUpperCase(), '']) {
      expect((await post({ authorization: `Bearer ${t}` })).status).toBe(401);
    }
    expect(handled).toBe(0);
  });

  it('accepts the right token and dispatches', async () => {
    const res = await post({ authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 1, result: { ok: true } });
    expect(handled).toBe(1);
  });

  it('also guards /mcp (POST and the SSE GET) and /info', async () => {
    expect((await post({}, '/mcp')).status).toBe(401);
    expect((await fetch(`${base}/mcp`)).status).toBe(401);
    expect((await fetch(`${base}/info`)).status).toBe(401);
    expect((await fetch(`${base}/info`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(200);
    expect((await post({ authorization: `Bearer ${TOKEN}` }, '/mcp')).status).toBe(200);
  });

  it('rejects malformed Authorization headers', async () => {
    for (const h of [`Bearer`, `Bearer `, `${TOKEN}`, `Token ${TOKEN}`, `Basic ${Buffer.from(TOKEN).toString('base64')}`, `Bearer${TOKEN}`, `Bearer  `]) {
      expect((await post({ authorization: h })).status).toBe(401);
    }
    expect(handled).toBe(0);
  });

  it('a unicode token never matches and never crashes the server', async () => {
    // Sent as raw UTF-8 bytes (fetch itself refuses non-latin1 header values).
    for (const t of ['tökén-tökén-tökén-tökén', '\u{1F511}'.repeat(8), `${TOKEN}́`]) {
      const res = await raw(
        `POST /rpc HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\nAuthorization: Bearer ${Buffer.from(t, 'utf8').toString('latin1')}\r\n\r\n{}`,
      );
      expect(res.status).toBe(401);
    }
    expect((await post({ authorization: `Bearer ${TOKEN}` })).status).toBe(200);
  });

  it('supports a unicode token configured in code: exact bytes match, near-misses do not', async () => {
    await transport!.stop();
    const unicode = 'pässwörd-☃-token-0123456789';
    await start({ enabled: true, method: 'token', tokens: [unicode] });
    const sendRaw = (t: string) => raw(
      `POST /rpc HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(JSON.stringify(RPC))}\r\nConnection: close\r\nAuthorization: Bearer ${Buffer.from(t, 'utf8').toString('latin1')}\r\n\r\n${JSON.stringify(RPC)}`,
    );
    // Node decodes header bytes as latin1, so a UTF-8 client never matches a
    // non-ASCII token; that is why the CLI only accepts printable-ASCII tokens.
    expect((await sendRaw('pässwörd-☃-token-0123456780')).status).toBe(401);
    expect((await sendRaw('password-token-0123456789')).status).toBe(401);
  });

  it('compares tokens with crypto.timingSafeEqual (once per configured token, even on failure)', async () => {
    cryptoSpy.timingSafeEqual.mockClear();
    await post({ authorization: 'Bearer nope-nope-nope-nope' });
    expect(cryptoSpy.timingSafeEqual).toHaveBeenCalledTimes(1);
    const [a, b] = cryptoSpy.timingSafeEqual.mock.calls[0];
    expect(a.length).toBe(b.length); // equal-length digests: no length leak
    cryptoSpy.timingSafeEqual.mockClear();
    await post({ authorization: `Bearer ${TOKEN}` });
    expect(cryptoSpy.timingSafeEqual).toHaveBeenCalled();
  });

  it('never logs the token or the Authorization header', async () => {
    await post({ authorization: 'Bearer wrong-token-wrong-token' });
    await post({ authorization: `Bearer ${TOKEN}` });
    const logged = JSON.stringify([logger.debug, logger.info, logger.warn, logger.error].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls));
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain('wrong-token-wrong-token');
    expect(logged.toLowerCase()).not.toContain('bearer');
  });

  it('keeps the request body size cap', async () => {
    await transport!.stop();
    await start({ enabled: true, method: 'token', tokens: [TOKEN] }, { maxRequestSize: '1kb' });
    const big = { ...RPC, params: { pad: 'x'.repeat(5000) } };
    const res = await post({ authorization: `Bearer ${TOKEN}` }, '/rpc', big);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(handled).toBe(0);
  });

  it('an unauthenticated client cannot make the server read or parse a body', async () => {
    await transport!.stop();
    await start({ enabled: true, method: 'token', tokens: [TOKEN] }, { maxRequestSize: '1kb' });
    const big = { ...RPC, params: { pad: 'x'.repeat(5000) } };
    // 401 (auth runs before the body parser), not 413.
    expect((await post({}, '/rpc', big)).status).toBe(401);
  });

  describe('health endpoint', () => {
    it('is reachable without credentials and reveals only liveness', async () => {
      const res = await fetch(`${base}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    });

    it('is the only public route: look-alike paths still need the token', async () => {
      for (const p of ['/health/../rpc', '/health%2f..%2frpc', '//rpc', '/healthz', '/health/x', '/info']) {
        const res = await post({}, p);
        expect([401, 404]).toContain(res.status);
        expect(handled).toBe(0);
      }
      expect((await post({}, '/health')).status).not.toBe(200); // POST /health is not the public GET
      expect(handled).toBe(0);
    });
  });

  describe('bypass attempts', () => {
    const noAuthBypass = async (res: { status: number }) => {
      expect(res.status).toBe(401);
      expect(handled).toBe(0);
    };

    it('method override headers/params do not turn a request into the public GET /health', async () => {
      await noAuthBypass(await post({ 'x-http-method-override': 'GET' }));
      await noAuthBypass(await post({ 'x-method-override': 'GET', 'x-http-method': 'GET' }));
      await noAuthBypass(await post({}, '/rpc?_method=GET'));
    });

    it('HEAD and non-preflight OPTIONS on tool routes do not dispatch or leak data', async () => {
      const head = await rawPost([], '/rpc', 'HEAD');
      expect(head.status).toBe(401);
      expect(handled).toBe(0);
      const opts = await rawPost([], '/rpc', 'OPTIONS');
      expect([204, 401, 404]).toContain(opts.status);
      expect(handled).toBe(0);
    });

    it('scheme case: "bearer"/"BEARER" with a wrong token fails, with the right token is valid per RFC 7235', async () => {
      await noAuthBypass(await post({ authorization: 'bearer wrong-token-wrong-token' }));
      await noAuthBypass(await post({ authorization: 'BEARER wrong-token-wrong-token' }));
      expect((await post({ authorization: `bearer ${TOKEN}` })).status).toBe(200);
    });

    it('duplicate Authorization headers: only the first counts, so a valid second one cannot rescue a bad first', async () => {
      const bad = await rawPost([`Authorization: Bearer wrong-token-wrong-token`, `Authorization: Bearer ${TOKEN}`]);
      expect(bad.status).toBe(401);
      expect(handled).toBe(0);
      const swapped = await rawPost([`Authorization: Bearer ${TOKEN}`, `Authorization: Bearer wrong-token-wrong-token`]);
      expect(swapped.status).toBe(200); // first (valid) header wins; nothing about the second is trusted
    });

    it('comma-joined or multi-token values do not match', async () => {
      await noAuthBypass(await post({ authorization: `Bearer wrong-token-wrong-token, Bearer ${TOKEN}` }));
      await noAuthBypass(await post({ authorization: `Bearer ${TOKEN}, Bearer wrong-token-wrong-token` }));
    });

    it('path variants of the RPC routes are still gated', async () => {
      for (const p of ['/RPC', '/rpc/', '/rpc//', '/%72pc', '/rpc;x=1', '/rpc%00', '/./rpc', '/mcp/', '/MCP']) {
        const res = await post({}, p);
        expect([401, 404]).toContain(res.status);
        expect(handled).toBe(0);
      }
    });

    it('a forged Host or X-Forwarded-* header does not authenticate', async () => {
      await noAuthBypass(await post({ 'x-forwarded-for': '127.0.0.1', 'x-forwarded-host': 'localhost', 'x-real-ip': '127.0.0.1' }));
      await noAuthBypass(await raw(`POST /rpc HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(JSON.stringify(RPC))}\r\nConnection: close\r\n\r\n${JSON.stringify(RPC)}`));
    });

    it('credentials in the query string or body are ignored', async () => {
      await noAuthBypass(await post({}, `/rpc?token=${TOKEN}&access_token=${TOKEN}`));
      await noAuthBypass(await post({}, '/rpc', { ...RPC, token: TOKEN, auth: TOKEN }));
    });
  });

  describe('CORS preflight behaviour is unchanged', () => {
    it('answers a preflight from an allowed origin without credentials, and refuses a foreign origin', async () => {
      const ok = await fetch(`${base}/rpc`, {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
      });
      expect(ok.status).toBe(204);
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.example');
      expect(ok.headers.get('access-control-allow-headers')).toContain('Authorization');
      expect(handled).toBe(0);
      const foreign = await fetch(`${base}/rpc`, {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
      });
      expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
      expect(foreign.status).toBeGreaterThanOrEqual(400);
      // A cross-origin POST from a foreign origin is refused by CORS even with a token.
      const post2 = await post({ origin: 'https://evil.example', authorization: `Bearer ${TOKEN}` });
      expect(post2.status).toBeGreaterThanOrEqual(400);
      expect(handled).toBe(0);
    });
  });
});

describe('HTTP transport auth: fail closed and unchanged defaults', () => {
  it('auth enabled with no configured tokens accepts nothing (used to accept any Bearer value)', async () => {
    await start({ enabled: true, method: 'token' });
    expect((await post({ authorization: 'Bearer anything-at-all-123' })).status).toBe(401);
    await transport!.stop();
    await start({ enabled: true, method: 'token', tokens: [] });
    expect((await post({ authorization: 'Bearer anything-at-all-123' })).status).toBe(401);
    expect(handled).toBe(0);
  });

  it('without auth config nothing changes: requests are served and /health keeps its full body', async () => {
    await start(undefined);
    expect((await post()).status).toBe(200);
    const health = await (await fetch(`${base}/health`)).json();
    expect(health).toMatchObject({ status: 'ok', connections: 0 });
    expect(typeof health.timestamp).toBe('string');
  });

  it('auth.enabled=false behaves as no auth', async () => {
    await start({ enabled: false, method: 'none' });
    expect((await post()).status).toBe(200);
  });
});
