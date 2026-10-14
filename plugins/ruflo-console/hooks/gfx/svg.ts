/**
 * Cell graphics for the surfaces that draw vectors (Claude Code Desktop, the editor, the mobile app): the same `Grid` the terminal gets as a
 * `Raster`, written as one SVG document. Block and braille glyphs become rectangles, so they line up whatever font the surface has; other
 * glyphs are placed one by one on the cell grid, so a proportional fallback font cannot drift them. Pure: no `$`, no Node.
 */
import { DEFAULT, type Grid } from './raster'

/** The host's limit on an `Svg` element's `source`; a longer one makes the whole tree invalid, so the picture is dropped instead. */
export const SVG_SOURCE_MAX = 131_072
/** One cell in SVG user units: the width of a monospace glyph and a line of text at 13 px. */
export const CELL_W = 8
export const CELL_H = 16
/** The terminal's own foreground has no value outside a terminal: a grey that reads on a light and on a dark page. */
const DEFAULT_FG = '#8b949e'
const FONT = 'font-family="SFMono-Regular, Menlo, Consolas, DejaVu Sans Mono, monospace" font-size="13"'

/** A rectangle as fractions of a cell: [x, y, width, height]. */
type Rect = readonly [number, number, number, number]

const UL: Rect = [0, 0, 0.5, 0.5]
const UR: Rect = [0.5, 0, 0.5, 0.5]
const LL: Rect = [0, 0.5, 0.5, 0.5]
const LR: Rect = [0.5, 0.5, 0.5, 0.5]

/**
 * Every Block Elements glyph (U+2580 to U+259F) as the rectangles it fills and their opacity: eighths from the bottom and from the left,
 * the halves, the upper and right eighths, the shades, and the quadrants.
 */
const SHAPES = new Map<number, { rects: readonly Rect[]; opacity: number }>([
  [0x2580, { rects: [[0, 0, 1, 0.5]], opacity: 1 }], // ▀
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => [0x2580 + n, { rects: [[0, 1 - n / 8, 1, n / 8]] as Rect[], opacity: 1 }] as const), // ▁▂▃▄▅▆▇█
  ...[7, 6, 5, 4, 3, 2, 1].map((n, i) => [0x2589 + i, { rects: [[0, 0, n / 8, 1]] as Rect[], opacity: 1 }] as const), // ▉▊▋▌▍▎▏
  [0x2590, { rects: [[0.5, 0, 0.5, 1]], opacity: 1 }], // ▐
  [0x2591, { rects: [[0, 0, 1, 1]], opacity: 0.25 }], // ░
  [0x2592, { rects: [[0, 0, 1, 1]], opacity: 0.5 }], // ▒
  [0x2593, { rects: [[0, 0, 1, 1]], opacity: 0.75 }], // ▓
  [0x2594, { rects: [[0, 0, 1, 1 / 8]], opacity: 1 }], // ▔
  [0x2595, { rects: [[7 / 8, 0, 1 / 8, 1]], opacity: 1 }], // ▕
  [0x2596, { rects: [LL], opacity: 1 }], // ▖
  [0x2597, { rects: [LR], opacity: 1 }], // ▗
  [0x2598, { rects: [UL], opacity: 1 }], // ▘
  [0x2599, { rects: [UL, LL, LR], opacity: 1 }], // ▙
  [0x259a, { rects: [UL, LR], opacity: 1 }], // ▚
  [0x259b, { rects: [UL, UR, LL], opacity: 1 }], // ▛
  [0x259c, { rects: [UL, UR, LR], opacity: 1 }], // ▜
  [0x259d, { rects: [UR], opacity: 1 }], // ▝
  [0x259e, { rects: [UR, LL], opacity: 1 }], // ▞
  [0x259f, { rects: [UR, LL, LR], opacity: 1 }], // ▟
])

/** Braille dot bit → [column, row] in the 2×4 dot cell. */
const DOTS: readonly (readonly [number, number])[] = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3]]

const hex = (color: number): string => `#${(color & 0xffffff).toString(16).padStart(6, '0')}`
const fgOf = (color: number): string => (color === DEFAULT ? DEFAULT_FG : hex(color))
const n = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, ''))

