/**
 * @claude-flow/browser - Action Routing Types (ADR-122 Phase 5)
 *
 * Per-action cost-aware model routing. The intuition (from ADR-026):
 *
 *   Tier 1 — Agent Booster (WASM, $0, <1ms): simple DOM-present actions
 *            where the selector is already known (e.g. click @e1, fill @e2).
 *   Tier 2 — Haiku ($0.0002, ~500ms): visual grounding or find-by-text on
 *            unfamiliar pages, low-complexity recovery.
 *   Tier 3 — Sonnet/Opus ($0.003-$0.015, 2-5s): plan-level reasoning, complex
 *            recovery, security-sensitive decisions.
 *
 * The classifier is heuristic and reversible — callers can override per-action.
 * It composes with existing `hooks_route` rather than replacing it.
 */

import { z } from 'zod';

export const ActionTierSchema = z.enum(['tier-1-booster', 'tier-2-haiku', 'tier-3-frontier']);
export type ActionTier = z.infer<typeof ActionTierSchema>;

export interface RoutingDecision {
  tier: ActionTier;
  estimatedCostUsd: number;
  /** Suggested model name for downstream hooks_route consumption. */
  model: 'agent-booster' | 'haiku' | 'sonnet' | 'opus';
  /** Why this tier was chosen. */
  rationale: string;
}

export interface ActionRoutingInput {
  /** Action verb (open/click/fill/find/snapshot/...). */
  action: string;
  /** Selector / target if applicable. */
  selector?: string;
  /** True if the action targets a known element-ref (`@e1`) — Tier 1 candidate. */
  hasResolvedRef?: boolean;
  /** Causal risk score for the target ref (from Phase 2). High risk → escalate. */
  causalRiskScore?: number;
  /** Action complexity hint from the caller. */
  complexity?: 'low' | 'medium' | 'high';
}

/** Per-trajectory aggregate cost report. */
export interface TrajectoryCostReport {
  trajectoryId: string;
  totalCostUsd: number;
  byTier: Record<ActionTier, { count: number; costUsd: number }>;
  /** Share of actions that bypassed the LLM entirely (Tier 1). */
  tier1Share: number;
}
