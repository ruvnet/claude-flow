import type { RenderElement } from 'claude-code'

import { GOALS_PLUGIN, RESEARCH_FROM, goalsOf, type ResearchRecord } from '../data/research'
import { ago, button, clip, live, row, rule, sourceLine, text, THEME, type Ctx } from './common'

const STATUS_COLOR: Record<string, string> = { done: THEME.ok, truncated: THEME.warn, failed: THEME.bad }
const SHOWN = 5

/** Spend as the record states it: `n/a` when the run did not know, never a guess. */
export const spendText = (usd: number | null): string => (usd === null ? 'n/a' : `$${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)}`)

const recordRows = (ctx: Ctx, record: ResearchRecord): RenderElement[] => [
  text(ctx, ` ${clip(record.question, Math.min(56, ctx.columns - 4))}`, { bold: true }),
  text(ctx, `   ${record.status} · ${record.findings} ${record.findings === 1 ? 'finding' : 'findings'} · ${ago(record.atMs, ctx.nowMs)}${record.isScreened ? '' : ' · unscreened'}`, STATUS_COLOR[record.status] === undefined ? { dimColor: true } : { color: STATUS_COLOR[record.status] as string }),
  text(ctx, `   High ${record.grades.High} · Medium ${record.grades.Medium} · Low ${record.grades.Low} · spend ${spendText(record.spentUsd)}`, { dimColor: true }),
]

/** The newest research records (ADR-438), read-only: from the ruflo-goals plugin's local list script, only while Missions is in front. */
export function researchRows(ctx: Ctx): RenderElement[] {
  const { state } = ctx
  const result = state.probes.get('research')
  const records = live<ResearchRecord[]>(result)
  const rows = [rule(ctx, 'Research', records === null ? 'deep-researcher records' : `newest ${Math.min(SHOWN, records.length)} · local`)]
  const goals = goalsOf(state)

  if (goals.kind !== 'ready') {
    const name = GOALS_PLUGIN.split('@')[0]

    rows.push(text(ctx, ` n/a — ${goals.kind === 'old' ? `${name} ${goals.version}; needs ${RESEARCH_FROM.join('.')} or newer` : `${name} is not installed`}`, { dimColor: true }))
    rows.push(row(ctx, [button(ctx, 'research-install-goals', goals.kind === 'old' ? 'Plugins: update it' : `Plugin Catalog: ${name}`, () => ctx.act.view(goals.kind === 'old' ? 'plugins' : 'market'))]))

    return rows
  }

  const source = sourceLine(result, ctx.nowMs, 'research')

  rows.push(text(ctx, ` ${records === null ? source.text : `records: ${GOALS_PLUGIN.split('@')[0]}, ${ago(result?.okAtMs, ctx.nowMs)}`}`, { dimColor: true, ...(source.color !== undefined && { color: source.color }) }))
  if (records === null) return rows

  if (records.length === 0) rows.push(text(ctx, ' No research records yet.', { dimColor: true }))
  for (const record of records.slice(0, SHOWN)) rows.push(...recordRows(ctx, record))
  rows.push(text(ctx, ' Read-only. Nothing is started here.', { dimColor: true }))

  return rows
}
