/**
 * The Timeline's data (ADR-474): lanes in groups, their busy and idle spans and tool calls per minute, held in one bounded store that
 * the persisted `lanes.jsonl` fills at start and the live reads extend. Windows, buckets, the concurrency strip, idle gaps and the
 * busiest minute are pure functions of that store. Nothing is invented: a lane has the spans something observed.
 */
import { MAX_LANE_ROWS, type LaneGroup, type LaneRow, type LaneSpan, type LaneTick } from './activity-store'
import type { ConsoleEvent } from './events'
import { refOf } from './events'
import { levelOfEvent, rankOf, type Level } from './event-severity'

export type LaneStore = {
  spans: LaneSpan[]
  ticks: Map<string, LaneTick>
  open: Map<string, { group: LaneGroup; label: string; fromMs: number; busy: boolean }>
  known: Set<string>
  persistedTicks: Set<string>
  cursors: Map<string, number>
  /** Bumps on every change: a memo key. */
  version: number
}

export const newLaneStore = (): LaneStore => ({ spans: [], ticks: new Map(), open: new Map(), known: new Set(), persistedTicks: new Set(), cursors: new Map(), version: 0 })

const minuteOf = (ms: number): number => Math.floor(ms / 60_000)
const tickKey = (lane: string, min: number): string => `${lane}|${min}`

function pushSpan(store: LaneStore, span: LaneSpan): void {
  store.spans.push(span)
  if (store.spans.length > MAX_LANE_ROWS) store.spans.splice(0, store.spans.length - MAX_LANE_ROWS)
  store.known.add(`${span.lane}|${span.fromMs}`)
}

/** Fills the store from what was persisted (spans, ticks); a tick read back is already persisted. */
export function loadRows(store: LaneStore, rows: readonly LaneRow[]): void {
  for (const row of rows) {
    if (row.k === 'span') {
      if (!store.known.has(`${row.lane}|${row.fromMs}`)) pushSpan(store, row)
    } else {
      const key = tickKey(row.lane, row.min)

      store.ticks.set(key, row)
      store.persistedTicks.add(key)
    }
  }

  store.spans.sort((a, b) => a.fromMs - b.fromMs)
  store.version++
}

export type Sample = { lane: string; group: LaneGroup; label: string; busy: boolean }

/** A status read: each sampled lane is busy or idle now. A lane of `group` that is not in the sample has gone, and its open span closes. Returns the spans that closed. */
export function observe(store: LaneStore, group: LaneGroup, samples: readonly Sample[], nowMs: number): LaneRow[] {
  const out: LaneRow[] = []
  const seen = new Set<string>()

  for (const sample of samples) {
    seen.add(sample.lane)

    const held = store.open.get(sample.lane)

    if (held !== undefined && held.busy === sample.busy) continue

    if (held !== undefined && nowMs > held.fromMs) {
      const span = { lane: sample.lane, group, label: held.label, fromMs: held.fromMs, toMs: nowMs, busy: held.busy }

      pushSpan(store, span)
      out.push({ k: 'span', ...span })
    }

    store.open.set(sample.lane, { group, label: sample.label, fromMs: nowMs, busy: sample.busy })
    store.version++
  }

  for (const [lane, held] of [...store.open]) {
    if (held.group !== group || seen.has(lane)) continue

    if (nowMs > held.fromMs) {
      const span = { lane, group, label: held.label, fromMs: held.fromMs, toMs: nowMs, busy: held.busy }

      pushSpan(store, span)
      out.push({ k: 'span', ...span })
    }

    store.open.delete(lane)
    store.version++
  }

  return out
}

