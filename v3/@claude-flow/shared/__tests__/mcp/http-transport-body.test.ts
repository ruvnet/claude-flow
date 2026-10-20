/**
 * HTTP transport request-body handling
 *
 * Express 5 leaves req.body undefined when no JSON body is parsed (Express 4
 * gave {}), and body-parser reports malformed JSON through the error handler.
 * Both are the client's JSON-RPC errors (400), not internal errors (500).
 *
 * @module v3/shared/__tests__/mcp/http-transport-body.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpTransport } from '../../src/mcp/transport/http.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

describe('HttpTransport request body', () => {
  // Port 0: the transport's own server takes a free port, so nothing can claim it in between.
  const transport = new HttpTransport(logger as never, { host: '127.0.0.1', port: 0 });
  let base = '';

  beforeAll(async () => {
    await transport.start();
    const server = (transport as unknown as { server: Server }).server;
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await transport.stop();
  });

  const rpc = (init: RequestInit) => fetch(`${base}/rpc`, { method: 'POST', ...init });

  it('answers a POST /rpc without a JSON body with a JSON-RPC 400', async () => {
    const res = await rpc({});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32600 } });
  });

  it('answers malformed JSON with a JSON-RPC parse error (400, -32700)', async () => {
    const res = await rpc({ headers: { 'content-type': 'application/json' }, body: '{bad' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: -32700 } });
  });

  it('still answers a well-formed request that names the wrong version with a 400', async () => {
    const res = await rpc({ headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '1.0', id: 7, method: 'x' }) });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ id: 7, error: { code: -32600 } });
  });
});
