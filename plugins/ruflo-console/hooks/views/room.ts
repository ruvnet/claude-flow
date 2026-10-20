import { fullRows } from './full-rows'
import type { RenderElement } from 'claude-code'

import { isoOf } from '../data/safe'
import { isBlocked, pendingBanner, roomFeed, SAY_IDS, SAY_LABEL, VIEW_OF_KIND, type RoomItem, type RoomSource } from '../data/room'
import { PENDING_TTL_MS } from '../runner'
import { ROOM_PAGE, roomOf } from '../room'
import { ago, button, clip, col, row, rule, text, THEME, type Ctx } from './common'
import { lanesOf } from './frames'
import { VIEWS, type ViewId } from '../state'
import { statsOf } from './manage'
import { modsRows } from './mods'
import { sessionRows } from './sessions'

/** How long the Room says a card expired, after the runner cleared it. */
const EXPIRED_SHOWN_MS = 15_000
const TONE_COLOR = { ok: THEME.ok, warn: THEME.warn, bad: THEME.bad, info: THEME.info } as const
const SOURCES: readonly { id: 'all' | RoomSource; label: string }[] = [
  { id: 'all', label: 'all' },
  { id: 'claude', label: '🤖 claude' },
  { id: 'event', label: 'events' },
  { id: 'said', label: 'you said' },
]

const chip = (ctx: Ctx, key: string, label: string, isOn: boolean, onPress: () => void): RenderElement =>
  ctx.kit.Button({ key, label: ` ${isOn ? '●' : '○'} ${label} `, plain: true, ...(isOn && { variant: 'primary' as const }), onPress })

/** The feed as the page draws it and pages it; the page count is also what the paging action clamps to. */
export function roomShown(ctx: Pick<Ctx, 'state'>): RoomItem[] {
  const { state } = ctx
  const room = roomOf(state)

  return roomFeed({ events: state.events, log: state.control.log, said: room.said, pending: state.pending, outcome: state.outcome, source: room.source, query: room.query, untilMs: room.pausedAtMs, blocked: room.blocked })
}

/** How many items the feed holds that were refused or failed, whatever the filters: the number on the blocked chip. */
export function roomBlockedCount(ctx: Pick<Ctx, 'state'>): number {
  const { state } = ctx
  const room = roomOf(state)

  return roomFeed({ events: state.events, log: state.control.log, said: room.said, pending: state.pending, outcome: state.outcome, source: 'all', query: '', untilMs: room.pausedAtMs }).filter(isBlocked).length
}

export const roomPages = (state: Ctx['state']): number => Math.max(1, Math.ceil(roomShown({ state }).length / ROOM_PAGE))

/**
 * The Room (ADR-448): the one pending confirm first, with its age against the window; a box to say something (the existing broadcast,
 * aside and guide actions, each still asking first); the merged feed of events, Claude's console actions and what you said; who is here.
 */
