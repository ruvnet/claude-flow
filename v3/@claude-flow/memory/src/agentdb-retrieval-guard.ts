/**
 * AgentDbRetrievalGuard — ADR-377 Phase 1.
 *
 * Filters AgentDB HNSW top-K retrieval results before they are assembled
 * into agent context. Closes the gap identified in ruvnet/ruflo#2516:
 * AgentDB's retrieval path has zero certified defenses against poisoned
 * memory entries — SMSR (arXiv:2606.12703) shows 93-100% undefended attack
 * success, reduced to 0% behind a certified content guard.
 *
 * This does not reimplement OWASP LLM01/LLM08 pattern detection — it wraps
 * `@claude-flow/security`'s `ToolOutputGuardrail` (ADR-131), which already
 * ships the injection pattern library and policy engine used elsewhere in
 * the codebase for tool-output screening. The size gate and per-chunk
 * annotation are the only AgentDB-retrieval-specific logic here.
 *
 * Off by default: set `CLAUDE_FLOW_RETRIEVAL_GUARD=true` to enable, and
 * `CLAUDE_FLOW_RETRIEVAL_GUARD_STRICT=true` to drop (rather than merely
 * flag) chunks above the configured severity threshold.
 */

import {
  ToolOutputGuardrail,
  createToolOutputGuardrail,
  type GuardrailConfig,
  type GuardrailResult,
} from '@claude-flow/security';
import type { SearchResult } from './types.js';

export interface RetrievalGuardConfig {
  /** Hard cap per chunk content length. Oversized chunks are flagged (or
   * dropped in strict mode) rather than truncated — truncation would let an
   * attacker pad a payload past the guardrail's own scan window. */
  maxPayloadBytes?: number;
  /** When true, chunks whose guardrail scan is unsafe are removed from the
   * result set entirely. When false (default), they pass through but are
   * annotated so callers can still choose to drop them. */
  blockOnSuspicion?: boolean;
  /** Extra options forwarded to the underlying ToolOutputGuardrail — use
   * `customPatterns` to add AgentDB-specific injection shapes. */
  guardrailConfig?: GuardrailConfig;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 8192;

export interface GuardedSearchResult extends SearchResult {
  /** Guardrail scan outcome for this entry's content. `undefined` if the
   * entry was oversized and therefore not scanned (treated as unsafe). */
  guardrail?: GuardrailResult;
  /** True if this result was retained after filtering. Always true unless
   * `blockOnSuspicion` is set and the guardrail rejected the content, or the
   * payload exceeded `maxPayloadBytes`. */
  retained: boolean;
  /** Reason a result was flagged or dropped; absent when clean. */
  flagReason?: 'oversized' | 'unsafe-content';
}

export interface FilteredSearchResults {
  results: GuardedSearchResult[];
  /** Count of input results dropped by `blockOnSuspicion`. Always 0 when
   * `blockOnSuspicion` is false. */
  droppedCount: number;
  /** Count of results whose content tripped the guardrail at any severity,
   * whether or not they were ultimately dropped. */
  flaggedCount: number;
}

/**
 * Reads the two feature flags this guard is gated behind, matching the
 * inline `process.env.CLAUDE_FLOW_*` convention used elsewhere in the repo
 * (e.g. `CLAUDE_FLOW_STRICT_GUARDRAIL` in mcp-client.ts) rather than a
 * central config schema.
 */
export function isRetrievalGuardEnabled(): boolean {
  return process.env.CLAUDE_FLOW_RETRIEVAL_GUARD === 'true';
}

export function isRetrievalGuardStrict(): boolean {
  return process.env.CLAUDE_FLOW_RETRIEVAL_GUARD_STRICT === 'true';
}

export class AgentDbRetrievalGuard {
  private readonly guardrail: ToolOutputGuardrail;
  private readonly maxPayloadBytes: number;
  private readonly blockOnSuspicion: boolean;

  constructor(config: RetrievalGuardConfig = {}) {
    this.maxPayloadBytes = config.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
    this.blockOnSuspicion = config.blockOnSuspicion ?? isRetrievalGuardStrict();
    this.guardrail = createToolOutputGuardrail(config.guardrailConfig);
  }

  /**
   * Filter HNSW search results before they reach context assembly.
   * Pure and synchronous — the underlying guardrail scan has no I/O.
   */
  filter(results: SearchResult[]): FilteredSearchResults {
    let droppedCount = 0;
    let flaggedCount = 0;

    const guarded: GuardedSearchResult[] = results.map((result) => {
      const content = result.entry.content;

      if (typeof content === 'string' && content.length > this.maxPayloadBytes) {
        flaggedCount++;
        const retained = !this.blockOnSuspicion;
        if (!retained) droppedCount++;
        return { ...result, retained, flagReason: 'oversized' };
      }

      const scan = this.guardrail.scan(content);
      if (!scan.safe) {
        flaggedCount++;
        const retained = !this.blockOnSuspicion;
        if (!retained) droppedCount++;
        return { ...result, guardrail: scan, retained, flagReason: 'unsafe-content' };
      }

      return { ...result, guardrail: scan, retained: true };
    });

    const filtered = this.blockOnSuspicion ? guarded.filter((r) => r.retained) : guarded;

    return { results: filtered, droppedCount, flaggedCount };
  }
}

/** Convenience factory mirroring `createToolOutputGuardrail`'s shape. */
export function createAgentDbRetrievalGuard(config?: RetrievalGuardConfig): AgentDbRetrievalGuard {
  return new AgentDbRetrievalGuard(config);
}
