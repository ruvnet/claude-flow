import { afterEach, describe, expect, it } from 'vitest';
import { createMCPServer } from '../src/server.js';
import type { ILogger, ResourceContent } from '../src/types.js';
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


function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('resource cache writes respect invalidation while producers are pending', () => {
  it.each([
    ['static', 'notify'], ['template', 'notify'],
    ['static', 'clear'], ['template', 'clear'],
  ] as const)('does not resurrect old %s content after %s invalidation', async (kind, invalidation) => {
    const { registry, read } = await client();
    const uri = 'status://workers/one';
    const started = deferred();
    const release = deferred();
    let value = 'old';
    let calls = 0;
    const handler = async (): Promise<ResourceContent[]> => {
      const captured = value;
      if (++calls === 1) { started.resolve(); await release.promise; }
      return [{ uri, text: captured }];
    };
    if (kind === 'static') registry.registerResource({ uri, name: 'Status' }, handler);
    else registry.registerTemplate({ uriTemplate: 'status://workers/{id}', name: 'Status' }, handler);
    const oldRead = read(uri);
    try {
      await started.promise;
      value = 'fresh';
      if (invalidation === 'notify') await registry.notifyUpdate(uri);
      else registry.clearCache();
      expect(await read(uri)).toBe('fresh');
    } finally { release.resolve(); }
    // An already-running request may complete with its captured snapshot.
    expect(await oldRead).toBe('old');
    expect(await read(uri)).toBe('fresh');
    expect(await read(uri)).toBe('fresh');
    expect(calls).toBe(2);
  });

  it('does not cache a removed producer over a re-registered resource', async () => {
    const { registry, read } = await client();
    const uri = 'status://workers/one';
    const started = deferred();
    const release = deferred();
    registry.registerResource({ uri, name: 'Old producer' }, async () => {
      started.resolve(); await release.promise;
      return [{ uri, text: 'old producer' }];
    });
    const oldRead = read(uri);
    try {
      await started.promise;
      expect(registry.unregisterResource(uri)).toBe(true);
      expect(registry.registerResource({ uri, name: 'New producer' }, async () => [{ uri, text: 'new producer' }])).toBe(true);
      expect(await read(uri)).toBe('new producer');
    } finally { release.resolve(); }
    expect(await oldRead).toBe('old producer');
    expect(await read(uri)).toBe('new producer');
  });

  it('keeps subscribed refresh content after an older read finishes', async () => {
    const { registry, read } = await client();
    const uri = 'status://workers/one';
    const started = deferred();
    const release = deferred();
    let value = 'old';
    let calls = 0;
    const updates: string[] = [];
    registry.registerResource({ uri, name: 'Status' }, async () => {
      const captured = value;
      if (++calls === 1) { started.resolve(); await release.promise; }
      return [{ uri, text: captured }];
    });
    registry.subscribe(uri, (_uri, content) => updates.push(content[0].text!));
    const oldRead = read(uri);
    try {
      await started.promise;
      value = 'fresh';
      await registry.notifyUpdate(uri);
      expect(updates).toEqual(['fresh']);
    } finally { release.resolve(); }
    expect(await oldRead).toBe('old');
    expect(await read(uri)).toBe('fresh');
    expect(calls).toBe(2);
  });

  it('retains cache reuse without invalidation and other already-cached URIs', async () => {
    const { registry, read } = await client();
    const uri = 'status://workers/one';
    const otherUri = 'status://workers/two';
    let calls = 0;
    registry.registerResource({ uri, name: 'Status' }, async () => { calls++; return [{ uri, text: 'stable' }]; });
    registry.registerResource({ uri: otherUri, name: 'Other' }, async () => [{ uri: otherUri, text: 'other' }]);
    expect(await read(uri)).toBe('stable');
    expect(await read(uri)).toBe('stable');
    expect(calls).toBe(1);
    expect(await read(otherUri)).toBe('other');
    await registry.notifyUpdate(otherUri);
    expect(await read(uri)).toBe('stable');
    expect(calls).toBe(1);
  });
});
