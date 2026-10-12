/**
 * The animated pictures of the overview, swarm and learning views, each a pure function of its data, its size and the
 * real clock `t` (ms). The render and every `$.ui.blit` frame call the same function with the same size, so a frame
 * always fits the mounted Raster. What motion means is said beside each picture: data where it is data, decoration
 * where it is not.
 */
import { Braille, COLOR, Grid, mix, ramp, sparkline } from './raster'
import { bigText } from './font'
import { hash } from './boot-cyber'
import { getBuild } from '../build'
import { CONSOLE_VERSION } from '../version'

export { bootPicture, BOOT_ROWS } from './boot'

export type TopoNode = { id: string; label: string; status: string; isLeader: boolean; /** When the console last saw an event about it. */ pulseAtMs?: number }
export type TopoModel = { topology: string; nodes: TopoNode[] }

export const PULSE_MS = 1_400
/** How long a work-in-flight dot takes from the leader to a busy agent. */
export const FLIGHT_MS = 1400
const isBusy = (status: string) => /busy|active|running|working/i.test(status)
const isDown = (status: string) => /stop|terminat|offline|dead|error|fail/i.test(status)

export function nodeColor(node: TopoNode): number {
  if (node.isLeader) return COLOR.accent
  if (isDown(node.status)) return /error|fail/i.test(node.status) ? COLOR.bad : COLOR.dim
  if (isBusy(node.status)) return COLOR.warn

  return COLOR.info
}

/**
 * Where each node sits, in braille dots, by topology: a tree (rows of workers under the leader) for hierarchical and
 * star, a circle for mesh and ring. Large swarms wrap into more rows rather than overprinting.
 */
export function layout(model: TopoModel, width: number, height: number): { x: number; y: number }[] {
  const n = model.nodes.length
  const topology = model.topology.toLowerCase()
  const isCircle = (topology.includes('mesh') && !topology.includes('hierarchical')) || topology.includes('ring')

  if (n === 0) return []

  if (!isCircle) {
    const workers = n - 1
    const perRow = Math.max(1, Math.min(workers, Math.floor(width / 10)))
    const tiers = Math.max(1, Math.ceil(workers / perRow))
    const top = 3
    const span = Math.max(4, height - 6 - top)

    return model.nodes.map((_, i) => {
      if (i === 0) return { x: width / 2, y: top }

      const k = i - 1
      const tier = Math.floor(k / perRow)
      const inTier = Math.min(perRow, workers - tier * perRow)
      const slot = k % perRow

      return { x: ((slot + 0.5) / inTier) * (width - 8) + 4, y: top + 6 + (tiers === 1 ? span - 2 : (tier / Math.max(1, tiers - 1)) * (span - 2)) }
    })
  }

  const cx = width / 2
  const cy = height / 2
  const r = Math.max(4, Math.min(width / 2 - 6, height / 2 - 3))

  return model.nodes.map((_, i) => {
    const angle = -Math.PI / 2 + (i / n) * Math.PI * 2

    return { x: cx + Math.cos(angle) * r * 1.6, y: cy + Math.sin(angle) * r }
  })
}

/** The edges a topology draws between node indexes (capped: a 100-agent mesh draws its first 300). */
export function edges(model: TopoModel): [number, number][] {
  const n = model.nodes.length
  const out: [number, number][] = []
  const topology = model.topology.toLowerCase()

  if (n < 2) return out

  if (topology.includes('mesh') && !topology.includes('hierarchical')) {
    for (let a = 0; a < n && out.length < 300; a++) for (let b = a + 1; b < n && out.length < 300; b++) out.push([a, b])
  } else if (topology.includes('ring')) {
    for (let a = 0; a < n; a++) out.push([a, (a + 1) % n])
  } else {
    for (let b = 1; b < n; b++) out.push([0, b])
    if (topology.includes('hierarchical-mesh')) for (let a = 1; a < n - 1; a++) out.push([a, a + 1])
  }

  return out
}

/**
 * The swarm graph: nodes coloured by the status ruflo wrote (busy amber, idle blue, stopped grey), the leader starred.
 * A dot runs from the leader to a node once each time the console sees an event about that agent (data); the leader's
 * slow heartbeat is decoration.
 */
