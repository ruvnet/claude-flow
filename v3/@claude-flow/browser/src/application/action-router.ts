/**
 * @claude-flow/browser - Action Router (ADR-122 Phase 5)
 *
 * Classifies each browser action into a routing tier so callers can dispatch
 * to the cheapest model that does the job. Bookkeeping: keeps per-trajectory
 * cost rollups exposed via getCostReport().
 *
 * Composition: this is the BROWSER-AWARE classifier; downstream the
 * `hooks_route` MCP tool already routes by global heuristics. The browser
 * router emits suggestions; callers can pass them to hooks_route as a hint.
 */

import {
  ActionTierSchema,
  type ActionTier,
  type ActionRoutingInput,
  type RoutingDecision,
  type TrajectoryCostReport,
} from '../domain/action-routing.js';

/** Tier-1 candidate verbs — pure DOM actions with a resolved ref need no LLM. */
const TIER_1_VERBS = new Set([
  'click', 'dblclick', 'fill', 'type', 'press', 'hover', 'focus', 'check',
  'uncheck', 'select', 'scroll', 'scrollintoview', 'screenshot', 'getText',
  'getHtml', 'getValue', 'getAttr', 'getTitle', 'getUrl', 'isVisible',
  'isEnabled', 'isChecked', 'snapshot', 'wait',
]);

/** Tier-2 verbs — visual / semantic grounding usually needs a small LLM. */
const TIER_2_VERBS = new Set([
  'findByText', 'findByLabel', 'findByPlaceholder', 'findByRole', 'findByTestId',
]);

/** Tier-3 verbs — anything involving plan-level reasoning or novel UI. */
const TIER_3_VERBS = new Set([
  'eval', 'openWithGoal', 'plan', 'recoverFromBreak',
]);

/** Per-action cost estimates (USD). Conservative defaults; override via config. */
const DEFAULT_TIER_COSTS: Record<ActionTier, number> = {
  'tier-1-booster': 0,
  'tier-2-haiku': 0.0002,
  'tier-3-frontier': 0.005,
};

export interface ActionRouterOptions {
  tierCosts?: Partial<Record<ActionTier, number>>;
  /** Causal risk threshold above which we always escalate to Tier 2+. */
  riskEscalationThreshold?: number;
}

export class ActionRouter {
  private readonly tierCosts: Record<ActionTier, number>;
  private readonly riskEscalationThreshold: number;
  private readonly costs: Map<string, TrajectoryCostReport> = new Map();

  constructor(options: ActionRouterOptions = {}) {
    this.tierCosts = { ...DEFAULT_TIER_COSTS, ...options.tierCosts };
    this.riskEscalationThreshold = options.riskEscalationThreshold ?? 0.5;
  }

  /** Classify a single action. */
  classify(input: ActionRoutingInput): RoutingDecision {
    // High causal risk forces Tier 2+ regardless of verb — the cheap path
    // is no good if the locator is known-brittle.
    if ((input.causalRiskScore ?? 0) >= this.riskEscalationThreshold) {
      return {
        tier: 'tier-2-haiku',
        estimatedCostUsd: this.tierCosts['tier-2-haiku'],
        model: 'haiku',
        rationale: `causal risk ${input.causalRiskScore?.toFixed(2)} ≥ ${this.riskEscalationThreshold} — escalate from Tier 1`,
      };
    }

    // Explicit complexity hints override verb classification.
    if (input.complexity === 'high') {
      return {
        tier: 'tier-3-frontier',
        estimatedCostUsd: this.tierCosts['tier-3-frontier'],
        model: 'sonnet',
        rationale: 'caller hint: high complexity → Tier 3',
      };
    }

    // Tier 1 wins if the action is a pure DOM verb with a resolved ref.
    if (TIER_1_VERBS.has(input.action) && input.hasResolvedRef !== false) {
      return {
        tier: 'tier-1-booster',
        estimatedCostUsd: this.tierCosts['tier-1-booster'],
        model: 'agent-booster',
        rationale: 'pure DOM action with resolved ref — no LLM needed',
      };
    }

    if (TIER_2_VERBS.has(input.action)) {
      return {
        tier: 'tier-2-haiku',
        estimatedCostUsd: this.tierCosts['tier-2-haiku'],
        model: 'haiku',
        rationale: 'semantic/visual grounding required — Tier 2',
      };
    }

    if (TIER_3_VERBS.has(input.action) || input.complexity === 'medium') {
      return {
        tier: 'tier-3-frontier',
        estimatedCostUsd: this.tierCosts['tier-3-frontier'],
        model: input.complexity === 'medium' ? 'sonnet' : 'sonnet',
        rationale: 'plan-level / reasoning action — Tier 3',
      };
    }

    // Default fallback — Tier 2 is the safe middle.
    return {
      tier: 'tier-2-haiku',
      estimatedCostUsd: this.tierCosts['tier-2-haiku'],
      model: 'haiku',
      rationale: 'default tier — verb not in tier-specific allow-lists',
    };
  }

  /** Record an action's outcome against a trajectory's cost ledger. */
  record(trajectoryId: string, decision: RoutingDecision): void {
    const report = this.costs.get(trajectoryId) ?? newReport(trajectoryId);
    report.byTier[decision.tier].count += 1;
    report.byTier[decision.tier].costUsd += decision.estimatedCostUsd;
    report.totalCostUsd += decision.estimatedCostUsd;
    const totalActions =
      report.byTier['tier-1-booster'].count +
      report.byTier['tier-2-haiku'].count +
      report.byTier['tier-3-frontier'].count;
    report.tier1Share = totalActions === 0 ? 0 : report.byTier['tier-1-booster'].count / totalActions;
    this.costs.set(trajectoryId, report);
  }

  getCostReport(trajectoryId: string): TrajectoryCostReport | undefined {
    return this.costs.get(trajectoryId);
  }

  listReports(): readonly TrajectoryCostReport[] {
    return [...this.costs.values()];
  }

  reset(): void {
    this.costs.clear();
  }
}

function newReport(trajectoryId: string): TrajectoryCostReport {
  return {
    trajectoryId,
    totalCostUsd: 0,
    byTier: {
      'tier-1-booster': { count: 0, costUsd: 0 },
      'tier-2-haiku': { count: 0, costUsd: 0 },
      'tier-3-frontier': { count: 0, costUsd: 0 },
    },
    tier1Share: 0,
  };
}

// Re-export tier schema for downstream consumers.
export { ActionTierSchema };
