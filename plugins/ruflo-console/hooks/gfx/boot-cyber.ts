/**
 * The boot log under the RuFlo sign, drawn as a cyberpunk uplink from real data (ADR-432): a title strip that scrambles into place,
 * the ruvector constellation (a star is lit only if boot-facts found evidence for it, and data pulses run only along lines whose two
 * ends are both lit), a signal row of the project's real numbers, a scan grid of every console area with the self-check's verdict, and a
 * READY line that says "ALL STARS ALIGNED" only when every star is lit and every area verified. Everything is a function of the age in
 * ms and a hash of it, never of a random number, so a frame is reproducible. One easter egg sits in the middle of the boot.
 */
import type { BootCheck } from '../boot-checks'
import type { BootFacts, Star } from '../boot-facts'
import { Grid } from './raster'

const GREEN = 0x39ff14
const CYAN = 0x05d9e8
const PINK = 0xff2a6d
const AMBER = 0xffb000
const DIM = 0x6b7280
const WHITE = 0xe6e6e6

/** The log starts here (the sign has struck and the handshake is typed), and one area is scanned every SCAN_MS. */
export const CYBER_FROM_MS = 1500
const SCAN_MS = 100
/** How long a constellation line takes to draw out. */
const EDGE_MS = 350
/** The easter egg's window: a ghost signal in the signal row. */
export const EGG_FROM_MS = 2400
export const EGG_TO_MS = 3800

/** The scan grid's names, shortened where the full one would not fit its cell (the checks are still keyed by the full name). */
export const SCAN_NAMES: Readonly<Record<string, string>> = { MetaHarness: 'Harness', 'Self-Evolution': 'Evolution', 'Plugins & Mods': 'Plugins', 'Plugin Catalog': 'Catalog', 'Cost & Budget': 'Cost', Performance: 'Perf', 'AI Terminal': 'Terminal' }
/** How many characters of a name its cell holds. */
export const SCAN_NAME_CELLS = 10

/** The constellation's height: seven rows when the pane has room, five (the same nine stars, closer together) when it is shorter. */
const CONST_ROWS = 7
const COMPACT_ROWS = 5
const CELL = 18
/** The narrowest pane the uplink is drawn in: below it the plain boot log. Its text fits the width it is given (see `fit`). */
const MIN_COLUMNS = 48

/** The first of `variants` that fits `columns`, else the last cut to fit: the long form when there is room, never a sentence cut mid-word. */
const fit = (columns: number, variants: readonly string[]): string => variants.find(text => text.length <= columns) ?? (variants.at(-1) as string).slice(0, columns)

/** A deterministic hash, 0 to 0xffffffff. */
export const hash = (n: number): number => {
  let x = Math.imul(n | 0, 0x9e3779b1) >>> 0

  x ^= x >>> 15
  x = Math.imul(x, 0x85ebca6b) >>> 0
  x ^= x >>> 13

  return x >>> 0
}

const NOISE = '01#%$&▒░<>/\\'

/** `text` resolved from the left over `span` ms from `from`: characters not yet resolved are noise, so it scrambles into place. */
export function scramble(text: string, age: number, from: number, span: number): string {
  if (age < from) return ''

  const settled = Math.floor(((age - from) / span) * text.length)

  return [...text].map((ch, i) => (i < settled || ch === ' ' ? ch : (NOISE[hash(i * 31 + Math.floor(age / 55)) % NOISE.length] as string))).join('')
}

/** The ghost signal's text at `age`: three bytes of binary that decode, byte by byte, into rUv. */
export function eggText(age: number, withTail = true): string {
  const bytes = [...'rUv'].map(ch => ch.charCodeAt(0).toString(2).padStart(8, '0'))
  const shown = Math.min(1, Math.max(0, (age - EGG_FROM_MS) / 1100))
  const bits = bytes.join(' ')
  const lit = Math.floor(shown * bits.length)
  const done = shown >= 1

  return `${bits.slice(0, lit)}${bits.slice(lit).replace(/[01]/g, (_m, at: number) => (hash(at + Math.floor(age / 70)) % 2 === 0 ? '0' : '1'))}${done ? (withTail ? '  =  rUv · the stars were always there' : '  =  rUv') : ''}`
}

