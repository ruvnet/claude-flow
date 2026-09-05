/**
 * ruflo-graph-intelligence — Domain Types (ADR-123)
 *
 * Core type contract: SparseMatrix shape, ComplexityClass budget, coherence
 * threshold, signed PR artifact envelope. These are the wire types every
 * adapter, MCP tool, and federation peer agrees on.
 */

import { z } from 'zod';

// ============================================================================
// SparseMatrix — the adapter handover shape
// ============================================================================

export const SparseEntrySchema = z.object({
  row: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
  value: z.number().finite(),
});
export type SparseEntry = z.infer<typeof SparseEntrySchema>;

export const SparseMatrixSchema = z.object({
  /** Stable identifier — e.g. "ruflo-federation:trust-mesh:2026-05-19T01:00:00Z". */
  graphId: z.string().min(1),
  /** Number of rows / columns (square). */
  size: z.number().int().positive(),
  /** Non-zero entries. */
  entries: z.array(SparseEntrySchema),
  /** Node-id → row-index lookup so callers can talk in domain identifiers. */
  nodeIndex: z.record(z.number().int().nonnegative()),
  /** Reverse lookup row-index → node-id. */
  indexNode: z.array(z.string()),
  /** When the snapshot was taken (ISO). */
  capturedAt: z.string(),
  /** Optional content hash for memoization + signed-artifact integrity. */
  contentHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});
export type SparseMatrix = z.infer<typeof SparseMatrixSchema>;

// ============================================================================
// Complexity class — runtime governance budget
// ============================================================================

/**
 * 12-tier upstream `sublinear-time-solver@1.7.0` taxonomy. Ordered.
 * Lower-cost classes are at the top; Adaptive wraps a (default, worst) pair.
 */
export const ComplexityClassSchema = z.enum([
  'constant',         // O(1)
  'logarithmic',      // O(log n)
  'polylogarithmic',  // O((log n)^k)
  'sublinear',        // O(n^α) for α < 1
  'linear',           // O(n)
  'linearithmic',     // O(n log n)
  'polynomial',       // O(n^k)
  'exponential',      // O(2^n)
  'doubleExponential',// O(2^(2^n))
  'adaptive',         // see adaptiveBound
  'unknown',
  'unbounded',
]);
export type ComplexityClass = z.infer<typeof ComplexityClassSchema>;

/** For Adaptive: default + worst-case both reported. */
export interface AdaptiveBound {
  default: ComplexityClass;
  worst: ComplexityClass;
}

/** Ordering — index = cost rank, so `rank('logarithmic') < rank('linear')`. */
const COMPLEXITY_RANK: Record<ComplexityClass, number> = {
  constant: 0,
  logarithmic: 1,
  polylogarithmic: 2,
  sublinear: 3,
  linear: 4,
  linearithmic: 5,
  polynomial: 6,
  exponential: 7,
  doubleExponential: 8,
  adaptive: 4, // worst-case treated as Linear for budget comparisons by default
  unknown: 8,
  unbounded: 9,
};

/** Is `actual` within `budget`? */
export function fitsBudget(actual: ComplexityClass, budget: ComplexityClass): boolean {
  return COMPLEXITY_RANK[actual] <= COMPLEXITY_RANK[budget];
}

/** Pi-Zero-safe ≈ at most polylogarithmic. */
export function isEdgeSafe(c: ComplexityClass): boolean {
  return COMPLEXITY_RANK[c] <= COMPLEXITY_RANK['polylogarithmic'];
}

// ============================================================================
// Coherence — DD margin for graph stability monitoring
// ============================================================================

export const CoherenceReportSchema = z.object({
  /** Per-row margin (min over rows of (|diag| − Σ|off|) / |diag|). Range (−∞, 1]. */
  score: z.number(),
  /** Did the matrix pass the configured threshold? */
  passed: z.boolean(),
  /** Threshold used. 0 = gate disabled (wire-compatible default). */
  threshold: z.number(),
});
export type CoherenceReport = z.infer<typeof CoherenceReportSchema>;

