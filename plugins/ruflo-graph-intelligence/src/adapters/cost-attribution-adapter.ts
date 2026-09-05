/**
 * Cost Attribution Adapter (Wedge 6, ADR-123 Phase 3)
 *
 * `ruflo-cost-tracker` records token usage per session in a causation graph:
 *   user-prompt → spawned-agent → MCP-call → model-invocation → tokens-USD
 *
 * This adapter exports that graph so `sublinear/page-rank-entry` answers
 * "which root prompt caused the most downstream spend" in O(log traces)
 * rather than O(traces) walks. Costs are one-way edges → asymmetric matrix.
 */

import { createHash } from 'node:crypto';
import type { SparseEntry, SparseMatrix } from '../domain/types.js';
import type { SublinearAdapter, AdapterRegistry } from '../domain/adapter.js';
import { getRegistry } from '../domain/adapter.js';

export interface CostCausationEdge {
  /** Parent node — typically a prompt id or upstream agent id. */
  parentId: string;
  /** Child node — typically a spawned agent / MCP call / model invocation id. */
  childId: string;
  /** USD cost attributed to the child as caused by this parent. */
  costUsd: number;
}

export interface CostCausationSource {
  /** All causation edges for a session (or globally). */
  listCausationEdges(sessionId?: string): Promise<readonly CostCausationEdge[]>;
}

export interface CostAttributionAdapterOptions {
  source: CostCausationSource;
  /** Restrict to a specific session id. */
  sessionId?: string;
  /** DD safety margin. Default 0.25. */
  ddSafetyMargin?: number;
}

export function costAttributionGraphId(sessionId?: string): string {
  return sessionId ? `ruflo-cost-tracker:causation:${sessionId}` : 'ruflo-cost-tracker:causation:global';
}

export class CostAttributionAdapter implements SublinearAdapter {
  readonly graphId: string;
  readonly ownerPlugin = 'ruflo-cost-tracker';
  readonly requiresPreprocessing = false;

  private readonly source: CostCausationSource;
  private readonly sessionId?: string;
  private readonly ddSafetyMargin: number;

  constructor(options: CostAttributionAdapterOptions) {
    this.source = options.source;
    this.sessionId = options.sessionId;
    this.ddSafetyMargin = options.ddSafetyMargin ?? 0.25;
    this.graphId = costAttributionGraphId(this.sessionId);
  }

  async exportAsSparseMatrix(options?: { nodeFilter?: ReadonlySet<string> }): Promise<SparseMatrix> {
    const edges = await this.source.listCausationEdges(this.sessionId);
    const nodeSet = new Set<string>();
    for (const e of edges) {
      nodeSet.add(e.parentId);
      nodeSet.add(e.childId);
    }
    if (options?.nodeFilter) {
      for (const n of [...nodeSet]) if (!options.nodeFilter.has(n)) nodeSet.delete(n);
    }

    const nodes = [...nodeSet].sort();
    const nodeIndex: Record<string, number> = {};
    nodes.forEach((n, i) => (nodeIndex[n] = i));

    // Normalise costs into [0, 1] per row so PageRank semantics make sense
    // (we're after the *share of blame*, not the raw dollar amount).
    const rawRowSums = new Array<number>(nodes.length).fill(0);
    for (const e of edges) {
      const r = nodeIndex[e.parentId];
      if (r === undefined) continue;
      rawRowSums[r]! += Math.max(0, e.costUsd);
    }
    const entries: SparseEntry[] = [];
    const rowSums = new Array<number>(nodes.length).fill(0);
    for (const e of edges) {
      const r = nodeIndex[e.parentId];
      const c = nodeIndex[e.childId];
      if (r === undefined || c === undefined || r === c) continue;
      const denom = rawRowSums[r]!;
      if (denom === 0) continue;
      const w = Math.max(0, e.costUsd) / denom;
      if (w === 0) continue;
      entries.push({ row: r, col: c, value: w });
      rowSums[r] += w;
    }
    for (let i = 0; i < nodes.length; i++) {
      entries.push({ row: i, col: i, value: rowSums[i]! + this.ddSafetyMargin });
    }
    return {
      graphId: this.graphId,
      size: nodes.length,
      entries,
      nodeIndex,
      indexNode: nodes,
      capturedAt: new Date().toISOString(),
      contentHash: hashContent(this.graphId, entries),
    };
  }
}

export function registerCostAttributionAdapter(
  options: CostAttributionAdapterOptions & { registry?: AdapterRegistry },
): CostAttributionAdapter {
  const adapter = new CostAttributionAdapter(options);
  (options.registry ?? getRegistry()).register(adapter);
  return adapter;
}

function hashContent(graphId: string, entries: readonly SparseEntry[]): string {
  const h = createHash('sha256');
  h.update(graphId);
  for (const e of entries) h.update(`|${e.row},${e.col},${e.value.toFixed(8)}`);
  return h.digest('hex');
}