export function topologyPicture(model: TopoModel, columns: number, rows: number, t: number): Grid {
  const grid = new Grid(columns, rows)
  const canvas = new Braille(columns, rows)
  const points = layout(model, canvas.width, canvas.height)
  const links = edges(model)
  const leader = points[0]

  for (const [a, b] of links) {
    const p = points[a]
    const q = points[b]

    if (p !== undefined && q !== undefined) canvas.line(p.x, p.y, q.x, q.y, COLOR.line)
  }

  // Work in flight: while ruflo has an agent busy, a dim amber dot keeps travelling down its edge from the leader.
  // It runs only for as long as the status says busy, so it is data, not decoration; each agent has its own phase.
  model.nodes.forEach((node, i) => {
    const q = points[i]

    if (i === 0 || leader === undefined || q === undefined || !isBusy(node.status)) return

    const k = (((t / FLIGHT_MS + i * 0.37) % 1) + 1) % 1
    const x = leader.x + (q.x - leader.x) * k
    const y = leader.y + (q.y - leader.y) * k

    canvas.dot(x, y, COLOR.warn)
    canvas.dot(x + 1, y, COLOR.warn)
  })

  model.nodes.forEach((node, i) => {
    const q = points[i]
    const k = node.pulseAtMs === undefined ? -1 : (t - node.pulseAtMs) / PULSE_MS

    if (i === 0 || leader === undefined || q === undefined || k < 0 || k > 1) return

    const x = leader.x + (q.x - leader.x) * k
    const y = leader.y + (q.y - leader.y) * k

    // Two dots wide, so a pulse on a vertical edge stands out of the line rather than sitting on its dots.
    canvas.dot(x, y, 0xffffff)
    canvas.dot(x + 1, y, 0xffffff)
  })

  canvas.blitInto(grid, 0, 0)

  const room = Math.floor(columns / Math.max(2, Math.min(model.nodes.length, Math.floor(canvas.width / 10))))

  points.forEach((point, i) => {
    const node = model.nodes[i]

    if (node === undefined) return

    const cx = Math.floor(point.x / 2)
    const cy = Math.floor(point.y / 4)
    const heartbeat = node.isLeader ? Math.max(0, Math.sin(t / 260)) ** 6 : 0
    const flash = node.pulseAtMs !== undefined && t - node.pulseAtMs >= 0 && t - node.pulseAtMs < PULSE_MS + 600
    // A busy agent breathes (brighter and back, about once every 2 s) so it reads as working, not just coloured.
    const breath = !node.isLeader && isBusy(node.status) ? 0.45 * Math.sin(t / 330 + i) ** 2 : 0
    const color = flash ? 0xffffff : node.isLeader ? mix(COLOR.accent, 0xffffff, heartbeat) : mix(nodeColor(node), 0xffffff, breath)

    grid.set(cx, cy, node.isLeader ? '★' : isBusy(node.status) ? '◉' : '●', color)

    if (room >= 5 || node.isLeader) {
      const label = node.label.slice(0, Math.max(3, room - 1))

      grid.text(Math.max(0, Math.min(columns - label.length, cx - Math.floor(label.length / 2))), Math.min(rows - 1, cy + 1), label, node.isLeader ? COLOR.accent : nodeColor(node))
    }
  })

  return grid
}

/**
 * Two measured series as sparklines with their labels: tool calls the console saw per 5 s, and ruflo state files that
 * changed per refresh. The newest bar glows while the pane animates: decoration over measured bars.
 */
export function activityPicture(series: readonly { label: string; values: readonly number[] }[], columns: number, t: number): Grid {
  const grid = new Grid(columns, Math.max(1, series.length))
  const labelWidth = Math.min(18, Math.max(8, ...series.map(entry => entry.label.length + 1)))
  const width = Math.max(4, columns - labelWidth)

  series.forEach((entry, row) => {
    grid.text(0, row, entry.label.slice(0, labelWidth - 1), COLOR.dim)
    sparkline(grid, labelWidth, row, width, entry.values, v => ramp(0.3 + v * 0.7))

    const glow = 0.5 + 0.5 * Math.sin(t / 300)
    const last = labelWidth + width - 1

    if ((entry.values[entry.values.length - 1] ?? 0) > 0) grid.set(last, row, grid.glyph(last, row), mix(COLOR.info, 0xffffff, glow * 0.6))
  })

  return grid
}

