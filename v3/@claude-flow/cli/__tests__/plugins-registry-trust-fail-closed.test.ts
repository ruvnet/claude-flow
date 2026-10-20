/**
 * Plugin registry trust fails closed (ADR-145).
 *
 * The signed registry is what vouches for a plugin: its trustLevel 'official'/'verified' lets an
 * install run npm lifecycle scripts and skip the permission gate. So:
 *  - an unverified registry (unsigned, bad signature, placeholder pinned key, verification off)
 *    and the built-in fallback list carry no registry trust;
 *  - a placeholder pinned key (all-zero or any small-order point) is never used to verify, and the
 *    Ed25519 verifier runs in RFC 8032 strict mode;
 *  - an unverified registry claims no official plugins and no verified authors, and the MCP
 *    transfer_plugin-* tools report the registry status;
 *  - CLAUDE_FLOW_STRICT_PLUGINS=true turns the fallback into an error and makes `plugins install`
 *    refuse without --allow-unverified;
 *  - `plugins install` never passes an unverified entry's trust, permissions or checksum on.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ipfs = vi.hoisted(() => ({ registry: null as Record<string, unknown> | null }));

vi.mock('../src/transfer/ipfs/client.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/transfer/ipfs/client.js')>();
  return {
    ...real,
    resolveIPNS: vi.fn(async () => null),
    fetchFromIPFS: vi.fn(async () => ipfs.registry),
  };
});

const manager = vi.hoisted(() => ({
  installFromNpm: vi.fn(),
}));

vi.mock('../src/plugins/manager.js', () => ({
  getPluginManager: () => ({
    initialize: async () => {},
    getPlugin: async () => undefined,
    installFromNpm: manager.installFromNpm,
    getPluginsDir: () => '/tmp/plugins',
  }),
}));

import { PluginDiscoveryService } from '../src/plugins/store/discovery.js';
import { verifyEd25519Signature } from '../src/transfer/ipfs/client.js';
import { isPlaceholderSigningKey, isStrictPluginMode } from '../src/plugins/trust-policy.js';
import { pluginsCommand } from '../src/commands/plugins.js';
import transferTools from '../src/mcp-tools/transfer-tools.js';
import type { CommandContext } from '../src/types.js';
import anchorsFile from '../src/plugins/trust/trust-anchors.json';

const ZERO_KEY = '0'.repeat(64);
// An ordinary Ed25519 public key (not small-order) with no known signer.
const REAL_KEY = 'ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c';
// Small-order points: identity, order 2, order 8.
const SMALL_ORDER_KEYS = [
  '01' + '0'.repeat(62),
  'ec' + 'ff'.repeat(30) + '7f',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
];
// Known-bad signature fixture used against small-order keys.
const BAD_SIG = '01' + '0'.repeat(126);

function entry(name: string, trustLevel = 'official') {
  return {
    id: name,
    name,
    displayName: name,
    version: '1.0.0',
    trustLevel,
    verified: true,
    checksum: 'sha256:' + 'a'.repeat(64),
    permissions: ['shell:exec'],
    hooks: [],
    commands: [],
  };
}

function registryWith(plugins: ReturnType<typeof entry>[], extra: Record<string, unknown> = {}) {
  return {
    version: '1.0.1',
    type: 'plugins',
    plugins,
    totalPlugins: plugins.length,
    featured: [],
    official: plugins.map((p) => p.id),
    ...extra,
  };
}

function serviceFor(publicKey: string, overrides: Record<string, unknown> = {}) {
  return new PluginDiscoveryService({
    requireVerification: true,
    defaultRegistry: 'test',
    registries: [
      { name: 'test', description: 't', ipnsName: 'QmTestRegistry', gateway: 'https://example.invalid', publicKey, trusted: true, official: true },
    ],
    ...overrides,
  } as never);
}

async function signRegistry(registry: Record<string, unknown>) {
  const ed = await import('@noble/ed25519');
  const priv = ed.utils.randomPrivateKey();
  const pub = Buffer.from(await ed.getPublicKeyAsync(priv)).toString('hex');
  const sig = await ed.signAsync(new TextEncoder().encode(JSON.stringify(registry)), priv);
  return { pub, signed: { ...registry, registrySignature: Buffer.from(sig).toString('hex') } };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  delete process.env.CLAUDE_FLOW_STRICT_PLUGINS;
  ipfs.registry = null;
  manager.installFromNpm.mockReset();
});

afterEach(() => {
  delete process.env.CLAUDE_FLOW_STRICT_PLUGINS;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('placeholder signing keys', () => {
  it('a shipped trust anchor that is a placeholder leaves a registry pinned to it unverified', async () => {
    // Holds whether or not maintainers have replaced the placeholder with a real key.
    for (const a of anchorsFile.anchors) {
      if (!isPlaceholderSigningKey(a.publicKey)) continue;
      ipfs.registry = registryWith([entry('@claude-flow/a')], { registrySignature: BAD_SIG });
      const result = await serviceFor(`ed25519:${a.publicKey}`).discoverRegistry();
      expect(result.verified).toBe(false);
      expect(result.unverifiedReason).toMatch(/placeholder/);
    }
  });

  it('rejects missing, malformed, off-curve, all-zero and small-order keys; accepts an ordinary key', () => {
    expect(isPlaceholderSigningKey(undefined)).toBe(true);
    expect(isPlaceholderSigningKey('')).toBe(true);
    expect(isPlaceholderSigningKey('ed25519:abc')).toBe(true);
    expect(isPlaceholderSigningKey(`ed25519:${'ab'.repeat(32)}`)).toBe(true);
    expect(isPlaceholderSigningKey(`ed25519:${ZERO_KEY}`)).toBe(true);
    for (const k of SMALL_ORDER_KEYS) expect(isPlaceholderSigningKey(`ed25519:${k}`)).toBe(true);
    expect(isPlaceholderSigningKey(`ed25519:${REAL_KEY}`)).toBe(false);
  });

  it('verifyEd25519Signature rejects the bad-signature fixture for every small-order key (RFC 8032 strict)', async () => {
    for (const k of [ZERO_KEY, ...SMALL_ORDER_KEYS]) {
      expect(await verifyEd25519Signature('any message', BAD_SIG, k)).toBe(false);
    }
  });

  it('a small-order pinned key is treated as a placeholder', async () => {
    ipfs.registry = registryWith([entry('@claude-flow/evil')], { registrySignature: BAD_SIG });
    const result = await serviceFor(`ed25519:${SMALL_ORDER_KEYS[0]}`).discoverRegistry();
    expect(result.verified).toBe(false);
    expect(result.unverifiedReason).toMatch(/placeholder/);
  });

  it('an all-zero pinned key leaves the registry unverified and its entries unlisted', async () => {
    ipfs.registry = registryWith([entry('@claude-flow/evil')], { registrySignature: BAD_SIG });
    const result = await serviceFor(`ed25519:${ZERO_KEY}`).discoverRegistry();

    expect(result.verified).toBe(false);
    expect(result.unverifiedReason).toMatch(/placeholder/);
    expect(result.registry!.plugins.find((p) => p.name === '@claude-flow/evil')).toBeUndefined();
    expect(result.registry!.plugins.every((p) => p.trustLevel === 'unverified' && !p.verified)).toBe(true);
  });
});

describe('discovery: an unverified registry confers no trust', () => {
  it('an unsigned registry falls back to the built-in list, labelled demo and unverified, with trust stripped', async () => {
    ipfs.registry = registryWith([entry('@claude-flow/a')]);
    const svc = serviceFor(`ed25519:${REAL_KEY}`);

    const first = await svc.discoverRegistry();
    expect(first.success).toBe(true);
    expect(first.demo).toBe(true);
    expect(first.verified).toBe(false);
    expect(first.unverifiedReason).toMatch(/unsigned/);
    expect(first.registry!.plugins.length).toBeGreaterThan(0);
    expect(first.registry!.plugins.every((p) => p.trustLevel === 'unverified' && !p.verified)).toBe(true);

    const second = await svc.discoverRegistry();
    expect(second.fromCache).toBe(true);
    expect(second.verified).toBe(false);
    expect(second.registry!.plugins.every((p) => p.trustLevel === 'unverified')).toBe(true);
  });

  it('an unverified registry lists no official plugins and no verified authors', async () => {
    ipfs.registry = registryWith([entry('@claude-flow/a')]);
    const result = await serviceFor(`ed25519:${REAL_KEY}`).discoverRegistry();
    expect(result.verified).toBe(false);
    expect(result.registry!.official).toEqual([]);
    expect(result.registry!.authors.every((a) => !a.verified)).toBe(true);
    expect(result.registry!.plugins.every((p) => !p.author?.verified)).toBe(true);
  });

  it('a signature that does not verify is not silently treated as the registry', async () => {
    const { signed } = await signRegistry(registryWith([entry('@claude-flow/a')]));
    ipfs.registry = signed;
    // Pinned key differs from the signer.
    const result = await serviceFor(`ed25519:${REAL_KEY}`).discoverRegistry();
    expect(result.verified).toBe(false);
    expect(result.demo).toBe(true);
    expect(result.unverifiedReason).toMatch(/does not verify/);
  });

  it('with verification disabled the fetched registry is used but every entry is unverified', async () => {
    ipfs.registry = registryWith([entry('@claude-flow/a')]);
    const result = await serviceFor(`ed25519:${REAL_KEY}`, { requireVerification: false }).discoverRegistry();
    expect(result.success).toBe(true);
    expect(result.demo).toBeUndefined();
    expect(result.verified).toBe(false);
    expect(result.registry!.plugins).toEqual([expect.objectContaining({ name: '@claude-flow/a', trustLevel: 'unverified', verified: false })]);
  });

  it('a correctly signed registry is verified and keeps its trust levels', async () => {
    const { pub, signed } = await signRegistry(registryWith([entry('@claude-flow/a')]));
    ipfs.registry = signed;
    const result = await serviceFor(`ed25519:${pub}`).discoverRegistry();
    expect(result.verified).toBe(true);
    expect(result.demo).toBeUndefined();
    expect(result.unverifiedReason).toBeUndefined();
    expect(result.registry!.plugins[0].trustLevel).toBe('official');
  });

  it('CLAUDE_FLOW_STRICT_PLUGINS=true: no fallback, discovery fails with the reason', async () => {
    process.env.CLAUDE_FLOW_STRICT_PLUGINS = 'true';
    expect(isStrictPluginMode()).toBe(true);
    ipfs.registry = registryWith([entry('@claude-flow/a')]);
    const result = await serviceFor(`ed25519:${REAL_KEY}`).discoverRegistry();
    expect(result.success).toBe(false);
    expect(result.registry).toBeUndefined();
    expect(result.verified).toBe(false);
    expect(result.error).toMatch(/unsigned.*CLAUDE_FLOW_STRICT_PLUGINS=true/);
  });
});

describe('plugins install: unverified registry entries get no registry trust', () => {
  const install = pluginsCommand.subcommands!.find((c) => c.name === 'install')!;
  const ctxFor = (flags: Record<string, unknown>) =>
    ({ args: [], flags: { _: [], ...flags }, cwd: process.cwd(), interactive: false }) as unknown as CommandContext;
  const installed = { success: true, plugin: { name: '@claude-flow/neural', version: '3.0.0', source: 'npm' }, warnings: [] };

  // The real default registry is unsigned today, as the live CID is; serve it unsigned.
  beforeEach(() => {
    ipfs.registry = registryWith([entry('@claude-flow/neural')]);
    manager.installFromNpm.mockResolvedValue(installed);
  });

  it('default mode: a built-in-list entry installs without its "official" trust, permissions or checksum', async () => {
    const res = await install.action!(ctxFor({ name: '@claude-flow/neural' }));
    expect(res.success).toBe(true);
    expect(manager.installFromNpm).toHaveBeenCalledTimes(1);
    const opts = manager.installFromNpm.mock.calls[0][2];
    expect(opts).toEqual({ verify: true, trust: false });
  });

  it('strict mode: refuses without --allow-unverified and installs nothing', async () => {
    process.env.CLAUDE_FLOW_STRICT_PLUGINS = 'true';
    const res = await install.action!(ctxFor({ name: '@claude-flow/neural' }));
    expect(res.success).toBe(false);
    expect(manager.installFromNpm).not.toHaveBeenCalled();
  });

  it('strict mode + --allow-unverified: installs, still without registry trust', async () => {
    process.env.CLAUDE_FLOW_STRICT_PLUGINS = 'true';
    const res = await install.action!(ctxFor({ name: '@claude-flow/neural', allowUnverified: true }));
    expect(res.success).toBe(true);
    expect(manager.installFromNpm.mock.calls[0][2]).toEqual({ verify: true, trust: false });
  });

  it('a verified registry entry still passes its trust, permissions and checksum on', async () => {
    const { pub, signed } = await signRegistry(registryWith([entry('@claude-flow/neural')]));
    ipfs.registry = signed;
    const { DEFAULT_PLUGIN_STORE_CONFIG } = await import('../src/plugins/store/discovery.js');
    const original = DEFAULT_PLUGIN_STORE_CONFIG.registries.map((r) => r.publicKey);
    DEFAULT_PLUGIN_STORE_CONFIG.registries.forEach((r) => { r.publicKey = `ed25519:${pub}`; });
    try {
      const res = await install.action!(ctxFor({ name: '@claude-flow/neural' }));
      expect(res.success).toBe(true);
      expect(manager.installFromNpm.mock.calls[0][2]).toEqual({
        verify: true,
        trust: false,
        expectedChecksum: 'sha256:' + 'a'.repeat(64),
        registryTrustLevel: 'official',
        registryPermissions: ['shell:exec'],
      });
    } finally {
      DEFAULT_PLUGIN_STORE_CONFIG.registries.forEach((r, i) => { r.publicKey = original[i]; });
    }
  });
});

describe('MCP transfer_plugin-* tools report registry status', () => {
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    const tool = transferTools.find((t) => t.name === name)!;
    const res = await tool.handler(input as never);
    return JSON.parse((res.content[0] as { text: string }).text);
  };

  beforeEach(() => {
    // The default registry, served unsigned as the live CID is.
    ipfs.registry = registryWith([entry('@claude-flow/neural')]);
  });

  it('transfer_plugin-official claims nothing as official when the registry is unverified', async () => {
    const out = await call('transfer_plugin-official');
    expect(out.plugins).toEqual([]);
    expect(out.registry.verified).toBe(false);
    expect(out.registry.unverifiedReason).toMatch(/unsigned/);
  });

  it('transfer_plugin-featured, -search and -info carry the status and unverified entries', async () => {
    const featured = await call('transfer_plugin-featured', { limit: 3 });
    expect(featured.registry.verified).toBe(false);
    expect(featured.plugins.every((p: { trustLevel: string }) => p.trustLevel === 'unverified')).toBe(true);

    const search = await call('transfer_plugin-search', { query: 'neural' });
    expect(search.registry.verified).toBe(false);

    const info = await call('transfer_plugin-info', { name: '@claude-flow/neural' });
    expect(info.trustLevel).toBe('unverified');
    expect(info.registry).toEqual(expect.objectContaining({ verified: false }));
  });
});
