/**
 * AIDefence Suspicion Adapter (Wedge 10, ADR-123 Phase 6)
 *
 * `ruflo-aidefence` flags syscalls / agent actions as suspicious. This
 * adapter exports the call-graph so suspicion propagates from the flagged
 * leaf node back through callers via single-entry PR. `α=0.95` (high
 * decay — suspicion travels far) by convention.
 */

import { createHash } from 'node:crypto';
import type { SparseEntry, SparseMatrix } from '../domain/types.js';
import type { SublinearAdapter, AdapterRegistry } from '../domain/adapter.js';
import { getRegistry } from '../domain/adapter.js';

export interface CallEdge {
  callerId: string;
  calleeId: string;
  /** Optional weight — calls per session. Default 1. */
  weight?: number;
}

export interface AIDefenceSource {
  listCallEdges(): Promise<readonly CallEdge[]>;
}

export interface AIDefenceAdapterOptions {
  source: AIDefenceSource;
  /** DD safety margin. Default 0.25. */
  ddSafetyMargin?: number;
}

export const AIDEFENCE_CALL_GRAPH_ID = 'ruflo-aidefence:call-graph';

export class AIDefenceSuspicionAdapter implements SublinearAdapter {
  readonly graphId = AIDEFENCE_CALL_GRAPH_ID;
  readonly ownerPlugin = 'ruflo-aidefence';
  readonly requiresPreprocessing = false;

  private readonly source: AIDefenceSource;
  private readonly ddSafetyMargin: number;

  constructor(options: AIDefenceAdapterOptions) {
    this.source = options.source;
    this.ddSafetyMargin = options.ddSafetyMargin ?? 0.25;
  }

  async exportAsSparseMatrix(options?: { nodeFilter?: ReadonlySet<string> }): Promise<SparseMatrix> {
    const edges = await this.source.listCallEdges();
    const idSet = new Set<string>();
    for (const e of edges) {
      idSet.add(e.callerId);
      idSet.add(e.calleeId);
    }
    if (options?.nodeFilter) {
      for (const n of [...idSet]) if (!options.nodeFilter.has(n)) idSet.delete(n);
    }
    const nodes = [...idSet].sort();
    const nodeIndex: Record<string, number> = {};
    nodes.forEach((n, i) => (nodeIndex[n] = i));

    // Suspicion flows from callee BACK to caller, so edges are reversed:
    // a callee that's flagged should bump suspicion on its caller.
    const entries: SparseEntry[] = [];
    const rowSums = new Array<number>(nodes.length).fill(0);
    for (const e of edges) {
      // Reverse direction: from callee → caller
      const r = nodeIndex[e.calleeId];
      const c = nodeIndex[e.callerId];
      if (r === undefined || c === undefined || r === c) continue;
      const w = Math.max(0, e.weight ?? 1);
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

export function registerAIDefenceSuspicionAdapter(
  options: AIDefenceAdapterOptions & { registry?: AdapterRegistry },
): AIDefenceSuspicionAdapter {
  const adapter = new AIDefenceSuspicionAdapter(options);
  (options.registry ?? getRegistry()).register(adapter);
  return adapter;
}

function hashContent(graphId: string, entries: readonly SparseEntry[]): string {
  const h = createHash('sha256');
  h.update(graphId);
  for (const e of entries) h.update(`|${e.row},${e.col},${e.value.toFixed(8)}`);
  return h.digest('hex');
}
