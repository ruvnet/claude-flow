/**
 * ruflo-graph-intelligence — Solver Bridge Tests (ADR-123 Phase 1)
 */

import { describe, it, expect } from 'vitest';
import {
  coherenceScore,
  checkCoherence,
  singleEntryPageRank,
  conjugateGradient,
  neumann,
  solveOnChange,
  observedComplexity,
  hashResult,
  runPageRank,
} from '../src/infrastructure/solver-bridge.js';
import { fitsBudget, isEdgeSafe, type SparseMatrix, type PageRankQuery } from '../src/domain/types.js';

/** Build a small DD matrix for tests. */
function ddMatrix(n: number): SparseMatrix {
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
  return {
    graphId: `test-dd-${n}`,
    size: n,
    entries,
    nodeIndex,
    indexNode,
    capturedAt: '2026-05-19T00:00:00Z',
  };
}

describe('coherence', () => {
  it('reports positive coherence for a clean DD matrix', () => {
    const m = ddMatrix(8);
    const score = coherenceScore(m);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('passes the gate when threshold is below score', () => {
    const m = ddMatrix(8);
    const r = checkCoherence(m, 0.1);
    expect(r.passed).toBe(true);
    expect(r.score).toBeGreaterThan(0.1);
  });

  it('rejects when threshold exceeds score', () => {
    const m = ddMatrix(8);
    const r = checkCoherence(m, 0.99);
    expect(r.passed).toBe(false);
  });

  it('reports −∞ for a zero-diagonal matrix', () => {
    const m: SparseMatrix = {
      graphId: 'singular',
      size: 2,
      entries: [{ row: 0, col: 1, value: 1 }],
      nodeIndex: { a: 0, b: 1 },
      indexNode: ['a', 'b'],
      capturedAt: 't',
    };
    expect(coherenceScore(m)).toBe(-Infinity);
  });
});

describe('complexity class budget', () => {
  it('logarithmic fits within linear', () => {
    expect(fitsBudget('logarithmic', 'linear')).toBe(true);
  });

  it('linearithmic does NOT fit within linear', () => {
    expect(fitsBudget('linearithmic', 'linear')).toBe(false);
  });

  it('polylogarithmic is edge-safe', () => {
    expect(isEdgeSafe('polylogarithmic')).toBe(true);
  });

  it('linear is NOT edge-safe', () => {
    expect(isEdgeSafe('linear')).toBe(false);
  });

  it('observedComplexity reports logarithmic when iterations ≤ log2(n)', () => {
    const obs = observedComplexity(3, 100);
    expect(['constant', 'logarithmic']).toContain(obs);
  });

  it('observedComplexity reports linear when iterations ≈ n', () => {
    expect(observedComplexity(100, 100)).toBe('linear');
  });
});

describe('singleEntryPageRank', () => {
  it('returns a non-negative score for a registered node', () => {
    const m = ddMatrix(10);
    const query: PageRankQuery = {
      graphId: m.graphId,
      nodeId: 'n5',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [],
      maxComplexityClass: 'linear',
      coherenceThreshold: 0,
    };
    const { score, iterations } = singleEntryPageRank(m, query);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(iterations).toBeGreaterThan(0);
  });

  it('returns 0 for an unknown node', () => {
    const m = ddMatrix(10);
    const { score } = singleEntryPageRank(m, {
      graphId: m.graphId,
      nodeId: 'absent',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [],
      maxComplexityClass: 'linear',
      coherenceThreshold: 0,
    });
    expect(score).toBe(0);
  });

  it('honours personalized seed nodes', () => {
    const m = ddMatrix(10);
    const seeded = singleEntryPageRank(m, {
      graphId: m.graphId,
      nodeId: 'n0',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: ['n0'],
      maxComplexityClass: 'linear',
      coherenceThreshold: 0,
    });
    const unseeded = singleEntryPageRank(m, {
      graphId: m.graphId,
      nodeId: 'n0',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [],
      maxComplexityClass: 'linear',
      coherenceThreshold: 0,
    });
    expect(seeded.score).toBeGreaterThan(unseeded.score);
  });
});

describe('conjugateGradient', () => {
  it('solves A·x = b on a DD system to residual < 1e-6', () => {
    const m = ddMatrix(8);
    const b = Array.from({ length: 8 }, () => 1);
    const { x, residualNorm, iterations } = conjugateGradient(m, b, { epsilon: 1e-8, maxIter: 50 });
    expect(x).toHaveLength(8);
    expect(residualNorm).toBeLessThan(1e-6);
    expect(iterations).toBeLessThan(50);
  });
});

describe('neumann', () => {
  it('converges on a DD system', () => {
    const m = ddMatrix(8);
    const b = Array.from({ length: 8 }, () => 1);
    const { residualNorm, iterations } = neumann(m, b, { epsilon: 1e-6, maxIter: 200 });
    expect(iterations).toBeLessThan(200);
    expect(residualNorm).toBeLessThan(1e-3);
  });
});

describe('solveOnChange', () => {
  it('produces x ≈ x_full when delta points at the same RHS', () => {
    const m = ddMatrix(8);
    const b = Array.from({ length: 8 }, () => 1);
    const baseline = conjugateGradient(m, b, { epsilon: 1e-8 });

    const prev = new Array<number>(8).fill(0);
    const delta = { indices: Array.from({ length: 8 }, (_, i) => i), values: b };
    const { x } = solveOnChange(m, prev, delta, { epsilon: 1e-8, algorithm: 'cg' });

    for (let i = 0; i < 8; i++) {
      expect(Math.abs(x[i]! - baseline.x[i]!)).toBeLessThan(1e-3);
    }
  });

  it('handles sparse delta (only one node updated)', () => {
    const m = ddMatrix(8);
    const prev = new Array<number>(8).fill(0.1);
    const delta = { indices: [3], values: [0.5] };
    const { x, iterations } = solveOnChange(m, prev, delta, { epsilon: 1e-8, algorithm: 'cg' });
    expect(iterations).toBeLessThan(50);
    expect(x).toHaveLength(8);
  });
});

describe('hashResult', () => {
  it('is deterministic for the same inputs', () => {
    const a = hashResult({ graphId: 'g', nodeId: 'n', alpha: 0.85, epsilon: 1e-3, seedNodes: [], score: 0.123 });
    const b = hashResult({ graphId: 'g', nodeId: 'n', alpha: 0.85, epsilon: 1e-3, seedNodes: [], score: 0.123 });
    expect(a).toBe(b);
  });

  it('differs when content differs', () => {
    const a = hashResult({ graphId: 'g', nodeId: 'n', alpha: 0.85, epsilon: 1e-3, seedNodes: [], score: 0.1 });
    const b = hashResult({ graphId: 'g', nodeId: 'n', alpha: 0.85, epsilon: 1e-3, seedNodes: [], score: 0.2 });
    expect(a).not.toBe(b);
  });

  it('treats seedNodes order as canonical', () => {
    const a = hashResult({ graphId: 'g', nodeId: 'n', alpha: 0.85, epsilon: 1e-3, seedNodes: ['a', 'b'], score: 0.1 });
    const b = hashResult({ graphId: 'g', nodeId: 'n', alpha: 0.85, epsilon: 1e-3, seedNodes: ['b', 'a'], score: 0.1 });
    expect(a).toBe(b);
  });
});

describe('runPageRank — error paths', () => {
  it('throws coherence-rejected when threshold not met', () => {
    const m = ddMatrix(8);
    expect(() =>
      runPageRank(m, {
        graphId: m.graphId,
        nodeId: 'n0',
        alpha: 0.85,
        epsilon: 1e-3,
        seedNodes: [],
        maxComplexityClass: 'linear',
        coherenceThreshold: 0.99,
      }),
    ).toThrow();
  });

  it('returns a populated result on the happy path', () => {
    const m = ddMatrix(8);
    const result = runPageRank(m, {
      graphId: m.graphId,
      nodeId: 'n3',
      alpha: 0.85,
      epsilon: 1e-3,
      seedNodes: [],
      maxComplexityClass: 'linear',
      coherenceThreshold: 0,
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.complexityClass).toBeDefined();
    expect(result.coherence.passed).toBe(true);
    expect(result.resultHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
