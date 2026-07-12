/**
 * Real WebSocket transport integration test. Boots an MCPServer on the ws
 * transport, connects an actual ws client, and drives the JSON-RPC lifecycle
 * end-to-end — closing the gap where only stdio/http/in-process were exercised.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createMCPServer } from '../src/index.js';
import type { ILogger, MCPServer } from '../src/server.js';

const noopLogger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
const PORT = 39217;
const URL = `ws://127.0.0.1:${PORT}/ws`;

describe('WebSocket transport', () => {
  let server: MCPServer;

  beforeAll(async () => {
    server = createMCPServer(
      { name: 'ruflo', version: '3.0.0', transport: 'websocket', host: '127.0.0.1', port: PORT },
      noopLogger
    );
    server.registerTool({
      name: 'echo',
      description: 'Echo the input back',
      inputSchema: { type: 'object', properties: { value: { type: 'string' } } },
      handler: async (input: unknown) => input,
    });
    await server.start();
  }, 20_000);

  afterAll(async () => {
    await server.stop();
  });

  /** Open a socket, run one request/response round trip, close. */
  const rpc = (payload: object): Promise<any> =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(URL);
      const timer = setTimeout(() => { ws.close(); reject(new Error('ws rpc timeout')); }, 8000);
      ws.on('open', () => ws.send(JSON.stringify(payload)));
      ws.on('message', (data) => {
        clearTimeout(timer);
        ws.close();
        resolve(JSON.parse(data.toString()));
      });
      ws.on('error', (err) => { clearTimeout(timer); reject(err); });
    });

  it('completes the initialize handshake over a real socket', async () => {
    const res = await rpc({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ws-test', version: '1' } },
    });
    expect(res.result.protocolVersion).toBe('2025-11-25');
    expect(res.result.serverInfo.name).toBe('ruflo');
  });

  it('negotiates a 2026-07-28 client over WebSocket', async () => {
    const res = await rpc({
      jsonrpc: '2.0', id: 2, method: 'initialize',
      params: { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'ws-test', version: '1' } },
    });
    expect(res.result.protocolVersion).toBe('2026-07-28');
  });

  it('lists and calls a tool over WebSocket', async () => {
    // Each rpc() uses its own connection; the server tracks the last session,
    // so initialize then exercise on fresh sockets in sequence.
    await rpc({
      jsonrpc: '2.0', id: 3, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ws-test', version: '1' } },
    });
    const list = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    expect(list.result.tools.some((t: { name: string }) => t.name === 'echo')).toBe(true);

    const call = await rpc({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'echo', arguments: { value: 'hello-ws' } },
    });
    expect(call.result.isError).toBe(false);
    expect(call.result.content[0].text).toContain('hello-ws');
  });
});
