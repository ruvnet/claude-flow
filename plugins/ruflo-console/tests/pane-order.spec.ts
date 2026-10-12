/**
 * The pane's order, small and wide: the page's title art leads and the tabs follow. In the compact layout (an inline pane shorter than the
 * page asks for) the tabs used to come first, above the title. Run with
 *   npx vitest run plugins/ruflo-console/tests/pane-order.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { Grid } from '../hooks/gfx/raster'
import { newState, type State, type ViewId } from '../hooks/state'
import { setLook, type Ctx } from '../hooks/views/common'
import { paneView } from '../hooks/views/pane'

type El = { props: Record<string, unknown>; kind: string }

const act = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy
})() as never
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input'), Raster: make('Raster') }
const flat = (el: unknown): El[] => {
  const node = el as El

  if (typeof node !== 'object' || node === null) return []

  const kids = node.props.children

  return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
}

/** The top-level parts of the pane, as indexes: where the title's raster is, and where the first tab is. */
function order(view: ViewId, columns: number, rows: number): { title: number; tabs: number } {
  const state: State = newState({})

  state.options.look = 'bbs'
  state.options.boot = false
  state.view = view
  state.pane.placement = 'inline'
  state.pane.rows = rows
  state.pane.columns = columns
  state.snapshot = null

  const pictures = new Map([['title', new Grid(40, 2)]])
  const tree = paneView({ kit, state, nowMs: Date.now(), columns, pictures, act, cards: false } as unknown as Ctx) as unknown as El
  const parts = tree.props.children as unknown[]
  const at = (match: (node: El) => boolean): number => parts.findIndex(part => flat(part).some(match))

  return { title: at(node => node.kind === 'Raster'), tabs: at(node => /^(tab-|nav-)/.test(String(node.props.key)) || String(node.props.key).startsWith('tabs')) }
}

afterEach(() => setLook('plain'))

describe('the pane\'s order', () => {
  it('leads with the title and then the tabs in the compact layout', () => {
    const { title, tabs } = order('swarm', 100, 8)

    expect(title).toBeGreaterThanOrEqual(0)
    expect(tabs).toBeGreaterThanOrEqual(0)
    expect(title).toBeLessThan(tabs)
  })

  it('leads with the title and then the tabs in the wide layout too', () => {
    const { title, tabs } = order('swarm', 140, 0)

    expect(title).toBeGreaterThanOrEqual(0)
    expect(title).toBeLessThan(tabs)
  })
})

describe('the main menu\'s header when the pane is small', () => {
  it('is the logo banner in the compact layout too, not the big-letter page title', () => {
    const state = newState({})

    state.options.look = 'bbs'
    state.options.boot = false
    state.view = 'menu'
    state.pane.placement = 'inline'
    state.pane.rows = 8
    state.pane.columns = 60
    state.snapshot = null

    const pictures = new Map([['title', new Grid(40, 2)], ['header', new Grid(60, 2)]])
    const tree = paneView({ kit, state, nowMs: Date.now(), columns: 60, pictures, act, cards: false } as unknown as Ctx) as unknown as El
    const rasters = flat(tree).filter(node => node.kind === 'Raster').map(node => String((node.props as { key?: unknown }).key ?? ''))

    expect(rasters[0]).toBe('header')
    expect(rasters).not.toContain('title')
  })

  it('shows the title whole, with the version only when it fits beside the logo', async () => {
    const { bannerPicture } = await import('../hooks/gfx/pictures')
    const text = (columns: number): string => {
      const grid = bannerPicture('ruflo', columns, 0)
      let row = ''

      for (let x = 0; x < columns; x++) row += String.fromCodePoint(grid.glyph(x, 0))

      return row
    }

    expect(text(44)).toContain('AGENT SWARM CONSOLE')
    expect(text(44)).not.toMatch(/ v\d/)
    expect(text(90)).toMatch(/AGENT SWARM CONSOLE v\d/)
  })
})