/** An interval something else timed (a workflow agent, an autopilot step, a mission task). Running (`toMs` null) is held open; finished is stored once, whatever number of reads show it. */
export function setInterval(store: LaneStore, lane: string, group: LaneGroup, label: string, fromMs: number, toMs: number | null, busy = true): LaneRow | null {
  if (!Number.isFinite(fromMs) || fromMs <= 0) return null

  if (toMs === null) {
    if (!store.open.has(lane) && !store.known.has(`${lane}|${fromMs}`)) {
      store.open.set(lane, { group, label, fromMs, busy })
      store.version++
    }

    return null
  }

  store.open.delete(lane)

  if (store.known.has(`${lane}|${fromMs}`) || toMs < fromMs) return null

  const span = { lane, group, label, fromMs, toMs, busy }

  pushSpan(store, span)
  store.version++

  return { k: 'span', ...span }
}

/** Tool calls newer than this lane's cursor, counted into minutes by tool. Returns the minutes that are complete and not yet persisted. */
export function addTools(store: LaneStore, lane: string, group: LaneGroup, label: string, calls: readonly { atMs: number; tool: string }[], nowMs: number): LaneRow[] {
  const cursor = store.cursors.get(lane) ?? 0
  let newest = cursor

  for (const call of calls) {
    if (call.atMs <= cursor) continue

    const key = tickKey(lane, minuteOf(call.atMs))
    // A tool named `constructor` or `__proto__` must count like any other: a null-prototype table has no inherited names.
    const tick = store.ticks.get(key) ?? { lane, group, label, min: minuteOf(call.atMs), n: 0, tools: Object.create(null) as Record<string, number> }
    const tool = call.tool.slice(0, 40)

    tick.n++
    tick.tools[tool] = (tick.tools[tool] ?? 0) + 1
    store.ticks.set(key, tick)
    newest = Math.max(newest, call.atMs)
  }

  if (newest > cursor) {
    store.cursors.set(lane, newest)
    store.version++
  }

  return completeTicks(store, nowMs)
}

/** The ticks of finished minutes that were not persisted yet (marked now). */
export function completeTicks(store: LaneStore, nowMs: number): LaneRow[] {
  const out: LaneRow[] = []

  for (const [key, tick] of store.ticks) {
    if (tick.min < minuteOf(nowMs) && !store.persistedTicks.has(key)) {
      store.persistedTicks.add(key)
      out.push({ k: 'tick', ...tick })
    }
  }

  return out
}

/** Drops ticks older than a day from memory (the file keeps its own rotation). */
export function trim(store: LaneStore, nowMs: number, keepMs = 7 * 86_400_000): void {
  for (const [key, tick] of store.ticks) if (tick.min * 60_000 < nowMs - keepMs) store.ticks.delete(key)
}

// ---------------------------------------------------------------------------------------------------------------- windows

export type TlWindowId = '5m' | '15m' | '1h' | '6h' | '24h' | 'session'

export const TL_WINDOWS: readonly { id: TlWindowId; label: string; ms: number | null }[] = [
  { id: '5m', label: '5 min', ms: 5 * 60_000 },
  { id: '15m', label: '15 min', ms: 15 * 60_000 },
  { id: '1h', label: '1 h', ms: 3_600_000 },
  { id: '6h', label: '6 h', ms: 6 * 3_600_000 },
  { id: '24h', label: '24 h', ms: 86_400_000 },
  { id: 'session', label: 'session', ms: null },
]

export const isTlWindow = (value: unknown): value is TlWindowId => TL_WINDOWS.some(entry => entry.id === value)

export type Span = { fromMs: number; toMs: number }

/** The span of time shown: `spanMs` long, ending `offsetMs` before now (0 is the live edge). A session is as long as the console has been up (at least a minute). */
export function windowOf(id: TlWindowId, offsetMs: number, nowMs: number, loadedAtMs: number): Span & { spanMs: number } {
  const entry = TL_WINDOWS.find(item => item.id === id)
  const spanMs = entry?.ms ?? Math.max(60_000, nowMs - loadedAtMs)
  const toMs = nowMs - Math.max(0, offsetMs)

  return { fromMs: toMs - spanMs, toMs, spanMs }
}

