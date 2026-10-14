/**
 * When the signed plugin registry can't be verified (ruvnet/ruflo#3211), discovery falls back
 * to the CLI's built-in list. The fallback must be labelled as such: flagged `demo`, no
 * fabricated CID, and a cached fallback must stay labelled on the next call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/transfer/ipfs/client.js', () => ({
  resolveIPNS: vi.fn(async () => null),
  // The pinned CID serves a registry with no registrySignature, as production does today.
  fetchFromIPFS: vi.fn(async () => ({ version: '1.0.1', type: 'plugins', plugins: [], totalPlugins: 0 })),
  verifyEd25519Signature: vi.fn(async () => false),
}));

import { PluginDiscoveryService } from '../src/plugins/store/discovery.js';

describe('plugin discovery: unverified registry fallback is labelled honestly', () => {
  beforeEach(() => {
    // Keep the built-in list's npm-stats lookup offline.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  });

  it('flags the fallback as demo, invents no CID, and keeps the label on a cache hit', async () => {
    const svc = new PluginDiscoveryService({ requireVerification: true } as never);
    const name = svc.listRegistries()[0].name;

    const first = await svc.discoverRegistry(name);
    expect(first.success).toBe(true);
    expect(first.demo).toBe(true);
    expect(first.cid).toBeUndefined();
    expect(first.source).toMatch(/\(demo\)$/);

    const second = await svc.discoverRegistry(name);
    expect(second.fromCache).toBe(true);
    expect(second.demo).toBe(true);
    expect(second.source).toMatch(/\(demo\)$/);
  });

  it('lists no retired agentic-qe shim and only curates plugins it actually lists', async () => {
    const svc = new PluginDiscoveryService({ requireVerification: true } as never);
    const { registry } = await svc.discoverRegistry(svc.listRegistries()[0].name);
    const ids = new Set(registry!.plugins.map((p) => p.id));

    // The in-repo shim was removed; agentic-qe ships as its own package and Claude Code plugin.
    expect(ids.has('@claude-flow/plugin-agentic-qe')).toBe(false);
    for (const list of [registry!.featured, registry!.trending, registry!.newest, registry!.official]) {
      for (const id of list) expect(ids.has(id)).toBe(true);
    }
  });
});
