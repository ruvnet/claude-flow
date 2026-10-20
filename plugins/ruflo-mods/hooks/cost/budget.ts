/**
 * The ruflo-cost-tracker budget ladder (scripts/budget.mjs `alertLevel`),
 * applied to the session's live cost as `session.measure` pushes it, with no
 * jsonl parse and no node spawn. The parity test reads the thresholds out of
 * budget.mjs.
 */

export type BudgetLevel = 'OK' | 'INFO' | 'WARNING' | 'CRITICAL' | 'HARD_STOP'

export const LEVELS: ReadonlyArray<{ readonly level: BudgetLevel; readonly at: number }> = [
  { level: 'HARD_STOP', at: 1.0 },
  { level: 'CRITICAL', at: 0.9 },
  { level: 'WARNING', at: 0.75 },
  { level: 'INFO', at: 0.5 },
]

const ORDER: Record<BudgetLevel, number> = { OK: 0, INFO: 1, WARNING: 2, CRITICAL: 3, HARD_STOP: 4 }

export function alertLevel(utilization: number): BudgetLevel {
  return LEVELS.find(l => utilization >= l.at)?.level ?? 'OK'
}

/** Whether `next` is a higher rung than `previous`: the one moment to tell. */
export const isRaised = (previous: BudgetLevel, next: BudgetLevel) => ORDER[next] > ORDER[previous]

/**
 * The budget in USD from the plugin option, or undefined when off: anything
 * not a finite positive number is off, never a zero budget that halts at once.
 */
export function budgetOf(option: unknown): number | undefined {
  const n = typeof option === 'string' ? Number(option) : option
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined
}