/** The next wider or narrower window, or the same one at the end of the list. */
export function zoomed(id: TlWindowId, by: 1 | -1): TlWindowId {
  const order = TL_WINDOWS.filter(entry => entry.ms !== null).map(entry => entry.id)
  const at = order.indexOf(id)

  return order[Math.max(0, Math.min(order.length - 1, (at === -1 ? 1 : at) + by))] ?? id
}

// ---------------------------------------------------------------------------------------------------------------- lanes

export type LaneView = {
  lane: string
  group: LaneGroup
  label: string
  spans: LaneSpan[]
  calls: number
  byTool: [string, number][]
  busyMs: number
  observedMs: number
  /** Busy share of the time the lane was observed in the window, or null where it was not observed. */
  busyPct: number | null
  longestMs: number
  lastAtMs: number
  /** The minutes (since the epoch) in which the lane called a tool, for drawing without scanning every minute of the window. */
  tickMins: number[]
}

const clip = (a: number, b: number, win: Span): number => Math.max(0, Math.min(b, win.toMs) - Math.max(a, win.fromMs))

/** Every lane that has a span or a tool call in the window. Open spans run to now. One pass over the store. */
export function lanesIn(store: LaneStore, win: Span, nowMs: number): LaneView[] {
  const views = new Map<string, LaneView & { tools: Map<string, number> }>()
  const view = (lane: string, group: LaneGroup, label: string) => {
    let held = views.get(lane)

    if (held === undefined) {
      held = { lane, group, label, spans: [], calls: 0, byTool: [], busyMs: 0, observedMs: 0, busyPct: null, longestMs: 0, lastAtMs: 0, tickMins: [], tools: new Map() }
      views.set(lane, held)
    }

    return held
  }
  const addSpan = (span: LaneSpan) => {
    const used = clip(span.fromMs, span.toMs, win)

    if (used <= 0) return

    const held = view(span.lane, span.group, span.label)

    held.spans.push(span)
    held.observedMs += used
    held.lastAtMs = Math.max(held.lastAtMs, Math.min(span.toMs, win.toMs))
    if (span.busy) {
      held.busyMs += used
      held.longestMs = Math.max(held.longestMs, used)
    }
  }

  for (const span of store.spans) if (span.toMs > win.fromMs && span.fromMs < win.toMs) addSpan(span)
  for (const [lane, held] of store.open) addSpan({ lane, group: held.group, label: held.label, fromMs: held.fromMs, toMs: nowMs, busy: held.busy })

  for (const tick of store.ticks.values()) {
    const at = tick.min * 60_000

    if (at + 60_000 <= win.fromMs || at >= win.toMs) continue

    const held = view(tick.lane, tick.group, tick.label)

    held.calls += tick.n
    held.tickMins.push(tick.min)
    held.lastAtMs = Math.max(held.lastAtMs, at)
    for (const [tool, n] of Object.entries(tick.tools)) held.tools.set(tool, (held.tools.get(tool) ?? 0) + n)
  }

  return [...views.values()].map(({ tools, ...rest }) => ({ ...rest, byTool: [...tools].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12), busyPct: rest.observedMs > 0 && rest.spans.length > 0 ? Math.round((rest.busyMs / rest.observedMs) * 100) : null }))
}

export type SortId = 'busy' | 'calls' | 'name' | 'recent'
export const SORTS: readonly SortId[] = ['busy', 'calls', 'name', 'recent']

export function sortLanes(lanes: readonly LaneView[], sort: SortId): LaneView[] {
  const by: Record<SortId, (a: LaneView, b: LaneView) => number> = {
    busy: (a, b) => (b.busyPct ?? -1) - (a.busyPct ?? -1) || b.calls - a.calls,
    calls: (a, b) => b.calls - a.calls || (b.busyPct ?? -1) - (a.busyPct ?? -1),
    name: (a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0),
    recent: (a, b) => b.lastAtMs - a.lastAtMs,
  }

  return [...lanes].sort((a, b) => by[sort](a, b) || (a.lane < b.lane ? -1 : 1))
}

