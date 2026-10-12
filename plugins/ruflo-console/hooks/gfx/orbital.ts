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

// Original stylized continent silhouettes in longitude/latitude degrees, for decoration only.
const LAND = [
  [[-168,65],[-150,71],[-135,69],[-128,58],[-123,49],[-124,41],[-117,32],[-108,24],[-97,16],[-86,10],[-83,15],[-90,21],[-97,26],[-81,25],[-81,32],[-70,44],[-58,49],[-65,60],[-95,72],[-130,73]],
  [[-81,12],[-70,11],[-61,6],[-51,3],[-35,-6],[-39,-19],[-49,-28],[-56,-37],[-68,-56],[-74,-49],[-73,-30],[-80,-5]],
  [[-17,35],[-4,36],[10,37],[24,32],[33,30],[43,12],[51,11],[42,0],[35,-12],[32,-27],[18,-35],[12,-20],[9,-3],[-1,5],[-15,11],[-18,22]],
  [[-10,36],[-9,44],[1,49],[9,54],[5,59],[20,71],[33,69],[29,58],[44,48],[36,42],[26,39],[21,36],[12,46],[3,43]],
  [[29,58],[45,72],[95,77],[140,71],[179,66],[160,55],[143,49],[135,35],[121,30],[109,19],[104,1],[98,7],[91,22],[80,8],[73,20],[64,25],[51,12],[43,14],[35,30],[44,48]],
  [[112,-12],[130,-11],[137,-16],[143,-11],[153,-25],[151,-37],[139,-39],[129,-32],[115,-35],[113,-24]],
  [[-53,59],[-42,61],[-22,76],[-30,83],[-52,84],[-66,70]],
  [[46,-13],[50,-17],[47,-25],[44,-22]],
  [[130,31],[136,35],[142,43],[145,44],[141,35]],
  [[166,-34],[179,-39],[172,-47],[166,-45]],
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
      // Thin orbital arc behind the planet; the solid sphere occludes the middle.
      const ringX = nx * 0.966 + ny * 0.259
      const ringY = -nx * 0.259 + ny * 0.966
      const ring = ringX * ringX / 3.24 + ringY * ringY / 0.16
      if (Math.abs(ring - 1) < 0.09) grid.set(x, y, '.', 0x543b32, BLACK)
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
    const brightness = 0.28 + 0.72 * sun
    const meridian = Math.abs(lon / 30 - Math.round(lon / 30)) < 0.055
    const parallel = Math.abs(lat / 30 - Math.round(lat / 30)) < 0.055
    const glyph = land ? (sun > 0.65 ? '#' : sun > 0.3 ? '+' : ':') : meridian || parallel ? ':' : '.'
    // A coral limb and dim night side keep the sphere readable without filling it solid.
    const sweepAngle = (Math.atan2(ny, nx) - angle * 2 + TAU * 3) % TAU
    const scanGlow = Math.max(0, 1 - sweepAngle / 0.45) * 0.24
    const base = scanGlow > 0.1 ? GREEN : z < 0.28 ? RED : land ? INK : GREEN
    const light = land || z < 0.28 ? Math.max(z < 0.28 ? 0.58 : 0, brightness) : brightness * 0.48
    grid.set(x, y, glyph, tint(base, Math.min(1, light + scanGlow)), BLACK)
  }
  // A single marker with a short fading trail follows the orbit, passing behind the planet.
  for (let trail = 5; trail >= 0; trail--) {
    const phase = angle - trail * 0.07
    const rx = 1.8 * Math.cos(phase)
    const ry = 0.4 * Math.sin(phase)
    const sx = rx * 0.966 - ry * 0.259
    const sy = rx * 0.259 + ry * 0.966
    if (sx * sx + sy * sy < 1 && Math.sin(phase) < 0) continue
    const x = Math.round((grid.columns - 1) / 2 + sx * radius * 2)
    const y = Math.round((height - 1) / 2 - sy * radius)
    grid.set(x, y, trail === 0 ? '+' : '.', tint(trail === 0 ? INK : RED, 1 - trail * 0.14), BLACK)
  }
  return grid
}

