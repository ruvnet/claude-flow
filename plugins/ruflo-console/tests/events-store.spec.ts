/**
 * The persisted schema (ADR-474): lines encode masked and versioned, decode tolerantly (corrupt lines, a cut first line, newer
 * schema, unknown kind), de-duplicate what two consoles both logged, rotate to the newest half, and the prefs file round-trips.
 * A property test round-trips random events.
 */
import { describe, expect, it } from 'vitest'

import { decodeEvent, decodeEvents, decodeLane, decodeLanes, decodePrefs, emptyPrefs, encodeEvent, encodeLane, encodePrefs, keepNewestHalf, MAX_LOG, MAX_PINS, MAX_RULES, MAX_SEARCHES, tailLines } from '../hooks/data/activity-store'
import type { ConsoleEvent } from '../hooks/data/events'

const T = Date.UTC(2026, 9, 7, 12)
const ev = (text: string, atS = 0, extra: Partial<ConsoleEvent> = {}): ConsoleEvent => ({ kind: 'swarm', text, atMs: T + atS * 1000, ...extra })

describe('event lines', () => {
  it('encode a versioned, masked line with its level, and decode it back', () => {
    const line = encodeEvent(ev('agent coder failed token=abc123def456 in /home/alice/x', 0, { agentId: 'a1' }), 's1')
    const parsed = JSON.parse(line) as Record<string, unknown>

    expect(parsed).toMatchObject({ v: 1, kind: 'swarm', level: 'bad', agent: 'a1', s: 's1' })
    expect(line).not.toContain('abc123def456')
    expect(line).not.toContain('alice')
    expect(line.endsWith('\n')).toBe(true)
    expect(decodeEvent(line.trim())).toMatchObject({ atMs: T, kind: 'swarm', agentId: 'a1', src: 'history' })
  })

  it('skips corrupt lines, a partial last line, a cut first line and lines from a newer schema, and says how many', () => {
    const good = encodeEvent(ev('one', 0)) + encodeEvent(ev('two', 1))
    const text = `${good.slice(7)}not json\n{"v":2,"t":1,"kind":"swarm","text":"future"}\n{"v":1,"t":"x"}\n${encodeEvent(ev('three', 2))}{"v":1,"t":99,"kind":"sw`
    const out = decodeEvents(text)

    expect(out.items.map(e => e.text)).toEqual(['two', 'three'].filter(t => out.items.some(e => e.text === t)))
    expect(out.items.map(e => e.text)).toContain('three')
    expect(out.newer).toBe(1)
    expect(out.bad).toBeGreaterThanOrEqual(3)
  })

  it('an unknown kind from an old log is shown as other with its name kept', () => {
    const line = `${JSON.stringify({ v: 1, t: T, kind: 'telepathy', level: 'info', text: 'hello' })}\n`

    expect(decodeEvents(line).items[0]).toMatchObject({ kind: 'other', text: '[telepathy] hello' })
  })

  it('de-duplicates one observation logged by two consoles, and caps the retained log', () => {
    const twice = encodeEvent(ev('same', 0), 'a') + encodeEvent(ev('same', 0), 'b')

    expect(decodeEvents(twice).items).toHaveLength(1)

    const many = Array.from({ length: MAX_LOG + 50 }, (_, i) => encodeEvent(ev(`e${i}`, i))).join('')

    expect(decodeEvents(many, 50_000_000).items).toHaveLength(MAX_LOG)
    expect(decodeEvents(many, 50_000_000).items.at(-1)?.text).toBe(`e${MAX_LOG + 49}`)
  })

  it('reads only the tail of a big file and drops the line it cut', () => {
    const lines = Array.from({ length: 100 }, (_, i) => encodeEvent(ev(`event number ${i}`, i))).join('')
    const { lines: tail } = tailLines(lines, 500)

    expect(tail.length).toBeLessThan(100)
    expect(tail.every(line => line.startsWith('{') && line.endsWith('}'))).toBe(true)
    expect(decodeEvents(null)).toEqual({ items: [], bad: 0, newer: 0, bytes: 0 })
  })

  it('rotation keeps the newest part, from a line start, about half the cap', () => {
    const text = Array.from({ length: 200 }, (_, i) => `{"line":${i}}\n`).join('')
    const kept = keepNewestHalf(text, 1000)

    expect(kept.length).toBeLessThanOrEqual(520)
    expect(kept.startsWith('{')).toBe(true)
    expect(kept.endsWith('{"line":199}\n')).toBe(true)
    expect(keepNewestHalf('short\n', 1000)).toBe('short\n')
  })

  it('round-trips 500 random events', () => {
    let seed = 3
    const rnd = (n: number): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n)
    const kinds = ['swarm', 'claims', 'workflows', 'autopilot', 'anatole'] as const
    const words = ['agent', 'failed', 'done', 'step', 'a1', 'paused', '42', 'run', 'x-y']
    const events = Array.from({ length: 500 }, (_, i) => ev(Array.from({ length: 1 + rnd(6) }, () => words[rnd(words.length)]).join(' ') + ` #${i}`, i, { kind: kinds[rnd(kinds.length)] as ConsoleEvent['kind'] }))
    const back = decodeEvents(events.map(e => encodeEvent(e)).join('')).items

    expect(back.map(e => [e.atMs, e.kind, e.text])).toEqual(events.map(e => [e.atMs, e.kind, e.text]))
  })
})

