/**
 * Portfolio Covariance Adapter (Wedge 8, ADR-123 Phase 5)
 *
 * `ruflo-neural-trader` does mean-variance optimisation: solve `Σ x = μ`
 * where `Σ` is the symmetric positive-definite asset-covariance matrix and
 * `μ` is the vector of expected returns. CG is the ideal target — upstream
 * 1.7.0 benchmarks: **816 ns at n=256, 40-60× faster than Neumann**.
 *
 * This adapter exports the covariance matrix as a SparseMatrix so callers
 * use `sublinear/solve` with `algorithm: 'cg'` and get the optimal weights.
 * Unlike the PageRank wedges, this graph IS symmetric (Σ = Σᵀ) and SPD by
 * construction.
 */

import { createHash } from 'node:crypto';
import type { SparseEntry, SparseMatrix } from '../domain/types.js';
import type { SublinearAdapter, AdapterRegistry } from '../domain/adapter.js';
import { getRegistry } from '../domain/adapter.js';

export interface CovarianceEntry {
  /** Asset symbol on the row side. */
  assetA: string;
  /** Asset symbol on the column side. */
  assetB: string;
  /** Covariance value. Σ[A,B] = Σ[B,A] by SPD construction. */
  covariance: number;
}

export interface PortfolioSource {
  /**
   * Dense or sparse covariance entries. Adapter symmetrises automatically
   * if only one of (A,B) or (B,A) is provided.
   */
  listCovarianceEntries(portfolioId: string): Promise<readonly CovarianceEntry[]>;
  /** Expected returns vector — same keys as covariance assets. */
  listExpectedReturns(portfolioId: string): Promise<Record<string, number>>;
}

export interface PortfolioAdapterOptions {
  source: PortfolioSource;
  portfolioId: string;
  /**
   * Ridge regularisation added to the diagonal to ensure SPD even when the
   * empirical covariance is rank-deficient. Default 1e-6.
   */
  ridge?: number;
}

export function portfolioGraphId(portfolioId: string): string {
  return `ruflo-neural-trader:covariance:${portfolioId}`;
}

export class PortfolioCovarianceAdapter implements SublinearAdapter {
  readonly graphId: string;
  readonly ownerPlugin = 'ruflo-neural-trader';
  readonly requiresPreprocessing = false;

  private readonly source: PortfolioSource;
  private readonly portfolioId: string;
  private readonly ridge: number;

  constructor(options: PortfolioAdapterOptions) {
    this.source = options.source;
    this.portfolioId = options.portfolioId;
    this.ridge = options.ridge ?? 1e-6;
    this.graphId = portfolioGraphId(this.portfolioId);
  }

  async exportAsSparseMatrix(options?: { nodeFilter?: ReadonlySet<string> }): Promise<SparseMatrix> {
    const covEntries = await this.source.listCovarianceEntries(this.portfolioId);
    const assetSet = new Set<string>();
    for (const e of covEntries) {
      assetSet.add(e.assetA);
      assetSet.add(e.assetB);
    }
    if (options?.nodeFilter) {
      for (const a of [...assetSet]) if (!options.nodeFilter.has(a)) assetSet.delete(a);
    }

    const assets = [...assetSet].sort();
    const nodeIndex: Record<string, number> = {};
    assets.forEach((a, i) => (nodeIndex[a] = i));

    // Symmetrise. If only Σ[A,B] is provided, also emit Σ[B,A] with the same value.
    const sym = new Map<string, number>();
    for (const e of covEntries) {
      const r = nodeIndex[e.assetA];
      const c = nodeIndex[e.assetB];
      if (r === undefined || c === undefined) continue;
      const k1 = `${r},${c}`;
      const k2 = `${c},${r}`;
      sym.set(k1, e.covariance);
      sym.set(k2, e.covariance);
    }
    const entries: SparseEntry[] = [];
    for (const [key, v] of sym) {
      const [rStr, cStr] = key.split(',');
      const r = Number(rStr);
      const c = Number(cStr);
      if (r === c) continue;
      entries.push({ row: r, col: c, value: v });
    }
    // Diagonal: existing variance value (if provided) PLUS ridge — keeps SPD
    // even when the empirical Σ is rank-deficient.
    for (let i = 0; i < assets.length; i++) {
      const provided = sym.get(`${i},${i}`) ?? 0;
      entries.push({ row: i, col: i, value: provided + this.ridge });
    }
    return {
      graphId: this.graphId,
      size: assets.length,
      entries,
      nodeIndex,
      indexNode: assets,
      capturedAt: new Date().toISOString(),
      contentHash: hashContent(this.graphId, entries),
    };
  }

  /** Fetch expected returns aligned with the matrix's node order. */
  async expectedReturnsVector(matrix: SparseMatrix): Promise<number[]> {
    const expected = await this.source.listExpectedReturns(this.portfolioId);
    return matrix.indexNode.map((a) => expected[a] ?? 0);
  }
}

export function registerPortfolioCovarianceAdapter(
  options: PortfolioAdapterOptions & { registry?: AdapterRegistry },
): PortfolioCovarianceAdapter {
  const adapter = new PortfolioCovarianceAdapter(options);
  (options.registry ?? getRegistry()).register(adapter);
  return adapter;
}

function hashContent(graphId: string, entries: readonly SparseEntry[]): string {
  const h = createHash('sha256');
  h.update(graphId);
  for (const e of entries) h.update(`|${e.row},${e.col},${e.value.toFixed(8)}`);
  return h.digest('hex');
}
