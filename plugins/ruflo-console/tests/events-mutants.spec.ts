/**
 * Boundaries the first mutation pass of the ADR-474 review found unguarded: each test below fails when the number or comparison it
 * names is changed. (`secret` in the KEYED mask is covered twice, by maskSecrets as well, so that one mutation is equivalent.)
 */
import { describe, expect, it } from 'vitest'

import { activityOf, tick } from '../hooks/activity-live'
import { resetIo } from '../hooks/activity-io'
import { keepNewestHalf } from '../hooks/data/activity-store'
import { lanesText } from '../hooks/data/event-export'
import { maskLine } from '../hooks/data/event-mask'
import { durationOf, matches, parseQuery } from '../hooks/data/event-query'
import { evaluateRules } from '../hooks/data/event-rules'
import { bars } from '../hooks/data/event-stats'
import type { ConsoleEvent } from '../hooks/data/events'
import { cellsOf, idleGaps, newLaneStore, zoomed, type LaneView } from '../hooks/data/timeline-model'
import { eventsModel, eventsUi } from '../hooks/events-ui'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'
import { hostOn, newDisk } from './fixtures/activity-fs'
import { rig } from './fixtures/ev-rig'

const T = Date.UTC(2026, 9, 7, 12)
const ev = (text: string, atS = 0): ConsoleEvent => ({ kind: 'swarm', text, atMs: T + atS * 1000 })
const lane = (id: string, spans: { fromMs: number; toMs: number; busy: boolean }[], tickMins: number[] = []): LaneView => ({ lane: id, group: 'ruflo', label: id, calls: 0, byTool: [], busyMs: 0, observedMs: 0, busyPct: null, longestMs: 0, lastAtMs: 0, tickMins, spans: spans.map(span => ({ lane: id, group: 'ruflo' as const, label: id, ...span })) })

describe('query', () => {
  it('a regex sees only the first 200 characters of a line; since: reaches 30 days and no further', () => {
    expect(matches(ev(`${'a'.repeat(150)}x`), parseQuery('/x/'), T)).toBe(true)
    expect(matches(ev(`${'a'.repeat(300)}x`), parseQuery('/x/'), T)).toBe(false)
    expect(durationOf('30d')).toBe(30 * 86_400_000)
    expect(durationOf('31d')).toBeNull()
  })

  it('a rule whose query has a problem never fires, even when it also has a term', () => {
    expect(evaluateRules([{ name: 'r', q: 'failed since:soon' }], [ev('step failed')], T)).toEqual([])
    expect(evaluateRules([{ name: 'r', q: 'failed' }], [ev('step failed')], T)).toHaveLength(1)
  })
})

describe('timeline arithmetic', () => {
  it('an idle stretch of 5 minutes next to a busy lane is a gap, 4 minutes is not', () => {
    const win = { fromMs: 0, toMs: 20 * 60_000 }
    const busy = lane('busy', [{ fromMs: 0, toMs: 20 * 60_000, busy: true }])
    const idle = lane('idle', [{ fromMs: 0, toMs: 4 * 60_000, busy: false }, { fromMs: 4 * 60_000, toMs: 6 * 60_000, busy: true }, { fromMs: 6 * 60_000, toMs: 11 * 60_000, busy: false }, { fromMs: 11 * 60_000, toMs: 20 * 60_000, busy: true }])
    const gaps = idleGaps([busy, idle], win, newLaneStore())

    expect(gaps).toHaveLength(1)
    expect(gaps[0]).toMatchObject({ lane: 'idle', fromMs: 6 * 60_000, toMs: 11 * 60_000 })
  })

  it('a minute of tool calls marks the bar that holds the middle of the minute', () => {
    const win = { fromMs: 0, toMs: 400_000 }
    const cells = cellsOf(lane('c', [], [1]), win, 10)

    expect(cells[2]).toBe(3)
    expect(cells[1]).toBe(0)
  })

  it('zoom steps one window out or in, from a session too', () => {
    expect(zoomed('15m', 1)).toBe('1h')
    expect(zoomed('15m', -1)).toBe('5m')
    expect(zoomed('session', 1)).toBe('1h')
    expect(zoomed('session', -1)).toBe('5m')
    expect(zoomed('24h', 1)).toBe('24h')
    expect(zoomed('5m', -1)).toBe('5m')
  })

  it('chart bars are a minute wide up to an hour', () => {
    expect(bars([], ['k'], () => 'k', 3_300_000, T, 100).stepMs).toBe(60_000)
    expect(bars([], ['k'], () => 'k', 3_700_000, T, 100).stepMs).toBe(600_000)
  })
})

