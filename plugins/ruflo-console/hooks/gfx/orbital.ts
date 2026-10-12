/** Orbital cell art: decorative motion, never a simulated health or progress measurement. */
import type { BootCheck } from '../boot-checks'
import { Grid } from './raster'
import { bannerPicture } from './pictures'

const RED = 0xf06449
const GREEN = 0x72c79b
const INK = 0xc6cbc8
const DIM = 0x596561
const BLACK = 0x000000
const TAU = Math.PI * 2

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

/** Tilted orthographic Earth with fixed sunlight and a sparse starfield. One turn takes 12 seconds. */
export function orbitalGlobe(columns: number, rows: number, timeMs: number): Grid {
  const height = Math.max(5, Math.min(24, Math.floor(rows) || 5))
  const grid = blank(columns, height)
  const radius = Math.min((height - 1) / 2, (grid.columns - 1) / 4)
  const angle = (Number.isFinite(timeMs) ? timeMs % 12000 : 0) / 12000 * TAU
  const tilt = 23.4 * Math.PI / 180
  const pitch = 0.18
  const tint = (color: number, brightness: number): number => {
    const channel = (shift: number) => Math.round(((color >>> shift) & 255) * brightness)
    return (channel(16) << 16) | (channel(8) << 8) | channel(0)
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < grid.columns; x++) {
    const nx = (x - (grid.columns - 1) / 2) / (radius * 2)
    const ny = ((height - 1) / 2 - y) / radius
    const r2 = nx * nx + ny * ny
    if (r2 > 1) {
      // Stable positions, slow brightness changes, and clear space around the limb.
      const seed = ((x + 17) * 73856093 ^ (y + 11) * 19349663) >>> 0
      if (r2 > 1.2 && seed % 113 === 0) {
        const glow = 0.45 + 0.3 * (1 + Math.sin(angle + seed % 31)) / 2
        grid.set(x, y, seed % 3 === 0 ? '+' : '.', tint(INK, glow), BLACK)
      }
      continue
    }
    const z = Math.sqrt(1 - r2)
    // Transform the visible surface into the tilted planet's coordinates before spinning its longitude.
    const ax = nx * Math.cos(tilt) + ny * Math.sin(tilt)
    const ay = -nx * Math.sin(tilt) + ny * Math.cos(tilt)
    const py = ay * Math.cos(pitch) + z * Math.sin(pitch)
    const pz = z * Math.cos(pitch) - ay * Math.sin(pitch)
    const lat = Math.asin(Math.max(-1, Math.min(1, py))) * 180 / Math.PI
    const lon = ((Math.atan2(ax, pz) + angle) * 180 / Math.PI + 540) % 360 - 180
    const land = onLand(lon, lat)
    const sun = Math.max(0, -0.58 * nx + 0.4 * ny + 0.71 * z)
    const brightness = 0.2 + 0.8 * sun
    const meridian = Math.abs(lon / 30 - Math.round(lon / 30)) < 0.055
    const parallel = Math.abs(lat / 30 - Math.round(lat / 30)) < 0.055
    const glyph = land ? (sun > 0.65 ? '#' : sun > 0.3 ? '+' : ':') : meridian || parallel ? ':' : '.'
    // A coral limb and dim night side keep the sphere readable without filling it solid.
    const base = z < 0.28 ? RED : land ? INK : GREEN
    grid.set(x, y, glyph, tint(base, land || z < 0.28 ? brightness : brightness * 0.48), BLACK)
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

/** Map the original banner's neon channels into Orbital's palette, preserving its highlight sweep. */
function orbitalBrandColor(color: number): number {
  const r = (color >>> 16) & 255
  const g = (color >>> 8) & 255
  // Original magenta and cyan are mixed with white by the shared banner renderer.
  const cyan = Math.max(0, Math.min(1, (255 - r) / 250))
  const white = Math.max(0, Math.min(1 - cyan, (g - 42 - 175 * cyan) / 213))
  const coral = 1 - cyan - white
  const channel = (a: number, z: number, light: number) => Math.round(a * coral + z * cyan + light * white)
  return (channel(240, 114, 240) << 16) | (channel(100, 199, 239) << 8) | channel(73, 155, 226)
}

/** Checks are actual self-check results; the globe and sweep are explicitly decorative. */
export function orbitalBoot(project: string, columns: number, timeMs: number, checks?: readonly BootCheck[]): Grid {
  const grid = blank(columns, 22)
  // Reuse the original console banner, including its half-block font and sweep, recolored for Orbital.
  const banner = bannerPicture(project, grid.columns, timeMs)
  for (let y = 0; y < banner.rows; y++) for (let x = 0; x < banner.columns; x++) {
    const i = (y * banner.columns + x) * 3
    grid.set(x, y, banner.cells[i]!, orbitalBrandColor(banner.cells[i + 1]!), BLACK)
  }
  grid.text(0, 3, ' ruvnet / ORBITAL', DIM)
  const globe = orbitalGlobe(grid.columns, 14, timeMs)
  const left = Math.floor((grid.columns - globe.columns) / 2)
  for (let y = 0; y < globe.rows; y++) for (let x = 0; x < globe.columns; x++) {
    const i = (y * globe.columns + x) * 3
    grid.set(left + x, y + 4, globe.cells[i]!, globe.cells[i + 1]!, BLACK)
  }
  grid.text(0, 18, ' LOADING CONSOLE / decorative orbit', RED)
  const passed = checks?.filter(c => c.ok).length ?? 0
  const failed = checks?.filter(c => !c.ok).length ?? 0
  grid.text(0, 19, checks === undefined ? ' Self-check: pending' : ` Self-check: ${passed} passed / ${failed} failed`, failed > 0 ? RED : GREEN)
  grid.text(0, 21, ' Motion: Settings > fps | Boot: optional', DIM)
  return grid
}
