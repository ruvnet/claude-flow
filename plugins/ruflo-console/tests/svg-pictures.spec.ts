/**
 * Pictures on the surfaces that draw vectors: the grid-to-SVG writer (shapes, braille, text placement, escaping, the host's size limit)
 * and the kit a surface really draws with. Run with
 *   npx vitest run plugins/ruflo-console/tests/svg-pictures.spec.ts
 */
import { describe, expect, it, vi } from 'vitest'

/** Counts how often the frame loop builds pictures, to show a surface that draws Svg builds none per frame. */
const built = vi.hoisted(() => ({ count: 0 }))

vi.mock('../hooks/views/frames', async importOriginal => {
  const real = await importOriginal<typeof import('../hooks/views/frames')>()

  return { ...real, picturesOf: (...args: Parameters<typeof real.picturesOf>) => ((built.count += 1), real.picturesOf(...args)) }
})

import { createController } from '../hooks/controller'
import { DEFAULT, Grid } from '../hooks/gfx/raster'
import type { Host } from '../hooks/host'
import { newState, VIEWS } from '../hooks/state'
import { picturesOf } from '../hooks/views/frames'
import { CELL_H, CELL_W, escapeXml, gridToSvg, SVG_SOURCE_MAX } from '../hooks/gfx/svg'
import { kitForSurface, type Kit } from '../hooks/views/common'

/**
 * A structural XML check for what gridToSvg writes (not a general XML parser, and not evidence beyond its own rules): one root element, every tag closed in order, close tags bare,
 * attributes quoted and unique, no bare `&` or character XML 1.0 cannot hold in text or in a value, and no `]]>` in text.
 */