const cellOf = (star: Star, left: number, width: number, top: number, rows: number): { x: number; y: number } => ({
  x: left + Math.round(star.x * Math.max(0, width - star.label.length - 3)),
  y: top + Math.round(star.y * (rows - 1)),
})

/** The cells of a straight line between two points, ends excluded. */
function line(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number }[] {
  const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  const out: { x: number; y: number }[] = []

  for (let i = 1; i < steps; i++) out.push({ x: Math.round(a.x + ((b.x - a.x) * i) / steps), y: Math.round(a.y + ((b.y - a.y) * i) / steps) })

  return out
}

function constellation(grid: Grid, facts: BootFacts, age: number, top: number, waveFrom: number, rows: number): void {
  const width = Math.min(grid.columns, 74)
  const left = Math.floor((grid.columns - width) / 2)
  const place = new Map(facts.stars.map(star => [star.id, cellOf(star, left, width, top, rows)]))
  const visible = (star: Star): boolean => age >= CYBER_FROM_MS + star.appearAt
  const byId = new Map(facts.stars.map(star => [star.id, star]))

  facts.links.forEach(([from, to], index) => {
    const a = byId.get(from)
    const b = byId.get(to)
    const pa = place.get(from)
    const pb = place.get(to)

    if (a === undefined || b === undefined || pa === undefined || pb === undefined || !visible(a) || !visible(b)) return

    // The line draws outward from its first end over EDGE_MS once both stars are up, so the constellation wires itself together.
    const both = CYBER_FROM_MS + Math.max(a.appearAt, b.appearAt)
    const cells = line(pa, pb).slice(0, Math.ceil(Math.min(1, (age - both) / EDGE_MS) * line(pa, pb).length))
    const live = a.alive && b.alive
    // A pulse travels a lit line from one end to the other; a line with a dark end stays a faint dotted trace and carries nothing.
    const pulse = live && cells.length === line(pa, pb).length && cells.length > 0 ? Math.floor(((age / 1100 + index * 0.37) % 1) * cells.length) : -1

    cells.forEach((cell, i) => {
      if (live) grid.set(cell.x, cell.y, i === pulse ? '●' : '·', i === pulse ? WHITE : CYAN)
      else if ((i + index) % 2 === 0) grid.set(cell.x, cell.y, '·', DIM)
    })
  })

  for (const star of facts.stars) {
    const at = place.get(star.id)

    if (at === undefined || !visible(star)) continue

    const since = age - CYBER_FROM_MS - star.appearAt
    const flicker = hash(star.appearAt + Math.floor(age / 260)) % 5 === 0
    // A star locks on with a flash; a dark one tries to light and fails, flickering for a moment before it settles as an empty star.
    const lockOn = star.alive && since < 350
    const trying = !star.alive && since < 700 && Math.floor(since / 70) % 2 === 1
    // Once the scan is done a wave of light runs across the lit stars.
    const wave = star.alive && age >= waveFrom && Math.abs(((age - waveFrom) / 1500) % 1.3 - 0.15 - star.x) < 0.1
    const glyph = lockOn ? '✺' : trying ? ' ' : star.alive ? (flicker ? '✦' : '★') : '☆'
    const color = lockOn || wave ? WHITE : star.alive ? (star.id === 'ruflo' ? AMBER : GREEN) : DIM

    grid.set(at.x, at.y, glyph, color)
    grid.text(at.x + 2, at.y, star.label, star.alive ? WHITE : DIM)
  }
}

/** The signal row: the project's real numbers two at a time, or the easter egg while it is on. */
function signal(grid: Grid, facts: BootFacts, age: number, y: number): void {
  if (age >= EGG_FROM_MS && age <= EGG_TO_MS) {
    grid.text(0, y, `░ ${eggText(age, grid.columns >= 72)}`.slice(0, grid.columns), PINK)

    return
  }

  if (facts.stats.length === 0) {
    grid.text(0, y, '▸ no live swarm data yet: a quiet project is a clean slate', DIM)

    return
  }

  const first = Math.floor(age / 700) % facts.stats.length
  const picks = [facts.stats[first], facts.stats[(first + 1) % facts.stats.length]].filter((entry, i, all) => entry !== undefined && all.indexOf(entry) === i)

  grid.text(0, y, `▸ ${picks.map(entry => `${entry?.label} ${entry?.value}`).join('  ·  ')}`.slice(0, grid.columns), CYAN)
}

