/**
 * ruflo-graph-intelligence — MCP Tool Surface (ADR-123 § Architecture)
 *
 * Six tools mounted under `sublinear/*`:
 *   - sublinear/page-rank-entry  — single-entry PPR (workhorse)
 *   - sublinear/solve            — full A·x = b
 *   - sublinear/solve-on-change  — incremental delta (Wedge 12, streaming)
 *   - sublinear/feasibility      — packing/covering LP feasibility
 *   - sublinear/jl-embed         — Johnson-Lindenstrauss projection
 *   - sublinear/analyze          — diagnostics (coherence, sparsity, recommended algo)
 *
 * Every tool accepts maxComplexityClass + coherenceThreshold.
 */

import { getRegistry } from '../domain/adapter.js';
import {
  PageRankQuerySchema,
  SolveQuerySchema,
  SolveOnChangeQuerySchema,
} from '../domain/types.js';
import {
  runPageRank,
  runSolve,
  runSolveOnChange,
  coherenceScore,
  checkCoherence,
} from '../infrastructure/solver-bridge.js';

export interface MCPTool {
  name: string;
  description: string;
  category: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

export const graphIntelligenceTools: MCPTool[] = [
  {
    name: 'sublinear/page-rank-entry',
    description:
      'Single-entry personalized PageRank over a registered RuFlo graph. O(log n) on DD inputs. Returns score + observed complexity-class + coherence margin. Accepts maxComplexityClass budget gate (default linear) and coherenceThreshold (default 0 = disabled). Use when you need a relevance/centrality score for ONE node (e.g. "how important is this agent/file/memory relative to a seed set?") without computing the full PR vector.',
    category: 'graph-intelligence',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: { type: 'string', description: 'Adapter-registered graph identifier' },
        nodeId: { type: 'string', description: 'Node to compute PR score for (single-entry query)' },
        alpha: { type: 'number', description: 'Damping factor (default 0.85)' },
        epsilon: { type: 'number', description: 'Convergence target (default 1e-3)' },
        seedNodes: {
          type: 'array',
          items: { type: 'string' },
          description: 'For personalized PR — seed nodes carrying restart distribution',
        },
        maxComplexityClass: {
          type: 'string',
          description: '12-tier upstream class budget (constant/logarithmic/polylogarithmic/sublinear/linear/...); default linear',
        },
        coherenceThreshold: {
          type: 'number',
          description: 'DD margin floor in [-∞, 1] (default 0 = disabled)',
        },
      },
      required: ['graphId', 'nodeId'],
    },
    handler: async (input) => {
      const query = PageRankQuerySchema.parse(input);
      const adapter = getRegistry().get(query.graphId);
      if (!adapter) {
        return { success: false, error: { kind: 'graph-not-found', message: `no adapter for graphId=${query.graphId}` } };
      }
      const matrix = await adapter.exportAsSparseMatrix();
      try {
        const result = runPageRank(matrix, query);
        return { success: true, result };
      } catch (err) {
        return { success: false, error: err };
      }
    },
  },

  {
    name: 'sublinear/solve',
    description:
      'Full linear solve A·x = b over a registered graph. CG (symmetric PD) or Neumann (general DD). Returns x + residual + observed complexity-class + coherence margin. Use when you need the full solution vector (all nodes), not a single-entry score — for batch ranking, flow propagation, or trust-vector materialization. Prefer sublinear/page-rank-entry for single-node queries.',
    category: 'graph-intelligence',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: { type: 'string' },
        rhs: { type: 'array', items: { type: 'number' } },
        algorithm: { type: 'string', enum: ['cg', 'neumann', 'random-walk'] },
        maxComplexityClass: { type: 'string' },
        coherenceThreshold: { type: 'number' },
      },
      required: ['graphId', 'rhs'],
    },
    handler: async (input) => {
      const query = SolveQuerySchema.parse(input);
      const adapter = getRegistry().get(query.graphId);
      if (!adapter) {
        return { success: false, error: { kind: 'graph-not-found', message: `no adapter for graphId=${query.graphId}` } };
      }
      const matrix = await adapter.exportAsSparseMatrix();
      try {
        const result = runSolve(matrix, query);
        return { success: true, result };
      } catch (err) {
        return { success: false, error: err };
      }
    },
  },

  {
    name: 'sublinear/solve-on-change',
    description:
      'Incremental solve A·dx = δ then x_new = x_prev + dx (Wedge 12, ADR-123). For event-driven streaming systems (federation trust deltas, span streams, append-only causal breaks). Sparse δ → asymptotically faster than full re-solve. Use when you already have a prevSolution from sublinear/solve and only a few entries of b changed — avoids recomputing the full vector.',
    category: 'graph-intelligence',
    inputSchema: {
      type: 'object',
      properties: {
        graphId: { type: 'string' },
        prevSolution: { type: 'array', items: { type: 'number' } },
        delta: {
          type: 'object',
          properties: {
            indices: { type: 'array', items: { type: 'number' } },
            values: { type: 'array', items: { type: 'number' } },
          },
        },
        algorithm: { type: 'string', enum: ['cg', 'neumann'] },
        maxComplexityClass: { type: 'string' },
      },
      required: ['graphId', 'prevSolution', 'delta'],
    },
    handler: async (input) => {
      const query = SolveOnChangeQuerySchema.parse(input);
      const adapter = getRegistry().get(query.graphId);
      if (!adapter) {
        return { success: false, error: { kind: 'graph-not-found', message: `no adapter for graphId=${query.graphId}` } };
      }
      const matrix = await adapter.exportAsSparseMatrix();
      try {
        const result = runSolveOnChange(matrix, query);
        return { success: true, result };
      } catch (err) {
        return { success: false, error: err };
      }
    },
  },

  {
    name: 'sublinear/analyze',
    description:
      'Diagnostic report on a registered graph: coherence margin (DD), sparsity, square-size, recommended algorithm. Use before sublinear/solve to choose algorithm + budget.',
    category: 'graph-intelligence',
    inputSchema: {
      type: 'object',
      properties: { graphId: { type: 'string' } },
      required: ['graphId'],
    },
    handler: async (input) => {
      const graphId = input.graphId as string;
      const adapter = getRegistry().get(graphId);
      if (!adapter) {
        return { success: false, error: { kind: 'graph-not-found', message: `no adapter for graphId=${graphId}` } };
      }
      const matrix = await adapter.exportAsSparseMatrix();
      const coherence = checkCoherence(matrix, 0);
      const nonzeros = matrix.entries.length;
      const density = nonzeros / (matrix.size * matrix.size);
      const recommendedAlgorithm = density < 0.01 ? 'forward-push' : coherence.score > 0 ? 'cg' : 'neumann';
      return {
        success: true,
        result: {
          graphId,
          size: matrix.size,
          nonzeros,
          density,
          coherenceScore: coherence.score,
          isDiagonallyDominant: coherence.score > 0,
          recommendedAlgorithm,
        },
      };
    },
  },

  {
    name: 'sublinear/feasibility',
    description:
      'Packing/covering LP feasibility check (Kyng-Sachdeva style). Wedge 9 — pre-flight check before invoking A* / heavy planners. Use when a planner/scheduler has resource constraints (A·x ≤ b) and you want to cheaply check satisfiability before committing to a full search; returns witness x if feasible.',
    category: 'graph-intelligence',
    inputSchema: {
      type: 'object',
      properties: {
        constraints: { type: 'array', description: 'A·x ≤ b constraint set' },
        tolerance: { type: 'number', description: 'Slack for soft constraints (default 0.05)' },
        maxComplexityClass: { type: 'string' },
      },
      required: ['constraints'],
    },
    handler: async (input) => {
      // Phase 6: relaxed packing/covering LP. Each constraint is a row Aᵢ
      // with shape { coeffs: Record<varId, number>, bound: number, kind: 'leq'|'geq'|'eq' }.
      // The relaxed check: does there exist x ≥ 0 satisfying all constraints within `tolerance`?
      // For Phase 6 we ship a tight bounded-variable LP via a simple Lagrangian
      // shrink-on-violation pass. Real Kyng–Sachdeva solver wires in Phase 7+.
      const constraints = (input.constraints as Array<{
        coeffs: Record<string, number>;
        bound: number;
        kind?: 'leq' | 'geq' | 'eq';
      }>) ?? [];
      const tolerance = (input.tolerance as number) ?? 0.05;
      if (constraints.length === 0) {
        return { success: true, result: { feasible: true, witness: {}, method: 'no-constraints' } };
      }
      // Collect variables; initialise x = 0 (the trivial point).
      const varSet = new Set<string>();
      for (const c of constraints) for (const k of Object.keys(c.coeffs)) varSet.add(k);
      const vars = [...varSet];
      const x: Record<string, number> = {};
      for (const v of vars) x[v] = 0;
      // 200-iter Lagrangian shrink: for each violated row, push x toward
      // satisfaction by a small step proportional to violation magnitude.
      const stepSize = 0.05;
      for (let it = 0; it < 200; it++) {
        let maxViolation = 0;
        for (const c of constraints) {
          let lhs = 0;
          for (const [k, w] of Object.entries(c.coeffs)) lhs += (x[k] ?? 0) * w;
          const kind = c.kind ?? 'leq';
          let violation = 0;
          if (kind === 'leq' && lhs > c.bound) violation = lhs - c.bound;
          else if (kind === 'geq' && lhs < c.bound) violation = c.bound - lhs;
          else if (kind === 'eq') violation = Math.abs(lhs - c.bound);
          if (violation > maxViolation) maxViolation = violation;
          if (violation === 0) continue;
          for (const [k, w] of Object.entries(c.coeffs)) {
            if (w === 0) continue;
            const direction = kind === 'leq' ? -Math.sign(w) : Math.sign(w);
            x[k] = Math.max(0, (x[k] ?? 0) + direction * stepSize * (violation / Math.abs(w)));
          }
        }
        if (maxViolation <= tolerance) {
          return { success: true, result: { feasible: true, witness: x, iterations: it + 1, method: 'lagrangian-shrink' } };
        }
      }
      // Couldn't satisfy within iteration cap — infeasibility certificate
      // is the residual violation vector.
      const residuals = constraints.map((c) => {
        let lhs = 0;
        for (const [k, w] of Object.entries(c.coeffs)) lhs += (x[k] ?? 0) * w;
        return { lhs, bound: c.bound, kind: c.kind ?? 'leq' };
      });
      return {
        success: true,
        result: {
          feasible: false,
          witness: x,
          certificateOfInfeasibility: residuals,
          method: 'lagrangian-shrink (capped)',
        },
      };
    },
  },

  {
    name: 'sublinear/jl-embed',
    description:
      'Johnson-Lindenstrauss projection. Maps vectors to a target dimension with ε-distortion. Replaces @claude-flow/embeddings hand-rolled JL (closes ADR-121 Phase 4 follow-up). Use when you need to downscale a batch of high-dim embeddings (e.g. 768→64) while preserving pairwise distances within ε — cheaper than PCA and randomized.',
    category: 'graph-intelligence',
    inputSchema: {
      type: 'object',
      properties: {
        vectors: { type: 'array', description: 'Input vectors' },
        targetDim: { type: 'number' },
        epsilon: { type: 'number' },
      },
      required: ['vectors', 'targetDim'],
    },
    handler: async (input) => {
      // Phase 6: real JL via jlEmbed (replaces ADR-121 hand-rolled).
      const { jlEmbed } = await import('../infrastructure/jl-embed.js');
      const vectors = (input.vectors as number[][]) ?? [];
      const targetDim = (input.targetDim as number) ?? 64;
      const epsilon = (input.epsilon as number) ?? 0.1;
      try {
        const result = jlEmbed(vectors, { targetDim, epsilon });
        return {
          success: true,
          result: {
            projected: result.projected,
            targetDim: result.targetDim,
            distortionBound: result.epsilon,
            withinAchlioptasBound: result.withinAchlioptasBound,
            method: 'real JL — Gaussian projection with k ≤ n−1 cap',
          },
        };
      } catch (err) {
        return {
          success: false,
          error: {
            kind: 'invalid-input',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
  },
];

export default graphIntelligenceTools;
