/**
 * Streaming Bridge — Wedge 12 (ADR-123 Phase 6.5)
 *
 * Couples a registered SublinearAdapter with `solve_on_change` so event-driven
 * graphs (federation trust deltas, span streams, append-only causal breaks,
 * cost spend events, AIDefence flag updates) pay only `O(nnz(delta) · log N)`
 * per event rather than recomputing the full vector each tick.
 *
 * The bridge maintains the *previous solution* in memory; every push call
 * applies the delta and returns the updated solution. It also exposes a
 * `crossoverHeuristic()` that decides whether the cheap delta path is
 * actually cheaper than a full re-solve given the current density.
 */

import type { SublinearAdapter } from '../domain/adapter.js';
import type { ComplexityClass, SparseDelta, SparseMatrix } from '../domain/types.js';
import { runSolveOnChange, runSolve } from '../infrastructure/solver-bridge.js';

export interface StreamingBridgeOptions {
  adapter: SublinearAdapter;
  /** Initial b vector for the base full-solve. */
  initialRhs: number[];
  algorithm?: 'cg' | 'neumann';
  maxComplexityClass?: ComplexityClass;
  /**
   * Crossover threshold: prefer `solve_on_change` when
   * `nnz(delta) / nnz(matrix) < deltaRatioThreshold`. Default 0.05.
   */
  deltaRatioThreshold?: number;
  /** Force full re-solve after N delta updates regardless. Default 50. */
  refreshEvery?: number;
}

export interface StreamingUpdate {
  x: number[];
  residualNorm: number;
  iterations: number;
  /** How this update was computed — informational. */
  mode: 'delta' | 'full-resolve' | 'cold-start';
  deltaNnz?: number;
  appliedAt: string;
}

export class StreamingBridge {
  private readonly adapter: SublinearAdapter;
  private readonly initialRhs: number[];
  private readonly algorithm: 'cg' | 'neumann';
  private readonly maxComplexityClass: ComplexityClass;
  private readonly deltaRatioThreshold: number;
  private readonly refreshEvery: number;

  private prevSolution: number[] | undefined;
  private deltaCount = 0;
  private cachedMatrix: SparseMatrix | undefined;

  constructor(options: StreamingBridgeOptions) {
    this.adapter = options.adapter;
    this.initialRhs = options.initialRhs;
    this.algorithm = options.algorithm ?? 'cg';
    this.maxComplexityClass = options.maxComplexityClass ?? 'polynomial';
    this.deltaRatioThreshold = options.deltaRatioThreshold ?? 0.05;
    this.refreshEvery = options.refreshEvery ?? 50;
  }

  /** Force a fresh full re-solve and reset the streaming state. */
  async coldStart(): Promise<StreamingUpdate> {
    const matrix = await this.adapter.exportAsSparseMatrix();
    this.cachedMatrix = matrix;
    const result = runSolve(matrix, {
      graphId: matrix.graphId,
      rhs: this.initialRhs,
      algorithm: this.algorithm,
      maxComplexityClass: this.maxComplexityClass,
      coherenceThreshold: 0,
    });
    this.prevSolution = result.x;
    this.deltaCount = 0;
    return {
      x: result.x,
      residualNorm: result.residualNorm,
      iterations: result.iterations,
      mode: 'cold-start',
      appliedAt: new Date().toISOString(),
    };
  }

  /**
   * Apply a delta event. The bridge picks `solve_on_change` if the delta is
   * sparse enough; otherwise it falls back to a full re-solve.
   */
  async pushDelta(delta: SparseDelta): Promise<StreamingUpdate> {
    if (!this.prevSolution || !this.cachedMatrix) {
      await this.coldStart();
    }
    // Refresh-cap forces a clean re-solve to bound drift error
    if (this.deltaCount >= this.refreshEvery) {
      return this.coldStart().then((u) => ({ ...u, mode: 'full-resolve' as const }));
    }

    const matrix = this.cachedMatrix!;
    const deltaRatio = delta.indices.length / Math.max(1, matrix.entries.length);
    if (deltaRatio >= this.deltaRatioThreshold) {
      // Too dense — full re-solve is cheaper than delta-and-correct
      return this.coldStart().then((u) => ({ ...u, mode: 'full-resolve' as const }));
    }

    const result = runSolveOnChange(matrix, {
      graphId: matrix.graphId,
      prevSolution: this.prevSolution!,
      delta,
      algorithm: this.algorithm,
      maxComplexityClass: this.maxComplexityClass,
    });
    this.prevSolution = result.x;
    this.deltaCount++;
    return {
      x: result.x,
      residualNorm: result.residualNorm,
      iterations: result.iterations,
      mode: 'delta',
      deltaNnz: delta.indices.length,
      appliedAt: new Date().toISOString(),
    };
  }

  /** Best-effort current solution snapshot. */
  getCurrentSolution(): readonly number[] | undefined {
    return this.prevSolution;
  }

  /** Reset cached state (e.g. after the underlying graph re-grew). */
  reset(): void {
    this.prevSolution = undefined;
    this.cachedMatrix = undefined;
    this.deltaCount = 0;
  }
}