/** Which of `n` cells of the window a lane was busy (2), idle (1), called a tool in (3), or unobserved (0). */
export function cellsOf(lane: LaneView, win: Span, cellsN: number, _store?: LaneStore): Uint8Array {
  const out = new Uint8Array(cellsN)
  const step = (win.toMs - win.fromMs) / cellsN

  for (const span of lane.spans) {
    const a = Math.max(0, Math.floor((Math.max(span.fromMs, win.fromMs) - win.fromMs) / step))
    const b = Math.min(cellsN - 1, Math.floor((Math.min(span.toMs, win.toMs) - win.fromMs - 1) / step))

    for (let i = a; i <= b; i++) out[i] = Math.max(out[i] as number, span.busy ? 2 : 1)
  }

  for (const m of lane.tickMins) {
    const i = Math.floor((m * 60_000 + 30_000 - win.fromMs) / step)

    if (i >= 0 && i < cellsN) out[i] = 3
  }

  return out
}

export type Concurrency = { counts: number[]; stepMs: number; peak: number; mean: number; peakAtMs: number | null }

/** How many lanes were busy in each bar (a busy span, or a tool call, in it): a parallelism strip with its peak and mean over the bars with anyone busy. */
export function concurrency(lanes: readonly LaneView[], win: Span, store: LaneStore, bars: number): Concurrency {
  const stepMs = (win.toMs - win.fromMs) / bars
  const counts = new Array<number>(bars).fill(0)

  for (const lane of lanes) {
    const cells = cellsOf(lane, win, bars, store)

    for (let i = 0; i < bars; i++) if ((cells[i] as number) >= 2) counts[i]!++
  }

  const peak = Math.max(0, ...counts)
  const active = counts.filter(n => n > 0)

  return { counts, stepMs, peak, mean: active.length === 0 ? 0 : Math.round((active.reduce((a, b) => a + b, 0) / active.length) * 10) / 10, peakAtMs: peak === 0 ? null : win.fromMs + counts.indexOf(peak) * stepMs }
}

export type IdleGap = { lane: string; label: string; fromMs: number; toMs: number }

/** A lane idle for `minMs` or more while another lane was busy: the stretches, longest first (at most `max`). */
export function idleGaps(lanes: readonly LaneView[], win: Span, store: LaneStore, minMs = 5 * 60_000, max = 8): IdleGap[] {
  const bars = Math.max(1, Math.min(240, Math.round((win.toMs - win.fromMs) / 60_000)))
  const step = (win.toMs - win.fromMs) / bars
  const grids = lanes.map(lane => cellsOf(lane, win, bars, store))
  const busyAt = (i: number, skip: number): boolean => grids.some((g, k) => k !== skip && (g[i] as number) >= 2)
  const out: IdleGap[] = []

  grids.forEach((grid, k) => {
    let from = -1

    const close = (to: number) => {
      if (from >= 0 && (to - from) * step >= minMs) out.push({ lane: (lanes[k] as LaneView).lane, label: (lanes[k] as LaneView).label, fromMs: win.fromMs + from * step, toMs: win.fromMs + to * step })

      from = -1
    }

    for (let i = 0; i < bars; i++) {
      const idle = (grid[i] as number) === 1 && busyAt(i, k)

      if (idle && from < 0) from = i
      else if (!idle) close(i)
    }

    close(bars)
  })

  return out.sort((a, b) => b.toMs - b.fromMs - (a.toMs - a.fromMs)).slice(0, max)
}

/** The minute with the most tool calls across all lanes in the window, or null. */
export function busiestMinute(store: LaneStore, win: Span): { atMs: number; n: number } | null {
  const per = new Map<number, number>()

  for (const tick of store.ticks.values()) if (tick.min * 60_000 >= win.fromMs - 60_000 && tick.min * 60_000 < win.toMs) per.set(tick.min, (per.get(tick.min) ?? 0) + tick.n)

  let best: { atMs: number; n: number } | null = null

  for (const [min, n] of per) if (best === null || n > best.n || (n === best.n && min * 60_000 > best.atMs)) best = { atMs: min * 60_000, n }

  return best
}