export function roomView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const room = roomOf(state)
  const shown = roomShown(ctx)
  const pages = Math.max(1, Math.ceil(shown.length / ROOM_PAGE))
  const page = Math.min(room.page, pages - 1)
  const banner = pendingBanner(state.pending, nowMs, PENDING_TTL_MS)
  const rows: RenderElement[] = []

  // Past the window a card is expired, never "63s of 30s": the runner clears it on its clock, and the page says so for a moment after.
  const isLate = banner !== null && banner.leftS === 0
  const expired = banner === null && state.outcome?.expired === true && nowMs - state.outcome.atMs < EXPIRED_SHOWN_MS ? state.outcome : null

  rows.push(rule(ctx, 'Waiting for a yes', isLate || expired !== null ? 'expired' : banner === null ? 'nothing' : `${banner.ageS}s of ${PENDING_TTL_MS / 1000}s`))

  if (expired !== null) rows.push(text(ctx, `⌛ ${clip(expired.label, 100)}: expired after ${PENDING_TTL_MS / 1000} s with no answer, so it did not run. Ask again if it is still wanted.`, { color: THEME.warn }))
  else if (banner === null) rows.push(text(ctx, ' Nothing is waiting. Anything that asks first shows up here, unmissable, with how long you have to answer.', { dimColor: true }))
  else if (isLate) rows.push(text(ctx, `⌛ ${banner.label}: expired after ${PENDING_TTL_MS / 1000} s with no answer. It will not run: ask again.`, { color: THEME.bad }))
  else {
    rows.push(text(ctx, `⚠ ${banner.label}`, { bold: true, color: TONE_COLOR[banner.tone] }))
    rows.push(text(ctx, `   expects: ${banner.expect}${banner.view === null ? '' : ` · raised on ${banner.view}`} · ${banner.leftS}s left to answer`, { color: TONE_COLOR[banner.tone] }))
  }

  rows.push(...sessionRows(ctx))
  rows.push(rule(ctx, 'Say something', 'each asks first, as anywhere else'))

  const Input = ctx.kit.Input

  rows.push(row(ctx, [...(Input === undefined ? [] : [ctx.kit.Box({ key: 'room-say-box', borderStyle: 'round', borderColor: THEME.info, paddingX: 1, children: [Input({ key: 'room-say', label: '💬', placeholder: room.draft === '' ? 'a message for the hive or for Claude (Enter keeps it)' : 'a draft is kept below — type to replace it (Enter keeps it)', submitLabel: 'keep', onSubmit: (value: string) => ctx.act.room.draft(value) })] })])], 'room-say-row'))
  // Nothing to send yet: no buttons that would do nothing, just the way to get one.
  if (room.draft === '') rows.push(row(ctx, [text(ctx, ' type a message above and press Enter; then choose where it goes', { dimColor: true })], 'room-send-row'))
  else rows.push(...fullRows(ctx, ' draft: ', room.draft, { key: 'room-draft' }), row(ctx, [text(ctx, ' send it →', { dimColor: true }), ...SAY_IDS.map(id => button(ctx, `room-send-${id}`, SAY_LABEL[id], () => ctx.act.room.say(id)))], 'room-send-row'))

  rows.push(rule(ctx, 'The feed', `${shown.length} shown${room.pausedAtMs === null ? '' : ' · paused'}${room.query === '' ? '' : ` · "${room.query}"`}`))
  rows.push(
    row(
      ctx,
      [
        ...SOURCES.map(source => chip(ctx, `room-src-${source.id}`, source.label, room.source === source.id, () => ctx.act.room.source(source.id))),
        chip(ctx, 'room-blocked', `⛔ blocked ${roomBlockedCount(ctx)}`, room.blocked, ctx.act.room.blocked),
        ctx.kit.Button({ key: 'room-pause', label: room.pausedAtMs === null ? ' ⏸ pause ' : ' ▶ resume ', ...(room.pausedAtMs === null ? { plain: true as const } : { variant: 'primary' as const }), onPress: ctx.act.room.pause }),
        ...(room.query === '' ? [] : [ctx.kit.Button({ key: 'room-clear', label: ' ✕ clear find ', plain: true, dimColor: true, onPress: () => ctx.act.room.query('') })]),
      ],
      'room-tools',
    ),
  )

  if (Input !== undefined) rows.push(row(ctx, [ctx.kit.Box({ key: 'room-find-box', borderStyle: 'round', borderColor: THEME.info, paddingX: 1, children: [Input({ key: 'room-find', label: '🔎 find', placeholder: 'words in the feed, or who (Enter)', submitLabel: 'find', onSubmit: (value: string) => ctx.act.room.query(value) })] })], 'room-find-row'))
  if (shown.length === 0) rows.push(text(ctx, ' Nothing yet. Events are what changed in ruflo and what this session did; Claude’s console actions and what you send appear here too.', { dimColor: true }))

  for (const item of shown.slice(page * ROOM_PAGE, page * ROOM_PAGE + ROOM_PAGE)) {
    const isOpen = room.open === item.id

    rows.push(
      row(
        ctx,
        [
          ctx.kit.Text({ dimColor: true, children: `${ago(item.atMs, nowMs).padStart(8)} ` }),
          ctx.kit.Text({ bold: item.source !== 'event', color: item.source === 'event' ? THEME.info : TONE_COLOR[item.tone], children: `${clip(item.who, 10).padEnd(10)} ` }),
          ctx.kit.Button({ key: `room-open-${item.id}`, label: `${isOpen ? '▾' : '▸'} ${clip(item.text, Math.max(16, ctx.columns - 26))}`, plain: true, onPress: () => ctx.act.room.open(item.id) }),
        ],
        `room-${item.id}`,
      ),
    )

    if (isOpen) {
      const target = item.kind === undefined ? undefined : VIEW_OF_KIND[item.kind]
      const view = target === undefined ? undefined : VIEWS.find(entry => entry.id === target)

      rows.push(text(ctx, `     ${item.text}  ·  ${isoOf(item.atMs)}`, { dimColor: true }))
      rows.push(row(ctx, [text(ctx, `     ${item.source === 'event' ? `event: ${item.kind ?? 'unknown'}` : item.source === 'claude' ? 'a console action by Claude' : 'what you said'}${isBlocked(item) ? ' · refused or failed' : ''}`, { dimColor: true }), ...(view === undefined ? [] : [button(ctx, `room-jump-${item.id}`, `jump to ${view.label}`, () => ctx.act.view(view.id as ViewId))])], `room-detail-${item.id}`))
    }
  }

  if (pages > 1) rows.push(row(ctx, [text(ctx, ` page ${page + 1}/${pages} `, { dimColor: true }), ...(page < pages - 1 ? [button(ctx, 'room-older', 'older ▸', () => ctx.act.room.page(1))] : []), ...(page > 0 ? [button(ctx, 'room-newer', '◂ newer', () => ctx.act.room.page(-1))] : [])], 'room-pages'))

  const lanes = lanesOf(state, nowMs)

  rows.push(rule(ctx, 'Who is here', lanes.length === 0 ? 'no agents or tool calls seen yet' : 'busy share of the last 15 min'))

  for (const [i, lane] of lanes.slice(0, 8).entries()) {
    const stats = statsOf(lane, nowMs - 15 * 60_000, nowMs)
    const share = stats.observedMs === 0 ? null : Math.round((stats.busyMs / stats.observedMs) * 100)

    rows.push(row(ctx, [ctx.kit.Text({ bold: true, color: THEME.head, children: ` ${clip(lane.label, 20).padEnd(20)}` }), ctx.kit.Text({ color: share === null ? THEME.info : share >= 60 ? THEME.ok : share >= 20 ? THEME.warn : THEME.info, children: ` ${share === null ? 'no status seen' : `busy ${share}%`}` }), ctx.kit.Text({ dimColor: true, children: ` · ${stats.calls} tool call${stats.calls === 1 ? '' : 's'}` })], `room-lane-${i}`))
  }

  if (lanes.length > 8) rows.push(text(ctx, ` +${lanes.length - 8} more`, { dimColor: true }))

  rows.push(...modsRows(ctx))

  return col(ctx, rows, 'room')
}
