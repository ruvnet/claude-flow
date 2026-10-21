import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { HttpTransport } from '../src/transport/http.js';
import type { ILogger, MCPResponse } from '../src/types.js';

describe('HTTP request timeout (#3158)', () => {
  const logger: ILogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  let transport: HttpTransport | undefined;

  afterEach(async () => {
    await transport?.stop();
    transport = undefined;
    vi.clearAllMocks();
  });

  it('sends one timeout response and ignores a tool result that arrives afterward', async () => {
    transport = new HttpTransport(logger, {
      host: '127.0.0.1',
      port: 0,
      corsEnabled: false,
      requestTimeout: 100,
    });
    let finish!: (response: MCPResponse) => void;
    const work = new Promise<MCPResponse>((resolve) => { finish = resolve; });
    transport.onRequest(async () => await work);
    await transport.start();

    const port = ((transport as unknown as { server: Server }).server.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/rpc`;
    const request = { jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'memory_store' } };
    const timedOut = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    });
    expect(timedOut.status).toBe(408);
    const timeoutBody = await timedOut.json();

    finish({ jsonrpc: '2.0', id: 17, result: { stored: true } });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logger.error).not.toHaveBeenCalled();
    expect(timeoutBody).toMatchObject({ id: 17, error: { code: -32000, message: 'Request timeout' } });
    expect((await transport.getHealthStatus()).metrics?.messagesSent).toBe(0);

    // The timed-out request must not poison the next HTTP request.
    transport.onRequest(async (next) => ({ jsonrpc: '2.0', id: next.id, result: { ok: true } }));
    const followUp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...request, id: 18 }),
    });
    expect(followUp.status).toBe(200);
    expect(await followUp.json()).toMatchObject({ id: 18, result: { ok: true } });
  });

  it('does not try to send a second error when a timed-out tool rejects', async () => {
    transport = new HttpTransport(logger, {
      host: '127.0.0.1',
      port: 0,
      corsEnabled: false,
      requestTimeout: 100,
    });
    let fail!: (error: Error) => void;
    const work = new Promise<MCPResponse>((_resolve, reject) => { fail = reject; });
    transport.onRequest(async () => await work);
    await transport.start();

    const port = ((transport as unknown as { server: Server }).server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 19, method: 'tools/call' }),
    });
    expect(response.status).toBe(408);
    await response.json();

    fail(new Error('late tool failure'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logger.error).not.toHaveBeenCalled();
  });
});
