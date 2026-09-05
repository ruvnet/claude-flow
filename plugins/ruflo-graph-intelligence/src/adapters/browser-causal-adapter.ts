/**
 * Browser Causal-Recovery Adapter (Wedge 1, ADR-123 Phase 2)
 *
 * Exports the ADR-122 Phase 2 selector-break events as a SparseMatrix so
 * `sublinear/page-rank-entry` can score a single element-ref's causal
 * brittleness in O(log N) instead of the current O(N) `breakCount / attempts`
 * ratio.
 *
 * The matrix `M` is built per-origin: rows + columns are union of
 *   - all element-refs that have ever appeared
 *   - all selector strings that have ever been retried
 * Off-diagonal entry M[i,j] = number of times row-event preceded column-event
 * on the same DOM mutation lineage (weight ≥ 1). Diagonal entry M[i,i] = 1 + Σ
 * |off-diagonals on row i|, so the matrix is strictly diagonally-dominant.
 *
 * The adapter is **dependency-injection-friendly**: callers pass a
 * `BreakEventSource` (a structural type matching the slice of ADR-122's
 * CausalRecoveryService surface we actually need) so this plugin does NOT
 * hard-import @claude-flow/browser. Phase 2 of *this* plugin ships the
 * adapter; the browser package only needs to call `registerBrowserCausalAdapter()`
 * at its plugin-init time.
 */

import { createHash } from 'node:crypto';
import type { SparseEntry, SparseMatrix } from '../domain/types.js';
import type { SublinearAdapter } from '../domain/adapter.js';

/**
 * The slice of @claude-flow/browser's CausalRecoveryService surface we depend on.
 * Defined structurally so we don't need a hard import.
 */
export interface BreakEventSource {
  /** All recorded break events for an origin, in chronological order. */
  listBreaks(origin: string): Promise<readonly BreakEventLike[]>;
}

/** Minimal break-event shape we read. Compatible with ADR-122 Phase 2. */
export interface BreakEventLike {
  id: string;
  origin: string;
  selector: string;
  /** Optional last-known role+name fuzzy-match keys (Phase 2 records both). */
  lastKnownRole?: string;
  lastKnownName?: string;
  /** When the break was first observed (ISO). */
  timestamp: string;
}

export interface BrowserCausalAdapterOptions {
  /** Origin (e.g. `https://example.com`) — one adapter instance per origin. */
  origin: string;
  /** Event source. */
  source: BreakEventSource;
  /** Adjacency-weighting half-life in milliseconds. Default 24h. */
  halfLifeMs?: number;
  /** Diagonal-dominance margin to keep DD even under heavy noise. Default 0.5. */
  ddSafetyMargin?: number;
}

/**
 * Identifier convention so consumers can address per-origin graphs:
 *   `browser:causal:<origin>` — e.g. `browser:causal:https://example.com`
 */
export function browserCausalGraphId(origin: string): string {
  return `browser:causal:${origin}`;
}

export class BrowserCausalAdapter implements SublinearAdapter {
  readonly graphId: string;
  readonly ownerPlugin = '@claude-flow/browser';

  private readonly origin: string;
  private readonly source: BreakEventSource;
  private readonly halfLifeMs: number;
  private readonly ddSafetyMargin: number;

  constructor(options: BrowserCausalAdapterOptions) {
    this.origin = options.origin;
    this.source = options.source;
    this.halfLifeMs = options.halfLifeMs ?? 24 * 60 * 60 * 1000;
    this.ddSafetyMargin = options.ddSafetyMargin ?? 0.5;
    this.graphId = browserCausalGraphId(this.origin);
  }

