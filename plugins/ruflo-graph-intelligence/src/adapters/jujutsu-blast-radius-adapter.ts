/**
 * Jujutsu Blast-Radius Adapter (Wedge 11, ADR-123 Phase 6)
 *
 * `ruflo-jujutsu` runs diff-analyze. This adapter exports the file-import
 * graph so "if I change `foo.ts`, which files are downstream-affected" is a
 * single-entry PR query — O(log files) instead of O(LOC × imports).
 *
 * The graph is directed: A imports B → A is downstream of B (B's change
 * propagates upward to A). For blast-radius FROM a changed file, the matrix
 * keeps natural orientation (changed file is the seed; downstream files
 * receive the PR mass).
 */

import { createHash } from 'node:crypto';
import type { SparseEntry, SparseMatrix } from '../domain/types.js';
import type { SublinearAdapter, AdapterRegistry } from '../domain/adapter.js';
import { getRegistry } from '../domain/adapter.js';

export interface ImportEdge {
  /** File that does the importing. */
  importer: string;
  /** File being imported. */
  importee: string;
  /** Optional weight — number of distinct symbols imported. Default 1. */
  weight?: number;
}

export interface JujutsuSource {
  listImportEdges(): Promise<readonly ImportEdge[]>;
}

export interface JujutsuAdapterOptions {
  source: JujutsuSource;
  /** DD safety margin. Default 0.25. */
  ddSafetyMargin?: number;
}

export const JUJUTSU_IMPORT_GRAPH_ID = 'ruflo-jujutsu:import-graph';

export class JujutsuBlastRadiusAdapter implements SublinearAdapter {
  readonly graphId = JUJUTSU_IMPORT_GRAPH_ID;
  readonly ownerPlugin = 'ruflo-jujutsu';
  readonly requiresPreprocessing = false;

  private readonly source: JujutsuSource;
  private readonly ddSafetyMargin: number;

  constructor(options: JujutsuAdapterOptions) {
    this.source = options.source;
    this.ddSafetyMargin = options.ddSafetyMargin ?? 0.25;
  }

  async exportAsSparseMatrix(options?: { nodeFilter?: ReadonlySet<string> }): Promise<SparseMatrix> {
    const edges = await this.source.listImportEdges();
    const fileSet = new Set<string>();
    for (const e of edges) {
      fileSet.add(e.importer);
      fileSet.add(e.importee);
    }
    if (options?.nodeFilter) {
      for (const n of [...fileSet]) if (!options.nodeFilter.has(n)) fileSet.delete(n);
    }
    const files = [...fileSet].sort();
    const nodeIndex: Record<string, number> = {};
    files.forEach((f, i) => (nodeIndex[f] = i));

    // For blast-radius PR seeded at the changed file: we want change to flow
    // from `importee` → `importer`. So row = importee, col = importer.
    const entries: SparseEntry[] = [];
    const rowSums = new Array<number>(files.length).fill(0);
    for (const e of edges) {
      const r = nodeIndex[e.importee];
      const c = nodeIndex[e.importer];
      if (r === undefined || c === undefined || r === c) continue;
      const w = Math.max(0, e.weight ?? 1);
      entries.push({ row: r, col: c, value: w });
      rowSums[r] += w;
    }
    for (let i = 0; i < files.length; i++) {
      entries.push({ row: i, col: i, value: rowSums[i]! + this.ddSafetyMargin });
    }
    return {
      graphId: this.graphId,
      size: files.length,
      entries,
      nodeIndex,
      indexNode: files,
      capturedAt: new Date().toISOString(),
      contentHash: hashContent(this.graphId, entries),
    };
  }
}

export function registerJujutsuBlastRadiusAdapter(
  options: JujutsuAdapterOptions & { registry?: AdapterRegistry },
): JujutsuBlastRadiusAdapter {
  const adapter = new JujutsuBlastRadiusAdapter(options);
  (options.registry ?? getRegistry()).register(adapter);
  return adapter;
}

function hashContent(graphId: string, entries: readonly SparseEntry[]): string {
  const h = createHash('sha256');
  h.update(graphId);
  for (const e of entries) h.update(`|${e.row},${e.col},${e.value.toFixed(8)}`);
  return h.digest('hex');
}
