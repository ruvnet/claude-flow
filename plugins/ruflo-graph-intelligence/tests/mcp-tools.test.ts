/**
 * ruflo-graph-intelligence — MCP Tool Tests (ADR-123 Phase 1)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { graphIntelligenceTools } from '../src/mcp-tools/index.js';
import { getRegistry, resetRegistry } from '../src/domain/adapter.js';
import type { SublinearAdapter } from '../src/domain/adapter.js';
import type { SparseMatrix } from '../src/domain/types.js';

function ddTestAdapter(): SublinearAdapter {
  return {
    graphId: 'test:dd',
    ownerPlugin: 'test',
    async exportAsSparseMatrix(): Promise<SparseMatrix> {
      const entries = [];
      const nodeIndex: Record<string, number> = {};
      const indexNode: string[] = [];
      const n = 6;
      for (let i = 0; i < n; i++) {
        nodeIndex[`n${i}`] = i;
        indexNode.push(`n${i}`);
        entries.push({ row: i, col: i, value: 5 });
        if (i > 0) entries.push({ row: i, col: i - 1, value: -1 });
        if (i < n - 1) entries.push({ row: i, col: i + 1, value: -1 });
      }
      return {
        graphId: 'test:dd',
        size: n,
        entries,
        nodeIndex,
        indexNode,
        capturedAt: 't',
      };
    },
  };
}

function findTool(name: string) {
  const tool = graphIntelligenceTools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

describe('MCP tools — surface', () => {
  it('exports six tools under sublinear/*', () => {
    const names = graphIntelligenceTools.map((t) => t.name);
    expect(names).toEqual([
      'sublinear/page-rank-entry',
      'sublinear/solve',
      'sublinear/solve-on-change',
      'sublinear/analyze',
      'sublinear/feasibility',
      'sublinear/jl-embed',
    ]);
  });

  it('each tool has an input schema with type:object', () => {
    for (const t of graphIntelligenceTools) {
      expect(t.inputSchema.type).toBe('object');
    }
  });
});

describe('sublinear/page-rank-entry', () => {
  beforeEach(() => {
    resetRegistry();
    getRegistry().register(ddTestAdapter());
  });

  it('returns a result on the happy path', async () => {
    const tool = findTool('sublinear/page-rank-entry');
    // Phase 1 forward-push is a reference impl — observed iterations on small DD
    // matrices may exceed the `linear` default budget. Use `polynomial` here to
    // exercise the happy path; the budget-exceeded path has its own dedicated test.
    const r = (await tool.handler({
      graphId: 'test:dd',
      nodeId: 'n3',
      maxComplexityClass: 'polynomial',
    })) as { success: boolean; result?: unknown };
    expect(r.success).toBe(true);
    expect(r.result).toBeDefined();
  });

  it('returns complexity-budget-exceeded when budget is too tight', async () => {
    const tool = findTool('sublinear/page-rank-entry');
    const r = (await tool.handler({
      graphId: 'test:dd',
      nodeId: 'n3',
      maxComplexityClass: 'constant',
    })) as { success: boolean; error?: { kind: string } };
    expect(r.success).toBe(false);
    expect(r.error?.kind).toBe('complexity-budget-exceeded');
  });

  it('returns graph-not-found for an unknown graphId', async () => {
    const tool = findTool('sublinear/page-rank-entry');
    const r = (await tool.handler({ graphId: 'missing', nodeId: 'n0' })) as { success: boolean; error?: { kind: string } };
    expect(r.success).toBe(false);
    expect(r.error?.kind).toBe('graph-not-found');
  });

  it('returns coherence-rejected when threshold not met', async () => {
    const tool = findTool('sublinear/page-rank-entry');
    const r = (await tool.handler({
      graphId: 'test:dd',
      nodeId: 'n0',
      coherenceThreshold: 0.99,
    })) as { success: boolean; error?: { kind: string } };
    expect(r.success).toBe(false);
    expect(r.error?.kind).toBe('coherence-rejected');
  });
});

describe('sublinear/analyze', () => {
  beforeEach(() => {
    resetRegistry();
    getRegistry().register(ddTestAdapter());
  });

  it('reports coherence + recommended algorithm', async () => {
    const tool = findTool('sublinear/analyze');
    const r = (await tool.handler({ graphId: 'test:dd' })) as { success: boolean; result?: Record<string, unknown> };
    expect(r.success).toBe(true);
    expect(r.result?.size).toBe(6);
    expect(r.result?.coherenceScore).toBeGreaterThan(0);
    expect(r.result?.recommendedAlgorithm).toBeDefined();
  });
});

describe('sublinear/solve', () => {
  beforeEach(() => {
    resetRegistry();
    getRegistry().register(ddTestAdapter());
  });

  it('solves A·x = b with CG', async () => {
    const tool = findTool('sublinear/solve');
    const r = (await tool.handler({
      graphId: 'test:dd',
      rhs: [1, 1, 1, 1, 1, 1],
      algorithm: 'cg',
      maxComplexityClass: 'polynomial',
    })) as { success: boolean; result?: { x: number[]; residualNorm: number } };
    expect(r.success).toBe(true);
    expect(r.result?.x).toHaveLength(6);
    expect(r.result?.residualNorm).toBeLessThan(1e-3);
  });
});

describe('sublinear/solve-on-change', () => {
  beforeEach(() => {
    resetRegistry();
    getRegistry().register(ddTestAdapter());
  });

  it('handles a single-node delta', async () => {
    const tool = findTool('sublinear/solve-on-change');
    const r = (await tool.handler({
      graphId: 'test:dd',
      prevSolution: [0, 0, 0, 0, 0, 0],
      delta: { indices: [2], values: [0.5] },
      algorithm: 'cg',
      maxComplexityClass: 'polynomial',
    })) as { success: boolean; result?: { x: number[] } };
    expect(r.success).toBe(true);
    expect(r.result?.x).toHaveLength(6);
  });
});