const BAD_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
const BAD_REF = /&(?!(amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/
const BAD_TEXT = (text: string): boolean => BAD_REF.test(text) || text.includes(']]>') || BAD_CHAR.test(text)
const BAD_VALUE = (value: string): boolean => BAD_REF.test(value) || BAD_CHAR.test(value)

function isWellFormed(xml: string): boolean {
  const stack: string[] = []
  const token = /<\/([A-Za-z][\w:-]*)>|<([A-Za-z][\w:-]*)((?:[ \t\r\n]+[A-Za-z_:][\w:.-]*="[^"<]*")*)[ \t\r\n]*(\/?)>|([^<]+)/gy
  let seenRoot = false
  let at = 0

  while (at < xml.length) {
    token.lastIndex = at
    const m = token.exec(xml)

    if (m === null) return false
    at = token.lastIndex
    if (m[5] !== undefined) {
      if (stack.length === 0 || BAD_TEXT(m[5])) return false
    } else if (m[1] !== undefined) {
      if (stack.pop() !== m[1]) return false
    } else {
      const values = [...(m[3] ?? '').matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)]

      if (new Set(values.map(v => v[1])).size !== values.length || values.some(v => BAD_VALUE(v[2] ?? ''))) return false
      // One root element: nothing opens once it has closed.
      if (stack.length === 0 && seenRoot) return false
      seenRoot = true
      if (m[4] !== '/') stack.push(m[2] as string)
    }
  }

  return seenRoot && stack.length === 0
}

const svgOf = (grid: Grid, alt = 'picture'): string => {
  const svg = gridToSvg(grid, alt)

  expect(svg).not.toBeNull()

  return svg as string
}

describe('gridToSvg', () => {
  it('draws block glyphs as rectangles and merges a run of one shape and colour into one', () => {
    const grid = new Grid(6, 1)

    grid.text(0, 0, '▀▀▀', 0xff0000)
    grid.set(3, 0, '█', 0x00ff00)
    grid.set(4, 0, '▄', 0x0000ff)
    const svg = svgOf(grid)

    expect(svg).toContain(`<path fill="#ff0000" d="M0 0h${3 * CELL_W}v${CELL_H / 2}h${-3 * CELL_W}z"/>`)
    expect(svg).toContain(`fill="#00ff00" d="M${3 * CELL_W} 0h${CELL_W}v${CELL_H}`)
    expect(svg).toContain(`fill="#0000ff" d="M${4 * CELL_W} ${CELL_H / 2}h${CELL_W}v${CELL_H / 2}`)
    expect(svg).not.toContain('<text')
    expect(isWellFormed(svg)).toBe(true)
  })

  it('keeps half-width shapes apart and draws shades as a translucent fill', () => {
    const grid = new Grid(5, 1)

    grid.text(0, 0, '▌▌', 0x111111)
    grid.text(2, 0, '░▒▓', 0x222222)
    const svg = svgOf(grid)

    expect(svg.match(/M\d+ 0h4v16h-4z/g)).toHaveLength(2)
    expect(svg).toContain('fill="#222222" fill-opacity="0.25"')
    expect(svg).toContain('fill="#222222" fill-opacity="0.5"')
    expect(svg).toContain('fill="#222222" fill-opacity="0.75"')
  })

  it('draws braille as dots on a 2x4 grid, one per set bit', () => {
    const grid = new Grid(2, 1)

    grid.set(0, 0, 0x28ff, 0xabcdef)
    grid.set(1, 0, 0x2801, 0xabcdef)
    const d = /fill="#abcdef" d="([^"]+)"/.exec(svgOf(grid))?.[1] ?? ''

    expect(d.match(/M/g)).toHaveLength(9)
    expect(d.startsWith('M1 1h2v2h-2z')).toBe(true)
    expect(d).toContain(`M${CELL_W + 1} 1h2v2h-2z`)
  })

  it('places every text glyph on its own cell, so a proportional font cannot drift the columns', () => {
    const grid = new Grid(10, 2)

    grid.text(2, 1, 'Hi!', 0x00aa00)
    const svg = svgOf(grid)

    expect(svg).toContain(`fill="#00aa00" x="${2 * CELL_W} ${3 * CELL_W} ${4 * CELL_W}" y="${CELL_H + 12}" xml:space="preserve">Hi!</text>`)
  })

  it('keeps every glyph on its own column when a character XML cannot hold is dropped before it', () => {
    const grid = new Grid(5, 1)

    grid.text(0, 0, 'A\u0001B', 0xffffff)
    grid.set(3, 0, 0xfffe, 0xffffff)
    grid.set(4, 0, 'C', 0xffffff)
    const svg = svgOf(grid)

    expect(svg).toContain(`x="0" y="12" xml:space="preserve">A</text>`)
    expect(svg).toContain(`x="${2 * CELL_W}" y="12" xml:space="preserve">B</text>`)
    expect(svg).toContain(`x="${4 * CELL_W}" y="12" xml:space="preserve">C</text>`)
  })

  it('turns every control character into a blank cell, so a CR, LF or TAB cannot move the glyphs after it', () => {
    const grid = new Grid(8, 1)

    grid.text(0, 0, 'A\r\nB\tC\u0085D', 0xffffff)
    const svg = svgOf(grid)

    expect(svg).toContain(`x="0" y="12" xml:space="preserve">A</text>`)
    expect(svg).toContain(`x="${3 * CELL_W}" y="12" xml:space="preserve">B</text>`)
    expect(svg).toContain(`x="${5 * CELL_W}" y="12" xml:space="preserve">C</text>`)
    expect(svg).toContain(`x="${7 * CELL_W}" y="12" xml:space="preserve">D</text>`)
    expect(svg).not.toMatch(/[\r\n\t\u0085]/)
  })

  it('draws every Block Elements glyph (U+2580 to U+259F) as rectangles, never as text', () => {
    for (let cp = 0x2580; cp <= 0x259f; cp++) {
      const grid = new Grid(1, 1)

      grid.set(0, 0, cp, 0x445566)
      const svg = svgOf(grid)

      expect(svg, cp.toString(16)).not.toContain('<text')
      expect(svg, cp.toString(16)).toContain('fill="#445566"')
    }
  })

  it('places the eighths, the upper and right bars and the quadrants where they belong', () => {
    const at = (cp: number): string => {
      const grid = new Grid(1, 1)

      grid.set(0, 0, cp, 0x000001)

      return /d="([^"]+)"/.exec(svgOf(grid))?.[1] ?? ''
    }

    expect(at(0x2594)).toBe(`M0 0h${CELL_W}v2h-${CELL_W}z`) // ▔ upper eighth
    expect(at(0x2595)).toBe(`M7 0h1v${CELL_H}h-1z`) // ▕ right eighth
    expect(at(0x2589)).toBe(`M0 0h7v${CELL_H}h-7z`) // ▉ seven eighths from the left
    expect(at(0x2596)).toBe(`M0 8h4v8h-4z`) // ▖ lower left
    expect(at(0x259a)).toBe(`M0 0h4v8h-4zM4 8h4v8h-4z`) // ▚ upper left and lower right
  })

  it('the well-formedness check itself rejects what it must', () => {
    expect(isWellFormed('<svg><title>a</title></svg>')).toBe(true)
    expect(isWellFormed('<svg></svg><svg></svg>')).toBe(false)
    expect(isWellFormed('<svg>a]]>b</svg>')).toBe(false)
    expect(isWellFormed('<svg>a\u0001b</svg>')).toBe(false)
    expect(isWellFormed('<svg><g a="1" a="2"/></svg>')).toBe(false)
    expect(isWellFormed('<svg>&bad</svg>')).toBe(false)
    expect(isWellFormed('<svg><g></svg>')).toBe(false)
    expect(isWellFormed('')).toBe(false)
    expect(isWellFormed('<svg></svg a="1">')).toBe(false)
    expect(isWellFormed('<svg></svg/>')).toBe(false)
    expect(isWellFormed('<svg a="x\u0001"></svg>')).toBe(false)
    expect(isWellFormed('<svg 1a="x"/>')).toBe(false)
    expect(isWellFormed('<svg\u000ba="x"/>')).toBe(false)
    expect(isWellFormed('<svg a="]]>">&#65;&#x41;</svg>')).toBe(true)
  })

  it('leaves the terminal default background transparent and fills a coloured one, and gives the default foreground a real colour', () => {
    const grid = new Grid(4, 1)

    grid.set(0, 0, 'a')
    grid.set(1, 0, ' ', DEFAULT, 0x123456)
    grid.set(2, 0, ' ', DEFAULT, 0x123456)
    const svg = svgOf(grid)

    expect(svg).toContain(`<path fill="#123456" d="M${CELL_W} 0h${2 * CELL_W}v${CELL_H}h${-2 * CELL_W}z"/>`)
    expect(svg).toContain('fill="#8b949e"')
    expect(svg).not.toContain('16777216')
  })

  it('escapes hostile text and the title, and drops what XML cannot hold', () => {
    const grid = new Grid(40, 1)

    grid.text(0, 0, '<script>&"\'</script>\u0001\u001b', 0xffffff)
    grid.set(30, 0, 0xd800, 0xffffff)
    grid.set(31, 0, 0xfffe, 0xffffff)
    // A Grid holds any u32; one past Unicode must not throw inside a render hook.
    grid.set(32, 0, 0x110000, 0xffffff)
    grid.set(33, 0, 0xffffffff, 0xffffff)
    const svg = svgOf(grid, 'a <b> & "c"')

    expect(svg).not.toMatch(/<script/i)
    expect(svg).toContain('&lt;script&gt;&amp;&quot;&apos;&lt;/script&gt;')
    expect(svg).toContain('<title>a &lt;b&gt; &amp; &quot;c&quot;</title>')
    expect(svg).not.toMatch(/[\u0001\u001b￾]/)
    expect(isWellFormed(svg)).toBe(true)
    expect(escapeXml('ok\u0000\ud800x')).toBe('okx')
  })

  it('sizes the document to the grid: columns by rows of cells', () => {
    const svg = svgOf(new Grid(12, 3))

    expect(svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" width="${12 * CELL_W}" height="${3 * CELL_H}" viewBox="0 0 ${12 * CELL_W} ${3 * CELL_H}" role="img">`)).toBe(true)
  })

  it('returns null rather than a document past the limit, and never passes the host limit', () => {
    const grid = new Grid(200, 80)

    for (let y = 0; y < 80; y++) for (let x = 0; x < 200; x++) grid.set(x, y, x % 2 === 0 ? 'x' : 0x28ff, (x * 7919 + y * 104729) & 0xffffff, (x * 31 + y) & 0xffffff)

    expect(gridToSvg(grid, 'busy')).toBeNull()
    expect(gridToSvg(new Grid(4, 1), 'tiny', 50)).toBeNull()

    const small = new Grid(60, 20)

    small.text(0, 0, 'header', 0xffffff)
    expect((gridToSvg(small, 'ok') as string).length).toBeLessThanOrEqual(SVG_SOURCE_MAX)
  })
})

