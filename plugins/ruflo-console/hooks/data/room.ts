/**
 * The Room's feed (ADR-448): what the console observed (events), what Claude did through the console tools (the control log) and what the
 * person said into the room, merged newest first. Pure: it reads what the console already holds and invents nothing.
 */
import type { ControlEntry } from '../state'
import type { ConsoleEvent } from './events'
import { plain } from './parse'

export type RoomSource = 'event' | 'claude' | 'said'
export type RoomTone = 'ok' | 'warn' | 'bad' | 'info'
export type RoomItem = { id: string; atMs: number; source: RoomSource; who: string; text: string; tone: RoomTone; kind?: string }

/** The three text actions the room can send; each keeps its own confirm. Nothing else is sendable from here. */
export const SAY_IDS = ['broadcast', 'mission-aside', 'mission-guide'] as const
export type SayId = (typeof SAY_IDS)[number]
export const SAY_LABEL: Record<SayId, string> = { broadcast: 'broadcast to the hive', 'mission-aside': 'aside to Claude', 'mission-guide': 'guide Claude' }

/** One thing the person said: the action's own label as the confirm showed it (null when it ran at once), kept for the outcome to be matched. */
export type Said = { atMs: number; id: SayId; text: string; label: string | null }

export const ROOM_MAX = 200
export const SAID_MAX = 50
export const DRAFT_MAX = 10_000

type Outcome = { label: string; ok: boolean; detail: string; atMs: number } | null
type Pending = { label: string } | null

const CONTROL_TONE: Record<ControlEntry['outcome'], RoomTone> = { ok: 'ok', waiting: 'warn', denied: 'bad', error: 'bad' }
const EVENT_TONE: Record<string, RoomTone> = { mods: 'warn', tools: 'info' }

/** Where a thing the person said got to, from what the console shows now: waiting for a Yes, sent, or not sent (with why). */
export function saidStatus(said: Said, pending: Pending, outcome: Outcome): { text: string; tone: RoomTone } {
  if (pending !== null && said.label !== null && pending.label === said.label) return { text: 'waiting for your yes', tone: 'warn' }
  if (outcome !== null && outcome.atMs >= said.atMs && (said.label === null || outcome.label === said.label)) return outcome.ok ? { text: 'sent', tone: 'ok' } : { text: `not sent: ${plain(outcome.detail, 80)}`, tone: 'bad' }

  return { text: 'not confirmed', tone: 'info' }
}

/** The page an event kind belongs on, for the feed's jump; kinds with no page of their own have none. */
export const VIEW_OF_KIND: Readonly<Record<string, string>> = { swarm: 'swarm', claims: 'claims', learning: 'learning', mods: 'plugins', missions: 'missions', federation: 'federation' }

/** Refused or failed: Claude's console actions the control log marked denied or error, and events that say something was denied. */
export const isBlocked = (item: RoomItem): boolean => (item.source === 'claude' ? item.tone === 'bad' : item.source === 'event' && /denied/i.test(item.text))

export type FeedInput = {
  events: readonly ConsoleEvent[]
  log: readonly ControlEntry[]
  said: readonly Said[]
  pending: Pending
  outcome: Outcome
  source: 'all' | RoomSource
  query: string
  /** Only what was refused or failed (see isBlocked). */
  blocked?: boolean
  /** The newest time shown: set while paused so the tail holds still. */
  untilMs: number | null
}

/** The merged feed, newest first, at most ROOM_MAX: one pass per source and one sort of a few hundred items. */
export function roomFeed(input: FeedInput): RoomItem[] {
  const out: RoomItem[] = []
  const want = (source: RoomSource) => input.source === 'all' || input.source === source
  const until = input.untilMs ?? Number.POSITIVE_INFINITY
  // One press opens one line: two items of the same time and text length (one read can hold both) still get distinct ids, stable while the order holds (#3817).
  const seen = new Map<string, number>()
  const unique = (id: string): string => {
    const n = seen.get(id) ?? 0

    seen.set(id, n + 1)

    return n === 0 ? id : `${id}#${n}`
  }

  if (want('event')) for (const e of input.events) if (e.atMs <= until) out.push({ id: unique(`event:${e.atMs}:${e.text.length}`), atMs: e.atMs, source: 'event', who: e.kind, text: plain(e.text, 200), tone: EVENT_TONE[e.kind] ?? 'info', kind: e.kind })
  if (want('claude')) for (const c of input.log) if (c.atMs <= until) out.push({ id: unique(`claude:${c.atMs}:${c.summary.length}`), atMs: c.atMs, source: 'claude', who: 'claude', text: plain(`${c.summary}${c.detail === '' ? '' : ` — ${c.detail}`}`, 200), tone: CONTROL_TONE[c.outcome] })
  if (want('said')) {
    for (const s of input.said) {
      if (s.atMs > until) continue

      const status = saidStatus(s, input.pending, input.outcome)

      out.push({ id: unique(`said:${s.atMs}:${s.text.length}`), atMs: s.atMs, source: 'said', who: 'you', text: plain(`${SAY_LABEL[s.id]}: ${s.text} (${status.text})`, 240), tone: status.tone })
    }
  }

  const query = input.query.trim().toLowerCase()
  const kept = query === '' ? out : out.filter(item => item.text.toLowerCase().includes(query) || item.who.includes(query))

  const shown = input.blocked === true ? kept.filter(isBlocked) : kept

  return shown.sort((a, b) => b.atMs - a.atMs).slice(0, ROOM_MAX)
}

/** The classes an ask can be shown as: a fixed list, so no label can add or change a word of the attribution (ADR-450 T14). */
export const PENDING_KINDS = ['write', 'network', 'install', 'spend', 'delete'] as const

/** "claude asks (network): " for an ask Claude raised, '' for the person's own; the words come from the stamped fields, never from the label. */
export function askedBy(pending: { source?: string; kind?: string } | null): string {
  if (pending === null || pending.source !== 'claude') return ''

  const kind = PENDING_KINDS.find(known => known === pending.kind)

  return kind === undefined ? 'claude asks: ' : `claude asks (${kind}): `
}

/** The banner for the one pending confirm: what, what it expects, where it was raised and how much of the window is left. */
export function pendingBanner(pending: { label: string; expect: string; view?: string; askedAtMs: number; source?: string; kind?: string } | null, nowMs: number, ttlMs: number): { label: string; expect: string; view: string | null; ageS: number; leftS: number; tone: RoomTone } | null {
  if (pending === null) return null

  const ageMs = Math.max(0, nowMs - pending.askedAtMs)
  const leftS = Math.max(0, Math.ceil((ttlMs - ageMs) / 1000))

  return { label: askedBy(pending) + plain(pending.label, 100), expect: plain(pending.expect, 120), view: pending.view ?? null, ageS: Math.floor(ageMs / 1000), leftS, tone: leftS <= 8 ? 'bad' : leftS <= 15 ? 'warn' : 'info' }
}
