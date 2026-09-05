/**
 * Phase 6.5 Tests — Streaming Bridge (Wedge 12)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StreamingBridge } from '../src/application/streaming-bridge.js';
import { resetRegistry, getRegistry, type SublinearAdapter } from '../src/domain/adapter.js';
import type { SparseEntry, SparseMatrix } from '../src/domain/types.js';

function staticDdAdapter(n: number, graphId = 'streaming:test'): SublinearAdapter {
  const entries: SparseEntry[] = [];
  const nodeIndex: Record<string, number> = {};
  const indexNode: string[] = [];
  for (let i = 0; i < n; i++) {
    nodeIndex[`n${i}`] = i;
    indexNode.push(`n${i}`);
    entries.push({ row: i, col: i, value: 5 });
    if (i > 0) entries.push({ row: i, col: i - 1, value: -1 });
    if (i < n - 1) entries.push({ row: i, col: i + 1, value: -1 });
  }
  const matrix: SparseMatrix = {
    graphId,
    size: n,
    entries,
    nodeIndex,
    indexNode,
    capturedAt: '2026-05-19T00:00:00Z',
  };
  return {
    graphId,
    ownerPlugin: 'test',
    async exportAsSparseMatrix() {
      return matrix;
    },
  };
}

describe('StreamingBridge', () => {
  beforeEach(() => resetRegistry());

  it('cold-start produces a full-solve baseline', async () => {
    const adapter = staticDdAdapter(8);
    const bridge = new StreamingBridge({
      adapter,
      initialRhs: Array.from({ length: 8 }, () => 1),
      algorithm: 'cg',
      maxComplexityClass: 'polynomial',
    });
    const u = await bridge.coldStart();
    expect(u.mode).toBe('cold-start');
    expect(u.x).toHaveLength(8);
    expect(u.residualNorm).toBeLessThan(1e-3);
  });

  it('applies a sparse delta via solve_on_change', async () => {
    const adapter = staticDdAdapter(8);
    const bridge = new StreamingBridge({
      adapter,
      initialRhs: Array.from({ length: 8 }, () => 1),
      algorithm: 'cg',
      maxComplexityClass: 'polynomial',
      deltaRatioThreshold: 0.5, // generous so single-element delta uses solve_on_change
    });
    await bridge.coldStart();
    const u = await bridge.pushDelta({ indices: [3], values: [0.5] });
    expect(u.mode).toBe('delta');
    expect(u.deltaNnz).toBe(1);
    expect(u.x).toHaveLength(8);
  });

  it('falls back to full re-solve when delta ratio exceeds threshold', async () => {
    const adapter = staticDdAdapter(4);
    const bridge = new StreamingBridge({
      adapter,
      initialRhs: [1, 1, 1, 1],
      algorithm: 'cg',
      maxComplexityClass: 'polynomial',
      deltaRatioThreshold: 0.1, // very strict
    });
    await bridge.coldStart();
    const u = await bridge.pushDelta({
      indices: [0, 1, 2, 3],
      values: [0.1, 0.1, 0.1, 0.1],
    });
    expect(u.mode).toBe('full-resolve');
  });

  it('refresh-cap forces full re-solve after N deltas', async () => {
    const adapter = staticDdAdapter(8);
    const bridge = new StreamingBridge({
      adapter,
      initialRhs: Array.from({ length: 8 }, () => 1),
      algorithm: 'cg',
      maxComplexityClass: 'polynomial',
      deltaRatioThreshold: 0.5,
      refreshEvery: 3,
    });
    await bridge.coldStart();
    // 3 deltas → 4th should be full-resolve via refresh cap
    for (let i = 0; i < 3; i++) {
      await bridge.pushDelta({ indices: [i], values: [0.1] });
    }
    const u = await bridge.pushDelta({ indices: [4], values: [0.1] });
    expect(u.mode).toBe('full-resolve');
  });

  it('getCurrentSolution returns the latest known x', async () => {
    const adapter = staticDdAdapter(8);
    const bridge = new StreamingBridge({
      adapter,
      initialRhs: Array.from({ length: 8 }, () => 1),
      algorithm: 'cg',
      maxComplexityClass: 'polynomial',
    });
    await bridge.coldStart();
    expect(bridge.getCurrentSolution()).toBeDefined();
    expect(bridge.getCurrentSolution()).toHaveLength(8);
  });

  it('reset clears cached state', async () => {
    const adapter = staticDdAdapter(8);
    const bridge = new StreamingBridge({
      adapter,
      initialRhs: Array.from({ length: 8 }, () => 1),
      algorithm: 'cg',
      maxComplexityClass: 'polynomial',
    });
    await bridge.coldStart();
    bridge.reset();
    expect(bridge.getCurrentSolution()).toBeUndefined();
    // After reset, a delta push should cold-start first
    const u = await bridge.pushDelta({ indices: [3], values: [0.5] });
    expect(u).toBeDefined();
  });
});
