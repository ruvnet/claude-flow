import type { ActionSpec } from './actions'
import { modelStatsProbe, probeArgv } from './data/cli'
import type { Sample, State } from './state'
import { live } from './views/common'

export const BUDGET_PRESETS = [1, 5, 10, 25] as const
export const BUDGET_HELP = 'set costBudgetUsd in /config → ruflo-mods; restart/reload may be needed'
export const BUDGET_ARGV = ['claude', 'plugin', 'configure', 'ruflo-mods@ruflo', '--values-stdin'] as const

/** Decimal dollars only: no flags, exponents, currency marks or non-finite values. */
export function budgetAmount(text: string): number | null {
  const value = text.trim()
  const amount = Number(value)

  return /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) && Number.isFinite(amount) && amount >= 0.01 && amount <= 10_000 ? amount : null
}

/** The ruflo-mods ladder: OK below 50%, then INFO, WARNING, CRITICAL and HARD_STOP. */
export function ladderDollars(limit: number | undefined): { level: string; percent: number; usd: number | null }[] {
  return [['INFO', 50], ['WARNING', 75], ['CRITICAL', 90], ['HARD_STOP', 100]].map(([level, percent]) => ({
    level: String(level), percent: Number(percent), usd: limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit * Number(percent) / 100 : null,
  }))
}

export type Projection = { usdPerMinute: number; minutes: number | null }

/** A budget and the last 20 spend observations, spanning a minute without resets or duplicate times. */
export function projectSpend(samples: readonly Sample[], limit?: number, used?: number): Projection | null {
  const window = samples.slice(-20)
  const first = window[0]
  const last = window.at(-1)

  if (limit === undefined || !Number.isFinite(limit) || limit <= 0 || window.length < 3 || first === undefined || last === undefined || last.atMs - first.atMs < 60_000) return null
  if (window.some((sample, i) => {
    const previous = window[i - 1]

    return !Number.isFinite(sample.atMs) || !Number.isFinite(sample.value) || sample.value < 0 || (previous !== undefined && (sample.atMs <= previous.atMs || sample.value < previous.value))
  })) return null

  const usdPerMinute = (last.value - first.value) / ((last.atMs - first.atMs) / 60_000)
  const spend = used ?? last.value
  if (!Number.isFinite(spend) || spend < 0) return null

  return { usdPerMinute, minutes: spend >= limit ? 0 : usdPerMinute > 0 ? (limit - spend) / usdPerMinute : null }
}

/** A supported CLI is required before a budget button can ask to change anything. */
export const canSetBudget = (state: State): boolean => live<boolean>(state.probes.get('budget-config')) === true

export const budgetWhy = (state: State, value: string): string => budgetAmount(value) === null ? 'budget must be a number from 0.01 to 10000 USD' : `budget setter unavailable${state.probes.has('budget-config') ? '' : ' — open Cost to check CLI support'}; ${BUDGET_HELP}`

/** Only this option is sent to Claude Code; its configure command preserves all omitted options. */
export function setBudget(state: State, value: string): ActionSpec | null {
  const amount = budgetAmount(value)

  if (amount === null || !canSetBudget(state)) return null

  const stdin = JSON.stringify({ costBudgetUsd: String(amount) })

  return {
    label: `set ruflo-mods@ruflo costBudgetUsd to $${amount}`,
    args: [], argv: BUDGET_ARGV, stdin,
    shows: `${BUDGET_ARGV.join(' ')} · stdin ${stdin}`,
    expect: `costBudgetUsd = ${amount}; restart/reload may be needed before the live budget changes`,
    note: 'Changes the ruflo-mods user plugin option only; restart/reload may be needed. Does not change the AI terminal’s $1 per-turn cap.',
  }
}

/** Reads local router counts at once; the JSON contains no billing totals. */
export const inspectModels = (state: State): ActionSpec => ({ label: 'model routing counts (dollars and tokens n/a)', args: modelStatsProbe.args, argv: probeArgv(modelStatsProbe, state.options.cli), isReadOnly: true, expect: 'local routing counts' })
