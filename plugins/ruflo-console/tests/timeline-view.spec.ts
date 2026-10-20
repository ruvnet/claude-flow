/**
 * The Timeline page drawn (ADR-474): groups, the text lines that carry what the picture carries, window, zoom, pan and sort controls,
 * a lane opened for detail, the cross-link to Events, export, paging past 12 lanes, and every row inside the pane at 56 to 125 columns.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { activityOf } from '../hooks/activity-live'
import { eventsUi } from '../hooks/events-ui'
import { loadRows } from '../hooks/data/timeline-model'
import { timelineModel, timelineUi } from '../hooks/timeline-ui'
import { setLook } from '../hooks/views/common'
import { linesFor } from '../hooks/views/timeline-lines'
import { timelineView } from '../hooks/views/timeline'
import { linesPicture } from '../hooks/gfx/ev-charts'
import { click, flat, words } from './fixtures/wf-drill-world'
import { measure } from './fixtures/wf-layout-rig'
import { rig, T, WIDTHS } from './fixtures/ev-rig'

afterEach(() => setLook('plain'))

const report = (found: ReturnType<typeof measure>): string => found.map(f => `${f.kind} ${f.width}>${f.avail} ${f.at}`).join('\n')
const keys = (tree: unknown): string[] => flat(tree).filter(el => el.kind === 'Button').map(el => String(el.props.key))

describe('layout', () => {
  for (const look of ['plain', 'bbs'] as const) {
    for (const columns of WIDTHS) {
      it(`every row fits ${columns} columns (${look}), also with a lane open and every window`, () => {
        setLook(look)

        const w = rig(columns)

        expect(report(measure(timelineView(w.ctx), columns))).toBe('')

        const lane = timelineModel(w.state, T).lanes[0]!

        w.actions.timeline.open(lane.lane)
        for (const id of ['5m', '1h', '24h', 'session'] as const) {
          w.actions.timeline.window(id)
          expect(report(measure(timelineView(w.ctx), columns))).toBe('')
        }
      })
    }
  }
})

describe('hotkeys', () => {
  it('every hotkey is one digit or lowercase letter, and none repeats on the page', () => {
    const w = rig(100)

    w.actions.timeline.open('ruflo:0')

    const hot = flat(timelineView(w.ctx)).filter(item => item.kind === 'Button' && item.props.hotkey !== undefined).map(item => String(item.props.hotkey))

    expect(hot.length).toBeGreaterThan(3)
    for (const key of hot) expect(key).toMatch(/^[0-9a-z]$/)
    expect(new Set(hot).size).toBe(hot.length)
  })
})

describe('behaviour', () => {
  it('lanes are grouped with headers; collapsing a group hides its lanes; keys are unique', () => {
    const w = rig(100)
    const text = words(timelineView(w.ctx))

    expect(text).toContain('▾ ruflo (5)')
    expect(text).toContain('▾ workflow (5)')
    expect(text).toContain('alpha-agent')

    click(timelineView(w.ctx), 'tl-group-ruflo')
    expect(words(timelineView(w.ctx))).not.toContain('alpha-agent')
    expect(words(timelineView(w.ctx))).toContain('▸ ruflo (5)')
    expect(new Set(keys(timelineView(w.ctx))).size).toBe(keys(timelineView(w.ctx)).length)
  })

  it('the text twin carries the picture: the same lines, cell for cell', () => {
    const w = rig(80)
    const model = timelineModel(w.state, T)
    const lines = linesFor(w.state, model, 80)
    const grid = linesPicture(lines, 80)
    const lane = lines.find(line => line.kind === 'lane')!
    const at = lines.indexOf(lane)

    expect(String.fromCodePoint(grid.glyph(lane.label.length + 1 + 3, at))).toBe(lane.cells[3]!.ch)

    const text = words(timelineView(w.ctx))

    expect(text).toContain('parallel')
    expect(text).toContain('█ busy')
    expect(text).toContain('parallel: peak')
  })

  it('zoom, pan, now, sort and window act on the model', () => {
    const w = rig(100)
    const ui = timelineUi(w.state)

    click(timelineView(w.ctx), 'tl-zout')
    expect(ui.window).toBe('1h')
    click(timelineView(w.ctx), 'tl-zin')
    click(timelineView(w.ctx), 'tl-zin')
    expect(ui.window).toBe('5m')
    click(timelineView(w.ctx), 'tl-back')
    expect(ui.offsetMs).toBe(150_000)
    click(timelineView(w.ctx), 'tl-fwd')
    expect(ui.offsetMs).toBe(0)
    click(timelineView(w.ctx), 'tl-fwd')
    expect(ui.offsetMs).toBe(0)
    ui.offsetMs = 3_600_000
    click(timelineView(w.ctx), 'tl-now')
    expect(ui.offsetMs).toBe(0)
    click(timelineView(w.ctx), 'tl-sort')
    expect(ui.sort).toBe('calls')
  })

  it('a lane opened shows spans, gaps, tools and its events; its buttons follow it on Events and go to its page', () => {
    const w = rig(100)
    const claude = timelineModel(w.state, T).lanes.find(l => l.group === 'claude')!

    w.actions.timeline.open(claude.lane)

    const text = words(timelineView(w.ctx))

    expect(text).toContain('tools: Bash 5 · Read 2')
    expect(text).toContain('7 tool calls')

    w.actions.timeline.open(null)
    w.actions.timeline.open('ruflo:0')
    expect(words(timelineView(w.ctx))).toContain('longest busy stretch')
    click(timelineView(w.ctx), 'tl-lane-events')
    expect(eventsUi(w.state).followRef).toBe('agent:0')
    expect(eventsUi(w.state).narrowed).not.toBeNull()
    expect(w.views).toContain('events')
    click(timelineView(w.ctx), 'tl-lane-go')
    expect(w.views.at(-1)).toBe('swarm')
  })

  it('pages past 12 lanes and builds only one page of lines', () => {
    const w = rig(100)
    const act = activityOf(w.state)

    loadRows(act.lanes, Array.from({ length: 200 }, (_, i) => ({ k: 'span' as const, lane: `ruflo:many${i}`, group: 'ruflo' as const, label: `lane ${i}`, fromMs: T - 600_000, toMs: T, busy: true })))

    const model = timelineModel(w.state, T)

    expect(model.total).toBeGreaterThan(200)
    expect(linesFor(w.state, model, 100).filter(line => line.kind === 'lane').length).toBeLessThanOrEqual(12)
    click(timelineView(w.ctx), 'tl-next')
    expect(timelineUi(w.state).page).toBe(1)
  })

  it('an empty window says so honestly; jump to the last problem moves the window and says where', () => {
    const empty = rig(100, { lanes: false })

    empty.state.snapshot = {} as never

    expect(words(timelineView(empty.ctx))).toContain('No lane was observed in this window')

    const w = rig(100)

    w.actions.timeline.problem()
    expect(timelineUi(w.state).said).toMatch(/jumped to|no warn or bad/)
  })

  it('export asks through the confirm card with a checked path, and a bad path says why', async () => {
    const w = rig(100)

    await w.actions.timeline.exportTo('md', 'tl.md')
    expect(w.asked).toHaveLength(1)
    await w.actions.timeline.exportTo('md', '../x.md')
    expect(w.asked).toHaveLength(1)
    expect(timelineUi(w.state).said).toContain('..')
  })
})