/**
 * Draws the cyberpunk log into `grid` below row `top`, in `room` rows. Returns false, drawing nothing, when the grid is too narrow
 * or too short for it, so the caller keeps the plain boot log.
 */
export function drawCyber(grid: Grid, facts: BootFacts, modules: readonly { name: string }[], checks: readonly BootCheck[] | undefined, age: number, top: number, room: number): boolean {
  const columns = grid.columns
  const per = Math.max(1, Math.floor(columns / CELL))
  const scanRows = Math.ceil(modules.length / per)
  // The full constellation if the pane has the rows, else the compact one, else none: the title, the signal row, the scan and READY always.
  const constRows = room >= 1 + CONST_ROWS + 1 + scanRows + 1 ? CONST_ROWS : room >= 1 + COMPACT_ROWS + 1 + scanRows + 1 ? COMPACT_ROWS : 0
  const withMap = constRows > 0
  const needed = 1 + 1 + scanRows + 1

  if (columns < MIN_COLUMNS || room < needed) return false

  let y = top

  // Title strip: scrambles into place, with a brief pink glitch now and then.
  const glitch = age > 3000 && Math.floor(age / 40) % 53 === 0
  const build = facts.build !== '' ? ` · ${facts.build}` : ''
  const title = fit(columns, [`▌ ${facts.title} ▐  ${facts.credit} · ruflo v${facts.version}${build}`, `▌ ${facts.title} ▐  ${facts.credit} · v${facts.version}`, `▌ RUV.NET // RUVECTOR ▐  ${facts.credit} · v${facts.version}`, `▌ RUV.NET ▐ ${facts.credit} · v${facts.version}`])

  grid.text(0, y, scramble(title, age, CYBER_FROM_MS - 200, 900).slice(0, columns), glitch ? PINK : CYAN)
  y += 1

  if (withMap) {
    constellation(grid, facts, age, y, CYBER_FROM_MS + modules.length * SCAN_MS + SCAN_MS, constRows)
    y += constRows
  }

  signal(grid, facts, age, y)
  y += 1

  // The scan grid: [ .. ] while an area is being read, then its verdict from the self-check.
  const failed = modules.filter(entry => checks?.find(result => result.area === entry.name)?.ok === false)

  modules.forEach((entry, i) => {
    const startedAt = CYBER_FROM_MS + i * SCAN_MS

    if (age < startedAt) return

    const x = (i % per) * CELL
    const row = y + Math.floor(i / per)
    const isOn = age >= startedAt + SCAN_MS
    const bad = isOn && failed.includes(entry)

    grid.text(x, row, bad ? '[FAIL]' : isOn ? '[ OK ]' : '[ .. ]', bad ? PINK : isOn ? GREEN : CYAN)
    grid.text(x + 7, row, (SCAN_NAMES[entry.name] ?? entry.name).slice(0, SCAN_NAME_CELLS), bad ? PINK : isOn ? WHITE : CYAN)
  })
  y += scanRows

  // READY: the claim is only as big as the evidence.
  const scanEnd = CYBER_FROM_MS + modules.length * SCAN_MS + SCAN_MS
  const dark = facts.stars.filter(star => !star.alive).length

  if (age >= scanEnd) {
    const verified = modules.length - failed.length
    const aligned = dark === 0 && failed.length === 0
    const tags = `${failed.length > 0 ? ` · ${failed.length} failed` : ''}${dark > 0 ? ` · ${dark} star${dark === 1 ? '' : 's'} dark` : ''}`
    const mark = aligned ? '[ OK ]' : failed.length > 0 ? '[FAIL]' : '[WARN]'
    // The long sentence when it fits, else shorter ones, never cut mid-word.
    const text = aligned
      ? fit(columns - 7, [`ALL STARS ALIGNED · ${verified} areas verified · press a key or click`, `ALL STARS ALIGNED · ${verified} verified · press a key`, 'ALL STARS ALIGNED'])
      : fit(columns - 7, [`READY · ${verified} of ${modules.length} areas verified${tags} · press a key or click`, `READY · ${verified}/${modules.length} verified${tags} · press a key`, `READY · ${verified}/${modules.length}${tags}`])

    grid.text(0, y, `${mark} ${text}`.slice(0, columns), aligned ? GREEN : failed.length > 0 ? PINK : AMBER)
  }

  return true
}
