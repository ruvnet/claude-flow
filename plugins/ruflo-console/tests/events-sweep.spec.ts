/**
 * The sweep (ADR-474 review): every button on the Events and the Timeline page, in a state that shows all of them, is pressed once on
 * a fresh page, and each must change something (a filter, a cursor, a flag, a saved list) or say something (a line, a card, a view).
 * A chip that is already on is exempt. Also: no two buttons share a key, and no two buttons on a page share a hotkey.
 */
import { describe, expect, it } from 'vitest'

import { activityOf } from '../hooks/activity-live'
import { eventsModel, eventsUi } from '../hooks/events-ui'
import { timelineModel, timelineUi } from '../hooks/timeline-ui'
import { eventsView } from '../hooks/views/events'
import { timelineView } from '../hooks/views/timeline'
import { buttonOf, flat } from './fixtures/wf-drill-world'
import { rig, T } from './fixtures/ev-rig'

type Rig = ReturnType<typeof rig>

const snap = (w: Rig): string => {
  const e = eventsUi(w.state)
  const t = timelineUi(w.state)
  const a = activityOf(w.state)

  return JSON.stringify([{ ...e, parsed: e.parsed.source, memo: null, memoKey: '', mutedKinds: [...e.mutedKinds], mutedTemplates: [...e.mutedTemplates], expanded: [...e.expanded] }, { ...t, collapsed: [...t.collapsed], memo: null, memoKey: '' }, a.prefs, w.state.eventFilter, w.asked.length, w.said.length, w.views.length])
}

const richEvents = (w: Rig): void => {
  const first = eventsModel(w.state, T).rows.find(row => row.members.length > 1) ?? eventsModel(w.state, T).rows[3]!

  eventsUi(w.state).open = first.id
  eventsUi(w.state).narrowed = null
  eventsUi(w.state).mutedKinds.add('tools')
  eventsUi(w.state).query = 'kind:swarm'
}

const richTimeline = (w: Rig): void => {
  const m = timelineModel(w.state, T)

  timelineUi(w.state).open = m.lanes.find(lane => lane.group === 'ruflo')!.lane
  timelineUi(w.state).offsetMs = 120_000
}

const pages = [
  { name: 'events', make: (w: Rig) => eventsView(w.ctx), prep: richEvents },
  { name: 'timeline', make: (w: Rig) => timelineView(w.ctx), prep: richTimeline },
] as const

describe('every button does something', () => {
  for (const page of pages) {
    const probe = rig(100, { events: 200 })

    page.prep(probe)

    const buttons = flat(page.make(probe)).filter(node => node.kind === 'Button')
    const keys = buttons.map(node => String(node.props.key))

    it(`${page.name}: keys and hotkeys are unique, and ${keys.length} buttons are found`, () => {
      expect(new Set(keys).size).toBe(keys.length)

      const hot = buttons.filter(node => node.props.hotkey !== undefined).map(node => String(node.props.hotkey))

      expect(new Set(hot).size).toBe(hot.length)
      expect(keys.length).toBeGreaterThan(20)
    })

    for (const key of keys) {
      it(`${page.name}: ${key}`, async () => {
        const w = rig(100, { events: 200 })

        page.prep(w)

        const target = buttonOf(page.make(w), key)

        if (target === undefined) throw new Error(`no button ${key}`)
        if (/^ ?●/.test(String(target.props.label))) return

        const before = snap(w)

        ;(target.props.onPress as () => void)()
        await new Promise(done => setTimeout(done, 0))
        expect(snap(w), `${key} (${String(target.props.label).trim()}) did nothing`).not.toBe(before)
      })
    }
  }
})

describe('layout in the busiest state, at every width and both looks', () => {
  for (const look of ['plain', 'bbs'] as const) {
    for (const columns of [56, 60, 72, 80, 100, 125]) {
      it(`${look} ${columns}: detail open with a burst unfolded, 50 pins, long names, a long error; a lane open on a panned window`, async () => {
        const { setLook } = await import('../hooks/views/common')
        const { measure } = await import('./fixtures/wf-layout-rig')

        setLook(look)

        try {
          const w = rig(columns, { events: 200 })
          const act = activityOf(w.state)

          act.prefs.pins = Array.from({ length: 50 }, (_, i) => ({ atMs: T - i, kind: 'swarm' as const, text: `pinned ${'wide '.repeat(30)} ${i}`, level: 'bad' as const }))
          act.prefs.searches = Array.from({ length: 20 }, (_, i) => ({ name: `a very long saved search name ${i}`, q: 'level:bad' }))
          act.prefs.rules = Array.from({ length: 10 }, (_, i) => ({ name: `a very long alert rule name ${i}`, q: 'level:bad' }))
          richEvents(w)
          eventsUi(w.state).expanded.add(eventsUi(w.state).open as string)
          eventsUi(w.state).parsed = { terms: [], sinceMs: null, errors: ['x'.repeat(300)], source: '' }
          w.actions.events.muteTemplate('agent coder-12 spawned')

          const fail = (tree: unknown): string => measure(tree as never, columns).map(f => `${f.kind} ${f.width}>${f.avail} ${f.at}`).join('\n')

          expect(fail(eventsView(w.ctx))).toBe('')
          richTimeline(w)
          expect(fail(timelineView(w.ctx))).toBe('')
        } finally {
          setLook('plain')
        }
      })
    }
  }
})

describe('page hotkeys against the pane (the engine: "two on one hotkey: the later wins")', () => {
  for (const [view, own] of [['events', ['ev-', 'filter']], ['timeline', ['tl-']]] as const) {
    it(`${view}: in the whole pane, every hotkey the page uses is won by the page's own button, not a tab`, async () => {
      const { paneView } = await import('../hooks/views/pane')
      const { VIEWS } = await import('../hooks/state')
      const w = rig(125, { events: 200 })

      w.state.view = view
      richEvents(w)
      richTimeline(w)

      const buttons = flat(paneView(w.ctx)).filter(node => node.kind === 'Button' && node.props.hotkey !== undefined)
      const winner = new Map<string, string>()

      for (const node of buttons) winner.set(String(node.props.hotkey), String(node.props.key))

      const pageKeys = new Set(buttons.filter(node => own.some(prefix => String(node.props.key).startsWith(prefix))).map(node => String(node.props.hotkey)))

      expect(pageKeys.size).toBeGreaterThan(3)

      for (const hotkey of pageKeys) expect(own.some(prefix => (winner.get(hotkey) as string).startsWith(prefix)), `${hotkey} is won by ${winner.get(hotkey)}`).toBe(true)

      // The collisions with the tab keys are real, and by design: list them so a new one is a decision.
      const tabKeys = new Set(VIEWS.map(item => item.key).filter(key => key !== ''))
      const shadowed = [...pageKeys].filter(key => tabKeys.has(key)).sort()

      expect(shadowed).toEqual(view === 'events' ? ['c', 'f', 'l', 't', 'v'] : ['b', 's'])
    })
  }
})
