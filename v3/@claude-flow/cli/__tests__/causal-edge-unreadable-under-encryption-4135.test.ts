/**
 * #4135 / #4161: with encryption at rest on, agentdb_causal-edge writes to the graph-node
 * backend and reports success, but the read tools (graph-query, graph-pathfinder) need
 * the RFE1-encrypted graph_edges database and refuse. The write must say so instead of
 * implying the edge can be read back, and k-hop must report the real reason.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

let encrypted = false;

vi.mock('../src/ruvector/graph-backend.js', () => ({
  isGraphBackendAvailable: async () => true,
  recordCausalEdge: async () => ({ success: true, backend: 'graph-node' }),
}));
vi.mock('../src/memory/memory-bridge.js', () => ({
  bridgeRecordCausalEdge: async () => ({ success: true }),
}));
vi.mock('../src/memory/memory-initializer.js', () => ({
  generateEmbedding: async () => null,
}));
vi.mock('../src/memory/graph-edge-writer.js', () => ({
  isBridgeDbEncryptedAtRest: () => encrypted,
  getBridgeDb: async () => null,
  insertGraphEdge: async () => undefined,
}));

const edge = { sourceId: 'entity:router-account', targetId: 'entity:account-service', relation: 'imports', weight: 0.9 };

describe('agentdb_causal-edge when the graph cannot be read back (#4135)', () => {
  beforeEach(() => { encrypted = false; });

  it('flags the write as unreadable when graph_edges is encrypted at rest', async () => {
    encrypted = true;
    const { agentdbCausalEdge } = await import('../src/mcp-tools/agentdb-tools.js');
    const result = await agentdbCausalEdge.handler(edge) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.readable).toBe(false);
    expect(String(result.warning)).toMatch(/encrypted at rest/i);
    expect(String(result.warning)).toMatch(/graph-query|graph-pathfinder/);
  });

  it('does not add the warning on a readable (unencrypted) store', async () => {
    encrypted = false;
    const { agentdbCausalEdge } = await import('../src/mcp-tools/agentdb-tools.js');
    const result = await agentdbCausalEdge.handler(edge) as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.readable).not.toBe(false);
    expect(result.warning ?? '').not.toMatch(/encrypted at rest/i);
  });

  it('k-hop names the encrypted store, not a generic unavailable backend', async () => {
    encrypted = true;
    const { agentdbGraphQuery } = await import('../src/mcp-tools/agentdb-tools.js');
    const result = await agentdbGraphQuery.handler({ nodeId: 'entity:router-account', mode: 'k-hop', depth: 2 }) as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(String(result.error)).toMatch(/encrypted at rest \(RFE1\)/);
    expect(String(result.error)).not.toMatch(/Retained SQL graph_edges backend is unavailable/);
  });
});
