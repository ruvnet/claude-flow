/**
 * Cell graphics for the terminal's `Raster` element: a grid of glyphs with 24-bit colours, packed as base64 of
 * little-endian u32 triplets `[codePoint, fg, bg]`, row-major. Pure: no `$`, no Node (base64 is encoded by hand).
 */

/** The terminal's own colour, foreground or background. */
export const DEFAULT = 0x01000000

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0

  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number)

    out += (B64[(n >> 18) & 63] as string) + (B64[(n >> 12) & 63] as string) + (B64[(n >> 6) & 63] as string) + (B64[n & 63] as string)
  }

  if (bytes.length - i === 1) {
    const n = (bytes[i] as number) << 16

    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`
  } else if (bytes.length - i === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8)

    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`
  }

  return out
}

export class Grid {
  readonly cells: Uint32Array

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.cells = new Uint32Array(Math.max(1, columns * rows) * 3)

    for (let i = 0; i < columns * rows; i++) {
      this.cells[i * 3] = 0x20
      this.cells[i * 3 + 1] = DEFAULT
      this.cells[i * 3 + 2] = DEFAULT
    }
  }

  set(x: number, y: number, ch: number | string, fg = DEFAULT, bg?: number): void {
    const cx = Math.floor(x)
    const cy = Math.floor(y)

    if (cx < 0 || cy < 0 || cx >= this.columns || cy >= this.rows) {
      return
    }

    const at = (cy * this.columns + cx) * 3

    this.cells[at] = typeof ch === 'number' ? ch : (ch.codePointAt(0) ?? 0x20)
    this.cells[at + 1] = fg >>> 0

    if (bg !== undefined) {
      this.cells[at + 2] = bg >>> 0
    }
  }

  glyph(x: number, y: number): number {
    return x < 0 || y < 0 || x >= this.columns || y >= this.rows ? 0x20 : (this.cells[(y * this.columns + x) * 3] as number)
  }

  /** Writes text left to right, clipped at the grid's edge. */
  text(x: number, y: number, text: string, fg = DEFAULT, bg?: number): void {
    let cx = x

    for (const ch of text) {
      this.set(cx, y, ch, fg, bg)
      cx += 1
    }
  }

  toRaster(key: string): { key: string; columns: number; rows: number; cells: string } {
    return { key, columns: this.columns, rows: this.rows, cells: this.encode() }
  }

  encode(): string {
    return toBase64(new Uint8Array(this.cells.buffer, this.cells.byteOffset, this.cells.byteLength))
  }
}

/** Linear blend of two 0xRRGGBB colours, `t` in 0..1. */
export function mix(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t))
  const channel = (shift: number) => Math.round(((a >> shift) & 255) * (1 - k) + ((b >> shift) & 255) * k)

  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/** A perceptual ramp for dark and light themes alike: indigo, cyan, emerald, amber. */
const RAMP = [0x3b3f9e, 0x2fa4c9, 0x2bb673, 0xe0a526] as const

export function ramp(t: number): number {
  const k = Math.max(0, Math.min(1, t)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(k))

  return mix(RAMP[i] as number, RAMP[i + 1] as number, k - i)
}

export const COLOR = {
  accent: 0x8b7cf6,
  ok: 0x2bb673,
  warn: 0xe0a526,
  bad: 0xe5534b,
  info: 0x2fa4c9,
  dim: 0x6b7280,
  line: 0x4b5563,
} as const

const BARS = ' ▁▂▃▄▅▆▇█'

/** A one-row bar sparkline of `values` (newest right), scaled to its own max; an empty series draws the baseline. */
export function sparkline(grid: Grid, x: number, y: number, width: number, values: readonly number[], color: (t: number) => number): void {
  const shown = values.slice(-width)
  const max = Math.max(1, ...shown)
  const offset = width - shown.length

  for (let i = 0; i < width; i++) {
    const value = i < offset ? 0 : (shown[i - offset] ?? 0)
    const level = value <= 0 ? 0 : Math.max(1, Math.round((value / max) * 8))

    grid.set(x + i, y, level === 0 ? '▁' : (BARS[level] as string), level === 0 ? COLOR.line : color(value / max))
  }
}

/** A canvas of braille dots over a grid region: each cell is 2 dots wide and 4 high. */
export class Braille {
  readonly bits: Uint8Array
  readonly colors: Uint32Array

  constructor(
    readonly columns: number,
    readonly rows: number,
  ) {
    this.bits = new Uint8Array(columns * rows)
    this.colors = new Uint32Array(columns * rows)
  }

  get width(): number {
    return this.columns * 2
  }

  get height(): number {
    return this.rows * 4
  }

  dot(px: number, py: number, color: number): void {
    const x = Math.round(px)
    const y = Math.round(py)

    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return
    }

    const cell = Math.floor(y / 4) * this.columns + Math.floor(x / 2)
    const dx = x % 2
    const dy = y % 4
    const bit = dy < 3 ? (dx === 0 ? [0x01, 0x02, 0x04][dy] : [0x08, 0x10, 0x20][dy]) : dx === 0 ? 0x40 : 0x80

    this.bits[cell] = (this.bits[cell] as number) | (bit as number)
    this.colors[cell] = color
  }

  line(x0: number, y0: number, x1: number, y1: number, color: number): void {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))))

    for (let i = 0; i <= steps; i++) {
      this.dot(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, color)
    }
  }

  /** Paints the dots into `grid` at (x, y); cells with no dot are left as they are. */
  blitInto(grid: Grid, x: number, y: number): void {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.columns; col++) {
        const i = row * this.columns + col
        const bits = this.bits[i] as number

        if (bits !== 0) {
          grid.set(x + col, y + row, 0x2800 + bits, this.colors[i] as number)
        }
      }
    }
  }
}
