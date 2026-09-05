/**
 * Phase 5 Tests — Portfolio Covariance Adapter (Wedge 8)
 *
 * Acceptance:
 *  - Covariance matrix is symmetric after symmetrisation
 *  - Σx = μ solved via CG to small residual
 *  - Ridge keeps Σ SPD even when the empirical covariance is rank-1
 *  - End-to-end via sublinear/solve
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PortfolioCovarianceAdapter,
  portfolioGraphId,
  registerPortfolioCovarianceAdapter,
} from '../src/adapters/portfolio-cg-adapter.js';
import { resetRegistry, getRegistry } from '../src/domain/adapter.js';
import { conjugateGradient } from '../src/infrastructure/solver-bridge.js';
import { graphIntelligenceTools } from '../src/mcp-tools/index.js';

describe('PortfolioCovarianceAdapter', () => {
  beforeEach(() => resetRegistry());

  it('symmetrises one-sided covariance entries', async () => {
    const adapter = new PortfolioCovarianceAdapter({
      portfolioId: 'p1',
      source: {
        async listCovarianceEntries() {
          return [
            { assetA: 'AAPL', assetB: 'AAPL', covariance: 0.04 },
            { assetA: 'GOOG', assetB: 'GOOG', covariance: 0.05 },
            { assetA: 'AAPL', assetB: 'GOOG', covariance: 0.01 }, // only one side
          ];
        },
        async listExpectedReturns() { return { AAPL: 0.08, GOOG: 0.09 }; },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    const aIdx = m.nodeIndex['AAPL'];
    const gIdx = m.nodeIndex['GOOG'];
    const ag = m.entries.find((e) => e.row === aIdx && e.col === gIdx);
    const ga = m.entries.find((e) => e.row === gIdx && e.col === aIdx);
    expect(ag?.value).toBeCloseTo(0.01, 6);
    expect(ga?.value).toBeCloseTo(0.01, 6);
  });

  it('CG solves Σx = μ to small residual', async () => {
    const adapter = new PortfolioCovarianceAdapter({
      portfolioId: 'p1',
      ridge: 1e-3,
      source: {
        async listCovarianceEntries() {
          return [
            { assetA: 'AAPL', assetB: 'AAPL', covariance: 0.04 },
            { assetA: 'GOOG', assetB: 'GOOG', covariance: 0.05 },
            { assetA: 'MSFT', assetB: 'MSFT', covariance: 0.03 },
            { assetA: 'AAPL', assetB: 'GOOG', covariance: 0.015 },
            { assetA: 'AAPL', assetB: 'MSFT', covariance: 0.018 },
            { assetA: 'GOOG', assetB: 'MSFT', covariance: 0.020 },
          ];
        },
        async listExpectedReturns() { return { AAPL: 0.08, GOOG: 0.09, MSFT: 0.07 }; },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    const mu = await adapter.expectedReturnsVector(m);
    const { x, residualNorm, iterations } = conjugateGradient(m, mu, { epsilon: 1e-8, maxIter: 50 });
    expect(x).toHaveLength(3);
    expect(residualNorm).toBeLessThan(1e-6);
    expect(iterations).toBeLessThan(20);
  });

  it('ridge keeps a rank-deficient matrix solvable', async () => {
    // Two perfectly-correlated assets — empirical Σ is rank 1
    const adapter = new PortfolioCovarianceAdapter({
      portfolioId: 'p-corr',
      ridge: 1e-3,
      source: {
        async listCovarianceEntries() {
          return [
            { assetA: 'X', assetB: 'X', covariance: 0.01 },
            { assetA: 'Y', assetB: 'Y', covariance: 0.01 },
            { assetA: 'X', assetB: 'Y', covariance: 0.01 },
          ];
        },
        async listExpectedReturns() { return { X: 0.1, Y: 0.1 }; },
      },
    });
    const m = await adapter.exportAsSparseMatrix();
    const mu = await adapter.expectedReturnsVector(m);
    const { residualNorm } = conjugateGradient(m, mu, { epsilon: 1e-6, maxIter: 100 });
    expect(residualNorm).toBeLessThan(1e-4);
  });

  it('end-to-end via sublinear/solve', async () => {
    const registry = getRegistry();
    registerPortfolioCovarianceAdapter({
      portfolioId: 'p2',
      source: {
        async listCovarianceEntries() {
          return [
            { assetA: 'A', assetB: 'A', covariance: 0.04 },
            { assetA: 'B', assetB: 'B', covariance: 0.05 },
            { assetA: 'A', assetB: 'B', covariance: 0.01 },
          ];
        },
        async listExpectedReturns() { return { A: 0.1, B: 0.12 }; },
      },
      registry,
    });
    const tool = graphIntelligenceTools.find((t) => t.name === 'sublinear/solve');
    const r = (await tool!.handler({
      graphId: portfolioGraphId('p2'),
      rhs: [0.1, 0.12],
      algorithm: 'cg',
      maxComplexityClass: 'polynomial',
    })) as { success: boolean; result?: { x: number[]; residualNorm: number } };
    expect(r.success).toBe(true);
    expect(r.result?.x).toHaveLength(2);
    expect(r.result?.residualNorm).toBeLessThan(1e-4);
  });
});