// ============================================================================
// PageRank query + result
// ============================================================================

export const PageRankQuerySchema = z.object({
  graphId: z.string(),
  /** Single-entry query — the node we want the PR score for. */
  nodeId: z.string(),
  /** Damping factor. Default 0.85. */
  alpha: z.number().positive().lt(1).default(0.85),
  /** ε convergence target. Default 1e-3. */
  epsilon: z.number().positive().default(1e-3),
  /** For personalized PR — seed nodes weighted as the restart distribution. */
  seedNodes: z.array(z.string()).default([]),
  /** Budget gate. Default `linear` (tier-2-safe). */
  maxComplexityClass: ComplexityClassSchema.default('linear'),
  /** DD-margin floor. 0 = disabled. */
  coherenceThreshold: z.number().default(0),
});
export type PageRankQuery = z.infer<typeof PageRankQuerySchema>;

export const PageRankResultSchema = z.object({
  graphId: z.string(),
  nodeId: z.string(),
  score: z.number(),
  alpha: z.number(),
  epsilon: z.number(),
  iterations: z.number().int().nonnegative(),
  /** Class the solver actually used. */
  complexityClass: ComplexityClassSchema,
  /** Coherence report attached at compute time. */
  coherence: CoherenceReportSchema,
  computedAt: z.string(),
  /** Hash of (graphId, nodeId, alpha, epsilon, seedNodes, score). Stable for memoization. */
  resultHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PageRankResult = z.infer<typeof PageRankResultSchema>;

// ============================================================================
// Solve (full vector)
// ============================================================================

export const SolveQuerySchema = z.object({
  graphId: z.string(),
  rhs: z.array(z.number()),
  algorithm: z.enum(['cg', 'neumann', 'random-walk']).default('cg'),
  maxComplexityClass: ComplexityClassSchema.default('linear'),
  coherenceThreshold: z.number().default(0),
});
export type SolveQuery = z.infer<typeof SolveQuerySchema>;

export const SolveResultSchema = z.object({
  graphId: z.string(),
  x: z.array(z.number()),
  residualNorm: z.number(),
  iterations: z.number().int().nonnegative(),
  complexityClass: ComplexityClassSchema,
  coherence: CoherenceReportSchema,
  computedAt: z.string(),
});
export type SolveResult = z.infer<typeof SolveResultSchema>;

// ============================================================================
// Incremental solve (Wedge 12 — streaming)
// ============================================================================

export const SparseDeltaSchema = z.object({
  indices: z.array(z.number().int().nonnegative()),
  values: z.array(z.number()),
});
export type SparseDelta = z.infer<typeof SparseDeltaSchema>;

export const SolveOnChangeQuerySchema = z.object({
  graphId: z.string(),
  prevSolution: z.array(z.number()),
  delta: SparseDeltaSchema,
  algorithm: z.enum(['cg', 'neumann']).default('cg'),
  maxComplexityClass: ComplexityClassSchema.default('linear'),
});
export type SolveOnChangeQuery = z.infer<typeof SolveOnChangeQuerySchema>;

// ============================================================================
// Structured errors
// ============================================================================

export const GraphIntelErrorKindSchema = z.enum([
  'complexity-budget-exceeded',
  'coherence-rejected',
  'graph-not-found',
  'invalid-input',
  'solver-failed',
  'not-applicable',
]);
export type GraphIntelErrorKind = z.infer<typeof GraphIntelErrorKindSchema>;

export interface GraphIntelError {
  kind: GraphIntelErrorKind;
  message: string;
  recoverable: boolean;
  /** If `complexity-budget-exceeded`: what class was needed vs requested. */
  requiredClass?: ComplexityClass;
  requestedClass?: ComplexityClass;
  /** If `coherence-rejected`: actual vs threshold. */
  coherence?: number;
  threshold?: number;
}
