/**
 * The one persisted store behind the Events and Timeline pages (ADR-474). Three files under the project's `.claude-flow/console/`:
 * `events.jsonl` (what happened), `lanes.jsonl` (when each lane was busy, and its tool calls per minute) and `events-prefs.json`
 * (saved searches, pins, alert rules). Every line is `{"v":1,...}`; a line that is not JSON, is cut off, or says a newer version is
 * counted and skipped, never thrown on. Everything written is washed first (data/event-mask.ts): only masked text reaches the disk.
 * This module is pure (text in, text out); the one write path that appends and rotates is hooks/activity-io.ts.
 */
import { countOf, timeOf } from './safe'
import { maskLine } from './event-mask'
import { isLevel, levelOf, type Level } from './event-severity'
import { isEventKind, type ConsoleEvent, type EventKind } from './events'

export const DIR = '.claude-flow/console'
export const EVENTS_FILE = `${DIR}/events.jsonl`
export const LANES_FILE = `${DIR}/lanes.jsonl`
export const PREFS_FILE = `${DIR}/events-prefs.json`
export const EXPORT_DIR = `${DIR}/exports`

export const SCHEMA = 1
export const EVENTS_CAP = 2 * 1024 * 1024
export const LANES_CAP = 1024 * 1024
export const PREFS_CAP = 64 * 1024
/** A file is read whole only up to this (the cap plus one batch); the page parses the last TAIL_BYTES of it. */
export const READ_MAX = 2_400_000
export const TAIL_BYTES = 1_000_000
export const MAX_LOG = 10_000
export const MAX_LANE_ROWS = 20_000
export const LINE_MAX = 1_000

export type Decoded<T> = { items: T[]; bad: number; newer: number; /** Bytes parsed, for the page to show next to the cap. */ bytes: number }

