/**
 * Grouping and correlation (ADR-474): bursts collapse by kind and template inside a gap, follow keeps a ref and what happened within
 * 30 s of it, neighbours are five either side, and the chart numbers (windows, bars, heat strip) are exact.
 */
import { describe, expect, it } from 'vitest'

import { collapse, follow, neighbours, templateOf } from '../hooks/data/event-group'
import { bars, barsLine, bucketMs, dayHour, heatLine, levelKey, narrow, windowStart } from '../hooks/data/event-stats'
import { refOf, type ConsoleEvent } from '../hooks/data/events'

const T = Date.UTC(2026, 9, 7, 12)
const ev = (text: string, atS: number, extra: Partial<ConsoleEvent> = {}): ConsoleEvent => ({ kind: 'swarm', text, atMs: T + atS * 1000, ...extra })

describe('collapse', () => {
  it('folds a burst of one template into one row with every member, newest shown', () => {
    const rows = collapse([ev('agent a1 progress 10%', 0), ev('agent a1 progress 20%', 5), ev('agent a1 progress 30%', 9), ev('swarm paused', 10)])

    expect(rows).toHaveLength(2)
    expect(rows[0]?.members).toHaveLength(3)
    expect(rows[0]?.event.text).toBe('agent a1 progress 30%')
  })

  it('does not fold across a gap longer than the burst gap, across kinds, or across agents', () => {
    expect(collapse([ev('x 1', 0), ev('x 2', 31)])).toHaveLength(2)
    expect(collapse([ev('x 1', 0), { ...ev('x 2', 1), kind: 'claims' }])).toHaveLength(2)
    expect(collapse([ev('x 1', 0, { agentId: 'a' }), ev('x 2', 1, { agentId: 'b' })])).toHaveLength(2)
    expect(collapse([ev('x 1', 0), ev('x 2', 30)])).toHaveLength(1)
  })

  it('templates drop numbers, hex ids and quoted names', () => {
    expect(templateOf('run "alpha" 3 of 10 abcdef12')).toBe(templateOf('run "beta" 4 of 99 12345678'))
  })
})

describe('follow and neighbours', () => {
  const events = [ev('a', 0, { agentId: 't1' }), ev('b', 10), ev('c', 100), ev('d', 125, { agentId: 't1' }), ev('e', 140), ev('f', 400)]

  it('keeps the ref events and everything within 30 s of them, nothing else', () => {
    const out = follow(events, 'agent:t1')

    expect(out.own).toBe(2)
    expect(out.events.map(e => e.text)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(follow(events, 'agent:nobody')).toEqual({ own: 0, events: [] })
  })

  it('derives a ref from the agent, or from the first id of a claims or missions line', () => {
    expect(refOf(ev('x', 0, { agentId: 'z' }))).toBe('agent:z')
    expect(refOf({ ...ev('ISSUE-7 claimed by coder', 0), kind: 'claims' })).toBe('claim:ISSUE-7')
    expect(refOf({ ...ev('task t-9 created: x', 0), kind: 'claims' })).toBe('task:t-9')
    expect(refOf({ ...ev('mission m-3 (active): go', 0), kind: 'missions' })).toBe('mission:m-3')
    expect(refOf(ev('plain', 0))).toBeUndefined()
  })

  it('five before and five after, clipped at the ends', () => {
    const many = Array.from({ length: 20 }, (_, i) => ev(`e${i}`, i))

    expect(neighbours(many, 10).before.map(e => e.text)).toEqual(['e5', 'e6', 'e7', 'e8', 'e9'])
    expect(neighbours(many, 10).after.map(e => e.text)).toEqual(['e11', 'e12', 'e13', 'e14', 'e15'])
    expect(neighbours(many, 0).before).toEqual([])
    expect(neighbours(many, 99)).toEqual({ before: [], after: [] })
  })
})

describe('chart numbers', () => {
  it('picks a bar size by span, and a window start by id', () => {
    expect(bucketMs(15 * 60_000)).toBe(60_000)
    expect(bucketMs(3 * 3_600_000)).toBe(600_000)
    expect(bucketMs(3 * 86_400_000)).toBe(3_600_000)
    expect(windowStart('1h', T, T - 5)).toBe(T - 3_600_000)
    expect(windowStart('session', T, T - 5)).toBe(T - 5)
    expect(windowStart('all', T, T - 5)).toBeNull()
  })

  it('stacks by kind and by level, and counts only what is inside the span', () => {
    const list = [ev('x failed', -30), { ...ev('ok done', -30), kind: 'claims' as const }, ev('old', -3000)]
    const byKind = bars(list, ['swarm', 'claims'], e => e.kind, 15 * 60_000, T + 1000)
    const byLevel = bars(list, ['bad', 'ok'], levelKey, 15 * 60_000, T + 1000)

    expect(byKind.stacks.reduce((n, s) => n + s.reduce((a, b) => a + b, 0), 0)).toBe(2)
    expect(byLevel.stacks.flat().reduce((a, b) => a + b, 0)).toBe(2)
    expect(barsLine(byKind)).toHaveLength(byKind.stacks.length)
    expect(narrow(100, 10, 3)).toEqual({ fromMs: 130, toMs: 140 })
  })

  it('a day by hour strip puts an event in its local day and hour', () => {
    const at = new Date(T)

    at.setHours(9, 30, 0, 0)

    const grid = dayHour([{ kind: 'swarm', text: 'x', atMs: at.getTime() }], T)

    expect(grid).toHaveLength(7)
    expect(grid[6]?.[9]).toBe(1)
    expect(heatLine([0, 1, 4])).toHaveLength(3)
  })
})
