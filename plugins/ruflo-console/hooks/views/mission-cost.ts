import type { RenderElement } from 'claude-code'

import type { MissionCost } from '../data/mission-cost'
import { capState } from '../data/mission-cost'
import { kv, rule, text, THEME, type Ctx } from './common'
import { ladder } from './cost'
import { moneyText } from './cost-providers'

/** The host clips a line at 60 columns; these notes stay shorter so nothing is cut mid-word. */
const LINE = 49
const short = (value: string): string => (value.length > LINE ? `${value.slice(0, LINE - 1)}…` : value)

const COLOR = { none: undefined, OK: THEME.ok, INFO: THEME.info, WARNING: THEME.warn, CRITICAL: THEME.warn, HARD_STOP: THEME.bad } as const

/** What the mission has spent, against its cap when it has one. `n/a` when the ledger did not answer. */
export function missionCostRows(ctx: Ctx, cost: MissionCost | null, cap: number | null, sourceNote: string): RenderElement[] {
  const rows = [rule(ctx, 'Mission spend', 'list-price estimate')]

  rows.push(kv(ctx, 'spend', cost === null || cost.usd === null ? 'n/a' : moneyText({ usd: cost.usd })))
  if (cost !== null && cost.credits !== null) rows.push(kv(ctx, 'Codex', moneyText({ credits: cost.credits })))
  rows.push(kv(ctx, 'cap', cap === null ? 'none set' : `$${cap.toFixed(2)}`))

  const state = capState(cost?.usd ?? null, cap)

  if (cap !== null && cost !== null && cost.usd !== null) {
    rows.push(text(ctx, ` ${ladder(cost.usd, cap, Math.min(30, Math.max(10, ctx.columns - 24)))} ${state.level} ${Math.round(state.percent ?? 0)}%`, { color: COLOR[state.level] }))
    rows.push(text(ctx, ' Marks: 50, 75, 90, 100% of the cap.', { dimColor: true }))
  }

  if (cost !== null && cost.unpriced.length > 0) rows.push(text(ctx, short(` Unpriced, not $0: ${cost.unpriced.join(', ')}`), { color: THEME.warn }))
  if (cost !== null && cost.usd === null && cost.rows > 0) rows.push(text(ctx, ' Every model here is unpriced.', { dimColor: true }))

  rows.push(text(ctx, short(` ${sourceNote}`), { dimColor: true }))
  rows.push(text(ctx, ' A list-price estimate, not a bill.', { dimColor: true }))
  rows.push(text(ctx, ' USD and credits are never added together.', { dimColor: true }))

  return rows
}
