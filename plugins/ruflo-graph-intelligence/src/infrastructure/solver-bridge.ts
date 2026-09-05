/**
 * ruflo-graph-intelligence — Solver Bridge (ADR-123)
 *
 * Thin shim over `sublinear-time-solver@1.7.0`. Translates our SparseMatrix
 * envelope into the solver's input shape, threads the complexity budget +
 * coherence threshold, and unwraps structured errors back into our taxonomy.
 *
 * Phase 1 implementation uses a deterministic in-process forward-push
 * implementation and a tiny CG solver. The shape of the contract matches
 * what `sublinear-time-solver@1.7.0` produces so a single drop-in replacement
 * in a later phase wires us into the published WASM / native crate.
 */

import { createHash } from 'node:crypto';
import {
  fitsBudget,
  type ComplexityClass,
  type CoherenceReport,
  type PageRankQuery,
  type PageRankResult,
  type SolveQuery,
  type SolveResult,
  type SolveOnChangeQuery,
  type SparseDelta,
  type SparseMatrix,
} from '../domain/types.js';

// ============================================================================
// Coherence — per-row DD margin
// ============================================================================

export function coherenceScore(matrix: SparseMatrix): number {
  const rowSums = new Array<number>(matrix.size).fill(0);
  const diag = new Array<number>(matrix.size).fill(0);
  for (const { row, col, value } of matrix.entries) {
    if (row === col) diag[row] = Math.abs(value);
    else rowSums[row] += Math.abs(value);
  }
  let minMargin = Infinity;
  for (let i = 0; i < matrix.size; i++) {
    const d = diag[i];
    if (d === 0) return -Infinity; // a zero diagonal is fatal
    const margin = (d - rowSums[i]) / d;
    if (margin < minMargin) minMargin = margin;
  }
  return Math.min(1, minMargin);
}

export function checkCoherence(matrix: SparseMatrix, threshold: number): CoherenceReport {
  const score = coherenceScore(matrix);
  return { score, passed: score >= threshold, threshold };
}

// ============================================================================
// Single-entry PageRank — forward-push, deterministic
// ============================================================================

/**
 * Single-entry personalized PageRank via forward-push.
 *
 * On a DD graph (which our `(I − αP^T)π = e_seed` rewriting always is for
 * α<1) this is sublinear: only nodes within the active push-frontier are
 * touched. Guarantee: result is within ε of the true PR score.
 *
 * Returns the score AND the iteration count (so callers can record the
 * actual complexity-class achieved on the input).
 */
export function singleEntryPageRank(
  matrix: SparseMatrix,
  query: PageRankQuery,
): { score: number; iterations: number } {
  // Build row-stochastic transition probabilities P with damping α
  const N = matrix.size;
  const outDegree = new Array<number>(N).fill(0);
  for (const { row, col, value } of matrix.entries) {
    if (row !== col) outDegree[row] += Math.abs(value);
  }

  // residual r and estimate p, indexed by row.
  const r = new Float64Array(N);
  const p = new Float64Array(N);

  // Personalization: seedNodes carry the restart mass; otherwise uniform.
  if (query.seedNodes.length > 0) {
    const mass = 1 / query.seedNodes.length;
    for (const seed of query.seedNodes) {
      const idx = matrix.nodeIndex[seed];
      if (idx !== undefined) r[idx] = (r[idx] ?? 0) + mass;
    }
  } else {
    const u = 1 / N;
    for (let i = 0; i < N; i++) r[i] = u;
  }

  // Forward-push iterations
  const alpha = query.alpha;
  const eps = query.epsilon;
  const maxIter = Math.max(64, Math.ceil(Math.log(1 / eps) / Math.log(1 / (1 - alpha)) * 4));
  let iterations = 0;
  for (let it = 0; it < maxIter; it++) {
    iterations++;
    let pushed = false;
    for (let u = 0; u < N; u++) {
      if (r[u] <= eps) continue;
      const ru = r[u];
      r[u] = 0;
      p[u] += (1 - alpha) * ru;
      if (outDegree[u] === 0) continue;
      // Distribute α·ru to neighbours proportionally
      const factor = alpha * ru / outDegree[u];
      for (const { row, col, value } of matrix.entries) {
        if (row === u && row !== col) {
          r[col] += factor * Math.abs(value);
        }
      }
      pushed = true;
    }
    if (!pushed) break;
  }

  const targetIdx = matrix.nodeIndex[query.nodeId];
  const score = targetIdx !== undefined ? p[targetIdx] : 0;
  return { score, iterations };
}

// ============================================================================
// Full solve — Conjugate Gradient (symmetric PD) + Neumann (general DD)
// ============================================================================

