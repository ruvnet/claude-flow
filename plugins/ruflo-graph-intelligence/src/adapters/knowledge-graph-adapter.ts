/**
 * Knowledge Graph Adapter (Wedge 4, ADR-123 Phase 4)
 *
 * `ruflo-knowledge-graph` builds an entity-relation graph via kg-extract.
 * This adapter exports it as a SparseMatrix so kg-importance(entity) becomes
 * a single-entry PR query — answering "which entity is most central" in
 * sub-millisecond on a 10k-node graph.
 */

import { createHash } from 'node:crypto';
import type { SparseEntry, SparseMatrix } from '../domain/types.js';
import type { SublinearAdapter, AdapterRegistry } from '../domain/adapter.js';
import { getRegistry } from '../domain/adapter.js';

export interface KGEdge {
  fromEntity: string;
  toEntity: string;
  relation: string;
  /** Edge confidence in [0,1]. Default 1.0. */
  confidence?: number;
}

export interface KnowledgeGraphSource {
  listEdges(): Promise<readonly KGEdge[]>;
}

export interface KnowledgeGraphAdapterOptions {
  source: KnowledgeGraphSource;
  /** DD safety margin. Default 0.25. */
  ddSafetyMargin?: number;
}

export const KNOWLEDGE_GRAPH_ID = 'ruflo-knowledge-graph:entities';

export class KnowledgeGraphAdapter implements SublinearAdapter {
  readonly graphId = KNOWLEDGE_GRAPH_ID;
  readonly ownerPlugin = 'ruflo-knowledge-graph';
  readonly requiresPreprocessing = false;

  private readonly source: KnowledgeGraphSource;
  private readonly ddSafetyMargin: number;

  constructor(options: KnowledgeGraphAdapterOptions) {
    this.source = options.source;
    this.ddSafetyMargin = options.ddSafetyMargin ?? 0.25;
  }

  async exportAsSparseMatrix(options?: { nodeFilter?: ReadonlySet<string> }): Promise<SparseMatrix> {
    const edges = await this.source.listEdges();
    const entitySet = new Set<string>();
    for (const e of edges) {
      entitySet.add(e.fromEntity);
      entitySet.add(e.toEntity);
    }
    if (options?.nodeFilter) {
      for (const n of [...entitySet]) if (!options.nodeFilter.has(n)) entitySet.delete(n);
    }

    const entities = [...entitySet].sort();
    const nodeIndex: Record<string, number> = {};
    entities.forEach((n, i) => (nodeIndex[n] = i));

    // Weight edges by confidence; if multiple relations exist between two
    // entities, sum confidences (cap at 1).
    const weights = new Map<string, number>();
    for (const e of edges) {
      const r = nodeIndex[e.fromEntity];
      const c = nodeIndex[e.toEntity];
      if (r === undefined || c === undefined || r === c) continue;
      const key = `${r},${c}`;
      weights.set(key, Math.min(1, (weights.get(key) ?? 0) + (e.confidence ?? 1)));
    }
    const entries: SparseEntry[] = [];
    const rowSums = new Array<number>(entities.length).fill(0);
    for (const [key, w] of weights) {
      const [rStr, cStr] = key.split(',');
      const r = Number(rStr);
      const c = Number(cStr);
      entries.push({ row: r, col: c, value: w });
      rowSums[r] += w;
    }
    for (let i = 0; i < entities.length; i++) {
      entries.push({ row: i, col: i, value: rowSums[i]! + this.ddSafetyMargin });
    }
    return {
      graphId: this.graphId,
      size: entities.length,
      entries,
      nodeIndex,
      indexNode: entities,
      capturedAt: new Date().toISOString(),
      contentHash: hashContent(this.graphId, entries),
    };
  }
}

export function registerKnowledgeGraphAdapter(
  options: KnowledgeGraphAdapterOptions & { registry?: AdapterRegistry },
): KnowledgeGraphAdapter {
  const adapter = new KnowledgeGraphAdapter(options);
  (options.registry ?? getRegistry()).register(adapter);
  return adapter;
}

// ============================================================================
// ADR-130 Phase 4 — GraphEdgesSource: default source reading from graph_edges
// ============================================================================

/**
 * Default KnowledgeGraphSource implementation that reads live edges from the
 * AgentDB sql.js `graph_edges` table (ADR-130 Phase 4).
 *
 * Used when `autoRegister: true` in a plugin's `graph_adapter` declaration.
 * Falls back to an empty edge list when the table is unavailable.
 */
export class GraphEdgesSource implements KnowledgeGraphSource {
  private readonly relationsFilter: readonly string[] | undefined;

  constructor(options?: { relationsFilter?: string[] }) {
    this.relationsFilter = options?.relationsFilter;
  }

  async listEdges(): Promise<readonly KGEdge[]> {
    try {
      // Lazy import to avoid hard-coupling the plugin to @claude-flow/cli at compile time.
      // The import paths are resolved at runtime only; TypeScript cannot type-check them
      // from this plugin's compilation context (no package-level dependency on @claude-flow/cli).
      type GraphEdgeWriterModule = {
        getBridgeDb: (dbPath?: string) => Promise<{ exec: (sql: string) => Array<{ values?: unknown[][] }> } | null>;
      };
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — dynamic cross-package import resolved at runtime
      const mod: GraphEdgeWriterModule = await import('@claude-flow/cli/src/memory/graph-edge-writer.js')
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore — fallback to local dist path in mono-repo context
        .catch(() => import('../../../../../v3/@claude-flow/cli/dist/src/memory/graph-edge-writer.js'));

      const db = await mod.getBridgeDb();
      if (!db) return [];

      const relClauses = this.relationsFilter?.length
        ? `WHERE relation IN (${this.relationsFilter.map(r => `'${r.replace(/'/g, "''")}'`).join(',')})`
        : '';

      const result = db.exec(
        `SELECT source_id, target_id, relation, weight FROM graph_edges ${relClauses} LIMIT 100000`,
      );
      const rows = result?.[0]?.values ?? [];
      return (rows as unknown[][]).map((r: unknown[]) => ({
        fromEntity: r[0] as string,
        toEntity: r[1] as string,
        relation: r[2] as string,
        confidence: typeof r[3] === 'number' ? r[3] : 1.0,
      }));
    } catch {
      return []; // fallback to empty (backward compat)
    }
  }
}

/**
 * Create a KnowledgeGraphAdapter backed by graph_edges (ADR-130 §Phase 4).
 * This is the "autoRegister" path: no manual SublinearAdapter implementation needed.
 */
export function createAutoGraphAdapter(options?: {
  relationsFilter?: string[];
  ddSafetyMargin?: number;
  registry?: AdapterRegistry;
}): KnowledgeGraphAdapter {
  const source = new GraphEdgesSource({ relationsFilter: options?.relationsFilter });
  return registerKnowledgeGraphAdapter({
    source,
    ddSafetyMargin: options?.ddSafetyMargin,
    registry: options?.registry,
  });
}

function hashContent(graphId: string, entries: readonly SparseEntry[]): string {
  const h = createHash('sha256');
  h.update(graphId);
  for (const e of entries) h.update(`|${e.row},${e.col},${e.value.toFixed(8)}`);
  return h.digest('hex');
}
