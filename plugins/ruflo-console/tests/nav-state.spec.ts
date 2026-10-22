/**
 * The nav's grouping and search, pure: which group is showing its pages, which pages a few words find (every word must match, names
 * rank before descriptions), and what the nav actions do to the state. Run with
 *   npx vitest run plugins/ruflo-console/tests/nav-state.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { findPages, groupOf, NAV_GROUPS, navActions, shownGroup } from '../hooks/nav-state'
import { newState, VIEWS, type ViewId } from '../hooks/state'

describe('nav groups', () => {
  it('names the group of a page, and shows the open page group unless another was picked on this page', () => {
    expect(groupOf('learning')).toBe('MIND')
    expect(groupOf('swarm')).toBe('SWARM')
    expect(groupOf('menu')).toBeNull()

    const state = newState({})

    state.view = 'learning'
    expect(shownGroup(state)).toBe('MIND')
    state.navPick = { group: 'NETWORK', view: 'learning' }
    expect(shownGroup(state)).toBe('NETWORK')
    // A pick belongs to the page it was made on: once the page changes, the nav follows the page again.
    state.view = 'swarm'
    expect(shownGroup(state)).toBe('SWARM')
    // A drill-down into an agent keeps the group of the page it came from.
    state.view = 'agent'
    state.back = 'learning'
    expect(shownGroup(state)).toBe('MIND')
  })

  it('has at most six pages a row, so a row can spell their names', () => {
    for (const group of NAV_GROUPS) for (const row of group.rows) expect(row.length).toBeLessThanOrEqual(6)
  })
})

describe('finding a page', () => {
  it('finds by name, group or what the page does; every word must match', () => {
    expect(findPages('memory')[0]).toBe('memory')
    expect(findPages('hive')).toContain('hive')
    expect(findPages('MIND')).toEqual(expect.arrayContaining(['learning', 'metaharness']))
    expect(findPages('cost budget')).toContain('cost')
    expect(findPages('zzzz-no-such-page')).toEqual([])
    expect(findPages('   ')).toEqual([])
    expect(findPages('memory zzzz-no-such-word')).toEqual([])
  })

  it('ranks a page whose name holds the words before one whose description does, and never lists the menu', () => {
    const found = findPages('lab')
    const names = found.map(id => VIEWS.find(view => view.id === id)?.label ?? '')

    expect(found).not.toContain('menu' as ViewId)
    expect(found.length).toBeLessThanOrEqual(12)
    expect(names.findIndex(name => /lab/i.test(name))).toBe(0)
  })
})

describe('the nav actions', () => {
  const setup = () => {
    const state = newState({})
    const calls = { invalidated: 0, opened: [] as ViewId[] }
    const act = navActions(state, () => void calls.invalidated++, view => void calls.opened.push(view))

    return { state, calls, act }
  }

  it('picking a group shows its pages on this page and clears a search', () => {
    const { state, act, calls } = setup()

    state.view = 'swarm'
    state.navQuery = 'old'
    act.group('MIND')
    expect(state.navPick).toEqual({ group: 'MIND', view: 'swarm' })
    expect(state.navQuery).toBe('')
    expect(calls.invalidated).toBe(1)
  })

  it('a search with one match opens it, with several lists them, and clear drops it', () => {
    const { state, act, calls } = setup()
    const unique = VIEWS.filter(view => view.id !== 'menu').map(view => view.label).find(label => findPages(label).length === 1)

    expect(unique, 'some page name finds exactly one page').toBeDefined()
    act.find(unique as string)
    expect(calls.opened).toHaveLength(1)
    expect(state.navQuery).toBe('')

    act.find('lab')
    expect(calls.opened).toHaveLength(1)
    expect(state.navQuery).toBe('lab')
    act.clear()
    expect(state.navQuery).toBe('')
  })
})

describe('finding what is on a page, not only the page', () => {
  it('searching for a capability by its own name finds the page it is on', () => {
    // Each of these is a section or a feature, not a page: the page's description has to name it for the search to find it.
    const where: Record<string, ViewId> = {
      sentries: 'secure',
      doctor: 'secure',
      aidefence: 'secure',
      updates: 'settings',
      loops: 'automate',
      autopilot: 'automate',
      kanban: 'automate',
    }

    for (const [word, view] of Object.entries(where)) expect(findPages(word), word).toContain(view)
  })
})