/**
 * The running success rate of routed tasks (routing-outcomes.json), oldest left, as a braille line over a 0-100% frame.
 * When new outcomes arrive the newest stretch draws in over 900 ms from `grewAtMs`: that motion is data arriving.
 */
export function curvePicture(points: readonly boolean[], columns: number, rows: number, t: number, grewAtMs = 0): Grid {
  const grid = new Grid(columns, rows)
  const canvas = new Braille(Math.max(1, columns - 5), rows)
  const n = points.length

  for (let r = 0; r < rows; r++) grid.text(0, r, r === 0 ? '100%' : r === rows - 1 ? '  0%' : '    ', COLOR.dim)

  if (n === 0) {
    grid.text(6, Math.floor(rows / 2), 'no routed outcomes on disk yet', COLOR.dim)

    return grid
  }

  let ok = 0
  const rates = points.map((point, i) => {
    ok += point ? 1 : 0

    return ok / (i + 1)
  })
  const xOf = (i: number) => (n === 1 ? canvas.width / 2 : (i / (n - 1)) * (canvas.width - 1))
  const yOf = (rate: number) => (1 - rate) * (canvas.height - 1)
  const drawIn = grewAtMs > 0 ? Math.max(0, Math.min(1, (t - grewAtMs) / 900)) : 1
  const shown = Math.max(1, Math.round(n * (0.8 + 0.2 * drawIn)))

  for (let x = 0; x < canvas.width; x += 4) canvas.dot(x, yOf(0.5), COLOR.line)
  for (let i = 1; i < shown; i++) canvas.line(xOf(i - 1), yOf(rates[i - 1] as number), xOf(i), yOf(rates[i] as number), ramp(rates[i] as number))
  if (n === 1) canvas.dot(xOf(0), yOf(rates[0] as number), ramp(rates[0] as number))

  canvas.blitInto(grid, 5, 0)

  return grid
}

/** The band's mark: a diamond that pulses while Claude works and rests otherwise. */
export function markPicture(isWorking: boolean, t: number): Grid {
  const grid = new Grid(2, 1)
  const k = isWorking ? 0.5 + 0.5 * Math.sin(t / 220) : 1

  grid.set(0, 0, '◆', isWorking ? mix(COLOR.line, COLOR.accent, k) : COLOR.accent)

  return grid
}

/** The pane's title strip: a highlight sweeps across it every few seconds while the pane is focused. Decoration only. */
/** RUFLO in a two-row half-block font, the way a BBS splash spelled its name. */
const LOGO = ['█▀█ █ █ █▀▀ █   █▀█', '█▀▄ █▄█ █▀  █▄▄ █▄█'] as const
const NEON_MAGENTA = 0xff2a6d
const NEON_CYAN = 0x05d9e8

/** A header strikes in over this long when its page is switched to, and when the menu enters. */
export const TITLE_ENTRY_MS = 1_200
const GLITCH = '#%&@/\\|<>=+*'

/**
 * The strike-in shared by the page titles and the menu banner: from `from`, the letters appear left to right, a bright edge leading
 * and block noise ahead of it; behind the edge a few settled cells flip for a frame to an ASCII character (pink or cyan, fading to none),
 * and now and then a row slips one cell sideways. Hash-driven, so a frame is reproducible; nothing once `age` reaches TITLE_ENTRY_MS.
 */
function strikeIn(grid: Grid, from: number, age: number, t = 0): void {
  if (age >= TITLE_ENTRY_MS) return occasionalGlitch(grid, from, t)

  let last = from

  for (let i = 0; i < grid.columns * grid.rows; i++) if (grid.cells[i * 3] !== 0x20) last = Math.max(last, i % grid.columns)

  const span = last - from + 1
  const lead = from + (age / TITLE_ENTRY_MS) * (span + 1)

  for (let y = 0; y < grid.rows; y++) {
    for (let x = from; x <= last; x++) {
      if (grid.glyph(x, y) === 0x20) continue

      if (x > lead + 1) grid.set(x, y, '░▒▓█'[hash(x * 7 + y + Math.floor(age / 60)) % 4] as string, mix(0x3a0f2e, NEON_CYAN, 0.35))
      else if (x > lead - 1.5) grid.set(x, y, grid.glyph(x, y), 0xffffff)
      else if (hash(x * 13 + y * 7 + Math.floor(age / 50)) % 100 < 4 * (1 - age / TITLE_ENTRY_MS)) grid.set(x, y, GLITCH[hash(x + y + Math.floor(age / 50)) % GLITCH.length] as string, hash(x + Math.floor(age / 50)) % 2 === 0 ? 0xff2a6d : 0x05d9e8)
    }

    const slip = hash(y * 5 + Math.floor(age / 80))

    if (slip % 16 === 0 && age < TITLE_ENTRY_MS - 150) {
      const by = (slip >>> 4) % 2 === 0 ? 1 : -1
      const row = grid.cells.slice(y * grid.columns * 3, (y + 1) * grid.columns * 3)

      for (let x = from; x <= last; x++) grid.cells.set(row.slice(Math.max(0, x - by) * 3, Math.max(0, x - by) * 3 + 3), (y * grid.columns + x) * 3)
    }
  }
}

