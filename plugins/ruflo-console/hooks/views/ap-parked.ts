/**
 * The autopilot's parked queue (ADR-466 §4), a board section: what the loop would not do on its own, each with the question it asked,
 * and buttons to approve it once or deny it. A park for a hard deny has no approve button (autopilot can never do it; the loop
 * ignores such an answer too). Nothing drawn here is made up: it is the journal's `parked` and `answered` lines, washed on the way in.
 */
import type { RenderElement } from 'claude-code'

import { answerParked, hostOf, storeOf } from '../ap-live'
import { cleanText } from '../data/wf-clean'
import { button, clip, row, text, THEME, type Ctx } from './common'
import { registerSlot, type SlotEnv } from './wf-slots'

/** Parks drawn at once; the rest are counted. */
export const SHOWN = 6

export const isHardDenyQuestion = (question: string): boolean => question.includes('can never do')

export function parkedRows(env: SlotEnv): RenderElement[] {
  const { ctx } = env
  const store = storeOf(ctx.state)
  const host = hostOf(ctx.state)
  const open = store.loop.parked.filter(p => p.answer === undefined)
  const answered = store.loop.parked.length - open.length

  if (store.loop.phase === 'idle' && store.loop.parked.length === 0) return [text(ctx, ' autopilot has not started: nothing is parked', { dimColor: true })]
  if (open.length === 0) return [text(ctx, ` nothing parked${answered > 0 ? ` · ${answered} answered earlier` : ''}`, { dimColor: true })]

  const rows: RenderElement[] = []

  for (const park of open.slice(0, SHOWN)) {
    const hard = isHardDenyQuestion(park.question)

    rows.push(text(ctx, ` ${clip(cleanText(park.task), 24)}  ${clip(cleanText(park.question), Math.max(30, ctx.columns - 36))}`, { color: hard ? THEME.warn : undefined }))
    rows.push(row(ctx, [
      ...(hard || host === undefined ? [] : [button(ctx, `ap-once-${park.id}`, 'approve once', () => void answerParked(ctx.state, host, park.id, 'once'))]),
      ...(host === undefined ? [] : [button(ctx, `ap-deny-${park.id}`, 'deny', () => void answerParked(ctx.state, host, park.id, 'deny'))]),
      text(ctx, hard ? ' never grantable' : ' once = this task only, then the envelope applies again', { dimColor: true }),
    ], `ap-park-${park.id}`))
  }

  if (open.length > SHOWN) rows.push(text(ctx, ` +${open.length - SHOWN} more parked, not drawn`, { dimColor: true }))

  return rows
}

export function registerParkedSlots(): void {
  registerSlot({ kind: 'board', id: 'ap-parked', title: 'Autopilot, parked for you', order: 6, render: parkedRows })
}

registerParkedSlots()
