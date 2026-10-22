/**
 * The RuFlo neon sign (ruflo/assets/ruflo-small.jpeg) in terminal cells: a pink rounded frame hung on clips and wires,
 * yellow tube lettering, a cyan circle of waves, on a dim brick wall. The tubes are line characters; the glow is the
 * cells' background, mixed toward each tube's colour by distance, so the light spills onto the wall as in the photo.
 * Animated (the boot), the tubes strike one after another with a stutter, then hum, with now and then a buzz; still
 * (the main menu), the sign is simply lit.
 */
import { Grid, mix } from './raster'

/** Light adds: the wall keeps its colour and the tube's light is laid over it, so a halo stays saturated, not muddy. */
function add(base: number, light: number, k: number): number {
  const channel = (shift: number) => Math.min(255, Math.round(((base >> shift) & 255) + ((light >> shift) & 255) * k))

  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/** Tube colours on the xterm-256 cube, so the sign reads the same where Claude Code draws in 256 colours: the lit
 * tube (a cell's background) and its white-hot core (the line drawn on it). */
const PINK = 0xd7005f
const YELLOW = 0xd7af00
const CYAN = 0x00afd7
const CORE: Record<number, number> = { [PINK]: 0xffafd7, [YELLOW]: 0xffff87, [CYAN]: 0xafffff }
const UNLIT = 0x3b3440
const CLIP = 0x26262c
const WIRE = 0x15151a

/** The lettering, five rows, one string per row; lower case sits on rows 1-4. */
const GLYPHS: Record<string, readonly string[]> = {
  R: ['╭───╮', '│   │', '├──┬╯', '│  ╰╮', '╵   ╰'],
  u: ['     ', '╷   ╷', '│   │', '│   │', '╰───╯'],
  f: [' ╭─╴', ' │  ', '╶┼─╴', ' │  ', ' ╵  '],
  l: ['╷ ', '│ ', '│ ', '│ ', '╰╴'],
  o: ['     ', '╭───╮', '│   │', '│   │', '╰───╯'],
}
const BADGE = ['╭───────╮', '│ ~~~~~ │', '│ ~~~~~ │', '│ ~~~~~ │', '╰───────╯'] as const

type Cell = { x: number; y: number; ch: string; tube: number }
type Tube = { color: number; strikeMs: number; seed: number }

/** The sign's cells in its own coordinates, built once: where each tube character sits and which tube it belongs to. */
function build(): { width: number; height: number; cells: Cell[]; tubes: Tube[]; clips: number[]; inner: { x0: number; x1: number; y0: number; y1: number } } {
  const word = 'Ruflo'
  const tubes: Tube[] = [{ color: PINK, strikeMs: 0, seed: 1 }]
  const cells: Cell[] = []
  const pad = 3
  let x = 1 + pad

  ;[...word].forEach((letter, i) => {
    const glyph = GLYPHS[letter] ?? []
    const tube = tubes.push({ color: YELLOW, strikeMs: 420 + i * 170, seed: 11 + i }) - 1

    glyph.forEach((line, row) => [...line].forEach((ch, col) => ch !== ' ' && cells.push({ x: x + col, y: 3 + row, ch, tube })))
    x += (glyph[0]?.length ?? 0) + 1
  })

  const badge = tubes.push({ color: CYAN, strikeMs: 420 + word.length * 170 + 160, seed: 41 }) - 1

  x += 1
  BADGE.forEach((line, row) => [...line].forEach((ch, col) => ch !== ' ' && cells.push({ x: x + col, y: 3 + row, ch, tube: badge })))
  x += BADGE[0].length + pad

  const width = x + 1
  const height = 11

  // The frame: a rounded rectangle on rows 1 and 9, with three clips on each long side and the wires they hang from.
  for (let cx = 1; cx < width - 1; cx++) {
    cells.push({ x: cx, y: 1, ch: '─', tube: 0 }, { x: cx, y: 9, ch: '─', tube: 0 })
  }
  for (let cy = 2; cy < 9; cy++) cells.push({ x: 0, y: cy, ch: '│', tube: 0 }, { x: width - 1, y: cy, ch: '│', tube: 0 })
  cells.push({ x: 0, y: 1, ch: '╭', tube: 0 }, { x: width - 1, y: 1, ch: '╮', tube: 0 }, { x: 0, y: 9, ch: '╰', tube: 0 }, { x: width - 1, y: 9, ch: '╯', tube: 0 })

  return { width, height, cells, tubes, clips: [4, Math.floor(width / 2) - 1, width - 6], inner: { x0: 1, x1: width - 2, y0: 2, y1: 8 } }
}

const SIGN = build()
export const NEON_COLUMNS = SIGN.width
export const NEON_ROWS = SIGN.height

/** For each cell of the sign's box, the tubes within reach and how much of each one's light lands there. */
const GLOW: Map<number, { tube: number; w: number }[]> = (() => {
  const reach = 2
  const out = new Map<number, { tube: number; w: number }[]>()

  for (const cell of SIGN.cells) {
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach * 2; dx <= reach * 2; dx++) {
        // Cells are twice as tall as wide: a horizontal step counts half.
        const d = Math.hypot(dx / 2, dy)

        if (d > reach) continue

        const key = (cell.y + dy) * 4096 + (cell.x + dx)
        const list = out.get(key) ?? []
        // A halo, not a flood: each tube lights a cell by its nearest stretch only, falling off fast.
        const w = 0.32 * (1 - d / (reach + 0.5)) ** 2
        const same = list.find(entry => entry.tube === cell.tube)

        if (same !== undefined) same.w = Math.max(same.w, w)
        else list.push({ tube: cell.tube, w })
        out.set(key, list)
      }
    }
  }

  return out
})()