/** One burst every BURST_EVERY_MS at a hash-chosen moment in its slot, lasting BURST_MS. */
const BURST_EVERY_MS = 8_000
const BURST_MS = 260

/**
 * After the entry, a header glitches now and then: for a quarter second, every eight seconds or so, a few of its cells flip to an ASCII
 * character and a row may slip a cell. Quieter than the entry, and a function of the animation clock `t` alone, so a still frame (t = 0,
 * fps 0) is never glitched.
 */
function occasionalGlitch(grid: Grid, from: number, t: number): void {
  if (t <= 0) return

  const slot = Math.floor(t / BURST_EVERY_MS)
  const at = t - (slot * BURST_EVERY_MS + (hash(slot + 977) % (BURST_EVERY_MS - 1_000)))

  if (at < 0 || at >= BURST_MS) return

  const frame = Math.floor(at / 45)

  for (let y = 0; y < grid.rows; y++) {
    for (let x = from; x < grid.columns; x++) {
      if (grid.glyph(x, y) === 0x20) continue
      if (hash(x * 11 + y * 5 + frame * 31 + slot) % 100 < 3) grid.set(x, y, GLITCH[hash(x + y + frame) % GLITCH.length] as string, hash(x + frame) % 2 === 0 ? 0xff2a6d : 0x05d9e8)
    }

    if (hash(y * 3 + frame + slot) % 5 === 0) {
      const row = grid.cells.slice(y * grid.columns * 3, (y + 1) * grid.columns * 3)

      for (let x = from; x < grid.columns; x++) grid.cells.set(row.slice(Math.max(0, x - 1) * 3, Math.max(0, x - 1) * 3 + 3), (y * grid.columns + x) * 3)
    }
  }
}

/**
 * The BBS banner: the logo in a magenta-to-cyan gradient with a scanline sweeping across it (decoration), a tag line,
 * the project, and a blinking block cursor. Two rows.
 */
export function bannerPicture(project: string, columns: number, t: number, age = Infinity): Grid {
  const grid = new Grid(columns, 2)
  const width = LOGO[0].length
  const sweep = ((t / 28) % (columns + 40)) - 20

  LOGO.forEach((line, y) => {
    ;[...line].forEach((ch, x) => {
      if (ch === ' ' || x >= columns) return

      const base = mix(NEON_MAGENTA, NEON_CYAN, x / Math.max(1, width - 1))
      const glow = Math.max(0, 1 - Math.abs(x - sweep) / 4)

      grid.set(x, y, ch, mix(base, 0xffffff, glow * 0.7))
    })
  })

  const x0 = width + 2

  if (columns > x0 + 4) {
    // The version, and the git revision when the session knows it: the revision changes with every commit, so it shows which build is loaded.
    // The title, with the version and build when they fit beside the logo; when they do not, the title whole rather than cut mid-word.
    const title = '░▒▓ AGENT SWARM CONSOLE'
    const full = `${title} v${CONSOLE_VERSION}${getBuild() === '' ? '' : ` · ${getBuild()}`}`
    // The longest that fits, never cut mid-word: version and build, the title, a shorter title, the shortest.
    const room = columns - x0
    const shown = [full, title, '░▒▓ SWARM CONSOLE', '░▒▓ CONSOLE'].find(text => text.length <= room) ?? '░▒▓ CONSOLE'

    grid.text(x0, 0, shown.slice(0, room), NEON_MAGENTA)

    const line = `▸ npx ruflo · ${project}`
    const node = line.length <= room - 2 ? line : `${line.slice(0, Math.max(1, room - 3))}…`

    grid.text(x0, 1, node, NEON_CYAN)
    if (Math.floor(t / 530) % 2 === 0 && x0 + node.length + 1 < columns) grid.set(x0 + node.length + 1, 1, '█', NEON_CYAN)
  }

  strikeIn(grid, 0, age, t)

  return grid
}

