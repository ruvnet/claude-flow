/**
 * The Hive-Mind's hero picture: a honeycomb that fills the pane's width. The queen sits in the centre cell wearing her
 * crown, with a soft pink halo on the walls around her; her workers take the cells nearest her, ring by ring, grouped
 * by role (● worker cyan, ◆ specialist yellow, ▲ scout green), each cell lit by how alive the worker is; the cells
 * nobody holds stay dim, so the comb fills as workers join. A worker flagged Byzantine has red walls. On the proposal
 * picked below, each worker's ballot is a dot in its cell (green for, pink against). Decisions on record leave a scar
 * in the outermost free cells: ✔ passed, ✘ failed.
 *
 * Motion means data: a worker's cell blinks and a wave runs from it to the queen for HIVE_PULSE_MS after the console
 * sees it vote, join or leave; nothing else moves, but for the queen's slow heartbeat (HEARTBEAT_MS, in eight steps,
 * so it repeats exactly). Colours are on the xterm-256 cube and its grey ramp, which is what Claude Code draws a
 * Raster in where the terminal has no true colour. The size depends only on the model and the columns.
 */
import { HIVE_PULSE_MS } from '../data/hive'
import { Grid } from './raster'

/** xterm-256 colours: the console's neon pink, yellow, cyan and green, a cube red, and grey-ramp walls. */
export const HIVE_COLOR = {
  pink: 0xd7005f,
  yellow: 0xd7af00,
  cyan: 0x00afd7,
  green: 0x5fd75f,
  red: 0xd70000,
  magenta: 0xd700d7,
  gold: 0xffd700,
  white: 0xffffff,
  grey: 0x808080,
  wall: 0x585858,
  faint: 0x303030,
} as const

export type Role = 'worker' | 'specialist' | 'scout' | 'unknown'
export type Glow = 'busy' | 'idle' | 'down' | 'error' | 'unknown'
export type Wave = { kind: 'for' | 'against' | 'join' | 'leave'; atMs: number }

export type HiveCell = {
  id: string
  role: Role
  glow: Glow
  /** Up to four characters on the cell's bottom row: the short id. */
  tag: string
  /** The worker's ballot on the picked proposal; absent when it has not voted or nothing is picked. */
  vote?: 'for' | 'against' | 'pending'
  isByzantine?: boolean
  /** When the console saw this worker vote, join or leave: the cell blinks and a wave runs to the queen. */
  wave?: Wave
}

export type Scar = { label: string; isPassed: boolean }

export type HivePictureModel = { queen: { tag: string; isKnown: boolean; wave?: Wave }; members: HiveCell[]; scars: Scar[] }

/** A cell is 8 columns by 5 rows; neighbouring columns of cells step 6 across and 2 down, so walls are shared. */
export const CELL_W = 8
export const CELL_H = 5
export const STEP_X = 6
const SHAPE = ['  ▁▁▁▁  ', ' ╱    ╲ ', '╱      ╲', '╲      ╱', ' ╲▁▁▁▁╱ '] as const
/** Each interior row of a cell: [row, first column, last column]. */
export const INTERIOR: readonly [number, number, number][] = [
  [1, 2, 5],
  [2, 1, 6],
  [3, 1, 6],
]
export const HEARTBEAT_MS = 4_000
const HEART = [0, 0.15, 0.35, 0.55, 0.55, 0.35, 0.15, 0] as const
const MAX_SCARS = 8

