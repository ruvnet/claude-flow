/**
 * The console's pictures on every surface it can be drawn on. The terminal draws a Raster; Claude Code Desktop draws the same cells as
 * an Svg, because the host completes the desktop's table with a Raster that draws an empty fragment. Run with
 *   claude plugin test plugins/ruflo-console
 */
import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { BAND, command, elementsOf, keyOf, paneAt, PLUGIN, SESSION, textOf, worldOf } from './fixtures/world'

/** The agent drill-down opens on an agent of the fixture project; a bare `agent` would open Swarm. */
const AGENT = 'agent-1790903032181-97m25s'
const VIEWS = [`agent ${AGENT}`, 'menu', 'missions', 'overview', 'swarm', 'hive', 'claims', 'workflows', 'federation', 'plugins', 'learning', 'metaharness', 'memory', 'cost', 'timeline', 'approvals', 'events', 'room', 'xruv', 'terminal', 'skills', 'secure', 'perf', 'automate', 'neural', 'vector', 'evolve', 'devtools', 'sandbox', 'market', 'adrs', 'whatsnew', 'themes', 'settings'] as const
const SVG_SOURCE_MAX = 131_072

type Props = { source?: string; alt?: string; width?: number }
const propsOf = (element: unknown): Props => ((element as { props?: Props }).props ?? {}) as Props

for (const look of ['bbs', 'plain', 'orbital'] as const) {
  describe(`pictures on each surface (${look})`, () => {
    test(`every view: the terminal gets Rasters and no Svg; the desktop gets one Svg per Raster, each within the host's limit, and no Raster`, { timeoutMs: 120_000, options: { boot: false, look } }, async ($, on) => {
      worldOf(on, RUFLO_FILES)
      mock.clock(on)
      await $.session.start(SESSION)

      let pictured = 0

      for (const view of VIEWS) {
        await $.command.run(command(view))
        await $.command.run(command('status'))

        const drawn: Record<'terminal' | 'desktop', unknown> = { terminal: null, desktop: null }

        for (const surface of ['terminal', 'desktop'] as const) {
          const pane = await $.ui.mount({ ...paneAt(110, 60, true, surface), plugin: PLUGIN })

          expect(pane.surface).toBe(surface)
          drawn[surface] = await pane.drawn()
          await pane.unmount()
        }

        const rasters = elementsOf(drawn.terminal as never, 'Raster')
        const svgs = elementsOf(drawn.desktop as never, 'Svg')

        // The bbs and orbital looks give every page title art; the plain look draws pictures on some pages only.
        if (look !== 'plain') expect(rasters.length, `${look} ${view}: the terminal draws its pictures`).toBeGreaterThan(0)
        pictured += rasters.length
        expect(elementsOf(drawn.terminal as never, 'Svg'), `${look} ${view}: no Svg on the terminal`).toHaveLength(0)
        expect(elementsOf(drawn.desktop as never, 'Raster'), `${look} ${view}: no Raster on the desktop`).toHaveLength(0)
        expect(svgs.length, `${look} ${view}: one Svg per picture`).toBe(rasters.length)
        // Picture by picture, not just by count: each Svg sits in a Box keyed by its Raster's key.
        const svgKeys = elementsOf(drawn.desktop as never, 'Box').map(keyOf).filter(key => key.startsWith('svg-')).map(key => key.slice(4))

        expect(svgKeys.sort(), `${look} ${view}: the same pictures`).toEqual(rasters.map(keyOf).sort())

        for (const svg of svgs) {
          const { source = '', alt = '', width = 0 } = propsOf(svg)

          expect(source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
          expect(source.length).toBeLessThanOrEqual(SVG_SOURCE_MAX)
          expect(alt.trim().length).toBeGreaterThan(0)
          expect(alt, `${look} ${view}: a drawn picture does not say it needs a terminal`).not.toMatch(/needs? a terminal/)
          expect(width).toBeGreaterThan(0)
        }

        // The words around the pictures are the same on both surfaces.
        expect(textOf(drawn.desktop as never)).toBe(textOf(drawn.terminal as never))
        if (view.startsWith('agent ')) expect(textOf(drawn.desktop as never), 'the agent drill-down is open').toContain(AGENT)
      }

      expect(pictured, `${look}: some page draws a picture`).toBeGreaterThan(0)
    })
  })
}

describe('pictures on each surface', () => {
  test('the main menu leads with the banner: a Raster on the terminal, an Svg titled with the console name on the desktop', { options: { boot: false } }, async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('menu'))

    const terminal = await $.ui.mount({ ...paneAt(110, 60, true, 'terminal'), plugin: PLUGIN })

    expect(elementsOf(await terminal.drawn(), 'Raster').map(keyOf)).toContain('header')
    await terminal.unmount()

    const desktop = await $.ui.mount({ ...paneAt(110, 60, true, 'desktop'), plugin: PLUGIN })
    const banner = elementsOf(await desktop.drawn(), 'Svg').map(propsOf)[0]

    expect(banner?.alt).toBe('RUFLO / AGENT SWARM CONSOLE')
    expect(banner?.source).toContain('<title>RUFLO / AGENT SWARM CONSOLE</title>')
    await desktop.unmount()
  })

  test('the frame loop blits on the terminal and never on the desktop, where nothing is mounted to blit', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('swarm'))
    await $.command.run(command('status'))

    const desktop = await $.ui.mount({ ...paneAt(110, 60, true, 'desktop'), plugin: PLUGIN })

    for (let i = 0; i < 8; i++) await clock.advance(125)
    expect(world.blits).toHaveLength(0)
    await desktop.unmount()

    const terminal = await $.ui.mount({ ...paneAt(110, 60, true, 'terminal'), plugin: PLUGIN })

    for (let i = 0; i < 8; i++) await clock.advance(125)
    expect(world.blits.filter(key => key === 'topology').length).toBeGreaterThan(2)
    await terminal.unmount()
  })

  test('the boot intro is a Raster on the terminal and an Svg on the desktop, with nothing else under it', async ($, on) => {
    worldOf(on, RUFLO_FILES)
    mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command())

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ ...paneAt(110, 60, true, surface), plugin: PLUGIN })
      const intro = await pane.drawn()

      expect(elementsOf(intro, 'Raster').map(keyOf)).toEqual(surface === 'terminal' ? ['boot'] : [])
      expect(elementsOf(intro, 'Svg').map(propsOf).map(props => props.alt)).toEqual(surface === 'terminal' ? [] : ['RUFLO AGENT SWARM CONSOLE · loading…'])
      expect(textOf(intro)).not.toContain('MAIN MENU')
      await pane.unmount()
    }
  })

  test('the band animates its working mark on the terminal and sends nothing for it on the desktop', { options: { boot: false } }, async ($, on) => {
    const world = worldOf(on, RUFLO_FILES)
    const clock = mock.clock(on)
    await $.session.start(SESSION)
    await $.command.run(command('status'))

    for (const surface of ['desktop', 'terminal'] as const) {
      world.blits.length = 0
      const band = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, isWorking: true }, plugin: PLUGIN })
      const tree = await band.drawn()

      for (let i = 0; i < 8; i++) await clock.advance(125)
      expect(world.blits.filter(key => key === 'mark').length > 0, `${surface}: mark blits`).toBe(surface === 'terminal')
      expect(textOf(tree).length).toBeGreaterThan(0)
      await band.unmount()
    }
  })
})
