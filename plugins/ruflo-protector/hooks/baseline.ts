import type { Ev } from './shapes'

/** A learned token: how often, when, and in how many distinct sessions (`s`, capped; `l` is the last session's short id). */
export type Entry = { n: number; first: number; last: number; s: number; l: string }
export type Counts = Record<string, Entry>

export type Baseline = {
  schemaVersion: 1
  events: number
  sessions: number
  firstSeenAt: number
  updatedAt: number
  tools: Counts
  commands: Counts
  hosts: Counts
  areas: Counts
  spawns: Counts
  rate: { p50: number; p95: number; max: number }
  /** Closed per-minute call counts, the sample the rate figures come from (bounded). */
  mins: number[]
}

export const CAP = 2000
export const MATURE = { events: 200, sessions: 3, ms: 24 * 3_600_000 }
const MAX_MINS = 600

export const emptyBaseline = (): Baseline => ({
  schemaVersion: 1, events: 0, sessions: 0, firstSeenAt: 0, updatedAt: 0,
  tools: {}, commands: {}, hosts: {}, areas: {}, spawns: {}, rate: { p50: 0, p95: 0, max: 0 }, mins: [],
})

const size = (b: Baseline) => Object.keys(b.tools).length + Object.keys(b.commands).length + Object.keys(b.hosts).length + Object.keys(b.areas).length + Object.keys(b.spawns).length

/** Count one token; a new session id bumps the distinct-session figure. */
function touch(map: Counts, tok: string, at: number, session: string) {
  const e = map[tok]
  if (e === undefined) map[tok] = { n: 1, first: at, last: at, s: 1, l: session }
  else {
    e.n++
    e.last = at
    if (e.l !== session) {
      e.s = Math.min(e.s + 1, 255)
      e.l = session
    }
  }
}

/** Drop the least recently seen entries until the whole baseline holds at most CAP tokens. */
function evict(b: Baseline) {
  let over = size(b) - CAP
  if (over <= 0) return
  const all = (['tools', 'commands', 'hosts', 'areas', 'spawns'] as const).flatMap(k => Object.entries(b[k]).map(([t, e]) => ({ k, t, last: e.last })))
  all.sort((x, y) => x.last - y.last)
  for (const v of all) {
    if (over-- <= 0) break
    delete b[v.k][v.t]
  }
}

/** Teach the baseline one CLEAN event (the caller has checked no rule fired, nothing was denied, the turn was not tainted). */
export function learn(b: Baseline, ev: Ev, session: string, at: number) {
  if (b.firstSeenAt === 0) b.firstSeenAt = at
  b.events++
  b.updatedAt = at
  touch(b.tools, ev.tool, at, session)
  if (ev.k === 'spawn' && ev.head !== '') touch(b.spawns, ev.head, at, session)
  for (const h of ev.heads) touch(b.commands, h, at, session)
  if (ev.host !== '') touch(b.hosts, ev.host, at, session)
  for (const a of ev.areas) touch(b.areas, a, at, session)
  evict(b)
}

export const maturity = (b: Baseline, now: number) => {
  const r = [b.events / MATURE.events, b.sessions / MATURE.sessions, b.firstSeenAt === 0 ? 0 : (now - b.firstSeenAt) / MATURE.ms].map(x => Math.max(0, Math.min(1, x)))
  return { pct: Math.round((r.reduce((a, c) => a + c, 0) / 3) * 100), mature: r.every(x => x >= 1) }
}

/** A token is known when it was seen; a risky class needs two different sessions before it counts (the slow-boil defence). */
export const known = (map: Counts, tok: string, risky: boolean) => {
  const e = map[tok]
  return e !== undefined && (!risky || e.s >= 2)
}

/** Fold a closed minute's call count into the rate sample and recompute p50/p95/max. */
export function closeMinute(b: Baseline, calls: number) {
  if (calls <= 0) return
  b.mins.push(calls)
  if (b.mins.length > MAX_MINS) b.mins.shift()
  const s = [...b.mins].sort((x, y) => x - y)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0
  b.rate = { p50: at(0.5), p95: at(0.95), max: s[s.length - 1] ?? 0 }
}

function counts(v: unknown): Counts {
  const out: Counts = {}
  if (v === null || typeof v !== 'object') return out
  for (const [t, e] of Object.entries(v as Record<string, unknown>).slice(0, CAP)) {
    const o = e as Partial<Entry> | null
    if (o && typeof o.n === 'number') out[t.slice(0, 40)] = { n: o.n, first: Number(o.first) || 0, last: Number(o.last) || 0, s: Math.min(Number(o.s) || 1, 255), l: String(o.l ?? '').slice(0, 12) }
  }
  return out
}

/** A baseline file read back; anything that is not a schemaVersion 1 baseline starts a fresh one. */
export function parseBaseline(text: string): Baseline {
  try {
    const o = JSON.parse(text) as Partial<Baseline>
    if (o.schemaVersion !== 1) return emptyBaseline()
    const b = emptyBaseline()
    b.events = Number(o.events) || 0
    b.sessions = Number(o.sessions) || 0
    b.firstSeenAt = Number(o.firstSeenAt) || 0
    b.updatedAt = Number(o.updatedAt) || 0
    for (const k of ['tools', 'commands', 'hosts', 'areas', 'spawns'] as const) b[k] = counts(o[k])
    b.mins = Array.isArray(o.mins) ? o.mins.filter((x): x is number => typeof x === 'number').slice(-MAX_MINS) : []
    closeMinute(b, 0)
    if (b.mins.length > 0) {
      const s = [...b.mins].sort((x, y) => x - y)
      b.rate = { p50: s[Math.floor(s.length / 2)] ?? 0, p95: s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] ?? 0, max: s[s.length - 1] ?? 0 }
    }
    return b
  } catch {
    return emptyBaseline()
  }
}