export const ROLE_GLYPH: Record<Role, string> = { worker: '●', specialist: '◆', scout: '▲', unknown: '○' }
export const ROLE_COLOR: Record<Role, number> = { worker: HIVE_COLOR.cyan, specialist: HIVE_COLOR.yellow, scout: HIVE_COLOR.green, unknown: HIVE_COLOR.grey }
/** A cell's lit interior by role and liveness, every one an exact cube or grey-ramp colour; null leaves it dark. */
export const CELL_BG: Record<Role, Record<Glow, number | null>> = {
  worker: { busy: 0x0087af, idle: 0x005f5f, down: 0x262626, error: 0x5f0000, unknown: null },
  specialist: { busy: 0xaf8700, idle: 0x5f5f00, down: 0x262626, error: 0x5f0000, unknown: null },
  scout: { busy: 0x5f8700, idle: 0x005f00, down: 0x262626, error: 0x5f0000, unknown: null },
  unknown: { busy: null, idle: null, down: null, error: null, unknown: null },
}
const QUEEN_BG = 0x5f005f
const DOT: Record<NonNullable<HiveCell['vote']>, [string, number]> = { for: ['●', HIVE_COLOR.green], against: ['●', HIVE_COLOR.pink], pending: ['·', HIVE_COLOR.grey] }
/** The wave's leading dot: a glyph no cell uses, so it reads as the wave and nothing else. */
export const WAVE_HEAD = '◉'
export const WAVE_COLOR: Record<Wave['kind'], number> = { for: HIVE_COLOR.green, against: HIVE_COLOR.pink, join: HIVE_COLOR.cyan, leave: HIVE_COLOR.grey }

