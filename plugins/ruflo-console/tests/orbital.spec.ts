import { afterEach, describe, expect, it } from 'vitest'
import { optionsOf } from '../hooks/state'
import { isOrbital, setLook, THEME } from '../hooks/views/common'
import { withCards } from '../hooks/views/card'
import { HEADS, mark } from '../hooks/views/marks'
import { parseConfig, setOption, settingsOf } from '../hooks/settings'
import { newState } from '../hooks/state'
import { CONSOLE_CONFIG } from './fixtures/settings'

afterEach(() => setLook('plain'))
describe('orbital theme', () => {
  it('uses square red cards and restores the original theme on switch', () => {
    setLook('orbital')
    expect(isOrbital()).toBe(true)
    expect(THEME.head).toBe('#f06449')
    const kit = { Box: (props: object) => ({ props }), Text: (props: object) => ({ props }) } as never
    const head = mark(HEADS, { props: { children: 'metrics' } })
    const tree = withCards(kit).Box({ flexDirection: 'column', children: [head] } as never) as unknown as { props: { children: { props: object }[] } }
    expect(tree.props.children[0]?.props).toMatchObject({ borderStyle: 'single', borderColor: '#f06449' })
    setLook('bbs')
    expect(isOrbital()).toBe(false)
    expect(THEME.head).toBe('#ff2a6d')
    expect(optionsOf(undefined).look).toBe('bbs')
  })
  it('accepts the option through the existing settings path', () => {
    const state = newState({})
    const config = parseConfig('ruflo-console', CONSOLE_CONFIG)
    expect(config).not.toBeNull()
    settingsOf(state).configs.set('ruflo-console', config!)
    expect(setOption(state, 'ruflo-console', 'look', 'orbital', () => undefined)?.stdin).toBe('{"look":"orbital"}')
    expect(setOption(state, 'ruflo-console', 'look', 'unknown', () => undefined)).toBeNull()
  })
})

import { orbitalGlobe, orbitalHeader, orbitalBoot, orbitalMasthead } from '../hooks/gfx/orbital'
import { isBooting, VIEWS } from '../hooks/state'
import { picturesOf } from '../hooks/views/frames'
import type { Grid } from '../hooks/gfx/raster'

const gridText = (grid: Grid) => Array.from({ length: grid.rows }, (_, y) => Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.glyph(x, y))).join('')).join('\n')

describe('orbital motion', () => {
  it('turns an ASCII globe and returns to the same frame after one revolution', () => {
    const initial = orbitalGlobe(38, 14, 0)
    expect(gridText(initial)).not.toBe(gridText(orbitalGlobe(38, 14, 3000)))
    expect(initial.cells).toEqual(orbitalGlobe(38, 14, 12000).cells)
    expect(gridText(initial)).toMatch(/^[\x20-\x7e\n]+$/)
    expect(gridText(initial)).toContain('#')
    expect(orbitalGlobe(38, 14, NaN).cells).toEqual(initial.cells)
  })

  it('keeps header dimensions stable while its pulse and scan move', () => {
    for (const columns of [20, 44, 72, 200]) {
      const first = orbitalHeader('overview', columns, 0)
      const next = orbitalHeader('overview', columns, 480)
      expect([next.columns, next.rows]).toEqual([columns, 4])
      expect(next.cells).not.toEqual(first.cells)
      expect(gridText(next).split('\n')[0]).toBe(gridText(first).split('\n')[0])
    }
  })

  it('uses actual boot checks without inventing successes or progress', () => {
    expect(gridText(orbitalBoot('project', 72, 0))).toContain('Self-check: pending')
    const result = orbitalBoot('project', 72, 1000, [{ area: 'one', ok: true, problems: [] }, { area: 'two', ok: false, problems: ['unavailable'] }])
    expect(gridText(result)).toContain('Self-check: 1 passed / 1 failed')
    expect(gridText(result)).not.toContain('%')
  })

  it('bounds the intro and skips it when motion or boot is disabled', () => {
    const state = newState({})
    state.options.look = 'orbital'
    state.options.boot = true
    state.options.fps = 12
    state.pane.bootAtMs = 1000
    expect(isBooting(state, 999)).toBe(false)
    expect(isBooting(state, 2499)).toBe(true)
    expect(isBooting(state, 6999)).toBe(true)
    expect(isBooting(state, 7000)).toBe(false)
    state.snapshot = {} as NonNullable<typeof state.snapshot>
    expect(isBooting(state, 2500)).toBe(false)
    state.options.fps = 0
    expect(isBooting(state, 1100)).toBe(false)
    state.options.fps = 12
    state.options.boot = false
    expect(isBooting(state, 1100)).toBe(false)
  })

  it('provides an animated header on every page and a stable header at fps zero', () => {
    const state = newState({})
    state.options.look = 'orbital'
    state.options.boot = false
    for (const view of VIEWS) for (const width of [60, 116, 200]) {
      state.view = view.id
      const key = view.id === 'menu' ? 'header' : 'title'
      state.options.fps = 12
      expect(picturesOf(state, width, 1000, 1000).get(key)?.cells).not.toEqual(picturesOf(state, width, 2000, 2000).get(key)?.cells)
      state.options.fps = 0
      const still = picturesOf(state, width, 1000, 1000).get(key)
      expect(still).toBeDefined()
      expect(still!.cells).toEqual(picturesOf(state, width, 2000, 2000).get(key)!.cells)
    }
  })
})

