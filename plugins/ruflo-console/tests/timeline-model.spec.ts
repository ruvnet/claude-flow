/**
 * The Timeline's data (ADR-474): spans from samples and intervals (idempotent), tool calls per minute, windows and zoom, lanes with
 * busy shares, sorting, the parallelism strip, idle gaps, the busiest minute, event markers on lanes, the axis, and the lines.
 */
import { describe, expect, it } from 'vitest'

import { buildLines, runsOf } from '../hooks/data/timeline-lines'
import type { ConsoleEvent } from '../hooks/data/events'
import { addTools, axisLine, busiestMinute, cellsOf, clockOf, completeTicks, concurrency, idleGaps, lanesIn, lastProblem, loadRows, markerIndex, newLaneStore, observe, setInterval, sortLanes, trim, windowOf, zoomed } from '../hooks/data/timeline-model'

const T = Date.UTC(2026, 9, 7, 12)
const M = 60_000
const sample = (lane: string, busy: boolean) => ({ lane: `ruflo:${lane}`, group: 'ruflo' as const, label: lane, busy })

describe('spans', () => {
  it('a status read opens a span; a change closes it and returns the row to persist; a vanished lane closes at now', () => {
    const store = newLaneStore()

    expect(observe(store, 'ruflo', [sample('a', true)], T)).toEqual([])
    expect(observe(store, 'ruflo', [sample('a', true)], T + M)).toEqual([])

    const closed = observe(store, 'ruflo', [sample('a', false)], T + 2 * M)

    expect(closed).toMatchObject([{ k: 'span', lane: 'ruflo:a', fromMs: T, toMs: T + 2 * M, busy: true }])
    expect(observe(store, 'ruflo', [], T + 5 * M)).toMatchObject([{ busy: false, fromMs: T + 2 * M, toMs: T + 5 * M }])
    expect(store.open.size).toBe(0)
  })

  it('an interval is stored once however many reads show it; running is held open', () => {
    const store = newLaneStore()

    expect(setInterval(store, 'workflow:r/a', 'workflow', 'r/a', T, null)).toBeNull()
    expect(setInterval(store, 'workflow:r/a', 'workflow', 'r/a', T, T + M)).toMatchObject({ k: 'span' })
    expect(setInterval(store, 'workflow:r/a', 'workflow', 'r/a', T, T + M)).toBeNull()
    expect(store.spans).toHaveLength(1)
    expect(setInterval(store, 'x', 'mission', 'x', 0, 5)).toBeNull()
  })

  it('persisted rows load once and are not duplicated by a later interval of the same start', () => {
    const store = newLaneStore()

    loadRows(store, [{ k: 'span', lane: 'autopilot:s1', group: 'autopilot', label: 's1', fromMs: T, toMs: T + M, busy: true }])
    expect(setInterval(store, 'autopilot:s1', 'autopilot', 's1', T, T + M)).toBeNull()
  })
})

describe('tool calls', () => {
  it('count per minute by tool, new calls only, finished minutes persisted once', () => {
    const store = newLaneStore()
    const calls = [{ atMs: T + 1000, tool: 'Bash' }, { atMs: T + 2000, tool: 'Bash' }, { atMs: T + M + 1000, tool: 'Read' }]

    expect(addTools(store, 'claude:main', 'claude', 'claude (main)', calls, T + 90_000)).toMatchObject([{ k: 'tick', n: 2, tools: { Bash: 2 } }])
    expect(addTools(store, 'claude:main', 'claude', 'claude (main)', calls, T + 90_000)).toEqual([])
    expect(completeTicks(store, T + 3 * M)).toMatchObject([{ k: 'tick', n: 1, tools: { Read: 1 } }])
    trim(store, T + 30 * 86_400_000)
    expect(store.ticks.size).toBe(0)
  })
})

describe('windows', () => {
  it('a window ends at now minus the pan, a session is as long as the console has been up, and zoom steps through the list', () => {
    expect(windowOf('15m', 0, T, T - 1)).toMatchObject({ fromMs: T - 15 * M, toMs: T, spanMs: 15 * M })
    expect(windowOf('1h', 30 * M, T, T)).toMatchObject({ toMs: T - 30 * M })
    expect(windowOf('session', 0, T, T - 10 * M).spanMs).toBe(10 * M)
    expect(windowOf('session', 0, T, T).spanMs).toBe(M)
    expect(zoomed('15m', 1)).toBe('1h')
    expect(zoomed('15m', -1)).toBe('5m')
    expect(zoomed('5m', -1)).toBe('5m')
    expect(zoomed('24h', 1)).toBe('24h')
  })
})

function world() {
  const store = newLaneStore()

  loadRows(store, [
    { k: 'span', lane: 'ruflo:a', group: 'ruflo', label: 'alpha', fromMs: T, toMs: T + 10 * M, busy: true },
    { k: 'span', lane: 'ruflo:a', group: 'ruflo', label: 'alpha', fromMs: T + 10 * M, toMs: T + 20 * M, busy: false },
    { k: 'span', lane: 'ruflo:b', group: 'ruflo', label: 'beta', fromMs: T, toMs: T + 20 * M, busy: true },
    { k: 'tick', lane: 'claude:main', group: 'claude', label: 'claude (main)', min: Math.floor(T / M) + 3, n: 5, tools: { Bash: 4, Read: 1 } },
    { k: 'tick', lane: 'claude:main', group: 'claude', label: 'claude (main)', min: Math.floor(T / M) + 4, n: 9, tools: { Bash: 9 } },
  ])

  const win = { fromMs: T, toMs: T + 20 * M }

  return { store, win, lanes: lanesIn(store, win, T + 20 * M) }
}