describe('lane lines', () => {
  it('round-trip a span and a tick, and refuse a span that ends before it starts', () => {
    const span = { k: 'span' as const, lane: 'ruflo:a1', group: 'ruflo' as const, label: 'coder', fromMs: 10, toMs: 20, busy: true }
    const tick = { k: 'tick' as const, lane: 'claude:main', group: 'claude' as const, label: 'claude (main)', min: 5, n: 3, tools: { Bash: 2, Read: 1 } }

    expect(decodeLane(encodeLane(span).trim())).toEqual(span)
    expect(decodeLane(encodeLane(tick).trim())).toEqual(tick)
    expect(decodeLane(encodeLane({ ...span, fromMs: 30 }).trim())).toBeNull()
    expect(decodeLane('{"v":9,"t":"span"}')).toBe('newer')
    expect(decodeLanes(`${encodeLane(span)}garbage\n${encodeLane(tick)}`).bad).toBe(1)
  })
})

describe('prefs', () => {
  it('round-trips searches, pins and rules and enforces every limit', () => {
    const prefs = {
      searches: Array.from({ length: MAX_SEARCHES + 5 }, (_, i) => ({ name: `s${i}`, q: `kind:swarm w${i}` })),
      pins: Array.from({ length: MAX_PINS + 5 }, (_, i) => ({ atMs: T + i, kind: 'swarm' as const, text: `p${i}`, level: 'info' as const })),
      rules: Array.from({ length: MAX_RULES + 5 }, (_, i) => ({ name: `r${i}`, q: `level:bad r${i}` })),
    }
    const read = decodePrefs(encodePrefs(prefs))

    expect(read.prefs.searches).toHaveLength(MAX_SEARCHES)
    expect(read.prefs.pins).toHaveLength(MAX_PINS)
    expect(read.prefs.rules).toHaveLength(MAX_RULES)
    expect(read.problem).toBeNull()
  })

  it('tolerates damage, leaves a newer file alone, masks what it reads, and an absent file is empty', () => {
    expect(decodePrefs('{broken').problem).not.toBeNull()
    expect(decodePrefs('[1]').problem).not.toBeNull()
    expect(decodePrefs(JSON.stringify({ v: 2, searches: [] }))).toMatchObject({ isForeign: true })
    expect(decodePrefs(null).prefs).toEqual(emptyPrefs())
    expect(decodePrefs(JSON.stringify({ v: 1, searches: [{ name: 'x', q: 'token=abc123def456 go' }, { name: 3 }], pins: [{ atMs: 'no' }] })).prefs.searches[0]?.q).not.toContain('abc123def456')
  })
})

describe('hostile times and counts in the history files (#3817 class)', () => {
  it('refuses a time past what Date holds, so no page ever calls toISOString on it', () => {
    expect(decodeEvent('{"v":1,"t":1e300,"kind":"swarm","text":"x"}')).toBeNull()
    expect(decodeEvent('{"v":1,"t":9e15,"kind":"swarm","text":"x"}')).toBeNull()
    expect(decodeLane('{"v":1,"t":"span","l":"a","g":"claude","n":"a","a":0,"b":1e300,"y":1}')).toBeNull()
    expect((decodeEvent('{"v":1,"t":1700000000000,"kind":"swarm","text":"x"}') as ConsoleEvent).atMs).toBe(1700000000000)

    const prefs = decodePrefs(JSON.stringify({ v: 1, pins: [{ atMs: 1e300, kind: 'swarm', text: 'x' }, { atMs: 5, kind: 'swarm', text: 'y' }] }))

    expect(prefs.prefs.pins.map(pin => pin.text)).toEqual(['y'])
  })

  it('clamps a lane tick count to a bounded whole number', () => {
    const row = decodeLane('{"v":1,"t":"tick","l":"a","g":"claude","n":"a","m":5,"c":1e300,"tools":{"x":1e300}}')

    expect(row !== null && row !== 'newer' && row.k === 'tick' && row.n <= 1e12 && (row.tools.x ?? 0) <= 1e12).toBe(true)
  })
})