const NEON_CORAL = 0xff7a59

/**
 * A view's BBS title: its name in the two-row half-block font, magenta to coral like the ANSI art boards, framed by
 * dithered ░▒▓ ramps, with a slow shimmer down the letters (decoration). Two rows.
 */
export function titlePicture(name: string, columns: number, t: number, age = Infinity): Grid {
  const grid = new Grid(columns, 2)
  const [top, bottom] = bigText(name)
  const edge = '░▒▓'
  const x0 = edge.length + 1
  const width = Math.max(top.length, bottom.length)
  const shimmer = ((t / 40) % (width + 30)) - 15
  // `RUFLO | PAGE`: the RUFLO letters move like the banner on the menu (a white glow sweeping a magenta to cyan ramp); the page's name keeps its slower coral shimmer.
  const logo = name.toLowerCase().startsWith('ruflo |') ? bigText('ruflo')[0].length : 0
  const sweep = ((t / 28) % (logo + 40)) - 20

  for (let y = 0; y < 2; y++) {
    ;[...edge].forEach((ch, i) => grid.set(i, y, ch, mix(0x3a0f2e, NEON_MAGENTA, (i + 1) / edge.length)))
    ;[...(y === 0 ? top : bottom)].forEach((ch, i) => {
      if (ch === ' ' || x0 + i >= columns) return

      if (i < logo) {
        const lit = Math.max(0, 1 - Math.abs(i - sweep) / 4)

        grid.set(x0 + i, y, ch, mix(mix(NEON_MAGENTA, NEON_CYAN, i / Math.max(1, logo - 1)), 0xffffff, lit * 0.7))

        return
      }

      const glow = Math.max(0, 1 - Math.abs(i - shimmer) / 3)

      grid.set(x0 + i, y, ch, mix(mix(NEON_MAGENTA, NEON_CORAL, i / Math.max(1, width - 1)), 0xffffff, glow * 0.6))
    })
    // The line closes on the ramp the other way round, ░▒▓, mirroring how the dark ▓▒░ edge opened it.
    ;[...'░▒▓'].forEach((ch, i) => {
      const x = x0 + width + 1 + i

      if (x < columns) grid.set(x, y, ch, mix(0x3a0f2e, NEON_MAGENTA, (i + 1) / edge.length))
    })
  }

  strikeIn(grid, x0, age, t)

  return grid
}

/**
 * The menu's palette strip: one block of each colour across the width, and a band of light that sweeps along it and starts again,
 * brightening the cells it passes (about 28 cells a second: three cells a frame at the default 8 fps, so it reads as motion, not a
 * jump). At `t` = 0 the light is off the strip and the cells are exactly the colours, so a still frame (fps 0) is the plain strip.
 * Decoration, like the boot's sign: it carries no data. A pure function of its size and the clock, as every picture here.
 */
export function palettePicture(columns: number, t: number, colors: readonly number[]): Grid {
  const grid = new Grid(columns, 1)
  const at = ((t / 36) % (columns + 24)) - 12

  for (let x = 0; x < columns; x++) {
    const base = colors[Math.min(colors.length - 1, Math.floor((x * colors.length) / columns))] ?? 0xffffff
    const glow = Math.max(0, 1 - Math.abs(x - at) / 7)

    grid.set(x, 0, '▀', mix(base, 0xffffff, glow * 0.8))
  }

  return grid
}

export function headerPicture(title: string, columns: number, t: number): Grid {
  const grid = new Grid(columns, 1)
  const at = ((t / 22) % (columns + 60)) - 20

  ;[...title.slice(0, columns)].forEach((ch, x) => {
    const glow = Math.max(0, 1 - Math.abs(x - at) / 6)

    grid.set(x, 0, ch, mix(x < 2 ? COLOR.accent : COLOR.dim, 0xffffff, glow * 0.8))
  })

  return grid
}