describe('kitForSurface', () => {
  const element = (type: string) => (() => ({ type })) as never
  const table = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Raster: element('Raster'), Svg: element('Svg'), Input: element('Input') } as Kit

  it('gives the terminal its Raster and no Svg', () => {
    const kit = kitForSurface(table, 'terminal')

    expect(kit.Raster).toBeDefined()
    expect(kit.Svg).toBeUndefined()
    expect(kit.Input).toBeDefined()
  })

  // A Claude Code that does not name its surface is older than the desktop pictures: it is the terminal, which keeps drawing its Rasters.
  it.each([undefined, '', null])('treats a host that names no surface (%s) as the terminal', surface => {
    const kit = kitForSurface(table, surface as never)

    expect(kit.Raster).toBeDefined()
    expect(kit.Svg).toBeUndefined()
  })

  it.each(['desktop', 'vscode', 'mobile'])('gives %s an Svg and no Raster (its Raster draws a fragment)', surface => {
    const kit = kitForSurface(table, surface)

    expect(kit.Raster).toBeUndefined()
    expect(kit.Svg).toBeDefined()
    expect(kit.Box).toBe(table.Box)
  })

  it('adds nothing a table lacks', () => {
    const { Svg: _svg, ...noSvg } = table

    expect(kitForSurface(noSvg as Kit, 'desktop').Svg).toBeUndefined()
    expect('Svg' in kitForSurface(noSvg as Kit, 'desktop')).toBe(false)
  })
})

