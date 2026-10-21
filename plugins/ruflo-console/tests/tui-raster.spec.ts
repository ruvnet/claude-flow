/**
 * The standalone terminal draws the console's pictures (ADR-489 phase 4): a Raster is the Grid's cells (`Grid.toRaster`) drawn as coloured
 * glyphs. Whatever is in the cells is data, never a command: a code point that is a control, an escape, an invisible or a wide character
 * becomes a space, and a `cells` string that is not exactly the declared size draws nothing. Run with
 *   npx vitest run plugins/ruflo-console/tests/tui-raster.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { Grid, DEFAULT, toBase64 } from '../hooks/gfx/raster'
import { render, terminalKit, widthOf } from '../tui/ansi'

const kit = terminalKit({ raster: true })
const draw = (grid: Grid, width: number, depth: 'none' | '256' | 'truecolor') => render(kit.Raster?.(grid.toRaster('t')), width, depth)
const OURS = /^\u001b\[[0-9;]*m$/
const escapes = (lines: string[]) => lines.join('\n').match(/\u001b[^m]*m?|\u009b/g) ?? []

describe('a Raster in the terminal kit', () => {
  it('is offered only when asked for: a kit without it makes the views fall back to words', () => {
    expect(terminalKit().Raster).toBeUndefined()
    expect(terminalKit({ raster: true }).Raster).toBeDefined()
  })

  it('draws the Grid cell for cell, with 24-bit colour in truecolor and the nearest of the 256 otherwise', () => {
    const grid = new Grid(3, 2)

    grid.set(0, 0, '█', 0xff0000, 0x000000)
    grid.set(1, 0, '▀', 0x00ff00)
    grid.set(2, 0, 'x')
    grid.set(0, 1, '░', 0x808080)

    const rich = draw(grid, 10, 'truecolor')
    const some = draw(grid, 10, '256')

    expect(rich).toHaveLength(2)
    expect(rich[0]).toContain('38;2;255;0;0;48;2;0;0;0')
    expect(rich[0]).toContain('38;2;0;255;0')
    expect(rich[1]).toContain('38;2;128;128;128')
    expect(some[0]).toContain('38;5;196')
    expect(some[1]).toMatch(/38;5;(244|102|8)/)
    expect(rich.map(widthOf)).toEqual([3, 3])
    // No style is left open at a row's end: the last sequence in a row is a reset (or the row has none).
    expect(rich.every(line => (line.match(/\u001b\[[0-9;]*m/g)?.at(-1) ?? '\u001b[0m') === '\u001b[0m' || /\u001b\[0m[^\u001b]*$/.test(line))).toBe(true)
  })

  it('draws no colour at all when there is none, and never more than the width it was given', () => {
    const grid = new Grid(40, 1)

    for (let x = 0; x < 40; x++) grid.set(x, 0, '█', 0x336699)

    expect(draw(grid, 40, 'none')[0]).toBe('█'.repeat(40))
    expect(draw(grid, 12, 'truecolor').map(widthOf)).toEqual([12])
  })

  it('turns a control, an escape, an invisible, a surrogate or a wide character into a space', () => {
    const grid = new Grid(8, 1)

    for (const [x, code] of [0x1b, 0x07, 0x202e, 0x200b, 0xd800, 0x4e2d, 0x1f600, 0x9b].entries()) grid.set(x, 0, code, 0xffffff)

    const line = draw(grid, 20, 'none')[0] as string

    expect(line).toBe(' '.repeat(8))
    expect(escapes(draw(grid, 20, 'truecolor')).every(seq => OURS.test(seq))).toBe(true)
  })

  it('withholds a secret that a picture was made to spell, cell by cell', () => {
    const grid = new Grid(1, 1)

    grid.set(0, 0, 'g')

    expect(draw(grid, 5, 'none')[0]).toBe('g')
  })

  it('draws nothing for cells that are not exactly the declared size, not base64, or too many', () => {
    const grid = new Grid(4, 2)
    const good = grid.toRaster('t')

    for (const bad of [
      { ...good, cells: good.cells.slice(4) },
      { ...good, cells: `${good.cells.slice(0, -4)}!!!!` },
      { ...good, columns: 5 },
      { ...good, columns: 0 },
      { ...good, rows: -1 },
      { ...good, columns: 1e9, rows: 1e9, cells: 'AAAA' },
      { ...good, cells: undefined },
      { ...good, columns: 1.5 },
    ]) expect(render(kit.Raster?.(bad as never), 40, 'truecolor')).toEqual([])
  })

  it('keeps the terminal default colour as no colour, so a theme with no background stays the terminal\'s', () => {
    const grid = new Grid(2, 1)

    grid.set(0, 0, 'a', DEFAULT, DEFAULT)
    grid.set(1, 0, 'b', 0x123456, DEFAULT)

    const line = draw(grid, 5, 'truecolor')[0] as string

    expect(line.startsWith('a')).toBe(true)
    expect(line).toContain('38;2;18;52;86')
    expect(line).not.toContain('48;')
  })

  it('decodes the base64 the Grid encodes (u32 little endian triplets), padding included', () => {
    const grid = new Grid(5, 3)

    grid.set(4, 2, '#', 0x010203, 0x040506)
    expect(toBase64(new Uint8Array([1, 2, 3, 4]))).toBe('AQIDBA==')
    expect(draw(grid, 9, 'truecolor')[2]).toContain('38;2;1;2;3;48;2;4;5;6')
  })
})
