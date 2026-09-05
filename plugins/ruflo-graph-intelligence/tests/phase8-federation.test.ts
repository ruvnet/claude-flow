/**
 * Phase 8 Tests — Federation Distribution of Signed PR Vectors (beyond-SOTA)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FederationServer } from '../src/application/federation-server.js';
import {
  FederationClient,
  inProcessTransport,
} from '../src/application/federation-client.js';
import { generateWitnessKey } from '../src/infrastructure/witness-signer.js';
import { resetRegistry, getRegistry, type SublinearAdapter } from '../src/domain/adapter.js';
import type { SparseMatrix } from '../src/domain/types.js';
import { createHash } from 'node:crypto';

function ddAdapter(graphId: string, n = 6): SublinearAdapter {
  const entries = [];
  const nodeIndex: Record<string, number> = {};
  const indexNode: string[] = [];
  for (let i = 0; i < n; i++) {
    nodeIndex[`n${i}`] = i;
    indexNode.push(`n${i}`);
    entries.push({ row: i, col: i, value: 5 });
    if (i > 0) entries.push({ row: i, col: i - 1, value: -1 });
    if (i < n - 1) entries.push({ row: i, col: i + 1, value: -1 });
  }
  const contentHash = createHash('sha256')
    .update(JSON.stringify({ graphId, n }))
    .digest('hex');
  const matrix: SparseMatrix = {
    graphId,
    size: n,
    entries,
    nodeIndex,
    indexNode,
    capturedAt: '2026-05-19T00:00:00Z',
    contentHash,
  };
  return {
    graphId,
    ownerPlugin: 'test',
    async exportAsSparseMatrix() {
      return matrix;
    },
  };
}

describe('Federation round-trip', () => {
  beforeEach(() => resetRegistry());

  it('client receives a verifiable peer artifact', async () => {
    const adapter = ddAdapter('fed:test', 6);
    getRegistry().register(adapter);
    const key = generateWitnessKey();
    const server = new FederationServer({
      installationId: 'inst-A',
      witnessKey: key,
      witnessKeyId: 'key-v1',
      transport: { async send() { return null; }, onMessage() { return () => {}; } },
    });
    const client = new FederationClient({
      installationId: 'inst-B',
      transport: inProcessTransport(server),
      trustedPublicKeys: [key.publicKeyHex],
    });
    const result = await client.fetchPageRank({
      peer: 'inst-A',
      graphId: 'fed:test',
      nodeId: 'n2',
    });
    expect(result.origin).toBe('peer');
    expect(result.verification?.valid).toBe(true);
    expect(result.result.score).toBeGreaterThanOrEqual(0);
  });

  it('client falls back to local on untrusted signer', async () => {
    const adapter = ddAdapter('fed:test', 6);
    getRegistry().register(adapter);
    const strangerKey = generateWitnessKey();
    const server = new FederationServer({
      installationId: 'inst-A',
      witnessKey: strangerKey,
      witnessKeyId: 'key-v1',
      transport: { async send() { return null; }, onMessage() { return () => {}; } },
    });
    const client = new FederationClient({
      installationId: 'inst-B',
      transport: inProcessTransport(server),
      trustedPublicKeys: ['0'.repeat(64)], // stranger NOT in trust list
    });
    const result = await client.fetchPageRank({
      peer: 'inst-A',
      graphId: 'fed:test',
      nodeId: 'n2',
    });
    expect(result.origin).toBe('untrusted-fallback');
    expect(result.fallbackReason).toMatch(/trusted list/i);
    expect(result.result.score).toBeGreaterThanOrEqual(0);
  });

  it('server sends pr_artifact_stale when graphHash differs', async () => {
    const adapter = ddAdapter('fed:test', 6);
    getRegistry().register(adapter);
    const key = generateWitnessKey();
    const server = new FederationServer({
      installationId: 'inst-A',
      witnessKey: key,
      witnessKeyId: 'key-v1',
      transport: { async send() { return null; }, onMessage() { return () => {}; } },
    });
    const client = new FederationClient({
      installationId: 'inst-B',
      transport: inProcessTransport(server),
      trustedPublicKeys: [key.publicKeyHex],
    });
    const result = await client.fetchPageRank({
      peer: 'inst-A',
      graphId: 'fed:test',
      nodeId: 'n2',
      lastKnownGraphHash: '0'.repeat(64), // doesn't match what server has
    });
    expect(result.origin).toBe('stale-fallback');
    expect(result.fallbackReason).toMatch(/changed/);
  });

  it('server returns stale-reject for an unknown graphId', async () => {
    const key = generateWitnessKey();
    const server = new FederationServer({
      installationId: 'inst-A',
      witnessKey: key,
      witnessKeyId: 'key-v1',
      transport: { async send() { return null; }, onMessage() { return () => {}; } },
    });
    const client = new FederationClient({
      installationId: 'inst-B',
      transport: inProcessTransport(server),
    });
    // No adapter registered on client OR server side
    try {
      await client.fetchPageRank({
        peer: 'inst-A',
        graphId: 'fed:nonexistent',
        nodeId: 'n2',
      });
      throw new Error('expected localCompute to throw');
    } catch (err) {
      expect((err as Error).message).toMatch(/no adapter/);
    }
  });

  it('server rate-limits per peer', async () => {
    const adapter = ddAdapter('fed:test', 6);
    getRegistry().register(adapter);
    const key = generateWitnessKey();
    const server = new FederationServer({
      installationId: 'inst-A',
      witnessKey: key,
      witnessKeyId: 'key-v1',
      transport: { async send() { return null; }, onMessage() { return () => {}; } },
      rateLimitPerPeerPerMinute: 2,
    });
    const client = new FederationClient({
      installationId: 'inst-B',
      transport: inProcessTransport(server),
      trustedPublicKeys: [key.publicKeyHex],
    });
    const r1 = await client.fetchPageRank({ peer: 'inst-A', graphId: 'fed:test', nodeId: 'n2' });
    const r2 = await client.fetchPageRank({ peer: 'inst-A', graphId: 'fed:test', nodeId: 'n3' });
    const r3 = await client.fetchPageRank({ peer: 'inst-A', graphId: 'fed:test', nodeId: 'n4' });
    expect(r1.origin).toBe('peer');
    expect(r2.origin).toBe('peer');
    expect(r3.origin).toBe('stale-fallback');
    expect(r3.fallbackReason).toMatch(/rate limit/i);
  });

  it('client falls back to local compute when no usable response', async () => {
    const adapter = ddAdapter('fed:test', 6);
    getRegistry().register(adapter);
    const client = new FederationClient({
      installationId: 'inst-B',
      transport: {
        async send() { return null; }, // server unreachable
        onMessage() { return () => {}; },
      },
    });
    const result = await client.fetchPageRank({
      peer: 'inst-A',
      graphId: 'fed:test',
      nodeId: 'n2',
    });
    expect(result.origin).toBe('local-fallback');
    expect(result.result.score).toBeGreaterThanOrEqual(0);
  });
});
