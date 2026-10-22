/**
 * The Timeline and Events state under vitest: the kind filter and the search, pausing the tail, counts per kind, events per minute,
 * paging, opening one event, and that asking about an event goes to the right page.
 */
import { describe, expect, it } from 'vitest'

import type { ConsoleEvent } from '../hooks/data/events'
import { newState, type State } from '../hooks/state'
import { eventsShown, idOf, kindCounts, PAGE, perMinute, RANGES, watchActions, watchOf } from '../hooks/watch'

const NOW = Date.UTC(2026, 9, 3, 12)
const ev = (kind: ConsoleEvent['kind'], text: string, agoMs = 0): ConsoleEvent => ({ kind, text, atMs: NOW - agoMs })

function stateWith(events: ConsoleEvent[]): State {
  const state = newState({})

  state.events = events

  return state
}

describe('watch: events and timeline', () => {
  it('the kind filter and the text search narrow the list; a search also matches the kind', () => {
    const state = stateWith([ev('swarm', 'agent coder joined'), ev('claims', 'claim ISSUE-1 taken'), ev('swarm', 'topology mesh')])

    expect(eventsShown(state)).toHaveLength(3)
    state.eventFilter = 'swarm'
    expect(eventsShown(state).map(event => event.text)).toEqual(['agent coder joined', 'topology mesh'])
    watchOf(state).query = 'MESH'
    expect(eventsShown(state).map(event => event.text)).toEqual(['topology mesh'])
    state.eventFilter = 'all'
    watchOf(state).query = 'claims'
    expect(eventsShown(state).map(event => event.text)).toEqual(['claim ISSUE-1 taken'])
  })

  it('pausing keeps the tail where it was: later events are not shown, the counts hold, and resuming shows them', () => {
    const state = stateWith([ev('swarm', 'a'), ev('swarm', 'b')])
    const actions = watchActions(state, () => undefined, () => undefined)

    actions.pause()
    state.events = [...state.events, ev('claims', 'c')]
    expect(eventsShown(state).map(event => event.text)).toEqual(['a', 'b'])
    expect(kindCounts(state).get('claims')).toBeUndefined()
    actions.pause()
    expect(eventsShown(state).map(event => event.text)).toEqual(['a', 'b', 'c'])
  })

  it('counts per kind, and events per minute over the last 15, oldest first', () => {
    const state = stateWith([ev('swarm', 'x'), ev('swarm', 'y'), ev('tools', 'z')])

    expect([...kindCounts(state)]).toEqual([['swarm', 2], ['tools', 1]])
    expect(perMinute([ev('swarm', 'now', 5_000), ev('swarm', 'now2', 10_000), ev('swarm', 'old', 14 * 60_000 + 1_000), ev('swarm', 'gone', 20 * 60_000)], NOW)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2])
  })

  it('paging stays inside the shown events; a new filter or search goes back to the newest page; opening toggles', () => {
    const state = stateWith(Array.from({ length: PAGE * 2 + 3 }, (_, i) => ev('swarm', `event ${i}`, i * 1000)))
    const actions = watchActions(state, () => undefined, () => undefined)

    actions.page(1)
    actions.page(1)
    actions.page(1)
    expect(watchOf(state).page).toBe(2)
    actions.page(-5)
    expect(watchOf(state).page).toBe(0)
    actions.page(1)
    actions.kind('swarm')
    expect(watchOf(state).page).toBe(0)

    const id = idOf(state.events[0] as ConsoleEvent)

    actions.open(id)
    expect(watchOf(state).open).toBe(id)
    actions.open(id)
    expect(watchOf(state).open).toBeNull()
  })

  it('the look-back range takes only the three offered values; asking goes to the page it was asked on', () => {
    const state = stateWith([])
    const asked: { question: string; view: string }[] = []
    const actions = watchActions(state, () => undefined, (question, view) => void asked.push({ question, view }))

    actions.range(7 * 60_000)
    expect(watchOf(state).rangeMs).toBe(15 * 60_000)
    actions.range(RANGES[0]?.ms ?? 0)
    expect(watchOf(state).rangeMs).toBe(5 * 60_000)
    state.view = 'timeline'
    actions.ask('is this healthy?')
    state.view = 'events'
    actions.ask('what is this event?')
    expect(asked.map(entry => entry.view)).toEqual(['timeline', 'events'])
  })
})
