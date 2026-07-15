/**
 * cost-governor/diversity.ts — ADR-179 sub-feature 5 (swarm diversity gate).
 *
 * `diversity_score = 1 - max_type_share` over the roster's agent-type
 * distribution (role heterogeneity — solver/critic/aggregator per
 * arXiv:2607.07729), NOT model distribution (model choice is ADR-026's
 * concern — conflating the two would double-govern the same axis).
 *
 * Enforcement point is `agent_spawn`-time registration, not `swarm_init` —
 * `swarm_init`'s schema carries only topology/strategy, no agent-type list
 * (confirmed by inspection), so there is nothing to gate at that call site.
 * Score is recomputed on every registration once the roster has >= 3
 * agents. Default `enforce: 'warn'` never blocks a spawn — escalation to
 * `'reject'` is a separate, explicit opt-in.
 *
 * @module @claude-flow/hooks/cost-governor/diversity
 */

import type { CostGovernorConfig } from './types.js';

/** 1 - (largest same-agent-type cluster / roster size). 0 = fully homogeneous, near 1 = fully diverse. */
export function computeDiversityScore(roster: string[]): number {
  if (roster.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const t of roster) counts.set(t, (counts.get(t) ?? 0) + 1);
  const maxShare = Math.max(...counts.values()) / roster.length;
  return 1 - maxShare;
}

export interface DiversityGateResult {
  diversity_score: number;
  blocked: boolean;
  message?: string;
}

/**
 * Evaluate the diversity gate for a roster of agent types. Only meaningful
 * once the roster has >= 3 agents — a 1-2 agent swarm has no useful
 * homogeneity signal. Never blocks when disabled, in 'warn' mode (the
 * default), or below the 3-agent floor.
 */
export function checkDiversityGate(
  roster: string[],
  cfg: CostGovernorConfig['diversityGate'],
): DiversityGateResult {
  const diversity_score = computeDiversityScore(roster);

  if (!cfg.enabled || roster.length < 3) {
    return { diversity_score, blocked: false };
  }

  const homogeneous = diversity_score < cfg.floor;
  if (!homogeneous) {
    return { diversity_score, blocked: false };
  }

  const message =
    `Swarm roster is ${((1 - diversity_score) * 100).toFixed(0)}% homogeneous ` +
    `(diversity_score=${diversity_score.toFixed(2)}, floor=${cfg.floor}). ` +
    'Recommend a heterogeneous agent-type mix (arXiv:2607.07729: 2.3x accuracy over homogeneous configs).';

  return { diversity_score, blocked: cfg.enforce === 'reject', message };
}
