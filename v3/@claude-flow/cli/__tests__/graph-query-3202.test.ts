/** Regression for #3202: k-hop relation and depth must describe the executed query. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({
  available: vi.fn(async () => true),
  neighbors: vi.fn(async () => ['unfiltered-neighbor']),
  getBridgeDb: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('../src/ruvector/graph-backend.js', () => ({
  isGraphBackendAvailable: backend.available,
  getNeighbors: backend.neighbors,
}));
vi.mock('../src/memory/graph-edge-writer.js', () => ({ getBridgeDb: backend.getBridgeDb }));
vi.mock('../src/mcp-tools/validate-input.js', () => ({
  validateIdentifier: () => ({ valid: true }),
  validateText: (value: unknown) => value,
}));

import { agentdbGraphQuery } from '../src/mcp-tools/agentdb-tools.js';

type Result = {
  success: boolean;
  error?: string;
  unsupported?: string;
  depth?: number;
  appliedDepth?: number;
  truncated?: boolean;
  backend?: string;
  results?: Array<{ nodeId: string; depth?: number }>;
};

async function query(params: Record<string, unknown>): Promise<Result> {
  return agentdbGraphQuery.handler({ nodeId: 'start', mode: 'k-hop', ...params }) as Promise<Result>;
}

describe('#3202 graph k-hop execution contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backend.available.mockResolvedValue(true);
    backend.neighbors.mockResolvedValue(['unfiltered-neighbor']);
    backend.prepare.mockImplementation(() => ({ raw: () => ({ all: () => [['filtered-neighbor', 3]] }) }));
    backend.getBridgeDb.mockResolvedValue({ prepare: backend.prepare });
  });

  it('reads retained SQL even when the separate native graph is available', async () => {
    const result = await query({ depth: 5 });
    expect(backend.neighbors).not.toHaveBeenCalled();
    expect(backend.getBridgeDb).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, backend: 'sql-cte', depth: 5, appliedDepth: 3, truncated: true });
  });

  it('applies a relation filter to retained SQL regardless of native availability', async () => {
    const result = await query({ depth: 5, relation: 'depends-on' });
    expect(backend.neighbors).not.toHaveBeenCalled();
    expect(backend.getBridgeDb).toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, backend: 'sql-cte' });
    expect(backend.prepare.mock.calls[0][0]).toContain("e.relation = 'depends-on'");
  });

  it('filters on SQL when native graph is unavailable and discloses the depth-3 bound', async () => {
    backend.available.mockResolvedValue(false);
    const result = await query({ depth: 5, relation: 'depends-on' });
    expect(backend.neighbors).not.toHaveBeenCalled();
    expect(backend.prepare).toHaveBeenCalledTimes(1);
    const sql = backend.prepare.mock.calls[0][0] as string;
    expect(sql).toContain("e.relation = 'depends-on'");
    expect(sql).toContain('k.hop_depth < 3');
    expect(result).toMatchObject({
      success: true, backend: 'sql-cte', depth: 5, appliedDepth: 3, truncated: true,
      results: [{ nodeId: 'filtered-neighbor', depth: 3 }],
    });
  });

  it('does not claim a relation-filtered success when neither backend can answer', async () => {
    backend.available.mockResolvedValue(false);
    backend.getBridgeDb.mockResolvedValue(null);
    const result = await query({ relation: 'depends-on' });
    expect(backend.neighbors).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/retained SQL graph_edges/i);
  });

  it('discloses SQL depth truncation even without a relation filter', async () => {
    backend.available.mockResolvedValue(false);
    const result = await query({ depth: 5 });
    expect(result).toMatchObject({ success: true, backend: 'sql-cte', depth: 5, appliedDepth: 3, truncated: true });
  });

  it('reports no truncation when SQL runs the full requested depth', async () => {
    backend.available.mockResolvedValue(false);
    const result = await query({ depth: 2 });
    const sql = backend.prepare.mock.calls[0][0] as string;
    expect(sql).toContain('k.hop_depth < 2');
    expect(result).toMatchObject({ success: true, backend: 'sql-cte', depth: 2, appliedDepth: 2 });
    expect(result.truncated).not.toBe(true);
  });
});