/** Light adds: the wall keeps its colour and the light is laid over it, so a halo stays saturated. */
export function addLight(base: number, light: number, k: number): number {
  const channel = (shift: number) => Math.min(255, Math.round(((base >> shift) & 255) + ((light >> shift) & 255) * k))

  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

/** Rows of the comb: one ring above and below the queen while every member fits the first ring, else two. */
export const heroRows = (members: number): number => (members <= 6 ? 2 * 4 + CELL_H : 4 * 4 + CELL_H)

/** The top-left corner of axial cell (q, r) in a comb `columns` wide and `rows` tall, the queen's cell centred. */
export function cellOrigin(q: number, r: number, columns: number, rows: number): { x: number; y: number } {
  return { x: Math.floor(columns / 2) - CELL_W / 2 + q * STEP_X, y: Math.floor((rows - CELL_H) / 2) + 2 * q + 4 * r }
}

export const hexDistance = (q: number, r: number): number => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2

/** Every whole cell that fits the comb, the queen's first, then by distance from her, each ring clockwise from the top. */
export function fieldOf(columns: number, rows: number): [number, number][] {
  const out: [number, number][] = []
  const span = Math.ceil(columns / STEP_X) + 1

  for (let q = -span; q <= span; q++) {
    for (let r = -span - rows; r <= span + rows; r++) {
      const { x, y } = cellOrigin(q, r, columns, rows)

      if (x >= 0 && y >= 0 && x + CELL_W <= columns && y + CELL_H <= rows) out.push([q, r])
    }
  }

  // Clockwise from the top, on screen: a column step is 6 across and 2 down, a row step 4 down (cells are taller than wide).
  const angle = ([q, r]: [number, number]) => (Math.atan2((q * STEP_X) / 1.5, -(2 * q + 4 * r)) + 2 * Math.PI) % (2 * Math.PI)

  return out.sort((a, b) => hexDistance(...a) - hexDistance(...b) || angle(a) - angle(b))
}

const ROLE_ORDER: Role[] = ['worker', 'specialist', 'scout', 'unknown']

/** Members in the order they take cells: by role, so each role holds an arc of the rings, then as listed. */
export const byRole = (members: readonly HiveCell[]): HiveCell[] => ROLE_ORDER.flatMap(role => members.filter(member => member.role === role))

/** A blink and its age while a wave is fresh, else null: the only motion a cell has. */
export function waveAge(wave: Wave | undefined, t: number): number | null {
  const age = wave === undefined ? -1 : t - wave.atMs

  return age < 0 || age >= HIVE_PULSE_MS ? null : age
}

/** The queen's halo strength at `t`: eight steps a beat, so a frame one beat later is the same frame. */
export function heartbeat(t: number): number {
  const phase = (((t % HEARTBEAT_MS) + HEARTBEAT_MS) % HEARTBEAT_MS) / HEARTBEAT_MS

  return HEART[Math.floor(phase * HEART.length) % HEART.length] as number
}

/** The halo's wall colour at `t`: half lit at rest (still pink after 256-colour quantisation, not a grey wall), brighter at the beat. */
export const haloColor = (t: number): number => addLight(HIVE_COLOR.faint, HIVE_COLOR.pink, 0.5 + heartbeat(t))

/** The walls of a cell, the bottom edge carrying the cell's own light under it. */
export function drawWalls(grid: Grid, x: number, y: number, wall: number, bg?: number): void {
  SHAPE.forEach((line, dy) => {
    ;[...line].forEach((ch, dx) => {
      if (ch !== ' ') grid.set(x + dx, y + dy, ch, wall, dy === CELL_H - 1 && ch === '▁' ? bg : undefined)
    })
  })
}

/** Lights a cell's interior (and clears it): the background is the light, null keeps the terminal's own. */
export function fillInterior(grid: Grid, x: number, y: number, bg: number | null): void {
  for (const [dy, from, to] of INTERIOR) {
    for (let dx = from; dx <= to; dx++) grid.set(x + dx, y + dy, ' ', HIVE_COLOR.white, bg ?? undefined)
  }
}

function drawMember(grid: Grid, cell: HiveCell, x: number, y: number, t: number): void {
  const age = waveAge(cell.wave, t)
  const isLit = age !== null && Math.floor(age / 250) % 2 === 0
  const bg = CELL_BG[cell.role][cell.glow]
  const wall = isLit ? HIVE_COLOR.white : cell.isByzantine === true ? HIVE_COLOR.red : HIVE_COLOR.wall
  const glyph = cell.glow === 'busy' ? HIVE_COLOR.white : cell.glow === 'down' || cell.glow === 'unknown' ? HIVE_COLOR.grey : ROLE_COLOR[cell.role]

  fillInterior(grid, x, y, bg)
  drawWalls(grid, x, y, wall, bg ?? undefined)
  grid.set(x + 3, y + 2, ROLE_GLYPH[cell.role], isLit ? HIVE_COLOR.white : glyph, bg ?? undefined)
  grid.text(x + 2, y + 3, cell.tag.slice(0, 4), age !== null ? HIVE_COLOR.white : HIVE_COLOR.grey, bg ?? undefined)

  if (cell.isByzantine === true) grid.set(x + 4, y + 1, '✖', HIVE_COLOR.red, bg ?? undefined)
  else if (cell.vote !== undefined) grid.set(x + 4, y + 1, DOT[cell.vote][0], DOT[cell.vote][1], bg ?? undefined)
}

function drawQueen(grid: Grid, model: HivePictureModel, x: number, y: number, t: number): void {
  const age = waveAge(model.queen.wave, t)
  const isLit = age !== null && Math.floor(age / 250) % 2 === 0
  const bg = model.queen.isKnown ? QUEEN_BG : null

  fillInterior(grid, x, y, bg)
  drawWalls(grid, x, y, isLit ? HIVE_COLOR.white : model.queen.isKnown ? HIVE_COLOR.pink : HIVE_COLOR.grey, bg ?? undefined)
  grid.text(x + 2, y + 1, model.queen.isKnown ? '✦  ✦' : '', HIVE_COLOR.yellow, bg ?? undefined)
  grid.set(x + 3, y + 2, model.queen.isKnown ? '♛' : '?', model.queen.isKnown ? HIVE_COLOR.gold : HIVE_COLOR.grey, bg ?? undefined)
  grid.text(x + 3, y + 3, model.queen.tag.slice(0, 3), HIVE_COLOR.yellow, bg ?? undefined)
}

/** The halo: the six cells around the queen get pink light on their walls, swelling and fading with her heartbeat; a
 * blinking or Byzantine neighbour keeps its own walls. */
function drawHalo(grid: Grid, columns: number, rows: number, t: number, lit: Set<string>): void {
  for (const [q, r] of [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]] as const) {
    if (lit.has(`${q},${r}`)) continue

    const { x, y } = cellOrigin(q, r, columns, rows)

    SHAPE.forEach((line, dy) => {
      ;[...line].forEach((ch, dx) => {
        const at = grid.glyph(x + dx, y + dy)

        // Only the walls the queen does not share: hers stay pink whatever the beat.
        if (ch !== ' ' && at === ch.codePointAt(0)) grid.set(x + dx, y + dy, ch, haloColor(t))
      })
    })
  }
}