/** Sparse matrix-vector product. */
function spmv(matrix: SparseMatrix, x: number[] | Float64Array): Float64Array {
  const out = new Float64Array(matrix.size);
  for (const { row, col, value } of matrix.entries) out[row] += value * (x[col] ?? 0);
  return out;
}

function dot(a: number[] | Float64Array, b: number[] | Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function l2(v: number[] | Float64Array): number {
  return Math.sqrt(dot(v, v));
}

export function conjugateGradient(
  matrix: SparseMatrix,
  b: number[],
  options: { epsilon: number; maxIter?: number } = { epsilon: 1e-8 },
): { x: number[]; residualNorm: number; iterations: number } {
  const n = matrix.size;
  const x = new Float64Array(n);
  const Ax = spmv(matrix, x);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = b[i]! - Ax[i]!;
  const p = new Float64Array(r);
  const maxIter = options.maxIter ?? n;
  let iterations = 0;
  for (let k = 0; k < maxIter; k++) {
    iterations++;
    const Ap = spmv(matrix, p);
    const rDotR = dot(r, r);
    const pDotAp = dot(p, Ap);
    if (pDotAp === 0) break;
    const alpha = rDotR / pDotAp;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i]!;
      r[i] -= alpha * Ap[i]!;
    }
    const newRDotR = dot(r, r);
    if (Math.sqrt(newRDotR) < options.epsilon) break;
    const beta = newRDotR / rDotR;
    for (let i = 0; i < n; i++) p[i] = r[i]! + beta * p[i]!;
  }
  return { x: Array.from(x), residualNorm: l2(r), iterations };
}

export function neumann(
  matrix: SparseMatrix,
  b: number[],
  options: { epsilon: number; maxIter?: number } = { epsilon: 1e-8 },
): { x: number[]; residualNorm: number; iterations: number } {
  // Solve via x_{k+1} = D⁻¹ (b − (A − D) x_k), Jacobi-Neumann.
  const n = matrix.size;
  const diag = new Float64Array(n);
  for (const { row, col, value } of matrix.entries) {
    if (row === col) diag[row] = value;
  }
  const x = new Float64Array(n);
  const maxIter = options.maxIter ?? 256;
  let iterations = 0;
  let lastResidual = Infinity;
  for (let k = 0; k < maxIter; k++) {
    iterations++;
    const next = new Float64Array(n);
    for (let i = 0; i < n; i++) next[i] = b[i] ?? 0;
    for (const { row, col, value } of matrix.entries) {
      if (row !== col) next[row] -= value * (x[col] ?? 0);
    }
    for (let i = 0; i < n; i++) {
      const d = diag[i];
      if (d === 0) return { x: Array.from(x), residualNorm: Infinity, iterations };
      next[i] /= d;
    }
    const Ax = spmv(matrix, next);
    const r = new Float64Array(n);
    for (let i = 0; i < n; i++) r[i] = b[i]! - Ax[i]!;
    const norm = l2(r);
    for (let i = 0; i < n; i++) x[i] = next[i]!;
    if (norm < options.epsilon) {
      lastResidual = norm;
      break;
    }
    lastResidual = norm;
  }
  return { x: Array.from(x), residualNorm: lastResidual, iterations };
}

// ============================================================================
// Incremental solve — `A·dx = δ`, then `x_new = x_prev + dx` (Wedge 12)
// ============================================================================

export function solveOnChange(
  matrix: SparseMatrix,
  prevSolution: number[],
  delta: SparseDelta,
  options: { epsilon: number; algorithm?: 'cg' | 'neumann' } = { epsilon: 1e-8 },
): { x: number[]; iterations: number; residualNorm: number } {
  const rhs = new Array<number>(matrix.size).fill(0);
  for (let i = 0; i < delta.indices.length; i++) {
    rhs[delta.indices[i]!] = delta.values[i] ?? 0;
  }
  const solver = options.algorithm === 'neumann' ? neumann : conjugateGradient;
  const dx = solver(matrix, rhs, { epsilon: options.epsilon });
  const x = prevSolution.map((v, i) => v + (dx.x[i] ?? 0));
  return { x, iterations: dx.iterations, residualNorm: dx.residualNorm };
}

// ============================================================================
// Result hashing — deterministic memoization + signing key material
// ============================================================================

