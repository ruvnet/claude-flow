/**
 * The management views: the approvals queue (the Timeline is views/timeline.ts, the Events page views/events.ts, ADR-474). Each acts through the palette's
 * entries (by id), so a button here runs exactly what the palette or `/ruflo run <id>` would.
 */
import type { RenderElement } from 'claude-code'

import { approvalsOf, waitingApprovalsOf } from '../data/alerts'
import type { Lane } from '../gfx/maps'
import { button, col, paragraph, row, rule, text, THEME, type Ctx } from './common'

/** Busy time as a share of the time this lane was observed in the window, and its tool calls. */
export function statsOf(lane: Lane, fromMs: number, nowMs: number): { observedMs: number; busyMs: number; calls: number } {
  const spans = lane.spans.filter(span => span.toMs > fromMs)
  const first = spans.length === 0 ? nowMs : Math.max(fromMs, Math.min(...spans.map(span => span.fromMs)))

  return { observedMs: Math.max(0, nowMs - first), busyMs: spans.filter(span => span.busy).reduce((sum, span) => sum + Math.max(0, span.toMs - Math.max(span.fromMs, fromMs)), 0), calls: lane.ticks.filter(at => at >= fromMs).length }
}

/** The header count: what a person can act on, with the notices (refused mods, permission denies) named apart (#3920). */
const headline = (all: number, waiting: number): string => (waiting === all ? `${all} waiting · j/k pick` : `${waiting} to approve · ${all - waiting} notice${all - waiting === 1 ? '' : 's'} · j/k pick`)

export function approvalsView(ctx: Ctx): RenderElement {
  const items = approvalsOf(ctx.state)
  const picked = items.length === 0 ? -1 : ((ctx.state.select.item % items.length) + items.length) % items.length
  const rows: RenderElement[] = [rule(ctx, 'Approvals', items.length === 0 ? 'nothing waiting' : headline(items.length, waitingApprovalsOf(ctx.state).length))]

  if (items.length === 0) {
    rows.push(...paragraph(ctx, 'No hive-mind proposals, stealable claims, refused mods, permission denies or budget alerts waiting.', { dimColor: true }))
  }

  items.slice(0, 12).forEach((item, i) => {
    const isPicked = i === picked

    rows.push(...paragraph(ctx, `${isPicked ? '▸' : ' '} [${item.kind}] ${item.text}`, isPicked ? { bold: true, color: THEME.head } : { color: item.kind === 'policy-deny' || item.kind === 'mod-trust' ? THEME.bad : THEME.warn }, '    '))
    rows.push(...paragraph(ctx, `    ${item.detail}`, { dimColor: true }, '    '))

    if (isPicked && item.actions.length > 0 && ctx.columns >= 44) {
      rows.push(row(ctx, item.actions.map((action, a) => button(ctx, `approve-${a}`, action.label, () => void ctx.act.run(action.paletteId), a < 2 ? { hotkey: a === 0 ? 'v' : 'w' } : {}))))
    }
  })

  if (ctx.columns >= 44 && items.length > 1) rows.push(row(ctx, [button(ctx, 'item-prev', 'prev', () => ctx.act.select(-1), { hotkey: 'k' }), button(ctx, 'item-next', 'next', () => ctx.act.select(1), { hotkey: 'j' })]))

  rows.push(...paragraph(ctx, 'each action asks y/n before it runs; a permission deny is shown, never loosened from here', { dimColor: true }))

  return col(ctx, rows, 'approvals')
}