/** Escapes text for an element body or an attribute; drops the code points XML 1.0 cannot hold at all. */
export function escapeXml(text: string): string {
  let out = ''

  for (const ch of text) {
    const cp = ch.codePointAt(0) as number

    if ((cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff) continue
    out += ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : ch === "'" ? '&apos;' : ch
  }

  return out
}

/** Paths keyed by fill colour and opacity, each a run of `M x y h w v h h -w z` rectangles: one element per colour, not one per cell. */
class Fills {
  private readonly paths = new Map<string, string[]>()

  rect(fill: string, opacity: number, x: number, y: number, w: number, h: number): void {
    const key = opacity === 1 ? fill : `${fill}|${opacity}`
    const list = this.paths.get(key) ?? []

    list.push(`M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`)
    this.paths.set(key, list)
  }

  toSvg(): string {
    return [...this.paths].map(([key, list]) => {
      const [fill, opacity] = key.split('|')

      return `<path fill="${fill}"${opacity === undefined ? '' : ` fill-opacity="${opacity}"`} d="${list.join('')}"/>`
    }).join('')
  }
}

/**
 * The grid as an SVG document, or null when it would pass `max` characters (the caller then says it in words). `alt` is its title.
 * Drawn `CELL_W`×`CELL_H` per cell; the default background is left transparent, so the page shows through as it does in a terminal.
 */
export function gridToSvg(grid: Grid, alt: string, max = SVG_SOURCE_MAX): string | null {
  const back = new Fills()
  const fore = new Fills()
  const texts: string[] = []
  let size = 0

  for (let y = 0; y < grid.rows; y++) {
    // Backgrounds: one rectangle per run of a colour along the row.
    for (let x = 0; x < grid.columns; ) {
      const bg = grid.cells[(y * grid.columns + x) * 3 + 2] as number
      let end = x + 1

      while (end < grid.columns && grid.cells[(y * grid.columns + end) * 3 + 2] === bg) end++
      if (bg !== DEFAULT) {
        back.rect(hex(bg), 1, x * CELL_W, y * CELL_H, (end - x) * CELL_W, CELL_H)
        size += 28
      }
      x = end
    }

    // Foregrounds: shapes as rectangles (a run of the same shape and colour merged), the rest as text placed cell by cell.
    let run: { fg: string; xs: number[]; text: string } | null = null
    const flush = () => {
      if (run === null) return
      const element = `<text ${FONT} fill="${run.fg}" x="${run.xs.join(' ')}" y="${y * CELL_H + 12}" xml:space="preserve">${run.text}</text>`

      texts.push(element)
      size += element.length
      run = null
    }

    for (let x = 0; x < grid.columns; x++) {
      const at = (y * grid.columns + x) * 3
      const cp = grid.cells[at] as number
      const fg = fgOf(grid.cells[at + 1] as number)
      const shape = SHAPES.get(cp)

      if (shape !== undefined) {
        flush()
        let end = x + 1

        while (end < grid.columns && grid.cells[(y * grid.columns + end) * 3] === cp && fgOf(grid.cells[(y * grid.columns + end) * 3 + 1] as number) === fg) end++

        const [only] = shape.rects

        // A full-width shape repeated along the row is one rectangle; any other (▌, ▕, a quadrant) leaves gaps, so each cell is its own.
        if (shape.rects.length === 1 && only !== undefined && only[0] === 0 && only[2] === 1) {
          fore.rect(fg, shape.opacity, x * CELL_W, (y + only[1]) * CELL_H, (end - x) * CELL_W, only[3] * CELL_H)
          size += 28
        } else {
          for (let k = x; k < end; k++) for (const [sx, sy, sw, sh] of shape.rects) fore.rect(fg, shape.opacity, (k + sx) * CELL_W, (y + sy) * CELL_H, sw * CELL_W, sh * CELL_H)
          size += 28 * shape.rects.length * (end - x)
        }
        x = end - 1
      } else if (cp >= 0x2800 && cp <= 0x28ff) {
        flush()
        DOTS.forEach(([col, row], bit) => {
          if (((cp - 0x2800) >> bit) & 1) {
            fore.rect(fg, 1, x * CELL_W + col * 4 + 1, y * CELL_H + row * 4 + 1, 2, 2)
            size += 20
          }
        })
      } else {
        // A control character (XML would turn a CR or a TAB into something else), a value past Unicode (a Grid holds any u32, and
        // String.fromCodePoint would throw) or one XML cannot hold is a blank cell, decided per cell so every later glyph keeps its column.
        const glyph = cp <= 0x20 || (cp >= 0x7f && cp <= 0x9f) || cp === 0xfe0f || cp === 0xfe0e || cp > 0x10ffff ? '' : escapeXml(String.fromCodePoint(cp))

        if (glyph === '') flush()
        else if (run !== null && run.fg === fg) {
          run.text += glyph
          run.xs.push(x * CELL_W)
        } else {
          flush()
          run = { fg, xs: [x * CELL_W], text: glyph }
        }
      }

      if (size > max) return null
    }

    flush()
  }

  const width = grid.columns * CELL_W
  const height = grid.rows * CELL_H
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escapeXml(alt)}</title>${back.toSvg()}${fore.toSvg()}${texts.join('')}</svg>`

  return svg.length > max ? null : svg
}