describe('events window', () => {
  it('a narrowed span is half open: its start is in, its end is out', () => {
    const w = rig(100, { events: 0 })

    w.act.log.length = 0
    activityOf(w.state).log.push({ atMs: T, kind: 'swarm', text: 'at start' }, { atMs: T + 60_000, kind: 'swarm', text: 'at end' })
    activityOf(w.state).version++
    eventsUi(w.state).narrowed = { fromMs: T, toMs: T + 60_000 }
    expect(eventsModel(w.state, T + 120_000).shown.map(item => item.text)).toEqual(['at start'])
  })
})

describe('writing', () => {
  it('two changes of the saved searches less than 2 s apart are one write; the third waits its turn', async () => {
    resetIo()

    const disk = newDisk()
    const state = newState({})

    state.cwd = '/work/proj'

    const host = { ...hostOn(disk), every: () => ({ cancel: () => undefined }), invalidate: () => undefined } as unknown as Host
    const file = '/work/proj/.claude-flow/console/events-prefs.json'
    const act = activityOf(state)
    const change = (name: string): void => {
      act.prefs.searches.push({ name, q: 'failed' })
      act.isPrefsDirty = true
    }

    await tick(state, host, T)
    change('one')
    await tick(state, host, T + 5000)
    expect(disk.files.get(file)).toContain('one')
    change('two')
    await tick(state, host, T + 6000)
    expect(disk.files.get(file)).not.toContain('two')
    await tick(state, host, T + 7100)
    expect(disk.files.get(file)).toContain('two')
  })

  it('past its cap a log keeps its newest half, from a line start', () => {
    const text = Array.from({ length: 30 }, () => `${'x'.repeat(9)}\n`).join('')

    expect(keepNewestHalf(text, 100).split('\n').filter(Boolean)).toHaveLength(4)
    expect(keepNewestHalf('short\n', 100)).toBe('short\n')
  })
})

describe('washing and export', () => {
  it('a /Users path loses its user name like /home does', () => {
    expect(maskLine('/Users/bob/projects/x')).toBe('~/projects/x')
    expect(maskLine('/home/bob/projects/x')).toBe('~/projects/x')
  })

  it('a lane name that starts with = + - or @ is defused in the CSV', () => {
    const base = { lanes: ['=SUM(A1)', '+1', '-2', '@x'].map(label => ({ ...lane(label, []), label })), concurrency: { counts: [], stepMs: 0, peak: 0, mean: 0, peakAtMs: null }, fromMs: 0, toMs: 1, busiest: null }
    const csv = lanesText(base, 'csv', T)

    for (const bad of ["'=SUM", "'+1", "'-2", "'@x"]) expect(csv).toContain(bad)
  })
})

describe('found by the review of what the pages promise', () => {
  it('permission denies keep arriving after the console has dropped its oldest (it keeps only 20): 25 denies in a row are 25 events', async () => {
    const { denyEvents, newMemo } = await import('../hooks/data/event-sources')
    const memo = newMemo()
    const kept: { tool: string; reason: string; atMs: number }[] = []
    let seen = 0

    denyEvents(memo, kept)

    for (let i = 0; i < 25; i++) {
      kept.push({ tool: `Tool${i}`, reason: 'policy', atMs: T + i * 1000 })
      if (kept.length > 20) kept.shift()
      seen += denyEvents(memo, kept).length
    }

    expect(seen).toBe(25)
  })

  it('at either end of the lanes the j and k buttons say so', async () => {
    const { timelineUi } = await import('../hooks/timeline-ui')
    const w = rig(100)

    w.actions.timeline.move(-1)
    expect(timelineUi(w.state).said).toBe('already on the first lane')
    for (let i = 0; i < 40; i++) w.actions.timeline.move(1)
    w.actions.timeline.move(1)
    expect(timelineUi(w.state).said).toBe('already on the last lane')
  })

  it('a slow regex says how many events were not searched, on the page', async () => {
    const { vi } = await import('vitest')
    const { eventsView } = await import('../hooks/views/events')
    const { words } = await import('./fixtures/wf-drill-world')
    const w = rig(100, { events: 400 })
    let clock = 0
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => (clock += 1000))

    try {
      eventsUi(w.state).parsed = parseQuery('/agent.*run/')
      expect(eventsModel(w.state, T).skipped).toBeGreaterThan(300)
      expect(words(eventsView(w.ctx))).toContain('is slow')
    } finally {
      spy.mockRestore()
    }
  })
})