const parseObject = (line: string): Record<string, unknown> | null => {
  if (line.length < 2 || line.length > LINE_MAX * 3 || line[0] !== '{') return null

  try {
    const value: unknown = JSON.parse(line)

    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The lines of the last `tailBytes` of `text`, without a first line that may have been cut in two. */
export function tailLines(text: string, tailBytes = TAIL_BYTES): { lines: string[]; bytes: number } {
  const cut = text.length > tailBytes
  const body = cut ? text.slice(text.length - tailBytes) : text
  const lines = body.split('\n')

  if (cut) lines.shift()

  return { lines: lines.filter(line => line !== ''), bytes: body.length }
}

// ---------------------------------------------------------------------------------------------------------------- events

/** One event as a line (with its newline): level decided now, text washed, every field a known type. */
export function encodeEvent(event: ConsoleEvent, session = ''): string {
  const text = maskLine(event.text, 240)
  const ref = event.ref === undefined ? undefined : maskLine(event.ref, 80)
  const agent = event.agentId === undefined ? undefined : maskLine(event.agentId, 80)

  return `${JSON.stringify({ v: SCHEMA, t: Math.round(event.atMs), kind: event.kind, level: levelOf(event.kind, text), text, ...(agent !== undefined && agent !== '' && { agent }), ...(ref !== undefined && ref !== '' && { ref }), ...(event.src !== undefined && { src: maskLine(event.src, 24) }), ...(session !== '' && { s: session }) })}\n`
}

/** One line to an event, or null (also null for a newer schema: counted by the caller). An unknown kind becomes `other` with its name kept in the words. */
export function decodeEvent(line: string): ConsoleEvent | 'newer' | null {
  const r = parseObject(line)

  if (r === null) return null
  if (typeof r.v === 'number' && r.v > SCHEMA) return 'newer'
  const at = timeOf(r.t)

  if (r.v !== SCHEMA || at === undefined || at < 0 || typeof r.text !== 'string' || typeof r.kind !== 'string') return null

  const kind: EventKind = isEventKind(r.kind) ? r.kind : 'other'
  const text = maskLine(kind !== 'other' || r.kind === 'other' ? r.text : `[${maskLine(r.kind, 20)}] ${r.text}`, 240)

  return {
    atMs: at,
    kind,
    text,
    ...(typeof r.agent === 'string' && r.agent !== '' && { agentId: maskLine(r.agent, 80) }),
    ...(typeof r.ref === 'string' && r.ref !== '' && { ref: maskLine(r.ref, 80) }),
    src: typeof r.src === 'string' ? maskLine(r.src, 24) : 'history',
  }
}

/** The events in the tail of a log file, oldest first, one of each (two consoles may have logged the same observation), at most MAX_LOG. */
export function decodeEvents(text: string | null, tailBytes = TAIL_BYTES): Decoded<ConsoleEvent> {
  if (text === null) return { items: [], bad: 0, newer: 0, bytes: 0 }

  const { lines, bytes } = tailLines(text, tailBytes)
  const seen = new Set<string>()
  const items: ConsoleEvent[] = []
  let bad = 0
  let newer = 0

  for (const line of lines) {
    const event = decodeEvent(line)

    if (event === null) bad++
    else if (event === 'newer') newer++
    else {
      const key = `${Math.floor(event.atMs / 1000)}|${event.kind}|${event.text}`

      if (!seen.has(key)) {
        seen.add(key)
        items.push(event)
      }
    }
  }

  items.sort((a, b) => a.atMs - b.atMs)

  return { items: items.length > MAX_LOG ? items.slice(items.length - MAX_LOG) : items, bad, newer, bytes }
}

/** The newest part of a log, from a line start, about half of `cap`: what is kept when the file passes its cap. */
export function keepNewestHalf(text: string, cap: number): string {
  if (text.length <= cap) return text

  const from = text.length - Math.floor(cap / 2)
  const at = text.indexOf('\n', from)

  return at === -1 ? '' : text.slice(at + 1)
}

// ---------------------------------------------------------------------------------------------------------------- lanes

export type LaneGroup = 'ruflo' | 'claude' | 'workflow' | 'mission' | 'autopilot'
export const LANE_GROUPS: readonly LaneGroup[] = ['ruflo', 'claude', 'workflow', 'mission', 'autopilot']
export const isLaneGroup = (value: unknown): value is LaneGroup => (LANE_GROUPS as readonly unknown[]).includes(value)

export type LaneSpan = { lane: string; group: LaneGroup; label: string; fromMs: number; toMs: number; busy: boolean }
/** Tool calls of one lane in one minute (`min` is the minute index since the epoch), by tool. */
export type LaneTick = { lane: string; group: LaneGroup; label: string; min: number; n: number; tools: Record<string, number> }
export type LaneRow = ({ k: 'span' } & LaneSpan) | ({ k: 'tick' } & LaneTick)

export function encodeLane(row: LaneRow): string {
  const base = { v: SCHEMA, t: row.k, l: maskLine(row.lane, 80), g: row.group, n: maskLine(row.label, 60) }

  if (row.k === 'span') return `${JSON.stringify({ ...base, a: Math.round(row.fromMs), b: Math.round(row.toMs), y: row.busy ? 1 : 0 })}\n`

  const tools = Object.fromEntries(Object.entries(row.tools).slice(0, 12).map(([name, n]) => [maskLine(name, 40), Math.max(0, Math.round(n))]))

  return `${JSON.stringify({ ...base, m: row.min, c: row.n, tools })}\n`
}

export function decodeLane(line: string): LaneRow | 'newer' | null {
  const r = parseObject(line)

  if (r === null) return null
  if (typeof r.v === 'number' && r.v > SCHEMA) return 'newer'
  if (r.v !== SCHEMA || typeof r.l !== 'string' || !isLaneGroup(r.g) || typeof r.n !== 'string') return null

  const lane = maskLine(r.l, 80)
  const label = maskLine(r.n, 60)

  const from = timeOf(r.a)
  const to = timeOf(r.b)

  if (r.t === 'span' && from !== undefined && to !== undefined && to >= from && from >= 0) return { k: 'span', lane, group: r.g, label, fromMs: from, toMs: to, busy: r.y === 1 }

  const minute = countOf(r.m)
  const calls = countOf(r.c)

  if (r.t === 'tick' && minute !== undefined && calls !== undefined) {
    const tools = Object.create(null) as Record<string, number>

    if (typeof r.tools === 'object' && r.tools !== null) {
      for (const [name, n] of Object.entries(r.tools as Record<string, unknown>).slice(0, 12)) {
        const n2 = countOf(n)

        if (n2 !== undefined) tools[maskLine(name, 40)] = n2
      }
    }

    return { k: 'tick', lane, group: r.g, label, min: minute, n: calls, tools }
  }

  return null
}

export function decodeLanes(text: string | null, tailBytes = TAIL_BYTES): Decoded<LaneRow> {
  if (text === null) return { items: [], bad: 0, newer: 0, bytes: 0 }

  const { lines, bytes } = tailLines(text, tailBytes)
  const items: LaneRow[] = []
  let bad = 0
  let newer = 0

  for (const line of lines) {
    const row = decodeLane(line)

    if (row === null) bad++
    else if (row === 'newer') newer++
    else items.push(row)
  }

  return { items: items.length > MAX_LANE_ROWS ? items.slice(items.length - MAX_LANE_ROWS) : items, bad, newer, bytes }
}

// ---------------------------------------------------------------------------------------------------------------- prefs

export const MAX_SEARCHES = 20
export const MAX_PINS = 50
export const MAX_RULES = 10

export type SavedSearch = { name: string; q: string }
export type Pin = { atMs: number; kind: ConsoleEvent['kind']; text: string; level: Level }
export type Prefs = { searches: SavedSearch[]; pins: Pin[]; rules: SavedSearch[] }
export type PrefsRead = { prefs: Prefs; problem: string | null; isForeign: boolean }

export const emptyPrefs = (): Prefs => ({ searches: [], pins: [], rules: [] })

const named = (list: unknown, max: number): SavedSearch[] => {
  if (!Array.isArray(list)) return []

  return list.flatMap(item => {
    const r = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null

    if (r === null || typeof r.name !== 'string' || typeof r.q !== 'string') return []

    const name = maskLine(r.name, 24)
    const q = maskLine(r.q, 200)

    return name === '' || q === '' ? [] : [{ name, q }]
  }).slice(0, max)
}

/** The prefs file read tolerantly: a newer schema is kept untouched (isForeign: never written over), damage gives the empty set and a problem. */
export function decodePrefs(text: string | null): PrefsRead {
  if (text === null) return { prefs: emptyPrefs(), problem: null, isForeign: false }

  let value: unknown

  try {
    value = JSON.parse(text)
  } catch {
    return { prefs: emptyPrefs(), problem: 'the saved searches file could not be read, so it starts empty and is replaced on the next change', isForeign: false }
  }

  const r = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null

  if (r === null) return { prefs: emptyPrefs(), problem: 'the saved searches file is not an object', isForeign: false }
  if (typeof r.v === 'number' && r.v > SCHEMA) return { prefs: emptyPrefs(), problem: `the saved searches file is from a newer console (v${r.v}) and is left as it is`, isForeign: true }

  const pins = (Array.isArray(r.pins) ? r.pins : []).flatMap((item): Pin[] => {
    const p = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null

    const pinAt = p === null ? undefined : timeOf(p.atMs)

    if (p === null || pinAt === undefined || typeof p.text !== 'string') return []

    const kind = isEventKind(p.kind) ? p.kind : 'other'
    const text = maskLine(p.text, 240)

    return [{ atMs: pinAt, kind, text, level: isLevel(p.level) ? p.level : levelOf(kind, text) }]
  })

  return { prefs: { searches: named(r.searches, MAX_SEARCHES), pins: pins.slice(0, MAX_PINS), rules: named(r.rules, MAX_RULES) }, problem: null, isForeign: false }
}

export const encodePrefs = (prefs: Prefs): string => `${JSON.stringify({ v: SCHEMA, searches: prefs.searches.slice(0, MAX_SEARCHES), pins: prefs.pins.slice(0, MAX_PINS), rules: prefs.rules.slice(0, MAX_RULES) })}\n`
