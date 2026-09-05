/**
 * OAS (Operator-Aware Selection) memory-consolidation operator picker
 * (#2763 dream-cycle).
 *
 * Findings from the OAS paper referenced in dream-cycle #2763: memory-
 * consolidation performance improves by +48% when the caller picks the
 * RIGHT operator for the current budget + workload, instead of always
 * applying the most-expensive one. Ruflo already has multiple
 * consolidation operators (merge / summarize / compress / distill),
 * but has no cost-aware selector — every `memory consolidate` call
 * uses the same path.
 *
 * v1 MVP: rule-based selector. Cost-per-entry estimates are informed
 * by ruflo's own measured performance targets in v3/@claude-flow/cli/
 * CLAUDE.md — no external benchmark call needed. v2 will refine costs
 * from routing-outcomes trajectories.
 */

/** The four consolidation operators ruflo can apply. */
export type OperatorId = 'merge' | 'summarize' | 'compress' | 'distill';

export interface OperatorSpec {
  id: OperatorId;
  /** Estimated cost per entry, in abstract "operator points" (1 point ≈ 1 Haiku call). */
  costPerEntry: number;
  /** Maximum recommended entry count per invocation (higher counts split). */
  maxEntries: number;
  /** What the operator does — human-readable. */
  description: string;
  /** Best when the entry set has this shape. */
  bestWhen: string;
}

export const OPERATORS: Record<OperatorId, OperatorSpec> = {
  merge: {
    id: 'merge',
    costPerEntry: 0.02, // near-free — deterministic near-duplicate merge
    maxEntries: 5000,
    description: 'Near-duplicate merge (deterministic, cosine ≥ 0.95)',
    bestWhen: 'Many near-identical entries (e.g. duplicated command traces)',
  },
  summarize: {
    id: 'summarize',
    costPerEntry: 0.5, // one Haiku call per ~2 entries
    maxEntries: 500,
    description: 'Short-to-long consolidation via Haiku (1 call per ~2 entries)',
    bestWhen: 'Verbose logs / trajectory steps that share a theme',
  },
  compress: {
    id: 'compress',
    costPerEntry: 1.5, // LoRA-style compression pass — heavier
    maxEntries: 200,
    description: 'LoRA/EWC-style compression preserving semantic embeddings',
    bestWhen: 'High-fidelity pattern preservation across many entries',
  },
  distill: {
    id: 'distill',
    costPerEntry: 3, // full distillation — heaviest
    maxEntries: 100,
    description: 'Full pattern distillation (extracts high-value patterns for ReasoningBank)',
    bestWhen: 'Extracting durable learnings from a small high-signal set',
  },
};

export interface OperatorSelection {
  operator: OperatorId;
  reason: string;
  /** Estimated cost = costPerEntry × min(entries, maxEntries). */
  estimatedCost: number;
  /** True if entries > operator.maxEntries and caller should split into multiple invocations. */
  needsSplit: boolean;
  suggestedBatchSize: number;
  /** All operators considered, in ranked order (best first). */
  considered: Array<{ id: OperatorId; cost: number; fits: boolean }>;
}

export interface SelectOptions {
  /** Budget in abstract operator points. */
  budget: number;
  /** Number of entries to consolidate. */
  entries: number;
  /**
   * Optional hint about entry shape:
   *   'duplicates' → strongly prefer merge (cheap wins first)
   *   'verbose'    → prefer summarize
   *   'patterns'   → prefer distill (small, high-signal)
   *   'general'    → let cost-fit decide (default)
   */
  hint?: 'duplicates' | 'verbose' | 'patterns' | 'general';
}

/**
 * Select the highest-value operator that fits the budget.
 *
 * Selection rule (v1):
 *   1. If a hint is provided AND the hinted operator fits the budget,
 *      pick it (hint is a strong signal about entry shape).
 *   2. Else, rank operators by cost ascending; pick the most expensive
 *      operator that still fits budget × 1.0 (no over-spend). Idea:
 *      spend the whole budget on the most-fidelity operator we can afford.
 *   3. If nothing fits, return merge (guaranteed cheapest) with
 *      needsSplit=true so caller batches.
 */
export function selectOperator(opts: SelectOptions): OperatorSelection {
  const { budget, entries, hint } = opts;

  const considered = (Object.keys(OPERATORS) as OperatorId[]).map((id) => {
    const spec = OPERATORS[id];
    const effectiveEntries = Math.min(entries, spec.maxEntries);
    const cost = spec.costPerEntry * effectiveEntries;
    return { id, cost, fits: cost <= budget };
  }).sort((a, b) => a.cost - b.cost);

  // Rule 1: honor a shape hint if the hinted operator fits.
  const hintMap: Record<NonNullable<SelectOptions['hint']>, OperatorId> = {
    duplicates: 'merge',
    verbose: 'summarize',
    patterns: 'distill',
    general: 'compress',
  };
  if (hint && hint !== 'general') {
    const preferred = hintMap[hint];
    const match = considered.find((c) => c.id === preferred);
    if (match?.fits) {
      const spec = OPERATORS[match.id];
      return {
        operator: match.id,
        reason: `Hint "${hint}" → ${match.id} (cost ${match.cost.toFixed(2)} ≤ budget ${budget})`,
        estimatedCost: match.cost,
        needsSplit: entries > spec.maxEntries,
        suggestedBatchSize: spec.maxEntries,
        considered,
      };
    }
  }

  // Rule 2: pick the most-expensive operator that still fits.
  const fitting = considered.filter((c) => c.fits);
  if (fitting.length > 0) {
    const best = fitting[fitting.length - 1]; // most expensive fitting
    const spec = OPERATORS[best.id];
    return {
      operator: best.id,
      reason: `Best-fit within budget: ${best.id} at cost ${best.cost.toFixed(2)} (budget ${budget}, entries ${entries})`,
      estimatedCost: best.cost,
      needsSplit: entries > spec.maxEntries,
      suggestedBatchSize: spec.maxEntries,
      considered,
    };
  }

  // Rule 3: budget too small for any operator on the full entry set.
  // Split via merge (cheapest) with the merge batch size.
  const mergeSpec = OPERATORS.merge;
  const batchSize = Math.max(1, Math.floor(budget / mergeSpec.costPerEntry));
  return {
    operator: 'merge',
    reason: `Budget ${budget} too small for any operator across ${entries} entries — split via merge in batches of ${batchSize}`,
    estimatedCost: budget,
    needsSplit: true,
    suggestedBatchSize: batchSize,
    considered,
  };
}