/** Fixed-height header: red scan line, travelling ASCII pulse and an orbit marker. */
export function orbitalHeader(label: string, columns: number, timeMs: number): Grid {
  const swarm = /swarm/i.test(label)
  const grid = blank(columns, swarm ? 16 : 4)
  const tick = Math.floor((Number.isFinite(timeMs) ? timeMs : 0) / 160)
  const title = ` RUFLO / ${label.toUpperCase()} `
  grid.text(0, 0, title.slice(0, grid.columns), RED)
  grid.text(0, 1, '-'.repeat(grid.columns), DIM)
  for (let tail = 4; tail >= 0; tail--) {
    const x = (((tick - tail) % grid.columns) + grid.columns) % grid.columns
    grid.set(x, 1, tail === 0 ? '>' : '=', tail === 0 ? INK : tail < 3 ? RED : DIM)
  }
  for (let x = 0; x < grid.columns - 12; x++) {
    const phase = ((x - tick) % 19 + 19) % 19
    grid.set(x, 2, phase === 9 ? '|' : phase === 8 || phase === 10 ? '/' : phase === 7 || phase === 11 ? '.' : '_', phase >= 7 && phase <= 11 ? GREEN : DIM)
  }
  grid.text(Math.max(0, grid.columns - 10), 2, `[${'|/-\\'[Math.abs(tick) % 4]}] ORBIT`, RED)
  if (swarm) {
    // A decorative routing motif, separate from the page's measured swarm topology.
    for (let y = 1; y < grid.rows; y++) grid.text(0, y, ' '.repeat(grid.columns), DIM)
    const center = { x: Math.floor(grid.columns / 2), y: 5 }
    const ms = Number.isFinite(timeMs) ? timeMs : 0
    const phase = ms / 12000 * TAU
    const icons = ['◇', '□', '△', '◎', '◇', '□', '△', '◎']
    const nodes = icons.map((icon, index) => {
      const angle = phase + index * TAU / icons.length
      const z = Math.sin(angle)
      const perspective = 2.8 / (2.8 - z * 0.5)
      return { icon, index, z, x: Math.round(center.x + Math.cos(angle) * grid.columns * 0.32 * perspective), y: Math.round(center.y + (Math.sin(angle) * 2.3 + Math.cos(angle) * 0.7) * perspective) }
    }).sort((a, b) => a.z - b.z)
    const beat = ((ms % 4800) + 4800) % 4800
    const stage = Math.floor(beat / 1200)
    // Sparse graph mesh and moving edge packets, all illustrative rather than reported traffic.
    for (let y = 1; y <= 9; y += 2) for (let x = 3; x < grid.columns - 3; x += 6) grid.set(x, y, '·', 0x18241f)
    nodes.forEach(node => {
      const next = nodes.find(other => other.index === (node.index + 1) % nodes.length)!
      const dx = next.x - node.x
      const dy = next.y - node.y
      const steps = Math.max(1, Math.abs(dx), Math.abs(dy))
      const packet = ((ms / 1100 + node.index * 0.19) % 1 + 1) % 1
      for (let step = 1; step < steps; step++) {
        const f = step / steps
        const lit = Math.abs(packet - f) < 0.045
        grid.set(Math.round(node.x + dx * f), Math.round(node.y + dy * f), lit ? '•' : '·', lit ? INK : 0x344138)
      }
    })
    // Projected direction vectors extend from the hub, rotating independently of the graph.
    for (let axis = 0; axis < 3; axis++) {
      const angle = phase * 1.5 + axis * TAU / 3
      for (let step = 2; step <= 8; step++) {
        const x = center.x + Math.round(Math.cos(angle) * step * Math.min(1.7, grid.columns / 36))
        const y = center.y + Math.round(Math.sin(angle) * step * 0.36)
        grid.set(x, y, step === 8 ? (Math.cos(angle) < 0 ? '◀' : '▶') : '·', step === 8 ? RED : 0x6c4335)
      }
    }
    const drawHub = () => {
      grid.text(center.x - 2, center.y + 1, ' ░░░ ', 0x4b2924)
      grid.text(center.x - 2, center.y, '[ ◈ ]', stage === 2 ? GREEN : INK)
    }
    let hubDrawn = false
    nodes.forEach(node => {
      if (!hubDrawn && node.z >= 0) { drawHub(); hubDrawn = true }
      const dx = node.x - center.x
      const dy = node.y - center.y
      const steps = Math.max(Math.abs(dx), Math.abs(dy))
      const outbound = ((ms / 1300 + node.index / icons.length) % 1 + 1) % 1
      const pulse = stage >= 2 ? 1 - outbound : outbound
      for (let step = 3; step < steps; step++) {
        const f = step / steps
        const x = Math.round(center.x + dx * f)
        const y = Math.round(center.y + dy * f)
        const lit = pulse - f >= 0 && pulse - f < 0.14
        grid.set(x, y, lit ? '•' : '·', lit ? GREEN : node.z < 0 ? 0x29342f : 0x58675e)
      }
      if (node.z > 0) {
        grid.text(node.x, node.y + 1, '░░', 0x4b2924)
        grid.text(node.x - 1, node.y, `[${node.icon}]`, pulse > 0.8 ? INK : RED)
      } else grid.set(node.x, node.y, node.icon, DIM)
    })
    if (!hubDrawn) drawHub()
    grid.text(1, 10, ' ◈ HUB  ◇ WORKER  □ TOOL  △ TASK  ◎ MEMORY', DIM)
    const stages = ['DISPATCH', 'PARALLEL', 'SYNC', 'RETURN']
    const lane = Math.max(1, Math.floor((grid.columns - 2) / 4))
    stages.forEach((label, index) => {
      const x = 1 + index * lane
      grid.text(x, 12, `${index === stage ? '▶' : '·'} ${label}`.slice(0, lane), index === stage ? INK : DIM)
      const cells = Math.max(1, lane - 2)
      for (let i = 0; i < cells; i++) {
        const lit = index === stage && i === Math.floor((beat % 1200) / 1200 * cells)
        grid.set(x + i, 13, lit ? '▪' : '·', lit ? GREEN : 0x35413c)
      }
    })
    grid.text(1, 15, ' Illustrative orchestration / live graph below', DIM)
  } else if (grid.columns >= 30) grid.text(0, 3, ' ruvnet / agent swarm console', DIM)
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
  const grid = blank(columns, 30)
  // Reuse the original console banner, including its half-block font and sweep, recolored for Orbital.
  const banner = bannerPicture(project, grid.columns, timeMs, Math.max(0, Number.isFinite(timeMs) ? timeMs : 0))
  for (let y = 0; y < banner.rows; y++) for (let x = 0; x < banner.columns; x++) {
    const i = (y * banner.columns + x) * 3
    grid.set(x, y, banner.cells[i]!, orbitalBrandColor(banner.cells[i + 1]!), BLACK)
  }
  grid.text(0, 3, ' ruvnet / ORBITAL', DIM)
  const globe = orbitalGlobe(grid.columns, 16, timeMs)
  const intro = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0)
  const reveal = Math.min(1, Math.max(0, (intro - 150) / 750))
  const eased = 1 - Math.pow(1 - reveal, 3)
  const halfWidth = Math.ceil(grid.columns * eased / 2)
  const left = Math.floor((grid.columns - globe.columns) / 2)
  for (let y = 0; y < globe.rows; y++) for (let x = 0; x < globe.columns; x++) {
    if (Math.abs(x - (grid.columns - 1) / 2) > halfWidth) continue
    const i = (y * globe.columns + x) * 3
    grid.set(left + x, y + 4, globe.cells[i]!, globe.cells[i + 1]!, BLACK)
  }
  // Acquisition brackets settle inward as the globe resolves; they do not represent data readiness.
  const inset = Math.round(2 + 5 * eased)
  for (const y of [5, 18]) {
    grid.text(inset, y, '+--', RED)
    grid.text(Math.max(inset + 3, grid.columns - inset - 3), y, '--+', RED)
  }
  const loaderWidth = Math.max(1, grid.columns - 4)
  const loader = Math.floor((Math.sin(intro / 450) + 1) / 2 * (loaderWidth - 1))
  for (let x = 0; x < loaderWidth; x++) grid.set(x + 2, 2, Math.abs(x - loader) < 3 ? '=' : '.', Math.abs(x - loader) < 3 ? GREEN : 0x303c37)
  grid.text(0, 20, ' LOADING CONSOLE / decorative orbit', RED)
  const passed = checks?.filter(c => c.ok).length ?? 0
  const failed = checks?.filter(c => !c.ok).length ?? 0
  grid.text(0, 21, checks === undefined ? ' Self-check: pending' : ` Self-check: ${passed} passed / ${failed} failed`, failed > 0 ? RED : GREEN)
  const age = Math.max(0, Number.isFinite(timeMs) ? timeMs : 0)
  const scan = Math.floor(age / 100) % Math.max(1, grid.columns - 2)
  grid.text(0, 22, ' '.repeat(grid.columns), DIM)
  grid.text(0, 22, ' MODULE INTEGRITY ', RED)
  if (scan >= 18) grid.set(scan, 22, '>', GREEN)
  if (checks === undefined) {
    grid.text(0, 24, ` [${'|/-\\'[Math.floor(age / 120) % 4]}] Waiting for local self-check results`, DIM)
  } else if (checks.length === 0) {
    grid.text(0, 24, ' [N/A] No module checks reported', DIM)
  } else {
    // Keep failures visible first. Cycle successful areas without fabricating execution progress.
    const errors = checks.filter(check => !check.ok)
    const successes = checks.filter(check => check.ok)
    const slots = Math.max(0, 4 - Math.min(4, errors.length))
    const page = Math.floor(age / 2200)
    const shown = [...errors.slice(0, 4), ...Array.from({ length: Math.min(slots, successes.length) }, (_, i) => successes[(page * slots + i) % successes.length]!)]
    shown.forEach((check, i) => {
      const reveal = Math.max(0, Math.floor(((age % 2200) - i * 80) / 25))
      const name = check.ok ? check.area.toUpperCase().slice(0, reveal) : check.area.toUpperCase()
      const status = check.ok ? '[PASS]' : '[FAIL]'
      const detail = !check.ok && check.problems.length > 0 ? ` / ${check.problems[0]}` : ''
      grid.text(0, 23 + i, ` ${status} ${name}${detail}`, check.ok ? GREEN : RED)
      const cursor = 8 + name.length
      if (check.ok && reveal < check.area.length && cursor < grid.columns) grid.set(cursor, 23 + i, '_', INK)
      if (grid.columns >= 55 && check.ok) {
        const phase = ((age % 2200) - i * 80) / 350
        const light = phase >= 0 && phase < 1 ? INK : DIM
        grid.text(grid.columns - 12, 23 + i, ':: VERIFIED', light)
      }
    })
    grid.text(0, 27, ` ${checks.length} areas / ${errors.length} failures / local registry checks`, DIM)
  }
  grid.text(0, 29, ' Motion: Settings > fps | Boot: optional', DIM)
  return grid
}
