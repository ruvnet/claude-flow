/**
 * @claude-flow/browser - Causal Recovery Service (ADR-122 Phase 2)
 *
 * Coordinates the in-process break store + snapshot annotation so the
 * BrowserService can:
 *   1. Record selector breaks as they happen (via reportBreak)
 *   2. Annotate a fresh snapshot with `_causalRiskScore` per element-ref
 *   3. Explain a current failure (priorBreaks + suggested alternative locators)
 *
 * Phase 2 ships an in-process implementation. Phase 2.5 substitutes the
 * store backend with the AgentDB causal-edge MCP bridge — caller-facing
 * API does not change.
 */

import {
  InMemoryBreakStore,
  JsonFileBreakStore,
  classifyBreak,
  parseUrl,
  type IBreakStore,
} from '../infrastructure/causal-recovery-store.js';
import type {
  SelectorBreakEvent,
  CausalRiskAnnotation,
  RecoveryExplanation,
} from '../domain/causal-recovery.js';
import type { Snapshot, SnapshotNode, ActionResult } from '../domain/types.js';

export interface CausalRecoveryServiceOptions {
  /** Existing store to use (else creates an in-memory one). */
  store?: IBreakStore;
  /** Path on disk for persistence; ignored when `store` is supplied. */
  persistPath?: string;
}

/**
 * Snapshot annotated with causal risk scores.
 *
 * Returned by `annotateSnapshot`. The wire shape is identical to a regular
 * Snapshot plus a `_causal` field for per-ref risk metadata.
 */
export interface AnnotatedSnapshot extends Snapshot {
  _causal: Record<string, CausalRiskAnnotation>;
}

export class CausalRecoveryService {
  private readonly store: IBreakStore;

  constructor(options: CausalRecoveryServiceOptions = {}) {
    if (options.store) {
      this.store = options.store;
    } else if (options.persistPath) {
      this.store = new JsonFileBreakStore(options.persistPath);
    } else {
      this.store = new InMemoryBreakStore();
    }
  }

  /**
   * Record a selector break observed during a browser action.
   *
   * Typically wired into the adapter's retry path so every retried failure
   * produces an edge in the causal graph.
   */
  async reportBreak(input: {
    url: string;
    selector: string;
    action: string;
    actionResult: ActionResult;
    lastKnownRole?: string;
    lastKnownName?: string;
    sessionId?: string;
  }): Promise<SelectorBreakEvent> {
    const { origin, path } = parseUrl(input.url);
    return this.store.recordBreak({
      origin,
      path,
      selector: input.selector,
      action: input.action,
      kind: classifyBreak(input.actionResult.error),
      reason: input.actionResult.error,
      lastKnownRole: input.lastKnownRole,
      lastKnownName: input.lastKnownName,
      sessionId: input.sessionId,
    });
  }

  /** Per-(origin, selector) risk lookup — single point. */
  getRisk(url: string, selector: string): Promise<CausalRiskAnnotation> {
    const { origin } = parseUrl(url);
    return this.store.getRisk(origin, selector);
  }

  /** Recovery explanation — prior breaks + suggested alternatives. */
  explain(url: string, failingSelector: string, options: { lastKnownRole?: string; lastKnownName?: string } = {}): Promise<RecoveryExplanation> {
    const { origin } = parseUrl(url);
    return this.store.explainRecovery(origin, failingSelector, options);
  }

  listBreaks(url: string): Promise<SelectorBreakEvent[]> {
    const { origin } = parseUrl(url);
    return this.store.listBreaks(origin);
  }

  /**
   * Annotate a snapshot with `_causalRiskScore` per element-ref.
   *
   * Returns a copy of the snapshot with a top-level `_causal` map. Existing
   * snapshot fields are preserved byte-for-byte so downstream consumers can
   * ignore the annotation if they don't care.
   */
  async annotateSnapshot(snapshot: Snapshot, url: string): Promise<AnnotatedSnapshot> {
    const refs = Object.keys(snapshot.refs ?? {});
    const annotations: Record<string, CausalRiskAnnotation> = {};
    for (const ref of refs) {
      annotations[ref] = await this.getRisk(url, ref);
    }
    return { ...snapshot, _causal: annotations };
  }

  /**
   * Decorate a snapshot tree in-place with `_causalRiskScore` markers on each
   * node that has a ref. Useful when callers want a single object to inspect
   * rather than a separate `_causal` map.
   */
  async decorateTree(snapshot: Snapshot, url: string): Promise<Snapshot> {
    const annotated = await this.annotateSnapshot(snapshot, url);
    walk(annotated.tree, annotated._causal);
    return annotated;
  }

  /** Direct store access for tests / advanced consumers. */
  getStore(): IBreakStore {
    return this.store;
  }
}

function walk(node: SnapshotNode | undefined, annotations: Record<string, CausalRiskAnnotation>): void {
  if (!node) return;
  if (node.ref && annotations[node.ref]) {
    const ann = annotations[node.ref];
    (node as SnapshotNode & { _causalRiskScore?: number; _causalBreakCount?: number }).
      _causalRiskScore = ann.riskScore;
    (node as SnapshotNode & { _causalRiskScore?: number; _causalBreakCount?: number }).
      _causalBreakCount = ann.breakCount;
  }
  for (const child of node.children ?? []) walk(child, annotations);
}