describe('lanes, parallelism, gaps', () => {
  it('busy shares, longest stretch, tool counts, and sorts', () => {
    const { lanes } = world()
    const alpha = lanes.find(l => l.lane === 'ruflo:a')
    const claude = lanes.find(l => l.lane === 'claude:main')

    expect(alpha).toMatchObject({ busyPct: 50, longestMs: 10 * M, observedMs: 20 * M })
    expect(lanes.find(l => l.lane === 'ruflo:b')?.busyPct).toBe(100)
    expect(claude).toMatchObject({ calls: 14, busyPct: null })
    expect(claude?.byTool[0]).toEqual(['Bash', 13])
    expect(sortLanes(lanes, 'busy')[0]?.lane).toBe('ruflo:b')
    expect(sortLanes(lanes, 'calls')[0]?.lane).toBe('claude:main')
    expect(sortLanes(lanes, 'name')[0]?.label).toBe('alpha')
    expect(sortLanes(lanes, 'recent')).toHaveLength(3)
  })

  it('counts lanes busy at once, with the peak and the mean over busy bars', () => {
    const { store, win, lanes } = world()
    const conc = concurrency(lanes, win, store, 20)

    // Two busy lanes, and the tool-call lane counts as busy in the two minutes it called a tool (a call is activity).
    expect(conc.peak).toBe(3)
    expect(conc.counts.slice(0, 10).every(n => n >= 2)).toBe(true)
    expect(conc.counts[15]).toBe(1)
    expect(conc.mean).toBeGreaterThan(1)
    expect(conc.peakAtMs).toBe(T + 3 * M)
  })

  it('finds a lane idle for 5 minutes or more while another was busy, and the busiest minute', () => {
    const { store, win, lanes } = world()
    const gaps = idleGaps(lanes, win, store)

    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ lane: 'ruflo:a' })
    expect(gaps[0]!.toMs - gaps[0]!.fromMs).toBeGreaterThanOrEqual(5 * M)
    expect(idleGaps(lanes, win, store, 30 * M)).toEqual([])
    expect(busiestMinute(store, win)).toEqual({ atMs: (Math.floor(T / M) + 4) * M, n: 9 })
    expect(busiestMinute(newLaneStore(), win)).toBeNull()
  })

  it('cells say busy, idle, tool or unobserved', () => {
    const { store, win, lanes } = world()
    const cells = cellsOf(lanes.find(l => l.lane === 'ruflo:a')!, win, 20, store)

    expect(cells[2]).toBe(2)
    expect(cells[15]).toBe(1)
    expect([...cellsOf(lanes.find(l => l.lane === 'claude:main')!, win, 20, store)].filter(n => n === 3)).toHaveLength(2)
  })
})

describe('events on lanes, the axis and the lines', () => {
  const bad = (ref: string, atS: number, text = 'x failed'): ConsoleEvent => ({ kind: 'swarm', text, atMs: T + atS * 1000, ref })

  it('a warn or bad event lands on its lane by ref, else on the top lane, and info is not drawn', () => {
    const { win, lanes } = world()
    const events = [bad('agent:a', 60), bad('run:zzz', 120), { kind: 'swarm' as const, text: 'topology mesh', atMs: T + 90_000, ref: 'agent:a' }]

    expect((markerIndex(events, lanes, win, 20).get('ruflo:a') ?? []).filter(x => x !== null)).toEqual(['bad'])
    expect((markerIndex(events, lanes, win, 20).get('') ?? []).filter(x => x !== null)).toEqual(['bad'])
    expect(lastProblem(events, T + 200_000)?.atMs).toBe(T + 120_000)
    expect(lastProblem(events, T)).toBeNull()
  })

  it('the axis labels fit and the lines carry the legend facts', () => {
    const { store, win, lanes } = world()

    expect(axisLine(win, 60)).toHaveLength(60)
    expect(axisLine(win, 60)).toMatch(/\d\d:\d\d/)
    expect(clockOf(T)).toMatch(/^\d\d:\d\d$/)

    const lines = buildLines([{ type: 'group', group: 'ruflo', count: 2, isOpen: true }, { type: 'lane', lane: lanes[0]! }], store, [bad('agent:a', 60)], lanes, win, concurrency(lanes, win, store, 20), 80, lanes[0]!.lane)
    const text = lines.map(line => line.label + line.cells.map(cell => cell.ch).join('')).join('\n')

    expect(lines.map(line => line.kind)).toEqual(['axis', 'events', 'group', 'lane', 'conc'])
    expect(text).toContain('█')
    expect(text).toContain('▲')
    expect(runsOf(lines[3]!.cells).every((run, i, all) => i === 0 || run.tone !== all[i - 1]!.tone)).toBe(true)
  })
})