/** A host that records blits, redraws and the frame timer, and answers everything else with nothing. */
function frameHost() {
  const calls = { blits: [] as string[], invalidates: 0, timers: [] as (() => void)[] }
  const host = new Proxy({}, {
    get: (_target, key) => {
      if (key === 'blit') return (args: { key: string }) => void calls.blits.push(args.key)
      if (key === 'invalidate') return () => void (calls.invalidates += 1)
      if (key === 'every') return (_ms: number, fn: () => void) => (calls.timers.push(fn), { cancel: () => undefined })
      if (key === 'after') return () => ({ cancel: () => undefined })
      if (key === 'pluginRoot') return '/plugin'
      if (key === 'fs') return { read: async () => Promise.reject(new Error('ENOENT')), stat: async () => Promise.reject(new Error('ENOENT')), list: async () => Promise.reject(new Error('ENOENT')) }

      return () => Promise.resolve(undefined)
    },
  }) as unknown as Host

  return { host, calls }
}

/** The timers `act` registered: animate() adds the frame loop's, and creating the controller adds others before it. */
function framesOf(calls: { timers: (() => void)[] }, act: () => void): (() => void)[] {
  const before = calls.timers.length

  act()

  return calls.timers.slice(before)
}

function shownState(view: 'swarm' | 'menu') {
  const state = newState({ boot: false })

  state.view = view
  Object.assign(state.pane, { isOpen: true, isShown: true, isFocused: true, columns: 110, rows: 60 })

  return state
}

