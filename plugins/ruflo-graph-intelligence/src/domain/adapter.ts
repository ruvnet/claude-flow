/**
 * ruflo-graph-intelligence — Adapter Contract (ADR-123 § Architecture)
 *
 * Each owning plugin (browser, federation, knowledge-graph, …) implements
 * this interface and registers itself at plugin-load time. The registry is
 * plugin-local — the source plugin understands its own storage layout best.
 */

import type { SparseMatrix } from './types.js';

export interface SublinearAdapter {
  /** Stable identifier — `"ruflo-federation:trust-mesh"`, etc. */
  readonly graphId: string;

  /** Owning plugin's package name; informational. */
  readonly ownerPlugin: string;

  /**
   * Export the current graph state as a SparseMatrix.
   *
   * `since` is an optional snapshot ISO timestamp — adapters may return
   * a frozen snapshot at that moment (for reproducibility) instead of
   * the live state. Adapters that don't support history return the live
   * state regardless.
   *
   * `nodeFilter` is an optional allow-list — adapters that can prune
   * irrelevant rows should honour it to keep the matrix small. Adapters
   * that can't filter return the full matrix.
   */
  exportAsSparseMatrix(options?: {
    since?: string;
    nodeFilter?: ReadonlySet<string>;
  }): Promise<SparseMatrix>;

  /**
   * Best-effort streaming hook — adapters that can emit deltas (new
   * causal events, new federation trust updates, new spans) push
   * `SparseDelta`s through this listener. Adapters that can't return
   * `noopUnsubscribe`.
   */
  onChange?(listener: (delta: import('./types.js').SparseDelta) => void): () => void;

  /**
   * Whether this graph is **structurally** non-DD (e.g. asymmetric trust with
   * negative weights). Adapters that know they need clamping/renormalisation
   * before submission set this flag so the registry can advise callers.
   */
  readonly requiresPreprocessing?: boolean;
}

/** No-op unsubscribe for adapters that don't support streaming. */
export const noopUnsubscribe = (): void => {};

/** Plugin-load-time registry — populated via `register()`. */
export class AdapterRegistry {
  private adapters = new Map<string, SublinearAdapter>();

  register(adapter: SublinearAdapter): void {
    if (this.adapters.has(adapter.graphId)) {
      throw new Error(`adapter ${adapter.graphId} already registered`);
    }
    this.adapters.set(adapter.graphId, adapter);
  }

  unregister(graphId: string): boolean {
    return this.adapters.delete(graphId);
  }

  get(graphId: string): SublinearAdapter | undefined {
    return this.adapters.get(graphId);
  }

  list(): SublinearAdapter[] {
    return [...this.adapters.values()];
  }

  clear(): void {
    this.adapters.clear();
  }
}

/** Singleton registry — same lifetime as the plugin process. */
let globalRegistry: AdapterRegistry | undefined;
export function getRegistry(): AdapterRegistry {
  if (!globalRegistry) globalRegistry = new AdapterRegistry();
  return globalRegistry;
}

/** Test hook. */
export function resetRegistry(): void {
  globalRegistry = undefined;
}
