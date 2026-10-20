import type { RenderElement } from 'claude-code'

import { gauge } from '../memory-lines'
import { section, count, row, THEME, type Ctx } from './common'
import { stagesOf } from './frames'
import { note, subhead } from './subhead'
import { spinAt } from '../spinner'

/** One step of the animation every 160 ms; nothing moves while the pane is hidden (the frame loop stops). */
const beat = (ctx: Ctx, ms: number): number => Math.floor(ctx.nowMs / ms)

/**
 * The learning pulse, folded in its own section: a marker travels the pipeline (RETRIEVE → JUDGE → DISTILL → CONSOLIDATE), quickening while a
 * learning action runs. Below it, three labelled groups of bars that line up: the router's model mix (each model's share of all routed tasks),
 * the last routed outcomes (one cell each), and the store's sizes (relative to the largest). They draw what was measured and nothing else: no data, no chart.
 */
export function pulseRows(ctx: Ctx): RenderElement[] {
  const { state } = ctx
  const rows: RenderElement[] = []
  const running = state.lab.running?.id.startsWith('nn-') === true
  const stages = stagesOf(state)
  const at = beat(ctx, running ? 250 : 700) % Math.max(1, stages.length)

  rows.push(subhead(ctx, 'Pipeline', running ? 'learning now' : 'the marker shows the active stage'))
  rows.push(
    row(
      ctx,
      stages.flatMap((stage, i) => [
        ctx.kit.Text({ bold: i === at, color: i === at ? THEME.warn : THEME.info, children: ` ${i === at ? (running ? spinAt(ctx.nowMs) : '●') : '○'} ${stage.name} ${stage.count ?? 'n/a'}` }),
        ...(i < stages.length - 1 ? [ctx.kit.Text({ dimColor: true, children: ' ━━' })] : []),
      ]),
      'pulse-pipeline',
    ),
  )

  const columns = ctx.columns
  const width = Math.max(12, Math.min(32, columns - 46))
  /** One chart row: a fixed label column, a bar of one fixed width, the number right-aligned, then a dim extra. Every group lines up. */
  const chart = (label: string, bar: string, value: string, color: string, extra = ''): RenderElement =>
    row(ctx, [
      ctx.kit.Text({ dimColor: true, children: ` ${label.slice(0, 14).padEnd(14)} ` }),
      ctx.kit.Text({ color, children: bar }),
      ctx.kit.Text({ bold: true, children: ` ${value.padStart(6)}` }),
      ...(extra === '' ? [] : [ctx.kit.Text({ dimColor: true, children: `  ${extra}` })]),
    ])

  const router = state.snapshot?.router ?? null
  const mix = router?.distribution.filter(entry => entry.count > 0) ?? []
  const total = mix.reduce((sum, entry) => sum + entry.count, 0)

  rows.push(subhead(ctx, 'Model mix', mix.length > 0 ? `share of ${count(total)} routed task${total === 1 ? '' : 's'}` : 'n/a'))

  if (mix.length > 0) {
    // Each bar is that model's share of ALL routed tasks, so the bars add up to the whole: scaling to the busiest model would draw it full whatever its share.
    for (const entry of mix.slice(0, 6)) rows.push(chart(entry.model, gauge(entry.count, total, width), count(entry.count), THEME.ok, `${Math.round((entry.count / total) * 100)}%`))
    if (mix.length > 6) rows.push(note(ctx, `+ ${mix.length - 6} more model${mix.length - 6 === 1 ? '' : 's'}`))
  } else rows.push(note(ctx, 'no .swarm/model-router-state.json: nothing routed yet'))

  const points = state.snapshot?.outcomes?.points ?? []
  const window = points.slice(-24)
  const passed = window.filter(point => point.ok).length

  rows.push(subhead(ctx, 'Outcomes', window.length > 1 ? `${passed} of the last ${window.length} succeeded · ${Math.round((passed / window.length) * 100)}%` : 'n/a'))

  if (window.length > 1) {
    // One cell per routed outcome, oldest first: a full cell passed, a short one failed. The chart is the data, with no cursor drawn over it.
    rows.push(chart('last outcomes', window.map(point => (point.ok ? '▇' : '▂')).join(''), `${passed}/${window.length}`, passed === window.length ? THEME.ok : THEME.warn))
  } else rows.push(note(ctx, 'fewer than two routed outcomes so far'))

  const neural = state.snapshot?.neural ?? null

  if (neural !== null) {
    const sizes = { trajectories: neural.trajectories ?? 0, patterns: neural.patterns ?? 0, signals: neural.signals ?? 0 }
    const top = Math.max(1, sizes.trajectories, sizes.patterns, sizes.signals)

    rows.push(subhead(ctx, 'Store', 'bars are relative to the largest'))
    for (const [name, value] of Object.entries(sizes)) rows.push(chart(name, gauge(value, top, width), count(value), THEME.info))
  }

  const live = state.lab.running?.id.startsWith('nn-') === true

  return section(ctx, 'learn-pulse', 'Learning pulse', live ? `${spinAt(ctx.nowMs)} learning now · the marker quickens` : 'live: the pipeline marker moves; the bars are what ruflo measured', rows, true)
}