/** A dotted wave from a worker's cell to the queen's: its head travels in with the age, its trail fading behind. */
function drawWave(grid: Grid, from: { x: number; y: number }, to: { x: number; y: number }, wave: Wave, t: number): void {
  const age = waveAge(wave, t)

  if (age === null) return

  const front = age / HIVE_PULSE_MS
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y) * 2)))
  let hasHead = false

  // From the front back along the trail: the first free cell carries the head, the ones behind it the fading trail.
  for (let i = Math.min(steps, Math.floor(front * steps)); i >= 0; i--) {
    const s = i / steps
    const behind = front - s
    const x = Math.round(from.x + (to.x - from.x) * s)
    const y = Math.round(from.y + (to.y - from.y) * s)

    if (behind > 0.45) break
    // Only over empty space, so the wave never hides a glyph, a ballot or a wall.
    if (grid.glyph(x, y) !== 0x20) continue

    grid.set(x, y, hasHead ? (behind < 0.2 ? '•' : '·') : WAVE_HEAD, hasHead ? addLight(0x000000, WAVE_COLOR[wave.kind], 1 - behind) : HIVE_COLOR.white)
    hasHead = true
  }
}

export function hivePicture(model: HivePictureModel, columns: number, t: number): Grid {
  const rows = heroRows(model.members.length)
  const grid = new Grid(columns, rows)
  const field = fieldOf(columns, rows)
  const members = byRole(model.members).slice(0, Math.max(0, field.length - 1))
  const free = field.slice(1 + members.length)
  const scars = model.scars.slice(0, Math.min(MAX_SCARS, free.length))
  const centre = (q: number, r: number) => {
    const { x, y } = cellOrigin(q, r, columns, rows)

    return { x: x + 4, y: y + 2 }
  }

  // The empty comb first, dim, then the scars in its outermost cells, then the workers and the queen over them.
  for (const [q, r] of field) {
    const { x, y } = cellOrigin(q, r, columns, rows)

    drawWalls(grid, x, y, HIVE_COLOR.faint)
  }

  scars.forEach((scar, i) => {
    const [q, r] = free[free.length - 1 - i] as [number, number]
    const { x, y } = cellOrigin(q, r, columns, rows)
    const color = scar.isPassed ? HIVE_COLOR.green : HIVE_COLOR.pink

    drawWalls(grid, x, y, addLight(HIVE_COLOR.faint, color, 0.35))
    grid.set(x + 3, y + 2, scar.isPassed ? '✔' : '✘', color)
    grid.text(x + 2, y + 3, scar.label.slice(0, 4), addLight(HIVE_COLOR.faint, color, 0.5))
  })

  members.forEach((cell, i) => {
    const [q, r] = field[i + 1] as [number, number]
    const { x, y } = cellOrigin(q, r, columns, rows)

    drawMember(grid, cell, x, y, t)
  })

  const queen = cellOrigin(0, 0, columns, rows)
  const lit = new Set(members.flatMap((cell, i) => (waveAge(cell.wave, t) !== null || cell.isByzantine === true ? [`${(field[i + 1] as [number, number]).join(',')}`] : [])))

  if (model.queen.isKnown) drawHalo(grid, columns, rows, t, lit)
  drawQueen(grid, model, queen.x, queen.y, t)

  members.forEach((cell, i) => {
    const [q, r] = field[i + 1] as [number, number]

    if (cell.wave !== undefined) drawWave(grid, centre(q, r), centre(0, 0), cell.wave, t)
  })

  const hidden = model.members.length - members.length

  if (hidden > 0) grid.text(Math.max(0, columns - 10), rows - 1, `+${hidden} more`.slice(0, 10), HIVE_COLOR.grey)

  return grid
}
