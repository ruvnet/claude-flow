/**
 * A2A well-known endpoint + consume tests — serving the card at
 * /.well-known/agent-card.json (loopback-only by default, ADR-166) and
 * fetching/validating/registering remote cards into federation discovery.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  toAgentCard,
  validateAgentCard,
  A2A_WELL_KNOWN_PATH,
  type A2AAgentCard,
} from '../../src/a2a/agent-card.js';
import {
  startAgentCardServer,
  isLoopbackHost,
  type AgentCardServerHandle,
} from '../../src/a2a/well-known.js';
import {
  fetchAgentCard,
  consumeAgentCard,
  resolveAgentCardUrl,
} from '../../src/a2a/consume.js';
import { DiscoveryService } from '../../src/domain/services/discovery-service.js';
import type { FederationManifest } from '../../src/domain/services/discovery-service.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function goldenCard(): A2AAgentCard {
  return JSON.parse(readFileSync(join(FIXTURES, 'a2a-agent-card.golden.json'), 'utf-8'));
}

function makeManifest(): FederationManifest {
  return {
    nodeId: 'node-golden',
    publicKey: 'aabbccddeeff',
    endpoint: 'ws://127.0.0.1:9100',
    capabilities: {
      agentTypes: ['coder', 'reviewer'],
      maxConcurrentSessions: 5,
      supportedProtocols: ['websocket', 'http'],
      complianceModes: ['hipaa'],
    },
    version: '1.0.0-alpha.16',
    signature: 'sig-golden',
    timestamp: '2026-07-03T00:00:00.000Z',
  };
}

function makeDiscovery() {
  return new DiscoveryService({
    signManifest: async () => 'sig',
    verifyManifest: async () => true,
  });
}

/** Stub fetch returning a fixed JSON body. */
function stubFetch(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

describe('startAgentCardServer', () => {
  let handle: AgentCardServerHandle | null = null;

  afterEach(async () => {
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  it('serves the card at the A2A well-known path with spec caching headers', async () => {
    const card = toAgentCard(makeManifest());
    handle = await startAgentCardServer({ getCard: () => card, port: 0 });

    expect(handle.url.endsWith(A2A_WELL_KNOWN_PATH)).toBe(true);
    expect(handle.host).toBe('127.0.0.1');

    const res = await fetch(handle.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('cache-control')).toContain('max-age=');
    expect(res.headers.get('etag')).toBeTruthy();

    const served = await res.json();
    expect(served).toEqual(JSON.parse(JSON.stringify(card)));
    expect(validateAgentCard(served).valid).toBe(true);
  });

  it('returns 304 on matching If-None-Match (spec 8.6 conditional requests)', async () => {
    handle = await startAgentCardServer({ getCard: () => goldenCard(), port: 0 });
    const first = await fetch(handle.url);
    const etag = first.headers.get('etag')!;
    const second = await fetch(handle.url, { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
  });

  it('404s other paths and 405s non-GET methods', async () => {
    handle = await startAgentCardServer({ getCard: () => goldenCard(), port: 0 });
    const base = handle.url.replace(A2A_WELL_KNOWN_PATH, '');

    expect((await fetch(`${base}/`)).status).toBe(404);
    expect((await fetch(`${base}/admin`)).status).toBe(404);
    const post = await fetch(handle.url, { method: 'POST', body: '{}' });
    expect(post.status).toBe(405);
  });

  it('returns 503 while no card is available (surface up, card not published)', async () => {
    handle = await startAgentCardServer({ getCard: () => null, port: 0 });
    expect((await fetch(handle.url)).status).toBe(503);
  });

  it('refuses a non-loopback bind without explicit allowNonLoopback (ADR-166)', async () => {
    await expect(
      startAgentCardServer({ getCard: () => goldenCard(), port: 0, host: '0.0.0.0' }),
    ).rejects.toThrow(/ADR-166/);
  });

  it('classifies loopback hosts correctly', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('10.0.0.5')).toBe(false);
  });
});

describe('resolveAgentCardUrl', () => {
  it('appends the well-known path to a bare base URL', () => {
    expect(resolveAgentCardUrl('http://127.0.0.1:4141')).toBe(
      `http://127.0.0.1:4141${A2A_WELL_KNOWN_PATH}`,
    );
  });

  it('leaves an explicit card URL untouched', () => {
    const explicit = 'https://agent.example.com/custom/card.json';
    expect(resolveAgentCardUrl(explicit)).toBe(explicit);
  });
});

describe('fetchAgentCard', () => {
  it('fetches and validates a card via an injected fetch', async () => {
    const { card, sourceUrl } = await fetchAgentCard('http://127.0.0.1:1', {
      fetchImpl: stubFetch(goldenCard()),
    });
    expect(card.name).toBe('ruflo-federation/node-golden');
    expect(sourceUrl).toBe(`http://127.0.0.1:1${A2A_WELL_KNOWN_PATH}`);
  });

  it('rejects a structurally invalid card', async () => {
    await expect(
      fetchAgentCard('http://127.0.0.1:1', { fetchImpl: stubFetch({ name: 'incomplete' }) }),
    ).rejects.toThrow(/invalid A2A agent card/);
  });

  it('rejects non-JSON and non-2xx responses', async () => {
    await expect(
      fetchAgentCard('http://127.0.0.1:1', { fetchImpl: stubFetch('<html>nope</html>') }),
    ).rejects.toThrow(/valid JSON/);
    await expect(
      fetchAgentCard('http://127.0.0.1:1', { fetchImpl: stubFetch(goldenCard(), 500) }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('consumeAgentCard', () => {
  it('registers a fixture card into federation discovery as an UNTRUSTED a2a-card peer', async () => {
    const discovery = makeDiscovery();
    const node = await consumeAgentCard(discovery, 'http://127.0.0.1:1', {
      fetchImpl: stubFetch(goldenCard()),
    });

    expect(node.nodeId).toBe('node-golden');
    expect(node.metadata.discoveryMechanism).toBe('a2a-card');
    expect(discovery.getPeer('node-golden')).toBe(node);
    expect(discovery.listPeers()).toHaveLength(1);
  });

  it('end-to-end: serves a card over loopback HTTP and consumes it into discovery', async () => {
    const card = toAgentCard(makeManifest());
    const handle = await startAgentCardServer({ getCard: () => card, port: 0 });
    try {
      const discovery = makeDiscovery();
      const node = await consumeAgentCard(discovery, `http://127.0.0.1:${handle.port}`);
      expect(node.nodeId).toBe('node-golden');
      expect(node.endpoint).toBe('ws://127.0.0.1:9100');
      expect(discovery.listActivePeers().map((p) => p.nodeId)).toContain('node-golden');
    } finally {
      await handle.close();
    }
  });
});