describe('still pictures for a surface that draws Svg', () => {
  it.each(['bbs', 'orbital'] as const)('are the frames fps 0 draws, not a header caught mid strike-in (%s)', look => {
    const state = newState({ boot: false, look })
    const now = Date.now()

    state.view = 'menu'
    Object.assign(state.pane, { isOpen: true, isShown: true, isFocused: true, columns: 110, rows: 60, viewAtMs: now })
    const still = picturesOf(state, 110, now, now, true)
    const moving = picturesOf(state, 110, now, now)

    expect(still.get('header')?.encode()).toBeDefined()
    expect(moving.get('header')?.encode()).not.toBe(still.get('header')?.encode())
  })

  it.each(['bbs', 'plain', 'orbital'] as const)('on every page the light is off and the motion stopped: header, title and palette are the same at any moment, and the rest is what fps 0 draws (%s)', look => {
    const state = newState({ boot: false, look })
    const now = Date.now()

    Object.assign(state.pane, { isOpen: true, isShown: true, isFocused: true, columns: 110, rows: 60, viewAtMs: now - 50 })

    for (const view of VIEWS.map(entry => entry.id)) {
      state.view = view
      const still = picturesOf(state, 110, now, now, true)
      const later = picturesOf(state, 110, now, now + 7_777, true)
      const fps0 = picturesOf({ ...state, options: { ...state.options, fps: 0 } }, 110, now, now)

      expect([...still.keys()], `${look} ${view}`).toEqual([...fps0.keys()])
      for (const [key, grid] of still) {
        // The decorative pictures do not depend on the moment; with fps 0 their light still moves with t, so only the rest equals fps 0's.
        if (key === 'header' || key === 'title' || key === 'palette') expect(grid.encode(), `${look} ${view} ${key} at two moments`).toBe(later.get(key)?.encode())
        else expect(grid.encode(), `${look} ${view} ${key}`).toBe(fps0.get(key)?.encode())
      }
    }
  })

  it('leaves the terminal its moving light, with fps 0 too: still=false keeps t', () => {
    const state = newState({ boot: false, look: 'bbs', fps: 0 })
    const now = Date.now()

    state.view = 'menu'
    Object.assign(state.pane, { isOpen: true, isShown: true, isFocused: true, columns: 110, rows: 60 })
    expect(picturesOf(state, 110, now, 300).get('header')?.encode()).not.toBe(picturesOf(state, 110, now, 900).get('header')?.encode())
  })
})

describe('the frame loop by surface', () => {
  it('on a surface that draws Svg the loop still runs for the pictures, but blits nothing and rebuilds nothing', () => {
    const state = shownState('swarm')
    const { host, calls } = frameHost()
    const control = createController(state, host)

    state.pictured = 3
    state.mounted = new Map()
    const frames = framesOf(calls, () => control.animate())

    expect(frames).toHaveLength(1)
    built.count = 0
    frames[0]?.()
    expect(calls.blits).toHaveLength(0)
    expect(built.count).toBe(0)
  })

  it('on the terminal it blits every mounted Raster at its mounted size', () => {
    const state = shownState('swarm')
    const { host, calls } = frameHost()
    const control = createController(state, host)
    const pictures = picturesOf(state, state.pane.columns, Date.now(), Date.now())

    state.pictured = pictures.size
    state.mounted = new Map([...pictures].map(([key, grid]) => [key, { columns: grid.columns, rows: grid.rows }]))
    framesOf(calls, () => control.animate())[0]?.()
    expect(pictures.size).toBeGreaterThan(0)
    expect(new Set(calls.blits)).toEqual(new Set(pictures.keys()))
  })

  it('with no picture and nothing moving the loop does not run', () => {
    const state = shownState('swarm')
    const { host, calls } = frameHost()

    state.pictured = 0
    const control = createController(state, host)

    expect(framesOf(calls, () => control.animate())).toHaveLength(0)
  })

  it("the menu's entry still redraws frame by frame on a surface that draws Svg", () => {
    const state = newState({ boot: true, look: 'bbs' })
    const { host, calls } = frameHost()
    const control = createController(state, host)

    state.view = 'menu'
    Object.assign(state.pane, { isOpen: true, isShown: true, isFocused: true, columns: 110, rows: 60, bootAtMs: Date.now() - 60_000, menuAtMs: Date.now() })
    state.pictured = 2
    const frames = framesOf(calls, () => control.animate())

    expect(frames).toHaveLength(1)
    frames[0]?.()
    expect(calls.invalidates).toBeGreaterThan(0)
    expect(calls.blits).toHaveLength(0)
  })
})
