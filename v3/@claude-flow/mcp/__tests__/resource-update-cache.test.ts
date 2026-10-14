import { afterEach, describe, expect, it } from 'vitest';
import { createMCPServer } from '../src/server.js';
import { createResourceRegistry } from '../src/resource-registry.js';
import type { ILogger } from '../src/types.js';
import type { Server } from 'node:http';

const logger: ILogger = { debug() {}, info() {}, warn() {}, error() {} };
const servers: ReturnType<typeof createMCPServer>[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.stop())); });

async function client() {
  const server = createMCPServer({ transport: 'http', host: '127.0.0.1', port: 0 }, logger);
  servers.push(server);
  await server.start();
  // Inspect only the ephemeral listener address; all requests use real HTTP/RPC.
  const transport = (server as unknown as { transports: { server: Server }[] }).transports[0];
  const address = transport.server.address();
  if (!address || typeof address === 'string') throw new Error('Missing TCP listener');
  const port = address.port;
  let id = 0;
  async function rpc(method: string, params: Record<string, unknown>) {
    const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    expect(response.ok).toBe(true);
    const message = await response.json();
    expect(message.error).toBeUndefined();
    return message.result;
  }
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'resource-cache-test', version: '1' } });
  return { registry: server.getResourceRegistry(), read: async (uri: string) => (await rpc('resources/read', { uri })).contents[0].text };
}

describe('resource updates invalidate cached content independently of subscriptions', () => {
  it.each(['static', 'template'])('serves fresh %s content over HTTP without subscribers', async kind => {
    const { registry, read } = await client();
    const uri = 'status://workers/one';
    let status = 'idle';
    let reads = 0;
    const handler = async () => { reads++; return [{ uri, text: status }]; };
    if (kind === 'static') registry.registerResource({ uri, name: 'Worker status' }, handler);
    else registry.registerTemplate({ uriTemplate: 'status://workers/{id}', name: 'Worker status' }, handler);
    expect(await read(uri)).toBe('idle');
    expect(await read(uri)).toBe('idle');
    expect(reads).toBe(1);
    status = 'busy';
    await registry.notifyUpdate(uri);
    // No subscribers: invalidate lazily, without reading/performing callbacks.
    expect(reads).toBe(1);
    expect(await read(uri)).toBe('busy');
    expect(await read(uri)).toBe('busy');
    expect(reads).toBe(2);
  });

  it('invalidates updates after the final subscriber leaves and retains other cached URIs', async () => {
    const registry = createResourceRegistry(logger);
    const uri = 'status://workers/one';
    let status = 'idle';
    let reads = 0;
    let callbacks = 0;
    registry.registerResource({ uri, name: 'Worker status' }, async () => { reads++; return [{ uri, text: status }]; });
    registry.registerResource({ uri: 'status://workers/two', name: 'Other worker' }, async () => [{ uri: 'status://workers/two', text: 'other' }]);
    await registry.read('status://workers/two');
    const sub = registry.subscribe(uri, () => { callbacks++; });
    await registry.read(uri);
    status = 'busy';
    await registry.notifyUpdate(uri);
    expect(callbacks).toBe(1);
    expect(reads).toBe(2);
    expect(registry.unsubscribe(sub)).toBe(true);
    status = 'finished';
    await registry.notifyUpdate(uri);
    expect(callbacks).toBe(1);
    expect(reads).toBe(2);
    expect(registry.getStats().cacheSize).toBe(1);
    expect((await registry.read(uri)).contents[0].text).toBe('finished');
    expect(registry.getStats().cacheSize).toBe(2);
  });
});