// ---------------------------------------------------------------------------------------------------------------- events on lanes

/** Lookup tables from a ref to a lane, built once per list of lanes: `agent:<id>` is `ruflo:<id>`, `run:<id>` is any workflow lane of that run. */
function laneIndex(lanes: readonly LaneView[]): { exact: Map<string, string>; runs: Map<string, string> } {
  const exact = new Map<string, string>()
  const runs = new Map<string, string>()

  for (const lane of lanes) {
    exact.set(lane.lane, lane.lane)

    if (lane.lane.startsWith('workflow:')) {
      const run = lane.lane.slice(9).split('/')[0] as string

      if (!runs.has(run)) runs.set(run, lane.lane)
    }
  }

  return { exact, runs }
}

const laneFor = (ref: string | undefined, index: ReturnType<typeof laneIndex>): string | null => {
  if (ref === undefined) return null

  const at = ref.indexOf(':')
  const kind = ref.slice(0, at)
  const id = ref.slice(at + 1)

  return index.exact.get(`${kind === 'agent' ? 'ruflo' : kind}:${id}`) ?? index.exact.get(ref) ?? (kind === 'run' ? (index.runs.get(id) ?? null) : null)
}

/** The worst warn or bad level in each of `bars` cells of the window, for every lane that has one ('' is the top events lane): one pass over the events. */
export function markerIndex(events: readonly ConsoleEvent[], lanes: readonly LaneView[], win: Span, bars: number): Map<string, (Level | null)[]> {
  const out = new Map<string, (Level | null)[]>()
  const index = laneIndex(lanes)
  const step = (win.toMs - win.fromMs) / bars

  for (const event of events) {
    if (event.atMs < win.fromMs || event.atMs >= win.toMs) continue

    const level = levelOfEvent(event)

    if (rankOf(level) < 2) continue

    const key = laneFor(refOf(event), index) ?? ''
    let cells = out.get(key)

    if (cells === undefined) {
      cells = new Array<Level | null>(bars).fill(null)
      out.set(key, cells)
    }

    const i = Math.min(bars - 1, Math.floor((event.atMs - win.fromMs) / step))

    if (cells[i] === null || rankOf(level) > rankOf(cells[i] as Level)) cells[i] = level
  }

  return out
}

/** The newest warn or bad event strictly before `beforeMs`, or null: where "jump to the last problem" goes. */
export function lastProblem(events: readonly ConsoleEvent[], beforeMs: number): ConsoleEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as ConsoleEvent

    if (event.atMs < beforeMs && rankOf(levelOfEvent(event)) >= 2) return event
  }

  return null
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Local `HH:MM` (or `D HH:MM` past a day) of a time. */
export function clockOf(ms: number, withDay = false): string {
  const at = new Date(ms)

  return `${withDay ? `${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ` : ''}${pad2(at.getHours())}:${pad2(at.getMinutes())}`
}

/** The axis: local time labels at even spacing across `cellsN` cells, never overlapping. */
export function axisLine(win: Span, cellsN: number): string {
  const long = win.toMs - win.fromMs > 86_400_000
  const label = long ? 11 : 5
  const marks = Math.max(1, Math.floor(cellsN / (label + 2)))
  const chars = new Array<string>(cellsN).fill(' ')

  for (let k = 0; k < marks; k++) {
    const at = marks === 1 ? 0 : Math.round((k / (marks - 1)) * (cellsN - label))
    const text = clockOf(win.fromMs + ((win.toMs - win.fromMs) * (at + label / 2)) / cellsN, long)

    for (let i = 0; i < text.length && at + i < cellsN; i++) chars[at + i] = text[i] as string
  }

  return chars.join('')
}
