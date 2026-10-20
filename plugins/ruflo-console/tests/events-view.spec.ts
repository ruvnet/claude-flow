/**
 * The Events page drawn (ADR-474): rows, levels, bursts, chips, the detail pane, pins, rules and mutes, every control pressable, no
 * duplicate keys, and every row inside the pane at 56, 60, 72, 80, 100 and 125 columns in both looks (the wf-layout harness).
 */
import { afterEach, describe, expect, it } from 'vitest'

import { eventsModel, eventsUi, openEventsFor } from '../hooks/events-ui'
import { setLook } from '../hooks/views/common'
import { eventsView } from '../hooks/views/events'
import { buttonOf, click, flat, words } from './fixtures/wf-drill-world'
import { measure } from './fixtures/wf-layout-rig'
import { rig, T, WIDTHS } from './fixtures/ev-rig'

afterEach(() => setLook('plain'))

const report = (found: ReturnType<typeof measure>): string => found.map(f => `${f.kind} ${f.width}>${f.avail} ${f.at}`).join('\n')
const keys = (tree: unknown): string[] => flat(tree).filter(el => el.kind === 'Button').map(el => String(el.props.key))

describe('layout', () => {
  for (const look of ['plain', 'bbs'] as const) {
    for (const columns of WIDTHS) {
      it(`every row fits ${columns} columns (${look}): chips, tools, query, rows, detail, pins, pages`, () => {
        setLook(look)

        const w = rig(columns)
        const first = eventsModel(w.state, T).rows[0]!

        expect(report(measure(eventsView(w.ctx), columns))).toBe('')

        eventsUi(w.state).open = first.id
        eventsUi(w.state).parsed = { terms: [], sinceMs: null, errors: ['⚠ a long problem '.repeat(8)], source: '' }
        w.actions.events.muteKind('tools')
        w.actions.events.muteTemplate('ISSUE-1234 progress')
        expect(report(measure(eventsView(w.ctx), columns))).toBe('')
      })
    }
  }

  it('no two buttons share a key, and a very long event cannot widen a row', () => {
    const w = rig(56)

    w.act.log.push({ atMs: T, kind: 'swarm', text: 'W'.repeat(900) })
    w.act.version++

    const tree = eventsView(w.ctx)

    expect(new Set(keys(tree)).size).toBe(keys(tree).length)
    expect(report(measure(tree, 56))).toBe('')
  })
})

describe('hotkeys', () => {
  it('every hotkey is one digit or lowercase letter (the engine skips a page whose hotkey is anything else)', () => {
    const w = rig(100)

    w.actions.events.open(eventsModel(w.state, T).rows[0]!.id)

    for (const el of flat(eventsView(w.ctx)).filter(item => item.kind === 'Button' && item.props.hotkey !== undefined)) expect(String(el.props.hotkey)).toMatch(/^[0-9a-z]$/)
  })
})

