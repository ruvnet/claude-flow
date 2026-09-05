/**
 * RAG Memory Adapter (Wedge 5, ADR-123 Phase 4)
 *
 * `ruflo-rag-memory` ships Graph-RAG multi-hop retrieval. This adapter
 * exports the chunk-connectivity graph so personalized PR seeded by the
 * query embedding ranks candidate chunks globally — graph-aware retrieval
 * beyond flat top-k MMR rerank.
 *
 * The seedNodes for personalized PR come from the caller's query side
 * (`sublinear/page-rank-entry` already accepts seedNodes). This adapter
 * just exposes the underlying chunk graph.
 */

import { createHash } from 'node:crypto';
import type { SparseEntry, SparseMatrix } from '../domain/types.js';
import type { SublinearAdapter, AdapterRegistry } from '../domain/adapter.js';
import { getRegistry } from '../domain/adapter.js';

export interface ChunkEdge {
  fromChunkId: string;
  toChunkId: string;
  /** Similarity weight in [0, 1] — typically cosine similarity of chunk embeddings. */
  similarity: number;
}

export interface RagMemorySource {
  listChunkEdges(namespace?: string): Promise<readonly ChunkEdge[]>;
}

export interface RagMemoryAdapterOptions {
  source: RagMemorySource;
  namespace?: string;
  /** Minimum similarity to include an edge. Default 0.5. */
  similarityFloor?: number;
  /** DD safety margin. Default 0.25. */
  ddSafetyMargin?: number;
}

export function ragMemoryGraphId(namespace?: string): string {
  return namespace
    ? `ruflo-rag-memory:chunks:${namespace}`
    : 'ruflo-rag-memory:chunks:default';
}

export class RagMemoryAdapter implements SublinearAdapter {
  readonly graphId: string;
  readonly ownerPlugin = 'ruflo-rag-memory';
  readonly requiresPreprocessing = false;

  private readonly source: RagMemorySource;
  private readonly namespace?: string;
  private readonly similarityFloor: number;
  private readonly ddSafetyMargin: number;

  constructor(options: RagMemoryAdapterOptions) {
    this.source = options.source;
    this.namespace = options.namespace;
    this.similarityFloor = options.similarityFloor ?? 0.5;
    this.ddSafetyMargin = options.ddSafetyMargin ?? 0.25;
    this.graphId = ragMemoryGraphId(this.namespace);
  }

  async exportAsSparseMatrix(options?: { nodeFilter?: ReadonlySet<string> }): Promise<SparseMatrix> {
    const edges = (await this.source.listChunkEdges(this.namespace)).filter(
      (e) => e.similarity >= this.similarityFloor,
    );
    const chunkSet = new Set<string>();
    for (const e of edges) {
      chunkSet.add(e.fromChunkId);
      chunkSet.add(e.toChunkId);
    }
    if (options?.nodeFilter) {
      for (const n of [...chunkSet]) if (!options.nodeFilter.has(n)) chunkSet.delete(n);
    }

    const chunks = [...chunkSet].sort();
    const nodeIndex: Record<string, number> = {};
    chunks.forEach((n, i) => (nodeIndex[n] = i));

    const entries: SparseEntry[] = [];
    const rowSums = new Array<number>(chunks.length).fill(0);
    for (const e of edges) {
      const r = nodeIndex[e.fromChunkId];
      const c = nodeIndex[e.toChunkId];
      if (r === undefined || c === undefined || r === c) continue;
      entries.push({ row: r, col: c, value: e.similarity });
      rowSums[r] += e.similarity;
    }
    for (let i = 0; i < chunks.length; i++) {
      entries.push({ row: i, col: i, value: rowSums[i]! + this.ddSafetyMargin });
    }
    return {
      graphId: this.graphId,
      size: chunks.length,
      entries,
      nodeIndex,
      indexNode: chunks,
      capturedAt: new Date().toISOString(),
      contentHash: hashContent(this.graphId, entries),
    };
  }
}

export function registerRagMemoryAdapter(
  options: RagMemoryAdapterOptions & { registry?: AdapterRegistry },
): RagMemoryAdapter {
  const adapter = new RagMemoryAdapter(options);
  (options.registry ?? getRegistry()).register(adapter);
  return adapter;
}

function hashContent(graphId: string, entries: readonly SparseEntry[]): string {
  const h = createHash('sha256');
  h.update(graphId);
  for (const e of entries) h.update(`|${e.row},${e.col},${e.value.toFixed(8)}`);
  return h.digest('hex');
}