it('shows actual failures immediately while success labels animate', () => {
  const checks = [{ area: 'Swarm', ok: true, problems: [] }, { area: 'Security', ok: false, problems: ['missing action'] }]
  const first = gridText(orbitalBoot('project', 72, 0, checks))
  expect(first).toContain('[FAIL] SECURITY / missing action')
  expect(first).toContain('[PASS]')
  expect(first).not.toContain('[PASS] SWARM')
  expect(gridText(orbitalBoot('project', 72, 700, checks))).toContain('[PASS] SWARM')
  expect(gridText(orbitalBoot('project', 72, 0, []))).toContain('[N/A] No module checks reported')
})

it('gives swarm control its own bounded routing animation', () => {
  for (const width of [20, 44, 72]) {
    const first = orbitalHeader('swarm control', width, 0)
    const later = orbitalHeader('swarm control', width, 500)
    expect([first.columns, first.rows]).toEqual([width, width >= 56 ? 16 : 4])
    expect(first.cells).not.toEqual(later.cells)
    if (width >= 56) expect(gridText(first)).toContain('◈')
    expect(gridText(first)).not.toContain('agents online')
  }
})

import { topologyPicture } from '../hooks/gfx/pictures'
it('preserves real topology labels and statuses in the depth view', () => {
  const model = { topology: 'hierarchical', nodes: [
    { id: 'hub', label: 'queen', status: 'leader', isLeader: true },
    { id: 'a', label: 'worker', status: 'busy', isLeader: false },
    { id: 'b', label: 'down', status: 'offline', isLeader: false },
  ] }
  const before = JSON.stringify(model)
  const first = topologyPicture(model, 72, 16, 0, true)
  const next = topologyPicture(model, 72, 16, 1200, true)
  for (const label of ['queen', 'worker', 'down', '◈', '◉', '×']) expect(gridText(next)).toContain(label)
  expect(first.cells).not.toEqual(next.cells)
  expect(JSON.stringify(model)).toBe(before)
})

it('fits narrow and short allocations without hiding failure totals', () => {
  const checks = [{ area: 'Security', ok: false, problems: ['broken registry'] }]
  for (const columns of [1, 8, 12, 20, 32, 44, 48, 55, 56, 72, 120, 200]) {
    for (const rows of [1, 2, 4, 8, 16, 24, 30, 60]) {
      const boot = orbitalBoot('very long project name', columns, 1000, checks, rows)
      const header = orbitalHeader('swarm control', columns, 1000, rows)
      for (const grid of [boot, header]) {
        expect(grid.columns).toBeLessThanOrEqual(columns)
        expect(grid.rows).toBeLessThanOrEqual(rows)
        expect(grid.cells.length).toBe(grid.columns * grid.rows * 3)
      }
      if (columns >= 12 && rows >= 2) expect(gridText(boot)).toMatch(/1 FAIL|1 failed/)
    }
  }
})

it('reserves icon room and switches layouts as the pane is resized', () => {
  const state = newState({})
  state.options.look = 'orbital'
  state.options.boot = false
  state.view = 'swarm'
  for (const [columns, rows] of [[160, 50], [44, 24], [72, 20], [200, 60], [20, 10]]) {
    state.pane.rows = rows!
    const header = picturesOf(state, columns!, 1000, 1000).get('title')!
    expect(header.columns).toBeLessThanOrEqual(Math.max(1, columns! < 40 ? columns! : columns! - 16))
    expect(header.rows).toBeLessThanOrEqual(Math.max(1, rows! - 12))
  }
})

it('keeps the original block brand after boot with bounded moving art and optional globe', async () => {
  const { ORBITAL_THEME } = await import('../hooks/themes')
  for (const columns of [1, 8, 19, 28, 44, 72, 78, 100, 120, 200]) {
    for (const rows of [1, 2, 4, 8]) {
      const first = orbitalMasthead('Main Menu', columns, 0, rows)
      const next = orbitalMasthead('Main Menu', columns, 1400, rows)
      expect(first.columns).toBeLessThanOrEqual(columns)
      expect(first.rows).toBeLessThanOrEqual(rows)
      expect([next.columns, next.rows]).toEqual([first.columns, first.rows])
      if (columns >= 19 && rows >= 2) expect(gridText(first)).toMatch(/[█▀▄]/)
      if (columns >= 19 && rows >= 4) expect(first.cells).not.toEqual(next.cells)
    }
  }
  const off = { ...ORBITAL_THEME, motion: { ...ORBITAL_THEME.motion, globe: false, topology: false } }
  const grid = orbitalMasthead('Theme Studio', 100, 0, 8, off)
  expect(gridText(grid)).toContain('THEME STUDIO')
  expect(gridText(grid)).toContain('█')
  expect(gridText(grid)).not.toContain('#')
  expect(grid.cells).not.toEqual(orbitalMasthead('Theme Studio', 100, 0).cells)
})

describe('Orbital header name', () => {
  it('says RUFLO in the wide masthead and the narrow fallback, never another name', () => {
    const text = (columns: number) => {
      const grid = orbitalMasthead('MAIN MENU', columns, 0)

      return Array.from({ length: grid.rows }, (_, y) => Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.glyph(x, y) || 32)).join('')).join('\n')
    }

    expect(text(140)).toContain('RUFLO / AGENT SWARM CONSOLE')
    expect(text(140)).not.toMatch(/RUVNET/)
    expect(text(60)).not.toMatch(/RUVNET/)
  })
})
