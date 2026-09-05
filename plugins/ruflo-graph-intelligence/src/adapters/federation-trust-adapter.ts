/**
 * Federation Trust Adapter (Wedge 3, ADR-123 Phase 3)
 *
 * `ruflo-federation` ships a peer trust mesh (ADR-097/104/105/111). This
 * adapter exports the mesh as a SparseMatrix so `sublinear/page-rank-entry`
 * computes transitive trust `(I − αT)τ = e` in O(log peers) instead of
 * O(peers²) closure walks. Trust is one-way → the matrix is asymmetric
 * (per upstream 2025 asymmetric-DD result, this is in-scope for sublinear).
 */

import { createHash } from 'node:crypto';
import type { SparseEntry, SparseMatrix } from '../domain/types.js';
import type { SublinearAdapter, AdapterRegistry } from '../domain/adapter.js';
import { getRegistry } from '../domain/adapter.js';

export interface PeerTrustEdge {
  /** Peer the trust comes from. */
  fromPeer: string;
  /** Peer the trust is directed at. */
  toPeer: string;
  /** Confidence in [0, 1] — typically derived from signed-message hit rate. */
  confidence: number;
  /** When the edge was last updated. */
  updatedAt: string;
}

export interface PeerTrustSource {
  /** All trust edges currently in the local view of the mesh. */
  listTrustEdges(): Promise<readonly PeerTrustEdge[]>;
}

export interface FederationTrustAdapterOptions {
  source: PeerTrustSource;
  /** Edge-staleness cutoff in milliseconds. Default 7 days. */
  freshnessMs?: number;
  /** Diagonal-dominance safety margin. Default 0.25. */
  ddSafetyMargin?: number;
}

export const FEDERATION_TRUST_GRAPH_ID = 'ruflo-federation:trust-mesh';

export class FederationTrustAdapter implements SublinearAdapter {
  readonly graphId = FEDERATION_TRUST_GRAPH_ID;
  readonly ownerPlugin = 'ruflo-federation';
  readonly requiresPreprocessing = false;

  private readonly source: PeerTrustSource;
  private readonly freshnessMs: number;
  private readonly ddSafetyMargin: number;

  constructor(options: FederationTrustAdapterOptions) {
    this.source = options.source;
    this.freshnessMs = options.freshnessMs ?? 7 * 24 * 60 * 60 * 1000;
    this.ddSafetyMargin = options.ddSafetyMargin ?? 0.25;
  }

  async exportAsSparseMatrix(options?: { nodeFilter?: ReadonlySet<string> }): Promise<SparseMatrix> {
    const allEdges = await this.source.listTrustEdges();
    const now = Date.now();
    const fresh = allEdges.filter((e) => now - Date.parse(e.updatedAt) <= this.freshnessMs);

    const peerSet = new Set<string>();
    for (const e of fresh) {
      peerSet.add(e.fromPeer);
      peerSet.add(e.toPeer);
    }
    if (options?.nodeFilter) {
      for (const p of [...peerSet]) if (!options.nodeFilter.has(p)) peerSet.delete(p);
    }

    const peers = [...peerSet].sort();
    const nodeIndex: Record<string, number> = {};
    peers.forEach((p, i) => (nodeIndex[p] = i));

    const entries: SparseEntry[] = [];
    const rowSums = new Array<number>(peers.length).fill(0);
    for (const edge of fresh) {
      const r = nodeIndex[edge.fromPeer];
      const c = nodeIndex[edge.toPeer];
      if (r === undefined || c === undefined || r === c) continue;
      const w = Math.max(0, Math.min(1, edge.confidence));
      if (w === 0) continue;
      entries.push({ row: r, col: c, value: w });
      rowSums[r] += w;
    }
    // DD diagonal: |diag| ≥ Σ|off| + margin
    for (let i = 0; i < peers.length; i++) {
      entries.push({ row: i, col: i, value: rowSums[i]! + this.ddSafetyMargin });
    }

    return {
      graphId: this.graphId,
      size: peers.length,
      entries,
      nodeIndex,
      indexNode: peers,
      capturedAt: new Date().toISOString(),
      contentHash: hashContent(this.graphId, entries),
    };
  }
}

export function registerFederationTrustAdapter(
  options: FederationTrustAdapterOptions & { registry?: AdapterRegistry },
): FederationTrustAdapter {
  const adapter = new FederationTrustAdapter(options);
  (options.registry ?? getRegistry()).register(adapter);
  return adapter;
}

function hashContent(graphId: string, entries: readonly SparseEntry[]): string {
  const h = createHash('sha256');
  h.update(graphId);
  for (const e of entries) h.update(`|${e.row},${e.col},${e.value.toFixed(8)}`);
  return h.digest('hex');
}