describe('behaviour', () => {
  it('shows a level mark, the kind and a burst count, and 12 rows a page with older and newer', () => {
    const w = rig(100, { events: 200 })
    const text = words(eventsView(w.ctx))

    expect(text).toContain('✖')
    expect(text).toContain('older ▸')
    expect(flat(eventsView(w.ctx)).filter(el => el.kind === 'Button' && String(el.props.key).startsWith('ev-open-'))).toHaveLength(12)
    expect(text).toContain('page 1/')
  })

  it('level and kind chips filter and count; a query narrows and shows its error inline; clear puts it all back', () => {
    const w = rig(100)
    const all = eventsModel(w.state, T).shown.length

    click(eventsView(w.ctx), 'ev-level-bad')
    const bad = eventsModel(w.state, T).shown.length

    expect(bad).toBeGreaterThan(0)
    expect(bad).toBeLessThan(all)
    expect(words(eventsView(w.ctx))).toContain('bad')

    w.actions.events.query('kind:swarm since:soon')
    expect(words(eventsView(w.ctx))).toContain('since: wants')
    click(eventsView(w.ctx), 'ev-clear')
    expect(eventsModel(w.state, T).shown).toHaveLength(all)
  })

  it('pause freezes the list and counts what arrived; resume shows it', () => {
    const w = rig(100)

    click(eventsView(w.ctx), 'ev-pause')
    w.act.log.push({ atMs: T, kind: 'swarm', text: 'later one' }, { atMs: T, kind: 'swarm', text: 'later two' })
    w.act.version++
    expect(eventsModel(w.state, T).unread).toBe(2)
    expect(eventsModel(w.state, T).shown.some(e => e.text === 'later one')).toBe(false)
    expect(words(eventsView(w.ctx))).toContain('paused (2 new)')
    click(eventsView(w.ctx), 'ev-pause')
    expect(eventsModel(w.state, T).shown.some(e => e.text === 'later one')).toBe(true)
  })

  it('the opened event shows its words, source, level, and the 5 events either side; follow, mute, pin and copy act', async () => {
    const w = rig(100)
    const row = eventsModel(w.state, T).rows[6]!

    w.actions.events.open(row.id)

    const tree = eventsView(w.ctx)

    expect(words(tree)).toContain('around it (5 before, 5 after)')
    expect(new Set(keys(tree)).size).toBe(keys(tree).length)
    click(tree, 'ev-pin')
    expect(w.act.prefs.pins).toHaveLength(2)
    click(eventsView(w.ctx), 'ev-copy')
    await new Promise(done => setTimeout(done, 0))
    expect(w.said.at(-1)).toContain(row.event.kind)
    click(eventsView(w.ctx), 'ev-mute-kind')
    expect(eventsUi(w.state).mutedKinds.has(row.event.kind)).toBe(true)
    w.actions.events.unmute()
    expect(eventsUi(w.state).mutedKinds.size).toBe(0)
  })

  it('follow keeps one ref and what is near it; the Timeline link sets the same follow and window', () => {
    const w = rig(100)

    openEventsFor(w.state, 'agent:coder-12', { fromMs: T - 600_000, toMs: T })
    expect(eventsUi(w.state).followRef).toBe('agent:coder-12')
    expect(eventsModel(w.state, T).shown.length).toBeGreaterThan(0)
    expect(eventsModel(w.state, T).shown.length).toBeLessThanOrEqual(120)
    expect(words(eventsView(w.ctx))).toContain('following agent:coder-12')
  })

  it('saved searches run, delete and are capped; rules add and remove; limits say so', () => {
    const w = rig(100)

    w.actions.events.query('level:bad')
    w.actions.events.saveSearch()
    expect(w.act.prefs.searches.some(s => s.q === 'level:bad')).toBe(true)
    w.actions.events.clearFilters()
    w.actions.events.runSearch('level:bad')
    expect(eventsUi(w.state).query).toBe('level:bad')
    w.actions.events.addRule()
    expect(w.act.prefs.rules).toHaveLength(2)
    w.actions.events.removeRule('level:bad')
    expect(w.act.prefs.rules).toHaveLength(1)
    w.actions.events.query('')
    w.actions.events.addRule()
    expect(eventsUi(w.state).said).toContain('valid query')
    w.actions.events.query('kind:swarm')

    for (let i = 0; i < 12; i++) {
      w.actions.events.query(`kind:swarm w${i}`)
      w.actions.events.addRule()
    }

    expect(w.act.prefs.rules.length).toBeLessThanOrEqual(10)
  })

  it('an empty log says so honestly, and a filter that matches nothing says that instead', () => {
    const empty = rig(100, { events: 0 })

    expect(words(eventsView(empty.ctx))).toContain('Nothing has changed since the console loaded')

    const w = rig(100)

    w.actions.events.query('zzzznotthere')
    expect(words(eventsView(w.ctx))).toContain('no event matches')
    expect(buttonOf(eventsView(w.ctx), 'ev-forget')).toBeDefined()
  })
})
