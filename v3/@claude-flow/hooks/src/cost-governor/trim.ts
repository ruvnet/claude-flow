/**
 * cost-governor/trim.ts — ADR-179 sub-feature 1 (context trim).
 *
 * Filters the ephemeral candidate set assembled by GuidanceProvider /
 * ReasoningBank pattern-search just before it is surfaced into the prompt.
 * Never mutates AgentDB/ReasoningBank storage (ADR-174 invariant) — this is
 * a retrieval-time filter only. MCP tool-call context (the harness's own
 * transcript) is out of scope; that window is owned by Claude Code.
 *
 * @module @claude-flow/hooks/cost-governor/trim
 */

import type { GuidancePattern, GuidanceResult } from '../reasoningbank/index.js';
import type { CostGovernorConfig } from './types.js';
import { defaultTurnCounter, TurnCounter } from './turn-counter.js';

export interface RetrievedCandidate {
  pattern: GuidancePattern;
  similarity: number;
  lastAccessTurn: number;
}

/**
 * Pure filter — deterministic (same input always produces the same
 * output). Keeps a candidate when it is recent enough (within
 * `maxTurnAge` turns) OR scores high enough (`>= minRetrievalScore`).
 */
export function trimCandidates<T extends { similarity: number; lastAccessTurn: number }>(
  candidates: T[],
  turn: number,
  cfg: CostGovernorConfig['contextTrim'],
): T[] {
  if (!cfg.enabled) return candidates;
  return candidates.filter(
    (c) => turn - c.lastAccessTurn <= cfg.maxTurnAge || c.similarity >= cfg.minRetrievalScore,
  );
}

/**
 * Apply context trim to a `GuidanceResult` just before its patterns are
 * serialized into `additionalContext`. Only `patterns` is filtered —
 * `recommendations` (domain templates) are unaffected.
 */
export function trimGuidanceResult(
  guidance: GuidanceResult,
  sessionId: string,
  cfg: CostGovernorConfig['contextTrim'],
  turnCounter: TurnCounter = defaultTurnCounter,
): { result: GuidanceResult; trimmedCount: number } {
  if (!cfg.enabled) return { result: guidance, trimmedCount: 0 };

  const turn = turnCounter.current(sessionId);
  const candidates: RetrievedCandidate[] = guidance.patterns.map(({ pattern, similarity }) => ({
    pattern,
    similarity,
    lastAccessTurn: pattern.lastAccessTurn ?? turnCounter.turnAt(sessionId, pattern.updatedAt),
  }));

  const kept = trimCandidates(candidates, turn, cfg);
  const trimmedCount = candidates.length - kept.length;

  return {
    result: {
      ...guidance,
      patterns: kept.map(({ pattern, similarity }) => ({ pattern, similarity })),
    },
    trimmedCount,
  };
}
