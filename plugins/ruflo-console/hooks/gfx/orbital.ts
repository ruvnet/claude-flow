/** Orbital cell art: decorative motion, never a simulated health or progress measurement. */
import type { BootCheck } from '../boot-checks'
import { Grid } from './raster'

const RED = 0xf06449
const GREEN = 0x72c79b
const INK = 0xc6cbc8
const DIM = 0x596561
const BLACK = 0x000000
const TAU = Math.PI * 2

// Original five-row ASCII wordmark. Small panes use the readable text lockup.
const WORDMARK = [
  '####  #   # ##### #      ### ',
  '#   # #   # #     #     #   #',
  '####  #   # ####  #     #   #',
  '#  #  #   # #     #     #   #',
  '#   #  ###  #     #####  ### ',
] as const

// Coarse original continent silhouettes in longitude/latitude degrees, for decoration only.
const LAND = [
  [[-168, 65], [-130, 72], [-58, 49], [-82, 10], [-112, 28], [-125, 50]],
  [[-81, 12], [-49, 2], [-35, -10], [-68, -56], [-76, -20]],
  [[-18, 35], [12, 37], [51, 12], [33, -34], [17, -35], [-5, 5]],
  [[-10, 36], [-10, 60], [45, 72], [170, 64], [135, 35], [105, 0], [70, 24], [35, 30]],
  [[112, -12], [139, -10], [154, -28], [132, -39], [113, -30]],
  [[-53, 59], [-22, 81], [-52, 84], [-66, 70]],
] as const

function onLand(lon: number, lat: number): boolean {
  return LAND.some(poly => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!
      const b = poly[j]!
      if ((a[1] > lat) !== (b[1] > lat) && lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
    }
    return inside
  })
}

function blank(columns: number, rows: number): Grid {
  const grid = new Grid(Math.max(12, Math.min(200, Math.floor(columns) || 12)), rows)
  for (let y = 0; y < rows; y++) for (let x = 0; x < grid.columns; x++) grid.set(x, y, ' ', INK, BLACK)
  return grid
}

/** Orthographic rotating Earth, using only ASCII cells. Rotation repeats every 12 seconds. */
export function orbitalGlobe(columns: number, rows: number, timeMs: number): Grid {
  const height = Math.max(5, Math.min(24, Math.floor(rows) || 5))
  const grid = blank(columns, height)
  const radius = Math.min((height - 1) / 2, (grid.columns - 1) / 4)
  const angle = (Number.isFinite(timeMs) ? timeMs % 12000 : 0) / 12000 * TAU
  for (let y = 0; y < height; y++) for (let x = 0; x < grid.columns; x++) {
    const nx = (x - (grid.columns - 1) / 2) / (radius * 2)
    const ny = ((height - 1) / 2 - y) / radius
    const r2 = nx * nx + ny * ny
    if (r2 > 1) continue
    const z = Math.sqrt(1 - r2)
    const lat = Math.asin(ny) * 180 / Math.PI
    const lon = ((Math.atan2(nx, z) + angle) * 180 / Math.PI + 540) % 360 - 180
    const land = onLand(lon, lat)
    const meridian = Math.abs(lon / 30 - Math.round(lon / 30)) < 0.045
    const parallel = Math.abs(lat / 30 - Math.round(lat / 30)) < 0.045
    grid.set(x, y, land ? (z > 0.55 ? '#' : '+') : meridian || parallel ? ':' : '.', land ? (z > 0.55 ? INK : RED) : DIM, BLACK)
  }
  return grid
}

/** Fixed-height header: red scan line, travelling ASCII pulse and an orbit marker. */
export function orbitalHeader(label: string, columns: number, timeMs: number): Grid {
  const grid = blank(columns, 4)
  const tick = Math.floor((Number.isFinite(timeMs) ? timeMs : 0) / 160)
  const title = ` RUFLO / ${label.toUpperCase()} `
  grid.text(0, 0, title.slice(0, grid.columns), RED)
  grid.text(0, 1, '-'.repeat(grid.columns), DIM)
  grid.set(((tick % grid.columns) + grid.columns) % grid.columns, 1, '+', RED)
  for (let x = 0; x < grid.columns - 12; x++) {
    const phase = ((x - tick) % 19 + 19) % 19
    grid.set(x, 2, phase === 9 ? '|' : phase === 8 || phase === 10 ? '/' : phase === 7 || phase === 11 ? '.' : '_', phase >= 7 && phase <= 11 ? GREEN : DIM)
  }
  grid.text(Math.max(0, grid.columns - 10), 2, `[${'|/-\\'[Math.abs(tick) % 4]}] ORBIT`, RED)
  if (grid.columns >= 30) grid.text(0, 3, ' ruvnet / agent swarm console', DIM)
  return grid
}

/** Checks are actual self-check results; the globe and sweep are explicitly decorative. */
export function orbitalBoot(project: string, columns: number, timeMs: number, checks?: readonly BootCheck[]): Grid {
  const grid = blank(columns, 22)
  if (grid.columns >= 30) {
    const offset = Math.floor((grid.columns - WORDMARK[0].length) / 2)
    const sweep = Math.floor((Number.isFinite(timeMs) ? timeMs : 0) / 160) % WORDMARK[0].length
    WORDMARK.forEach((line, y) => {
      for (let x = 0; x < line.length; x++) grid.set(offset + x, y, line[x]!, x === sweep ? INK : RED, BLACK)
    })
  } else grid.text(0, 1, ' RUFLO', RED)
  const brand = grid.columns >= 42 ? 'ruvnet / agent swarm console / ORBITAL' : 'ruvnet / ORBITAL'
  grid.text(Math.max(0, Math.floor((grid.columns - brand.length) / 2)), 5, brand, DIM)
  grid.text(0, 6, ` ${project}`.slice(0, grid.columns), INK)
  const globe = orbitalGlobe(Math.min(38, grid.columns), 10, timeMs)
  const left = Math.floor((grid.columns - globe.columns) / 2)
  for (let y = 0; y < globe.rows; y++) for (let x = 0; x < globe.columns; x++) {
    const i = (y * globe.columns + x) * 3
    grid.set(left + x, y + 7, globe.cells[i]!, globe.cells[i + 1]!, BLACK)
  }
  grid.text(0, 18, ' LOADING CONSOLE / decorative orbit', RED)
  const passed = checks?.filter(c => c.ok).length ?? 0
  const failed = checks?.filter(c => !c.ok).length ?? 0
  grid.text(0, 19, checks === undefined ? ' Self-check: pending' : ` Self-check: ${passed} passed / ${failed} failed`, failed > 0 ? RED : GREEN)
  grid.text(0, 21, ' Motion: Settings > fps | Boot: optional', DIM)
  return grid
}
