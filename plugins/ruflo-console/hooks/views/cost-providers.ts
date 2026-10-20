import type { RenderElement } from 'claude-code'

import { COST_PLUGIN, LEDGER_FROM, trackerOf, type Finding, type Ledger, type Money } from '../data/cost-ledger'
import { ago, button, kv, live, pct, row, rule, sourceLine, text, THEME, type Ctx } from './common'

const SPARK = '▁▂▃▄▅▆▇█'
/** A model id as a short label: no `claude-` prefix and no date suffix, so sonnet-5 and sonnet-5-5 stay distinct. */
export const shortModel = (model: string): string => model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
const grouped = (value: number): string => Math.round(value).toLocaleString('en-US')

/** USD and Codex credits side by side, never summed: they are different currencies. */
export const moneyText = (cost: Money): string => [cost.usd === undefined ? '' : `$${cost.usd >= 100 ? grouped(cost.usd) : cost.usd.toFixed(2)}`, cost.credits === undefined ? '' : `${grouped(cost.credits)} credits`].filter(Boolean).join(' · ') || 'n/a'

/** One block per day, scaled to the busiest: the shape of the week, not an exact figure. */
export function spark(values: readonly number[]): string {
  const top = Math.max(...values, 0)

  return values.map(value => (top <= 0 ? SPARK[0] : SPARK[Math.min(7, Math.floor((value / top) * 7.999))])).join('')
}

const saving = (finding: Finding): string => (finding.saving === null || finding.unit === null ? 'saving n/a' : `up to ${moneyText({ [finding.unit]: finding.saving })}`)

/** What each provider cost in the last week, and what to change: from the local logs, via the cost-tracker plugin. */
export function providerRows(ctx: Ctx): RenderElement[] {
  const { state } = ctx
  const result = state.probes.get('cost-ledger')
  const ledger = live<Ledger>(result)
  const rows = [rule(ctx, 'Across providers', ledger === null ? 'Claude Code + Codex · local logs' : `last ${ledger.since} · local logs · list-price estimates`)]

  const tracker = trackerOf(state)

  if (tracker.kind !== 'ready') {
    const name = COST_PLUGIN.split('@')[0]

    rows.push(kv(ctx, 'ledger', tracker.kind === 'old' ? `n/a — ${name} ${tracker.version} is installed; needs ${LEDGER_FROM.join('.')} or newer` : `n/a — ${name} is not installed`))
    rows.push(text(ctx, ' It shows Claude Code and Codex spend, cache hit ratio and savings here. Nothing is sent anywhere.', { dimColor: true }))
    rows.push(row(ctx, [button(ctx, 'cost-install-tracker', tracker.kind === 'old' ? 'Plugins: update it' : 'Plugin Catalog: ruflo-cost-tracker', () => ctx.act.view(tracker.kind === 'old' ? 'plugins' : 'market'))]))

    return rows
  }

  const source = sourceLine(result, ctx.nowMs, 'ledger')

  rows.push(text(ctx, ` ${ledger === null ? source.text : `ledger: cost-tracker plugin, ${ago(result?.okAtMs, ctx.nowMs)}`}`, { dimColor: true, ...(source.color !== undefined && { color: source.color }) }))
  if (ledger === null) return rows

  for (const provider of ledger.providers) rows.push(kv(ctx, provider.name, `${moneyText(provider.cost)} · cache hit ${provider.hitRatio === null ? 'n/a' : pct(provider.hitRatio)}`))
  if (ledger.days.length > 1) rows.push(kv(ctx, 'USD / day', `${spark(ledger.days.map(day => day.usd))}  ${ledger.days[0]?.day.slice(5)} → ${ledger.days.at(-1)?.day.slice(5)}`))
  const ranked = [...ledger.models].sort((a, b) => (b.cost.usd ?? b.cost.credits ?? 0) - (a.cost.usd ?? a.cost.credits ?? 0)).slice(0, 5)

  for (const model of ranked) rows.push(kv(ctx, shortModel(model.model).slice(0, 16), `${moneyText(model.cost)} · ${grouped(model.messages)} msgs`))
  if (ledger.unpriced.length > 0) rows.push(text(ctx, ` Unpriced, NOT counted as $0: ${ledger.unpriced.join(', ')}`, { color: THEME.warn }))
  if (ledger.unpriced.length > 0) rows.push(text(ctx, ' Add them to data/prices.json in the plugin.', { dimColor: true }))
  rows.push(text(ctx, ` List-price estimates (${ledger.priceDate}), not bills.`, { dimColor: true }))
  rows.push(text(ctx, ' USD and credits are never added together.', { dimColor: true }))

  if (ledger.findings.length > 0) {
    rows.push(rule(ctx, 'Savings you can act on', 'evidence from your logs · nothing is changed for you'))
    ledger.findings.slice(0, 4).forEach((finding, i) => {
      rows.push(text(ctx, ` ${i + 1}. ${finding.title}`, { bold: true }))
      rows.push(text(ctx, `    ${saving(finding)} · ${finding.action}`, finding.saving === null ? { dimColor: true } : { color: THEME.ok }))
    })
    rows.push(text(ctx, ' Same tokens at another rate; quality is not predicted. /cost-advise shows the evidence.', { dimColor: true }))
  }

  return rows
}
