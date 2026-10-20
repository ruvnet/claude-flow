import type { RenderElement } from 'claude-code'

import { BUDGET_HELP, BUDGET_PRESETS, canSetBudget, ladderDollars, projectSpend } from '../cost'
import type { ModelStats } from '../data/cli'
import { button, col, kv, live, pct, picture, row, rule, sourceLine, text, THEME, type Ctx } from './common'
import { providerRows } from './cost-providers'

const LADDER = [0.5, 0.75, 0.9, 1] as const
const dollars = (value: number | undefined | null): string => value === undefined || value === null || !Number.isFinite(value) || value < 0 ? 'n/a' : `$${value.toFixed(3)}`

/** The budget ladder as a text bar, with marks at 50/75/90/100% of the limit. */
export function ladder(usd: number, limit: number, width: number): string {
  const cells = Math.max(10, width)
  const at = Math.min(cells, Math.round((usd / limit) * cells))
  const marks = new Set(LADDER.map(step => Math.min(cells - 1, Math.round(step * cells) - 1)))

  return Array.from({ length: cells }, (_, i) => (marks.has(i) ? '│' : i < at ? '█' : '·')).join('')
}

/** Presets and custom dollars share the same confirm-gated palette entry. */
function budgetRows(ctx: Ctx): RenderElement[] {
  const { state } = ctx
  const rows = [rule(ctx, 'Set a budget', 'ruflo-mods · asks first')]

  rows.push(row(ctx, BUDGET_PRESETS.map(amount => button(ctx, `cost-budget-${amount}`, `$${amount}`, () => void ctx.act.run(`cost-budget-${amount}`)))))
  if (ctx.kit.Input !== undefined) rows.push(ctx.kit.Input({ key: 'cost-budget', label: 'custom USD', value: state.costBudgetDraft, placeholder: '0.01–10000', onInput: ctx.act.costBudgetDraft, onSubmit: value => void ctx.act.run('cost-budget', value), submitLabel: 'ask' }))
  rows.push(button(ctx, 'cost-budget-apply', 'Set custom budget', () => void ctx.act.run('cost-budget', state.costBudgetDraft)))
  rows.push(text(ctx, canSetBudget(state) ? ' Changes costBudgetUsd only; restart/reload may be needed. AI terminal cap stays $1 per Claude turn.' : ` Budget setter unavailable: ${BUDGET_HELP}`, { dimColor: true }))

  return rows
}

/** Sources have different scopes and coverage, so they are never added into a grand total. */
function breakdownRows(ctx: Ctx): RenderElement[] {
  const { state } = ctx
  const budget = state.ruflo.snapshot?.budget
  const used = budget?.usd ?? state.usage?.costUsd
  const term = state.terminal
  const stats = live<ModelStats>(state.probes.get('model-stats'))
  const rows = [rule(ctx, 'Where it goes', 'reported USD · sources are not additive')]

  rows.push(kv(ctx, 'Claude Code', `${dollars(state.usage?.costUsd)} · this session`))
  rows.push(kv(ctx, 'AI terminal', `${dollars(term.costReports > 0 ? term.costUsd : undefined)} · reported subtotal this session (${term.costReports} cost reports)`))
  rows.push(kv(ctx, 'terminal turns', `codex ${term.turns.codex} · claude ${term.turns.claude} · per-agent dollars n/a`))
  rows.push(kv(ctx, 'ruflo models', `n/a USD · tokens n/a · ${stats?.isAvailable === true ? `${stats.total ?? 'n/a'} decisions` : 'router unavailable'}`))
  for (const model of stats?.isAvailable === true ? stats.models : []) rows.push(kv(ctx, model.name, `${model.count} routes · spend n/a · tokens n/a`))
  rows.push(text(ctx, ' Router counts are persisted across sessions, not bills. Missing cost reports are not zero.', { dimColor: true }))
  rows.push(text(ctx, ` ${sourceLine(state.probes.get('model-stats'), ctx.nowMs, 'model-stats').text}`, { dimColor: true }))
  rows.push(kv(ctx, 'headroom', budget === undefined || used === undefined ? 'n/a' : `${dollars(Math.max(0, budget.limit - used))} · ruflo-mods budget${used > budget.limit ? ` · over by ${dollars(used - budget.limit)}` : ''}`))
  rows.push(row(ctx, [button(ctx, 'cost-model-stats', 'Inspect model stats', () => void ctx.act.run('cost-model-stats')), button(ctx, 'cost-refresh', 'Refresh cost', ctx.act.refresh)]))

  return rows
}

/** Session spend, budget controls, source coverage and a projection from actual timed observations. */
export function costView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const budget = state.ruflo.snapshot?.budget
  const spend = state.usage?.costUsd
  const used = budget?.usd ?? spend
  const projection = projectSpend(state.history.spend, budget?.limit, used)
  const rows: RenderElement[] = [rule(ctx, 'Cost', 'this session'), ...budgetRows(ctx)]

  rows.push(picture(ctx, 'gauge', budget === undefined ? 'no budget set' : `${dollars(used)} of $${budget.limit.toFixed(2)}`))
  rows.push(kv(ctx, 'context', state.usage?.contextPercent === undefined ? 'n/a' : `${Math.round(state.usage.contextPercent)}% of the window`))
  if (budget === undefined) {
    rows.push(kv(ctx, 'budget', state.ruflo.snapshot === null ? 'n/a — ruflo-mods not seated' : 'none set · choose a preset or custom amount'))
  } else {
    const color = budget.level === 'OK' || budget.level === 'INFO' ? THEME.ok : budget.level === 'WARNING' ? THEME.warn : THEME.bad

    rows.push(kv(ctx, 'budget', `${budget.level} · ${used === undefined ? 'n/a' : `$${used.toFixed(2)}`} of $${budget.limit.toFixed(2)} (${used === undefined ? 'n/a' : pct(used / budget.limit)})`, color))
    if (used !== undefined) rows.push(text(ctx, `${' '.repeat(17)}${ladder(used, budget.limit, Math.min(40, ctx.columns - 20))}  50·75·90·100%`, { color }))
  }
  rows.push(...breakdownRows(ctx))
  rows.push(...providerRows(ctx))
  rows.push(rule(ctx, 'Alert thresholds', 'OK below 50%'))
  for (const rung of ladderDollars(budget?.limit)) rows.push(kv(ctx, rung.level, `${rung.percent}% · ${rung.usd === null ? 'n/a' : `$${rung.usd.toFixed(2)}`}`))
  rows.push(text(ctx, ' HARD_STOP blocks new agents only when ruflo-mods costHardStop is enabled.', { dimColor: true }))
  rows.push(rule(ctx, 'Burn', `${state.history.spend.length} samples since the console loaded`))
  rows.push(picture(ctx, 'burn', `spend since load: ${state.history.spend.map(sample => `$${sample.value.toFixed(2)}`).join(' ') || 'n/a'}`))
  rows.push(kv(ctx, 'burn rate', projection === null ? 'n/a — need a budget and 3 samples spanning at least 60 s' : `$${projection.usdPerMinute.toFixed(4)}/min · last 20 observations at most`))
  rows.push(text(ctx, projection?.minutes === 0 ? ' Budget already reached.' : projection?.minutes === null || projection === null ? ' Budget reached in: n/a — needs a budget and positive measured burn.' : ` At this rate the budget is reached in ~${Math.ceil(projection.minutes)} min.`, { dimColor: true }))

  return col(ctx, rows, 'cost')
}
