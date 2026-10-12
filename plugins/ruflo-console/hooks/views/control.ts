import type { RenderElement } from 'claude-code'

import { confirmOf, levelOf, MAX_CALLS_PER_TURN } from '../model-tools'
import { settingsOf } from '../settings'
import { ago, button, kv, row, rule, text, THEME, type Ctx } from './common'

const MARK = { ok: '✓', waiting: '…', denied: '✕', error: '!' } as const
const COLOR = { ok: THEME.ok, waiting: THEME.warn, denied: THEME.bad, error: THEME.bad } as const

/** True while control is on or Claude has acted this session: then the dashboard leads the page, so it is never below the fold. */
export const isControlActive = (ctx: Ctx): boolean => !ctx.state.isStandalone && levelOf(settingsOf(ctx.state).ai.modelControl) !== 'off' || ctx.state.control.log.length > 0

/**
 * The "Claude control" dashboard (ADR-444): whether Claude may drive the console and how far, what it has done this session, and the
 * button that takes control back. Shown on Overview; the log is the audit trail, newest last.
 */
export function controlRows(ctx: Ctx): RenderElement[] {
  const { state } = ctx

  // The standalone terminal has no Claude session to control the console: the card would describe a thing that cannot happen here.
  if (state.isStandalone) return []
  const ai = settingsOf(state).ai
  const level = levelOf(ai.modelControl)
  const control = state.control

  if (level === 'off' && control.log.length === 0) {
    return [rule(ctx, 'Claude control', 'off'), text(ctx, ' Claude cannot drive the console. Turn it on in', { dimColor: true }), text(ctx, ' Settings → Claude control (read, write, manage, full).', { dimColor: true })]
  }

  const rows = [rule(ctx, 'Claude control', control.paused ? 'taken back' : level === 'off' ? 'off' : 'on')]

  rows.push(kv(ctx, 'level', `${level} · ${confirmOf(ai.modelConfirm) === 'auto' ? 'confirms itself' : 'waits for your Yes'}`, control.paused ? THEME.warn : undefined))
  rows.push(kv(ctx, 'this session', `${control.calls} action${control.calls === 1 ? '' : 's'} · ${control.turnCalls}/${MAX_CALLS_PER_TURN} this turn`))
  rows.push(row(ctx, [button(ctx, 'control-pause', control.paused ? 'Give control back' : 'Take back control', () => ctx.act.control.pause(!control.paused))], 'control-buttons'))

  for (const entry of control.log.slice(-6)) {
    rows.push(row(ctx, [ctx.kit.Text({ bold: true, color: COLOR[entry.outcome], children: ` ${MARK[entry.outcome]} ` }), ctx.kit.Text({ children: `${entry.summary} ` }), ctx.kit.Text({ dimColor: true, children: ago(entry.atMs, ctx.nowMs) })], `control-log-${entry.atMs}`))
  }

  if (control.log.length === 0) rows.push(text(ctx, ' Nothing yet: Claude has not used the console.', { dimColor: true }))

  return rows
}