  async exportAsSparseMatrix(options?: {
    since?: string;
    nodeFilter?: ReadonlySet<string>;
  }): Promise<SparseMatrix> {
    const events = await this.source.listBreaks(this.origin);
    const cutoff = options?.since ? Date.parse(options.since) : -Infinity;
    const filtered = events.filter((e) => Date.parse(e.timestamp) >= cutoff);

    // Node set: union of selectors + (role:name) fuzzy keys
    const nodeIds = new Set<string>();
    for (const e of filtered) {
      nodeIds.add(e.selector);
      if (e.lastKnownRole && e.lastKnownName) {
        nodeIds.add(`role:${e.lastKnownRole}:${e.lastKnownName}`);
      }
    }
    if (options?.nodeFilter) {
      for (const n of [...nodeIds]) if (!options.nodeFilter.has(n)) nodeIds.delete(n);
    }

    const nodes = [...nodeIds].sort();
    const nodeIndex: Record<string, number> = {};
    nodes.forEach((n, i) => (nodeIndex[n] = i));

    // Build adjacency: row = source event's selector, col = "next" event's selector
    // within the same chronological neighbourhood. Time-decayed weight.
    const weights = new Map<string, number>(); // key = "row:col"
    const now = Date.now();
    for (let i = 0; i < filtered.length - 1; i++) {
      const a = filtered[i];
      const b = filtered[i + 1];
      const decay = Math.exp(-(now - Date.parse(a.timestamp)) / this.halfLifeMs);
      const keys = pairKeys(a, b);
      for (const k of keys) weights.set(k, (weights.get(k) ?? 0) + decay);
    }

    // Emit off-diagonal entries, then add a diagonal that guarantees DD.
    const entries: SparseEntry[] = [];
    const rowSums = new Array<number>(nodes.length).fill(0);
    for (const [key, w] of weights) {
      const [from, to] = key.split('::');
      const rIdx = nodeIndex[from!];
      const cIdx = nodeIndex[to!];
      if (rIdx === undefined || cIdx === undefined) continue;
      if (rIdx === cIdx) continue;
      entries.push({ row: rIdx, col: cIdx, value: w });
      rowSums[rIdx] += Math.abs(w);
    }
    for (let i = 0; i < nodes.length; i++) {
      const diag = rowSums[i]! + this.ddSafetyMargin;
      entries.push({ row: i, col: i, value: Math.max(1, diag) });
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

  readonly requiresPreprocessing = false;
}

function pairKeys(a: BreakEventLike, b: BreakEventLike): string[] {
  const keys: string[] = [`${a.selector}::${b.selector}`];
  if (a.lastKnownRole && a.lastKnownName) {
    const key = `role:${a.lastKnownRole}:${a.lastKnownName}`;
    keys.push(`${key}::${b.selector}`);
  }
  if (b.lastKnownRole && b.lastKnownName) {
    const key = `role:${b.lastKnownRole}:${b.lastKnownName}`;
    keys.push(`${a.selector}::${key}`);
  }
  return keys;
}

function hashContent(graphId: string, entries: readonly SparseEntry[]): string {
  const h = createHash('sha256');
  h.update(graphId);
  for (const e of entries) {
    h.update(`|${e.row},${e.col},${e.value.toFixed(8)}`);
  }
  return h.digest('hex');
}

/**
 * Convenience entry point — instantiate + register in one call.
 *
 * Intended to be invoked from @claude-flow/browser's init code:
 *   import { registerBrowserCausalAdapter } from 'ruflo-graph-intelligence/adapters';
 *   registerBrowserCausalAdapter({ origin: 'https://example.com', source: causalService });
 */
export function registerBrowserCausalAdapter(
  options: BrowserCausalAdapterOptions & { registry?: import('../domain/adapter.js').AdapterRegistry },
): BrowserCausalAdapter {
  const adapter = new BrowserCausalAdapter(options);
  const registry = options.registry ?? import('../domain/adapter.js').then((m) => m.getRegistry());
  // Synchronous registration when registry is supplied; lazy fallback otherwise.
  if (typeof (registry as { register?: unknown }).register === 'function') {
    (registry as import('../domain/adapter.js').AdapterRegistry).register(adapter);
  } else {
    (registry as Promise<import('../domain/adapter.js').AdapterRegistry>).then((r) => r.register(adapter));
  }
  return adapter;
}
