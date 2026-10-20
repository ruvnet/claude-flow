/**
 * `/ruflo events` and `/ruflo timeline` (ADR-474): the parse, the help text, and that the verbs set the filters and do not collide
 * with the older commands.
 */
import { describe, expect, it } from 'vitest'

import { HELP, parseRuflo } from '../hooks/commands'
import { applyEventsArgs } from '../hooks/events-args'
import { eventsUi } from '../hooks/events-ui'
import { applyTimelineArgs, timelineUi } from '../hooks/timeline-ui'
import { newState } from '../hooks/state'

describe('parse', () => {
  it('bare events and timeline open their page; with words they carry them', () => {
    expect(parseRuflo('events')).toEqual({ kind: 'open', view: 'events' })
    expect(parseRuflo('timeline')).toEqual({ kind: 'open', view: 'timeline' })
    expect(parseRuflo('events level bad')).toEqual({ kind: 'events', args: ['level', 'bad'] })
    expect(parseRuflo('timeline zoom in')).toEqual({ kind: 'timeline', args: ['zoom', 'in'] })
    expect(parseRuflo('filter swarm')).toEqual({ kind: 'filter', filter: 'swarm' })
    expect(parseRuflo('filter workflows')).toEqual({ kind: 'filter', filter: 'workflows' })
  })

  it('every verb is in the help, and none of them is an older command word', () => {
    for (const verb of ['events [kind|level|since:15m|', 'timeline [5m|15m|1h|6h|24h|session|zoom', 'forget', 'export <path>', 'follow <ref>']) expect(HELP).toContain(verb)
    for (const old of ['filter', 'notices', 'quiet', 'band', 'autopilot', 'mission', 'palette']) expect(parseRuflo(old).kind).not.toBe('events')
  })
})

describe('events args', () => {
  it('kind, level, a query, a window, follow, clear', () => {
    const state = newState({})
    const ui = eventsUi(state)

    expect(applyEventsArgs(state, ['swarm']).text).toBe('events: swarm')
    expect(state.eventFilter).toBe('swarm')
    expect(applyEventsArgs(state, ['bad']).text).toBe('events: level bad')
    expect(ui.level).toBe('bad')
    expect(applyEventsArgs(state, ['since:15m', 'kind:claims']).text).toContain('query since:15m kind:claims')
    expect(ui.parsed.sinceMs).toBe(15 * 60_000)
    expect(applyEventsArgs(state, ['since:soon']).text).toContain('but since:')
    expect(applyEventsArgs(state, ['window', '1h']).text).toBe('events: window 1h')
    expect(applyEventsArgs(state, ['window', 'never']).text).toContain('window takes')
    expect(applyEventsArgs(state, ['follow', 'agent:x']).text).toContain('following agent:x')
    expect(ui.followRef).toBe('agent:x')
    expect(applyEventsArgs(state, ['clear']).text).toBe('events: filters cleared')
    expect([state.eventFilter, ui.level, ui.followRef, ui.query]).toEqual(['all', 'all', null, ''])
  })

  it('export and forget are handed to the caller; a quoted query is one query', () => {
    const state = newState({})

    expect(applyEventsArgs(state, ['export', 'run.jsonl']).export).toEqual({ format: 'jsonl', path: 'run.jsonl' })
    expect(applyEventsArgs(state, ['export', 'run.md']).export).toEqual({ format: 'md', path: 'run.md' })
    expect(applyEventsArgs(state, ['forget']).forget).toBe(true)
    expect(applyEventsArgs(state, ['"agent', 'coder"']).text).toContain('"agent coder"')
    expect(eventsUi(state).parsed.terms).toHaveLength(1)
  })
})

describe('timeline args', () => {
  it('windows, zoom, follow, export, and a hint for anything else', () => {
    const state = newState({})
    const ui = timelineUi(state)

    expect(applyTimelineArgs(state, ['6h']).text).toBe('timeline: 6h')
    expect(ui.window).toBe('6h')
    expect(applyTimelineArgs(state, ['zoom', 'in']).text).toBe('timeline: 1h')
    expect(applyTimelineArgs(state, ['zoom', 'out']).text).toBe('timeline: 6h')
    expect(applyTimelineArgs(state, ['zoom']).text).toContain('in or out')
    expect(applyTimelineArgs(state, ['follow']).text).toContain('takes a ref')
    expect(applyTimelineArgs(state, ['follow', 'run:wf_1']).follow).toBe('run:wf_1')
    expect(eventsUi(state).followRef).toBe('run:wf_1')
    expect(applyTimelineArgs(state, ['export', 'x.csv']).export).toEqual({ format: 'csv', path: 'x.csv' })
    expect(applyTimelineArgs(state, ['nonsense']).text).toContain('timeline [5m')
  })
})