const hash = (a: number, b: number): number => (Math.imul(a, 73_856_093) ^ Math.imul(b, 19_349_663)) >>> 0

/** How brightly a tube burns at `age` ms: dark before its strike, a stutter as it catches, then a hum and rare buzz. */
function power(tube: Tube, age: number, isAnimated: boolean): number {
  if (!isAnimated) return 1
  if (age < tube.strikeMs) return 0

  const since = age - tube.strikeMs

  if (since < 380) return hash(Math.floor(since / 45), tube.seed) % 3 === 0 ? 0.12 : 0.55 + since / 900
  if (hash(Math.floor(age / 90), tube.seed) % 53 === 0) return 0.35

  return 0.9 + 0.1 * Math.sin(age / 210 + tube.seed)
}

const NOISE = '#%@$&*+=?!/\\<>[]{}01'

/**
 * Now and then, once the sign is lit, a glitch: for ~110 ms one row slips one or two cells sideways and a few of its
 * cells flash to random letters, the way a bad line garbles an ANSI screen.
 */
function glitch(grid: Grid, age: number): void {
  const slot = Math.floor(age / 110)

  if (age < 1_600 || hash(slot, 97) % 11 !== 0) return

  const y = 1 + (hash(slot, 3) % (grid.rows - 2))
  const shift = hash(slot, 5) % 2 === 0 ? 1 + (hash(slot, 9) % 2) : -1 - (hash(slot, 9) % 2)
  const row = grid.cells.slice(y * grid.columns * 3, (y + 1) * grid.columns * 3)

  for (let x = 0; x < grid.columns; x++) {
    const from = Math.min(grid.columns - 1, Math.max(0, x - shift))
    const at = (y * grid.columns + x) * 3

    grid.cells[at] = row[from * 3] ?? 0x20
    grid.cells[at + 1] = row[from * 3 + 1] ?? 0
    grid.cells[at + 2] = row[from * 3 + 2] ?? 0
    if (hash(x, slot) % 9 === 0 && grid.cells[at] !== 0x20) grid.cells[at] = NOISE.codePointAt(hash(slot, x) % NOISE.length) ?? 0x23
  }
}

/** The wall behind the sign: bricks a row tall in a running bond, teal on the left warming to rose on the right. */
function wall(x: number, y: number, columns: number): number {
  const base = mix(0x0f2f38, 0x3a1230, x / Math.max(1, columns - 1))
  const brick = Math.floor((x + (y % 2) * 3) / 6)
  const isSeam = (x + (y % 2) * 3) % 6 === 0

  return isSeam ? mix(base, 0x000000, 0.22) : mix(base, 0x4a2a38, (hash(brick, y) % 100) / 500)
}

/**
 * The sign centred in `columns`, `age` ms after it was switched on. `isAnimated` false draws it fully lit and still
 * (the main menu: motion there must mean data). Narrower than the sign, it is clipped at the right.
 */
export function neonPicture(columns: number, age: number, isAnimated: boolean): Grid {
  const grid = new Grid(columns, NEON_ROWS)
  const left = Math.max(0, Math.floor((columns - SIGN.width) / 2))
  const levels = SIGN.tubes.map(tube => power(tube, age, isAnimated))

  for (let y = 0; y < NEON_ROWS; y++) {
    for (let gx = 0; gx < columns; gx++) {
      const sx = gx - left
      const bg = wall(gx, y, columns)


      let light = 0
      let tint = 0x000000

      for (const { tube, w } of GLOW.get(y * 4096 + sx) ?? []) {
        const amount = w * (levels[tube] ?? 0)

        if (amount <= 0) continue
        tint = light === 0 ? (SIGN.tubes[tube]?.color ?? 0) : mix(tint, SIGN.tubes[tube]?.color ?? 0, amount / (light + amount))
        light += amount
      }

      grid.set(gx, y, ' ', 0xffffff, light > 0 ? add(bg, tint, Math.min(0.22, light)) : bg)
    }
  }

  const frame = Math.floor(age / 60)

  for (const [i, cell] of SIGN.cells.entries()) {
    const level = levels[cell.tube] ?? 0
    const color = SIGN.tubes[cell.tube]?.color ?? 0xffffff
    const at = (cell.y * columns + cell.x + left) * 3
    const under = grid.cells[at + 2] ?? 0
    // Animated, each cell of a tube resolves at its own moment after the strike: until then it is a random letter
    // flickering in the tube's colour, the image-to-ASCII materialise.
    const resolveAt = (SIGN.tubes[cell.tube]?.strikeMs ?? 0) + (hash(i, 7) % 520)
    const isResolving = isAnimated && age >= resolveAt - 520 && age < resolveAt

    if (isResolving) {
      grid.set(cell.x + left, cell.y, NOISE[hash(i, frame) % NOISE.length] as string, mix(CORE[color] ?? 0xffffff, color, (hash(frame, i) % 100) / 100))
      continue
    }

    grid.set(cell.x + left, cell.y, cell.ch, level <= 0.05 ? UNLIT : mix(UNLIT, CORE[color] ?? 0xffffff, Math.min(1, level)), level <= 0.05 || cell.ch === '~' ? under : mix(under, color, Math.min(1, level)))
  }

  if (isAnimated) glitch(grid, age)

  // The hardware stays dark: clips over the frame, wires up and down off the panel.
  for (const cx of SIGN.clips) {
    for (const [y, wireY] of [[1, 0], [9, 10]] as const) {
      grid.set(left + cx, y, '▐', CLIP, 0x0c0c10)
      grid.set(left + cx + 1, y, '▌', CLIP, 0x0c0c10)
      grid.set(left + cx + 1, wireY, '│', WIRE)
    }
  }

  return grid
}
