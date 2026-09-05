/**
 * Observability Span Adapter (Wedge 7, ADR-123 Phase 3)
 *
 * `ruflo-observability` records spans (OpenTelemetry-style) with parent links
 * + cross-trace causality. This adapter exports the span graph so the user
 * can ask "which span most contributed to this slow/failed request" in
 * O(log spans) instead of full-trace walks.
 */

import { createHash } from 'node:crypto';
import type { SparseEntry, SparseMatrix } from '../domain/types.js';
import type { SublinearAdapter, AdapterRegistry } from '../domain/adapter.js';
import { getRegistry } from '../domain/adapter.js';

export interface SpanRecord {
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  /** Self-time in microseconds — used as edge weight. */
  selfTimeUs: number;
  /** Optional cross-trace causality link (e.g. an event triggered this trace). */
  causedBySpanId?: string;
}

export interface ObservabilitySpanSource {
  listSpans(traceId: string): Promise<readonly SpanRecord[]>;
}

export interface ObservabilitySpanAdapterOptions {
  source: ObservabilitySpanSource;
  traceId: string;
  /** DD safety margin. Default 0.25. */
  ddSafetyMargin?: number;
}

export function observabilityGraphId(traceId: string): string {
  return `ruflo-observability:trace:${traceId}`;
}

export class ObservabilitySpanAdapter implements SublinearAdapter {
  readonly graphId: string;
  readonly ownerPlugin = 'ruflo-observability';
  readonly requiresPreprocessing = false;

  private readonly source: ObservabilitySpanSource;
  private readonly traceId: string;
  private readonly ddSafetyMargin: number;

  constructor(options: ObservabilitySpanAdapterOptions) {
    this.source = options.source;
    this.traceId = options.traceId;
    this.ddSafetyMargin = options.ddSafetyMargin ?? 0.25;
    this.graphId = observabilityGraphId(this.traceId);
  }

  async exportAsSparseMatrix(options?: { nodeFilter?: ReadonlySet<string> }): Promise<SparseMatrix> {
    const spans = await this.source.listSpans(this.traceId);
    const idSet = new Set<string>();
    for (const s of spans) {
      idSet.add(s.spanId);
      if (s.parentSpanId) idSet.add(s.parentSpanId);
      if (s.causedBySpanId) idSet.add(s.causedBySpanId);
    }
    if (options?.nodeFilter) {
      for (const n of [...idSet]) if (!options.nodeFilter.has(n)) idSet.delete(n);
    }

    const nodes = [...idSet].sort();
    const nodeIndex: Record<string, number> = {};
    nodes.forEach((n, i) => (nodeIndex[n] = i));

    // Normalise self-time per parent: each parent's outbound weights sum to ≤1.
    const childrenByParent = new Map<string, SpanRecord[]>();
    for (const s of spans) {
      const p = s.parentSpanId ?? s.causedBySpanId;
      if (!p) continue;
      if (!childrenByParent.has(p)) childrenByParent.set(p, []);
      childrenByParent.get(p)!.push(s);
    }

    const entries: SparseEntry[] = [];
    const rowSums = new Array<number>(nodes.length).fill(0);
    for (const [parent, children] of childrenByParent) {
      const r = nodeIndex[parent];
      if (r === undefined) continue;
      const total = children.reduce((s, c) => s + Math.max(1, c.selfTimeUs), 0);
      for (const child of children) {
        const c = nodeIndex[child.spanId];
        if (c === undefined || c === r) continue;
        const w = Math.max(1, child.selfTimeUs) / total;
        entries.push({ row: r, col: c, value: w });
        rowSums[r] += w;
      }
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

export function registerObservabilitySpanAdapter(
  options: ObservabilitySpanAdapterOptions & { registry?: AdapterRegistry },
): ObservabilitySpanAdapter {
  const adapter = new ObservabilitySpanAdapter(options);
  (options.registry ?? getRegistry()).register(adapter);
  return adapter;
}

function hashContent(graphId: string, entries: readonly SparseEntry[]): string {
  const h = createHash('sha256');
  h.update(graphId);
  for (const e of entries) h.update(`|${e.row},${e.col},${e.value.toFixed(8)}`);
  return h.digest('hex');
}
