import type { RenderElement } from 'claude-code'

import { span, status, type LoopLevel, type LoopState } from '../mission-loop'
import { ago, button, kv, row, rule, text, THEME, type Ctx } from './common'

/** What the buttons do: each prepares text in the main UI and asks first; the console never schedules anything. */
export type LoopActions = { start: () => void; stop: () => void; rearm: () => void }

const COLOR: Record<LoopLevel, string> = { ok: THEME.ok, warn: THEME.warn, bad: THEME.bad }

/** The loop manager's rows: status, ticks, expiry, and the buttons that are valid for the state. */
export function loopRows(ctx: Ctx, loop: LoopState | null, actions: LoopActions, nowMs: number): RenderElement[] {
  const report = status(loop, nowMs)
  const rows = [rule(ctx, 'Loop manager', loop === null ? 'not started' : `every ${loop.interval}`), text(ctx, ` ${report.text}`, { color: COLOR[report.level] })]

  if (loop !== null && report.text !== 'no loop') {
    rows.push(kv(ctx, 'ticks', String(loop.ticks)))
    rows.push(kv(ctx, 'last tick', loop.lastTickMs === null ? 'none yet' : ago(loop.lastTickMs, nowMs)))
    rows.push(kv(ctx, 'time to expiry', loop.status === 'expired' ? 'expired' : span(report.msToExpiry), report.isExpiring && loop.status !== 'expired' ? THEME.warn : undefined))
    if (report.isExpiring && loop.status === 'armed' && report.msToExpiry > 0) rows.push(text(ctx, ' Expires within 24 hours: re-arm before it goes.', { color: THEME.warn }))
  }

  const state = loop?.status ?? 'idle'
  const isGone = state === 'stopped' || report.level === 'bad'
  const buttons: RenderElement[] = []

  if (loop === null || state === 'idle') buttons.push(button(ctx, 'loop-start', 'Start loop', actions.start, { primary: true }))
  if (state === 'armed' && report.msToExpiry > 0) buttons.push(button(ctx, 'loop-stop', 'Stop loop', actions.stop))
  if (isGone) buttons.push(button(ctx, 'loop-rearm', 'Re-arm loop', actions.rearm, { primary: true }))
  if (buttons.length > 0) rows.push(row(ctx, buttons))

  rows.push(text(ctx, ' Claude owns the schedule; the console only', { dimColor: true }))
  rows.push(text(ctx, ' prepares and watches it.', { dimColor: true }))

  return rows
}
