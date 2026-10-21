import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadOrCreateKey, nip98Header, xFederationJoinTools } from '../src/mcp-tools/x-federation-join.js';
// nostr-tools is an optionalDependency of the CLI and is NOT installed by the root `npm ci`
// (the CLI is a pnpm workspace, not a root npm workspace). The crypto-dependent cases are
// skipped when it is absent; the pure-logic cases always run.
const nt: any = await import('nostr-tools/pure').catch(() => null);
const { generateSecretKey, getPublicKey, verifyEvent } = nt ?? ({} as any);
describe('x_federation_join (self-service invite path)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.skipIf(!nt)('creates a 0600 key on first use and reuses it after', () => {
    const f = join(mkdtempSync(join(tmpdir(), 'xj-')), 'nostr.key');
    const a = loadOrCreateKey(nt, f); const b = loadOrCreateKey(nt, f);
    expect(a.created).toBe(true); expect(b.created).toBe(false); expect(a.pubkey).toBe(b.pubkey);
    expect(existsSync(f)).toBe(true); expect(statSync(f).mode & 0o777).toBe(0o600);
  });
  it.skipIf(!nt)('builds a valid NIP-98 header bound to url+method+payload hash', () => {
    const sk = generateSecretKey(); const h = nip98Header(nt, sk, 'https://r/api/invites/claim', 'POST', '{"code":"v2.x"}');
    const ev = JSON.parse(Buffer.from(h.replace(/^Nostr /, ''), 'base64').toString());
    expect(ev.kind).toBe(27235); expect(verifyEvent(ev)).toBe(true); expect(ev.pubkey).toBe(getPublicKey(sk));
    expect(ev.tags).toEqual(expect.arrayContaining([['u', 'https://r/api/invites/claim'], ['method', 'POST']]));
    expect(ev.tags.find((t: string[]) => t[0] === 'payload')[1]).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rejects malformed invite codes before any network call', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(xFederationJoinTools[0].handler({ code: 'not-a-code' }, {} as any)).rejects.toThrow(/v2\./);
    expect(f).not.toHaveBeenCalled();
  });
  it('is registered with an ADR-112 description and makes invite code optional', () => {
    const t = xFederationJoinTools[0]; expect(t.name).toBe('x_federation_join');
    expect(t.description).toMatch(/Use when/); expect(t.description).toMatch(/wrong/); expect((t.inputSchema as any).required).toEqual([]);
  });
});

// Real local WebSocket authentication; HTTP is intercepted to inspect exact
// signed registration bytes and simulate loss of an admission response.
import { WebSocketServer } from 'ws';
import { verifyMembership } from '../src/mcp-tools/x-federation-join.js';
import { rmSync } from 'node:fs';
async function localRelay() {
  const members = new Set<string>();
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>(r => server.once('listening', r));
  const url = `ws://127.0.0.1:${(server.address() as any).port}`;
  server.on('connection', ws => {
    ws.send(JSON.stringify(['AUTH', 'local-test']));
    ws.on('message', bytes => {
      const [kind, ev] = JSON.parse(bytes.toString());
      expect(kind).toBe('AUTH'); expect(verifyEvent(ev)).toBe(true);
      ws.send('malformed');
      ws.send(JSON.stringify(['OK', 'unrelated-event', true, '']));
      ws.send(JSON.stringify(['OK', ev.id, members.has(ev.pubkey), 'not a member']));
    });
  });
  return { url, members, close: async () => { for (const ws of server.clients) ws.terminate(); await new Promise<void>(r => server.close(() => r())); } };
}
describe.skipIf(!nt)('public self registration', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('ignores unrelated OK and requires acceptance of the signed AUTH event', async () => {
    const relay = await localRelay();
    try { expect((await verifyMembership(nt, generateSecretKey(), relay.url)).ok).toBe(false); }
    finally { await relay.close(); }
  });
  for (const lostResponse of [false, true]) {
    it(`joins without an invite with local key ownership (lost response: ${lostResponse})`, async () => {
      const relay = await localRelay(), dir = mkdtempSync(join(tmpdir(), 'xj-public-')), keyFile = join(dir, 'nostr.key');
      const key = loadOrCreateKey(nt, keyFile);
      const f = vi.fn(async (url: string, options: any) => {
        expect(url).toBe('https://x.ruv.io/api/registration'); expect(options.body).toBe('{}'); expect(options.redirect).toBe('error');
        const ev = JSON.parse(Buffer.from(options.headers.Authorization.slice(6), 'base64').toString());
        expect(verifyEvent(ev)).toBe(true); expect(ev.pubkey).toBe(key.pubkey);
        expect(ev.tags).toContainEqual(['u', url]);
        relay.members.add(ev.pubkey);
        if (lostResponse) throw new Error('response lost');
        return { ok: true, json: async () => ({ ok: true, role: 'member' }) };
      });
      vi.stubGlobal('fetch', f);
      try {
        const result: any = await xFederationJoinTools[0].handler({ keyFile, relayWs: relay.url }, {} as any);
        expect(result.ok).toBe(true); expect(result.pubkey).toBe(key.pubkey); expect(result.keyCreated).toBe(false); expect(result.membershipVerified).toBe(true);
        const again: any = await xFederationJoinTools[0].handler({ keyFile, relayWs: relay.url }, {} as any);
        expect(again.alreadyMember).toBe(true); expect(f).toHaveBeenCalledTimes(1);
      } finally { await relay.close(); rmSync(dir, { recursive: true, force: true }); }
    });
  }
  it('retains the invite claim path', async () => {
    const relay = await localRelay(), dir = mkdtempSync(join(tmpdir(), 'xj-invite-'));
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts: any) => {
      expect(url).toBe('https://relay.ruv.io/api/invites/claim'); expect(JSON.parse(opts.body).code).toBe('v2.test-invite');
      const ev = JSON.parse(Buffer.from(opts.headers.Authorization.slice(6), 'base64').toString());
      relay.members.add(ev.pubkey); return { ok: true, json: async () => ({ role: 'member' }) };
    }));
    try { expect((await xFederationJoinTools[0].handler({ code: 'v2.test-invite', relayWs: relay.url, keyFile: join(dir, 'key') }, {} as any) as any).ok).toBe(true); }
    finally { await relay.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('refuses a server success when the relay refuses membership', async () => {
    const relay = await localRelay(), dir = mkdtempSync(join(tmpdir(), 'xj-denied-'));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ role: 'member' }) })));
    try { const r: any = await xFederationJoinTools[0].handler({ relayWs: relay.url, keyFile: join(dir, 'key') }, {} as any); expect(r.ok).toBe(false); expect(r.membershipVerified).toBe(false); }
    finally { await relay.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects an insecure public registration origin before creating a key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xj-invalid-')), keyFile = join(dir, 'key');
    try {
      await expect(xFederationJoinTools[0].handler({ gatewayUrl: 'http://example.com', keyFile }, {} as any)).rejects.toThrow(/HTTPS/);
      expect(existsSync(keyFile)).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
