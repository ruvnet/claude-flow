/**
 * Pieces of the Events page (ADR-474): one event row with highlighted matches, the opened event's detail pane (its words, source,
 * level, the current state of the thing it is about with buttons that go to its page, and five events either side), and the chips.
 * Every row is measured to fit the pane: the text is clipped to what is left after the fixed cells, never wrapped.
 */
import type { RenderElement } from 'claude-code'

import { isoOf } from '../data/safe'
import { highlights, type Query } from '../data/event-query'
import { neighbours, type Row } from '../data/event-group'
import { levelOfEvent, type Level } from '../data/event-severity'
import { refOf, type ConsoleEvent } from '../data/events'
import { entityOf, eventsUi } from '../events-ui'
import { ago, button, clip, col, row, text, THEME, type Ctx } from './common'
import { flow, safe, type Btn } from './wf-layout'

export const LEVEL_COLOR: Record<Level, () => string> = { ok: () => THEME.ok, info: () => THEME.info, warn: () => THEME.warn, bad: () => THEME.bad }
export const LEVEL_MARK: Record<Level, string> = { ok: '✓', info: 'ℹ', warn: '⚠', bad: '✖' }
export const KIND_COLOR = (kind: string): string => ({ swarm: THEME.info, claims: THEME.warn, federation: THEME.ok, learning: THEME.head, tools: THEME.info, mods: THEME.bad, missions: THEME.head, workflows: THEME.ok, autopilot: THEME.warn, anatole: THEME.bad, notices: THEME.head })[kind] ?? THEME.info

export const chip = (key: string, label: string, isOn: boolean, onPress: () => void): Btn => ({ key, label: ` ${isOn ? '●' : '○'} ${label} `, onPress, ...(isOn && { primary: true }) })

/** The text of a row cut to `room` cells, as runs: the parts the query matched are bold and bright. */
function runs(ctx: Ctx, value: string, query: Query, room: number): RenderElement[] {
  const shown = clip(value, room)
  const marks = highlights(shown, query)
  const out: RenderElement[] = []
  let at = 0

  for (const [from, to] of marks) {
    if (from > at) out.push(ctx.kit.Text({ children: shown.slice(at, from) }))
    out.push(ctx.kit.Text({ bold: true, color: THEME.head, children: shown.slice(from, to) }))
    at = to
  }

  if (at < shown.length || out.length === 0) out.push(ctx.kit.Text({ children: shown.slice(at) }))

  return out
}

export function eventRow(ctx: Ctx, entry: Row, query: Query, isFocused: boolean, isOpen: boolean, nowMs: number): RenderElement {
  const event = entry.event
  const level = levelOfEvent(event)
  const count = entry.members.length > 1 ? ` ×${entry.members.length}` : ''
  // Fixed cells: age 9, mark 2, kind 11, open button 5, count text.
  const room = Math.max(8, ctx.columns - 9 - 2 - 11 - 5 - count.length)
  const id = entry.id

  return row(
    ctx,
    [
      ctx.kit.Text({ dimColor: true, children: `${ago(event.atMs, nowMs).padStart(8)} ` }),
      ctx.kit.Text({ color: LEVEL_COLOR[level](), children: `${isFocused ? '▸' : LEVEL_MARK[level]} ` }),
      ctx.kit.Text({ color: KIND_COLOR(event.kind), children: `${event.kind.slice(0, 10).padEnd(10)} ` }),
      ...runs(ctx, event.text, query, room),
      ...(count === '' ? [] : [ctx.kit.Text({ color: THEME.warn, children: count })]),
      ctx.kit.Button({ key: `ev-open-${id}`, label: isOpen ? '▾' : '▸', plain: true, onPress: safe(() => ctx.act.events.open(id)) }),
    ],
    `ev-${id}`,
  )
}

const line = (ctx: Ctx, value: string, props: { dimColor?: boolean; bold?: boolean; color?: string } = {}): RenderElement => text(ctx, `   ${value}`, props)

/** The opened event: words, facts, the entity's state now, buttons, and the five events either side (from the unfiltered shown list so the neighbours are what really surrounded it). */
export function detailRows(ctx: Ctx, entry: Row, around: readonly ConsoleEvent[], nowMs: number): RenderElement[] {
  const event = entry.event
  const ref = refOf(event)
  const entity = entityOf(ctx.state, ref)
  const act = ctx.act.events
  const out: RenderElement[] = [line(ctx, event.text, { bold: true }), line(ctx, `${levelOfEvent(event)} · ${event.kind} · ${isoOf(event.atMs)} · source ${event.src ?? 'observed'}${event.agentId === undefined ? '' : ` · agent ${clip(event.agentId, 24)}`}${ref === undefined ? '' : ` · ref ${clip(ref, 30)}`}`, { dimColor: true })]

  if (entity !== null) out.push(line(ctx, `now: ${entity.text}`, { color: THEME.info }))
  else if (ref !== undefined) out.push(line(ctx, 'now: nothing in the last read for this ref', { dimColor: true }))

  const buttons: Btn[] = [
    ...(ctx.state.isStandalone ? [] : [{ key: 'ev-ask', label: ' ✦ ask Claude ', onPress: () => act.ask(event) }]),
    { key: 'ev-pin', label: ' 📌 pin ', onPress: () => act.pin(event) },
    { key: 'ev-copy', label: ' ⧉ copy line ', onPress: () => act.copy(event) },
    { key: 'ev-mute-kind', label: ` mute ${event.kind} `, onPress: () => act.muteKind(event.kind) },
    { key: 'ev-mute-like', label: ' mute lines like this ', onPress: () => act.muteTemplate(event.text) },
    ...(ref === undefined ? [] : [{ key: 'ev-follow', label: ' ⤳ follow ', onPress: () => act.follow(ref) }]),
    ...(entity === null ? [] : [{ key: 'ev-go', label: ` open ${entity.go} `, onPress: () => ctx.act.view(entity.go) }]),
    ...(entry.members.length > 1 ? [{ key: 'ev-burst', label: eventsUi(ctx.state).expanded.has(entry.id) ? ' fold the burst ' : ` show ${entry.members.length} in the burst `, onPress: () => act.toggleBurst(entry.id) }] : []),
  ]

  out.push(...flow(ctx, buttons, 'ev-detail'))

  if (eventsUi(ctx.state).expanded.has(entry.id)) {
    for (const member of entry.members.slice(-8).reverse()) out.push(line(ctx, `${ago(member.atMs, nowMs).padStart(8)}  ${member.text}`, { dimColor: true }))
  }

  const at = around.indexOf(event)
  const near = neighbours(around, at, 5)

  if (near.before.length + near.after.length > 0) {
    out.push(line(ctx, 'around it (5 before, 5 after):', { dimColor: true }))
    for (const item of [...near.before, event, ...near.after]) out.push(line(ctx, `${item === event ? '▸' : ' '} ${isoOf(item.atMs).slice(11, 19)} ${item.kind.padEnd(9)} ${item.text}`, item === event ? { bold: true } : { dimColor: true }))
  }

  return out
}

export const stack = (ctx: Ctx, rows: readonly RenderElement[], key: string): RenderElement => col(ctx, rows, key)
export { button }
