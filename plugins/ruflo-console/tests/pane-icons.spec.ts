/**
 * The three icons in one row on the first line, beside the host's close mark: the main menu, help and settings. They sit beside the page's header rows in every
 * layout, each does its one thing, the one for the page you are on is lit (coloured text, the width of a button), and a pane too narrow for them has none. Run with
 *   npx vitest run plugins/ruflo-console/tests/pane-icons.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { Grid } from '../hooks/gfx/raster'
import { readSnapshot } from '../hooks/data/snapshot'
import { newState, type ViewId } from '../hooks/state'
import { setLook, type Ctx } from '../hooks/views/common'
import { paneView } from '../hooks/views/pane'

type El = { props: Record<string, unknown>; kind: string }

const calls: string[] = []
const recorder = (path: string): unknown =>
  new Proxy(() => undefined, {
    get: (_t, key) => (key === 'then' ? undefined : recorder(`${path}.${String(key)}`)),
    apply: (_t, _this, args) => void calls.push(`${path.slice(1)}(${args.join(',')})`),
  })
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input'), Raster: make('Raster') }
const flat = (el: unknown): El[] => {
  const node = el as El

  if (typeof node !== 'object' || node === null) return []

  const kids = node.props.children

  return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
}

function draw(view: ViewId, columns: number, rows: number, mutate: (state: ReturnType<typeof newState>) => void = () => undefined): El {
  const state = newState({})

  state.options.look = 'bbs'
  state.options.boot = false
  state.view = view
  state.pane.placement = 'inline'
  state.pane.rows = rows
  state.pane.columns = columns
  state.snapshot = null
  mutate(state)
  setLook('bbs')

  const pictures = new Map([['title', new Grid(40, 2)], ['header', new Grid(60, 2)]])

  return paneView({ kit, state, nowMs: Date.now(), columns, pictures, act: recorder('') as never, cards: false } as unknown as Ctx) as unknown as El
}

const key = (tree: El, name: string): El | undefined => flat(tree).find(node => node.props.key === name)

afterEach(() => setLook('plain'))

describe('the icon row', () => {
  it.each([
    ['a wide page', 'swarm', 140, 0],
    ['a short (compact) page', 'swarm', 90, 8],
    ['the wide main menu', 'menu', 140, 0],
    ['the compact main menu', 'menu', 70, 8],
  ] as const)('is five icons in one row at the right of the first line, beside the header rows on %s', (_name, view, columns, rows) => {
    const tree = draw(view, columns, rows)
    const column = key(tree, 'pane-icons')
    const top = key(tree, 'pane-top')

    const parts = column?.props.children as El[]

    expect(column?.props.flexDirection).toBe('row')
    // Five icons, then two cells after the last so it does not touch the close mark.
    expect(parts.length).toBe(6)
    expect(parts.slice(0, 5).map(part => String(part.props.key))).toEqual(['pane-icon-menu', 'pane-icon-palette', 'pane-icon-help', 'pane-icon-settings', 'pane-icon-refresh'])
    expect(parts[5]?.kind).toBe('Text')
    expect(String(parts[5]?.props.children).length).toBe(2)
    // The header's rows are in the same row as the column, to its left.
    expect(flat((top?.props.children as unknown[])[0]).some(node => node.kind === 'Raster')).toBe(true)
    expect((top?.props.children as unknown[])[1]).toBe(column)
  })

  const NAMES = ['pane-icon-menu', 'pane-icon-palette', 'pane-icon-help', 'pane-icon-settings', 'pane-icon-refresh'] as const
  const WORDS = { 'pane-icon-menu': 'menu', 'pane-icon-palette': 'palette', 'pane-icon-refresh': 'refresh', 'pane-icon-help': 'help', 'pane-icon-settings': 'settings' } as const

  it('keeps the horizontal padding modest: a glyph and one cell after it on a pane too narrow for words', () => {
    const tree = draw('swarm', 90, 0)

    for (const name of NAMES) expect(String(key(tree, name)?.props.label).length, name).toBe(2)
  })

  it('says its word beside each glyph from 110 columns, so help is obvious, and not below', () => {
    const wide = draw('swarm', 140, 0)
    const edge = draw('swarm', 110, 0)
    const narrow = draw('swarm', 109, 0)

    for (const name of NAMES) {
      expect(String(key(wide, name)?.props.label), name).toMatch(new RegExp(`^. ${WORDS[name]} $`))
      expect(String(key(edge, name)?.props.label), name).toMatch(new RegExp(`^. ${WORDS[name]} $`))
      expect(String(key(narrow, name)?.props.label).length, name).toBe(2)
    }
  })

  it('draws every glyph one cell wide, so the help icon is not the odd one out in size', () => {
    const tree = draw('swarm', 140, 0)

    for (const name of ['pane-icon-menu', 'pane-icon-palette', 'pane-icon-help', 'pane-icon-settings', 'pane-icon-refresh']) {
      const glyph = [...String(key(tree, name)?.props.label)][0] as string

      expect([...glyph].length, name).toBe(1)
      expect(glyph, name).not.toBe('?')
      // None may be an emoji, or have an emoji form: a terminal can draw those two cells wide, and the lit icon (bold) would then jump.
      expect(glyph, name).not.toMatch(/\p{Extended_Pictographic}|\p{Emoji_Presentation}/u)
    }
  })

  it('each icon does its one thing', () => {
    calls.length = 0

    const tree = draw('swarm', 140, 0)

    for (const name of NAMES) (key(tree, name)?.props.onPress as () => void)()

    expect(calls).toEqual(['view(menu)', 'palette(all)', 'help()', 'view(settings)', 'restart()'])
  })

  it.each([140, 90])('lights the icon of the page you are on in colour, in exactly the width of a button, at %i columns, so nothing jumps', columns => {
    const onMenu = draw('menu', columns, 0)
    const onSettings = draw('settings', columns, 0)
    const onHelp = draw('swarm', columns, 0, state => (state.isHelp = true))
    const onPalette = draw('swarm', columns, 0, state => (state.palette.isOpen = true))
    // What an icon draws, in cells: a plain Button draws its label, the lit icon its text.
    const cells = (el: El | undefined): number => (el?.kind === 'Button' ? String(el.props.label).length : String(flat(el)[1]?.props.children).length)
    const lit = (tree: El, name: string): El | undefined => flat(key(tree, name)).find(node => node.kind === 'Text')

    expect(lit(onMenu, 'pane-icon-menu')?.props).toMatchObject({ bold: true, color: expect.stringMatching(/^#|^[a-z]/) })
    expect(key(onMenu, 'pane-icon-help')?.kind).toBe('Button')
    expect(lit(onSettings, 'pane-icon-settings')).toBeDefined()
    expect(lit(onHelp, 'pane-icon-help')).toBeDefined()
    expect(lit(onPalette, 'pane-icon-palette')).toBeDefined()
    // Refresh is an action, never the page you are on.
    expect(key(onMenu, 'pane-icon-refresh')?.kind).toBe('Button')

    const reference = Object.fromEntries(NAMES.map(name => [name, cells(key(draw('swarm', columns, 0), name))]))

    for (const tree of [onMenu, onSettings, onHelp, onPalette]) for (const name of NAMES) expect(cells(key(tree, name)), name).toBe(reference[name])
  })

  it('puts refresh last, beside the close mark, and as a larger glyph than the others', () => {
    const parts = key(draw('swarm', 140, 0), 'pane-icons')?.props.children as El[]

    expect(String(parts[4]?.props.key)).toBe('pane-icon-refresh')
    expect(String(parts[4]?.props.label)).toMatch(/^⟳ refresh $/)
  })

  it('is left out of a pane too narrow for it', () => {
    expect(key(draw('swarm', 36, 0), 'pane-icons')).toBeUndefined()
  })
})

describe('the icon row never runs under the header art', () => {
  it('spells words only when the pane is wide and the art leaves room for the whole row', async () => {
    const { iconCells, iconsSpellWords, ICON_SLACK, ICON_WORDS_FROM } = await import('../hooks/icon-layout')

    expect(iconCells(true)).toBe(47)
    expect(iconCells(false)).toBe(12)
    expect(iconsSpellWords(ICON_WORDS_FROM - 1, 0)).toBe(false)
    expect(iconsSpellWords(ICON_WORDS_FROM, 0)).toBe(true)
    expect(iconsSpellWords(126, 126 - 47 - ICON_SLACK)).toBe(true)
    expect(iconsSpellWords(126, 126 - 47 - ICON_SLACK + 1)).toBe(false)
  })

  it('draws every page\'s header art narrower than the pane by at least the glyph row, at every width from 40 to 220', async () => {
    const { picturesOf } = await import('../hooks/views/frames')
    const { ICON_SLACK, iconCells } = await import('../hooks/icon-layout')
    const { VIEWS } = await import('../hooks/state')
    const problems: string[] = []

    for (const view of VIEWS) {
      for (let columns = 40; columns <= 220; columns += 7) {
        const state = newState({})

        state.options.look = 'bbs'
        state.options.boot = false
        state.view = view.id
        state.pane.columns = columns
        state.snapshot = null

        const pictures = picturesOf(state, columns, Date.now(), 0)
        const art = pictures.get(view.id === 'menu' ? 'header' : 'title')

        if (art !== undefined && art.columns + iconCells(false) + ICON_SLACK > columns) problems.push(`${view.id} at ${columns}: art ${art.columns} + icons ${iconCells(false)} + slack > ${columns}`)
      }
    }

    expect(problems).toEqual([])
  })

  it('with the real header art: words on the menu banner at 126 columns, glyphs only under a wide page title, and the art plus the row always fit', async () => {
    const { picturesOf } = await import('../hooks/views/frames')
    const { iconCells } = await import('../hooks/icon-layout')
    const render = (view: ViewId, columns: number): { tree: El; art: number } => {
      const state = newState({})

      state.options.look = 'bbs'
      state.options.boot = false
      state.view = view
      state.pane.placement = 'dock'
      state.pane.columns = columns
      state.snapshot = null
      setLook('bbs')

      const pictures = picturesOf(state, columns, Date.now(), 0)
      const tree = paneView({ kit, state, nowMs: Date.now(), columns, pictures, act: recorder('') as never, cards: false } as unknown as Ctx) as unknown as El

      return { tree, art: pictures.get(view === 'menu' ? 'header' : 'title')?.columns ?? 0 }
    }
    const word = (tree: El): string => String(key(tree, 'pane-icon-help')?.props.label ?? flat(key(tree, 'pane-icon-help'))[1]?.props.children)
    const menu = render('menu', 126)
    const page = render('market', 126)

    expect(word(menu.tree)).toBe('ʔ help ')
    expect(word(page.tree)).toBe('ʔ ')
    // Whichever form is chosen, the art and the row fit in the pane.
    expect(menu.art + iconCells(true)).toBeLessThanOrEqual(126)
    expect(page.art + iconCells(false)).toBeLessThanOrEqual(126)
  })
})

describe('the icon row does not shrink in the host\'s flex layout', () => {
  it('is told not to shrink, nor is the lit icon, so a tight row clips the art instead of collapsing the icon', () => {
    const tree = draw('settings', 126, 0)

    expect(key(tree, 'pane-icons')?.props.flexShrink).toBe(0)
    expect(key(tree, 'pane-icon-settings')?.props.flexShrink).toBe(0)
  })
})

describe('a narrow pane reads cleanly', () => {
  const rowOf = (grid: { columns: number; glyph: (x: number, y: number) => number }, y: number): string => Array.from({ length: grid.columns }, (_, x) => String.fromCodePoint(grid.glyph(x, y))).join('')

  it.each([44, 60, 90, 110, 140, 180])('keeps the focus state whole at %i columns, so the person knows where typing goes', async columns => {
    const missing = async (): Promise<never> => { throw new Error('ENOENT') }
    const snapshot = await readSnapshot({ read: missing, stat: missing, list: async () => [] }, new Map(), '/work', null, {}, Date.now())

    for (const isFocused of [true, false]) {
      const tree = draw('swarm', columns, 40, state => {
        state.pane.isFocused = isFocused
        state.snapshot = snapshot
      })
      const focus = flat(tree).find(node => node.kind === 'Text' && String(node.props.children).startsWith(isFocused ? 'keys on' : 'keys off'))

      expect(focus, `focus ${isFocused}`).toBeDefined()
      expect(String(focus?.props.children)).not.toMatch(/…\s*$/)
    }
  })

  it('keeps the banner\'s title whole: the longest of version, title, shorter title that fits', async () => {
    const { bannerPicture } = await import('../hooks/gfx/pictures')

    expect(rowOf(bannerPicture('p', 90, 0), 0)).toMatch(/AGENT SWARM CONSOLE v\d/)
    expect(rowOf(bannerPicture('p', 46, 0), 0)).toContain('AGENT SWARM CONSOLE')
    expect(rowOf(bannerPicture('p', 44, 0), 0)).toContain('SWARM CONSOLE')
    expect(rowOf(bannerPicture('p', 44, 0), 0)).not.toMatch(/CONSOL\s*$/)
    expect(rowOf(bannerPicture('p', 34, 0), 0)).toContain('CONSOLE')
  })

  it('clips a long project name with an ellipsis, not mid-letter', async () => {
    const { bannerPicture } = await import('../hooks/gfx/pictures')
    const second = rowOf(bannerPicture('a-very-long-project-name', 44, 0), 1)

    expect(second).toContain('…')
    expect(second.trimEnd().length).toBeLessThanOrEqual(44)
  })

  it('draws a page title that fits the pane, whole: the page alone when the ruflo prefix will not fit, and never clipped mid-letter', async () => {
    const { picturesOf } = await import('../hooks/views/frames')
    const { titlePicture } = await import('../hooks/gfx/pictures')
    const { usedColumns, iconCells, ICON_SLACK } = await import('../hooks/icon-layout')
    const { VIEWS } = await import('../hooks/state')
    const problems: string[] = []

    for (const view of VIEWS) {
      if (view.id === 'menu') continue

      for (const columns of [50, 60, 70, 90, 126]) {
        const state = newState({})

        state.options.look = 'bbs'
        state.options.boot = false
        state.view = view.id
        state.pane.columns = columns
        state.snapshot = null

        const art = picturesOf(state, columns, Date.now(), 0).get('title')
        const unclipped = [`ruflo | ${view.label}`, view.label, view.short].map(name => {
          const grid = titlePicture(name, 120, 0)

          return usedColumns(grid.cells, grid.columns, grid.rows)
        })
        const room = columns - iconCells(false) - ICON_SLACK

        // Whole means: its width is exactly the width of one of the unclipped names (or, when none fits the room, the room itself).
        if (art !== undefined && !unclipped.includes(art.columns) && art.columns !== room) problems.push(`${view.id} at ${columns}: art ${art.columns}, names ${unclipped.join('/')}, room ${room}`)
        if (art !== undefined && unclipped.some(width => width <= room) && art.columns > room) problems.push(`${view.id} at ${columns}: art wider than the room`)
        // And the first name that fits is the one chosen.
        const firstFit = unclipped.find(width => width <= room)

        if (art !== undefined && firstFit !== undefined && art.columns !== firstFit) problems.push(`${view.id} at ${columns}: chose ${art.columns}, first that fits is ${firstFit}`)
      }
    }

    expect(problems).toEqual([])
  })

  it('shows the main menu chip as MENU in a narrow nav, and the networks row wraps', async () => {
    const tree = draw('menu', 60, 0)
    const chipText = flat(tree).find(node => /\[0: .*MENU\]/.test(String(node.props.children)))

    expect(chipText).toBeDefined()
    expect(String(chipText?.props.children)).not.toContain('MAIN')
    expect(key(tree, 'networks')?.props.flexWrap).toBe('wrap')
  })

  it('shortens the ruHelp field\'s label to the arrow when the pane is narrow', async () => {
    const { helpView } = await import('../hooks/views/help')
    const labelAt = (columns: number): string => {
      const state = newState({})

      state.isHelp = true

      const tree = helpView({ kit, state, nowMs: Date.now(), columns, pictures: new Map(), act: recorder('') as never, cards: true } as unknown as Ctx) as unknown as El

      return String(flat(tree).find(node => node.props.key === 'help-input')?.props.label)
    }

    expect(labelAt(56)).toBe('›')
    expect(labelAt(120)).toBe('ruHelp ›')
  })
})
