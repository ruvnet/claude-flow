/**
 * @claude-flow/browser - Production-Aware UCT (ADR-122 Phase 7)
 *
 * Extends Phase 4's plain UCB1 with the substrate's production-aware formula:
 *
 *   score = Q + C·√(ln(parent_visits) / child_visits)
 *         + λ_R · replayability
 *         − λ_risk · risk
 *         − μ_cost · cost_usd
 *         − α_auth · auth_fragility
 *
 * Q   = mean trajectory value (success / similarity)
 * R   = replayability bonus (encourages reusable winning paths)
 * λ_R = replay weight
 *
 * The penalties keep MCTS from chasing high-Q paths that are expensive,
 * irreversible, or auth-fragile in production.
 */

import type { ProductionUctSignals, ProductionUctWeights } from '../domain/workflow.js';
import { DEFAULT_PRODUCTION_UCT_WEIGHTS } from '../domain/workflow.js';

export interface ProductionUctInput {
  /** Visits for the candidate branch. */
  visits: number;
  /** Total visits across all siblings (for the ln(N) term). */
  parentVisits: number;
  signals: ProductionUctSignals;
}

/** Compute the production-aware UCT score. Unvisited branches return +Infinity. */
export function productionUct(
  input: ProductionUctInput,
  weights: ProductionUctWeights = DEFAULT_PRODUCTION_UCT_WEIGHTS,
): number {
  if (input.visits === 0) return Number.POSITIVE_INFINITY;
  const exploitation = input.signals.qValue;
  const exploration = weights.c * Math.sqrt(Math.log(Math.max(1, input.parentVisits)) / input.visits);
  const replayBonus = weights.replayBonus * input.signals.replayability;
  const riskPenalty = weights.riskPenalty * input.signals.risk;
  const costPenalty = weights.costPenalty * input.signals.costUsd;
  const authPenalty = weights.authPenalty * input.signals.authFragility;
  return exploitation + exploration + replayBonus - riskPenalty - costPenalty - authPenalty;
}

/**
 * Compose two scoring sources — useful when a branch carries both a raw
 * scorer value (HNSW similarity, Phase 4) and observed signals (cost, auth).
 */
export function blendQ(scorerValue: number, replaySuccessRate?: number): number {
  if (replaySuccessRate === undefined) return scorerValue;
  // Linear blend so both sources matter — replay carries 30% weight by default.
  return 0.7 * scorerValue + 0.3 * replaySuccessRate;
}