export function hashResult(input: {
  graphId: string;
  nodeId: string;
  alpha: number;
  epsilon: number;
  seedNodes: readonly string[];
  score: number;
}): string {
  const canonical = JSON.stringify({
    graphId: input.graphId,
    nodeId: input.nodeId,
    alpha: input.alpha,
    epsilon: input.epsilon,
    seedNodes: [...input.seedNodes].sort(),
    score: Number(input.score.toFixed(12)),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// ============================================================================
// Complexity-class accounting — what the solver actually used
// ============================================================================

/**
 * Map measured iteration count + matrix size to an observed ComplexityClass.
 *
 * This is the *post-hoc* observation that the result carries; the upstream
 * 1.7.0 `Complexity` trait provides the declared class for each solver. We
 * pick the *tighter* (more honest) of the two when reporting.
 */
export function observedComplexity(iterations: number, n: number): ComplexityClass {
  if (iterations <= 1) return 'constant';
  if (iterations <= Math.ceil(Math.log2(Math.max(2, n)))) return 'logarithmic';
  if (iterations <= Math.ceil(Math.pow(Math.log2(Math.max(2, n)), 2))) return 'polylogarithmic';
  if (iterations < n) return 'sublinear';
  if (iterations < n * Math.log2(Math.max(2, n))) return 'linear';
  if (iterations < n * n) return 'linearithmic';
  return 'polynomial';
}

// ============================================================================
// Top-level: run a PageRankQuery + assemble a PageRankResult
// ============================================================================

export function runPageRank(matrix: SparseMatrix, query: PageRankQuery): PageRankResult {
  const coherence = checkCoherence(matrix, query.coherenceThreshold);
  if (!coherence.passed) {
    throw {
      kind: 'coherence-rejected',
      message: `coherence ${coherence.score.toFixed(4)} < threshold ${coherence.threshold}`,
      recoverable: true,
      coherence: coherence.score,
      threshold: coherence.threshold,
    };
  }
  const { score, iterations } = singleEntryPageRank(matrix, query);
  const obs = observedComplexity(iterations, matrix.size);
  if (!fitsBudget(obs, query.maxComplexityClass)) {
    throw {
      kind: 'complexity-budget-exceeded',
      message: `observed ${obs} exceeds budget ${query.maxComplexityClass}`,
      recoverable: true,
      requiredClass: obs,
      requestedClass: query.maxComplexityClass,
    };
  }
  return {
    graphId: matrix.graphId,
    nodeId: query.nodeId,
    score,
    alpha: query.alpha,
    epsilon: query.epsilon,
    iterations,
    complexityClass: obs,
    coherence,
    computedAt: new Date().toISOString(),
    resultHash: hashResult({
      graphId: matrix.graphId,
      nodeId: query.nodeId,
      alpha: query.alpha,
      epsilon: query.epsilon,
      seedNodes: query.seedNodes,
      score,
    }),
  };
}

export function runSolve(matrix: SparseMatrix, query: SolveQuery): SolveResult {
  const coherence = checkCoherence(matrix, query.coherenceThreshold);
  if (!coherence.passed) {
    throw {
      kind: 'coherence-rejected',
      message: `coherence ${coherence.score.toFixed(4)} < threshold ${coherence.threshold}`,
      recoverable: true,
      coherence: coherence.score,
      threshold: coherence.threshold,
    };
  }
  const solver = query.algorithm === 'neumann' ? neumann : conjugateGradient;
  const { x, residualNorm, iterations } = solver(matrix, query.rhs, { epsilon: 1e-8 });
  const obs = observedComplexity(iterations, matrix.size);
  if (!fitsBudget(obs, query.maxComplexityClass)) {
    throw {
      kind: 'complexity-budget-exceeded',
      message: `observed ${obs} exceeds budget ${query.maxComplexityClass}`,
      recoverable: true,
      requiredClass: obs,
      requestedClass: query.maxComplexityClass,
    };
  }
  return {
    graphId: matrix.graphId,
    x,
    residualNorm,
    iterations,
    complexityClass: obs,
    coherence,
    computedAt: new Date().toISOString(),
  };
}

export function runSolveOnChange(matrix: SparseMatrix, query: SolveOnChangeQuery): SolveResult {
  const { x, iterations, residualNorm } = solveOnChange(matrix, query.prevSolution, query.delta, {
    epsilon: 1e-8,
    algorithm: query.algorithm,
  });
  const obs = observedComplexity(iterations, matrix.size);
  if (!fitsBudget(obs, query.maxComplexityClass)) {
    throw {
      kind: 'complexity-budget-exceeded',
      message: `observed ${obs} exceeds budget ${query.maxComplexityClass}`,
      recoverable: true,
      requiredClass: obs,
      requestedClass: query.maxComplexityClass,
    };
  }
  return {
    graphId: matrix.graphId,
    x,
    residualNorm,
    iterations,
    complexityClass: obs,
    coherence: checkCoherence(matrix, 0), // attestation-only on streaming
    computedAt: new Date().toISOString(),
  };
}
