import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { HttpTransport } from '../src/transport/http.js';
import { createMCPServer, type MCPServer } from '../src/server.js';
import type { ILogger } from '../src/types.js';

const freePort = () => new Promise<number>((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as AddressInfo;
    probe.close(() => resolve(port));
  });
});

const post = (port: number, id: number) => fetch(`http://127.0.0.1:${port}/rpc`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id, method: 'ping' }),
});

describe('configurable rate limits (#3157)', () => {
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  let transport: HttpTransport | undefined;
  let server: MCPServer | undefined;

  afterEach(async () => {
    await transport?.stop();
    await server?.stop();
    transport = undefined;
    server = undefined;
    vi.clearAllMocks();
  });

  it('keeps 120 per window by default', async () => {
    transport = new HttpTransport(logger, { host: '127.0.0.1', port: 0, corsEnabled: false });
    transport.onRequest(async (request) => ({ jsonrpc: '2.0', id: request.id, result: {} }));
    await transport.start();
    const port = ((transport as unknown as { server: Server }).server.address() as AddressInfo).port;

    for (let id = 1; id <= 120; id++) {
      expect((await post(port, id)).status).toBe(200);
    }
    const rejected = await post(port, 121);
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32000, message: 'Rate limit exceeded' },
    });
  });

  it('keeps the default session buckets when none are configured', () => {
    server = createMCPServer({ transport: 'in-process' }, logger);

    expect(server.getRateLimiter().getStats().config).toMatchObject({
      requestsPerSecond: 100,
      burstSize: 200,
      perSessionLimit: 50,
    });
  });

  it('lets a session burst past 200 when the global burst is raised', () => {
    server = createMCPServer({
      transport: 'in-process',
      sessionRateLimit: { perSessionLimit: 500, burstSize: 1000 },
    }, logger);
    const limiter = server.getRateLimiter();

    for (let i = 0; i < 300; i++) {
      expect(limiter.check('session-1').allowed).toBe(true);
      limiter.consume('session-1');
    }
  });

  it('passes configured HTTP and session limits through MCPServerConfig', async () => {
    const port = await freePort();
    server = createMCPServer({
      transport: 'http',
      host: '127.0.0.1',
      port,
      rateLimit: { limit: 3 },
      sessionRateLimit: { perSessionLimit: 500 },
    }, logger);
    await server.start();

    expect(server.getRateLimiter().getStats().config.perSessionLimit).toBe(500);
    for (let id = 1; id <= 3; id++) {
      expect((await post(port, id)).status).not.toBe(429);
    }
    const rejected = await post(port, 4);
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toMatchObject({ error: { code: -32000 } });
  });
});
