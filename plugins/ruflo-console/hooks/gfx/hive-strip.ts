/**
 * The hive's strip under the chambers: on the left a shield showing how many faulty workers the strategy survives (f of
 * n, one pip per worker, the survivable ones gold; dim and n/a where the CLI states no bound), on the right the term
 * timeline (the current queen's election, the decisions and openings on record, each where its timestamp falls) over
 * the pheromone ticker: the shared-memory broadcasts, newest first. A broadcast the console has just seen slides in
 * from the left for HIVE_PULSE_MS, pushing the older ones along; otherwise the strip is still. Terms are marked only
 * where the file records them: an earlier term's start is never inferred.
 */
import { HIVE_PULSE_MS } from '../data/hive'
import { Grid } from './raster'
import { addLight, HIVE_COLOR } from './hive'

export type Shield = { faulty: number; of: number; rule: string } | null

export type Mark = { atMs: number; kind: 'opened' | 'passed' | 'failed'; label: string; term?: number }

export type Pheromone = { id: string; text: string; isLoud: boolean; arrivedAtMs: number }

export type StripModel = {
  shield: Shield
  strategy: string
  startMs: number
  /** The axis ends at the hive's last write, not the clock, so the marks hold still between writes. */
  endMs: number
  term?: number
  electedAtMs?: number
  marks: Mark[]
  pheromones: Pheromone[]
  keys: string[]
}

export const STRIP_ROWS = 7
const SHIELD_W = 12
const MAX_PIPS = 8
const SHIELD = ['╭──────────╮', '│          │', '│          │', '│          │', '╰╮        ╭╯', ' ╰─╮    ╭─╯', '   ╰────╯'] as const
const MARK: Record<Mark['kind'], [string, number]> = { opened: ['◇', HIVE_COLOR.yellow], passed: ['✔', HIVE_COLOR.green], failed: ['✘', HIVE_COLOR.pink] }

function drawShield(grid: Grid, shield: Shield, strategy: string): void {
  const isNa = shield === null
  const tone = isNa ? HIVE_COLOR.wall : shield.faulty === 0 ? HIVE_COLOR.pink : HIVE_COLOR.cyan
  const bg = isNa ? undefined : shield.faulty === 0 ? 0x5f0000 : 0x005f5f

  // The walls in the strategy's tone; the face between them lit (cyan when it survives a fault, red when it survives none).
  SHIELD.forEach((line, y) => {
    const first = line.search(/\S/)
    const last = line.trimEnd().length - 1

    ;[...line].forEach((ch, x) => {
      if (ch !== ' ') grid.set(x, y, ch, tone)
      else if (x > first && x < last) grid.set(x, y, ' ', HIVE_COLOR.white, bg)
    })
  })

  if (shield === null) {
    grid.text(3, 1, 'f n/a', HIVE_COLOR.grey)
    grid.text(2, 2, strategy.slice(0, 8), HIVE_COLOR.grey)
    grid.text(2, 3, 'no bound', HIVE_COLOR.wall)

    return
  }

  grid.text(2, 1, `f ${shield.faulty}`.padEnd(4), HIVE_COLOR.gold, bg)
  grid.text(6, 1, `of ${shield.of}`.slice(0, 5), HIVE_COLOR.white, bg)
  grid.text(2, 2, shield.rule.split(' ').slice(1).join('').slice(0, 8), addLight(tone, HIVE_COLOR.white, 0.3), bg)

  // One pip per worker, the ones the strategy survives losing in gold.
  const pips = Math.min(MAX_PIPS, shield.of)

  for (let i = 0; i < pips; i++) grid.set(2 + i, 3, i < shield.faulty ? '◆' : '◇', i < shield.faulty ? HIVE_COLOR.gold : HIVE_COLOR.white, bg)
  if (shield.of > MAX_PIPS) grid.set(2 + MAX_PIPS, 3, '+', HIVE_COLOR.white, bg)
  grid.text(3, 4, strategy.slice(0, 6), tone, bg)
}

/** The column a time falls in on an axis `width` cells wide from `startMs` to `endMs`. */
export function axisAt(atMs: number, startMs: number, endMs: number, width: number): number {
  const span = Math.max(1, endMs - startMs)

  return Math.max(0, Math.min(width - 1, Math.round(((atMs - startMs) / span) * (width - 1))))
}

function drawTimeline(grid: Grid, model: StripModel, x0: number, width: number): void {
  const at = (ms: number) => x0 + axisAt(ms, model.startMs, model.endMs, width)
  const elected = model.electedAtMs === undefined ? null : at(model.electedAtMs)

  grid.text(x0, 0, 'TERMS', HIVE_COLOR.pink)

  // The axis: the current term from its election on in cyan, before it grey (a term the file does not date is unlabelled).
  for (let i = 0; i < width; i++) grid.set(x0 + i, 2, '━', elected !== null && x0 + i >= elected ? HIVE_COLOR.cyan : HIVE_COLOR.wall)

  for (const term of [...new Set(model.marks.flatMap(mark => (mark.term !== undefined && mark.term !== model.term ? [mark.term] : [])))]) {
    const first = model.marks.find(mark => mark.term === term)

    if (first !== undefined) grid.text(at(first.atMs), 1, `T${term}`, HIVE_COLOR.grey)
  }

  if (elected !== null) grid.text(elected, 1, `♛T${model.term ?? '?'}`, HIVE_COLOR.gold)

  for (const mark of model.marks) {
    const [ch, color] = MARK[mark.kind]
    const x = at(mark.atMs)

    grid.set(x, 2, ch, color)
    if (grid.glyph(x, 3) === 0x20) grid.text(x, 3, mark.label.slice(0, 5), addLight(0x000000, color, 0.7))
  }

  const right = 'last write'

  grid.text(x0 + width - right.length, 1, right, HIVE_COLOR.grey)
}

/** Each pheromone's ticker text, newest first, joined by a hex separator. */
export const tickerText = (pheromones: readonly Pheromone[]): string => pheromones.map(entry => entry.text).join('  ⬡  ')

/** How far the ticker has slid at `t`: the newest pheromone's whole width while it has just arrived, easing to 0. */
export function tickerShift(pheromones: readonly Pheromone[], t: number): number {
  const newest = pheromones[0]

  if (newest === undefined) return 0

  const age = t - newest.arrivedAtMs

  if (age < 0 || age >= HIVE_PULSE_MS) return 0

  const k = 1 - age / HIVE_PULSE_MS

  return Math.round(k * k * (newest.text.length + 5))
}

function drawTicker(grid: Grid, model: StripModel, x0: number, width: number, t: number): void {
  grid.text(x0, 4, `PHEROMONES ${model.pheromones.length}`, HIVE_COLOR.pink)

  if (model.pheromones.length === 0) {
    grid.text(x0, 5, 'no broadcasts in the shared memory yet', HIVE_COLOR.wall)
  } else {
    const shift = tickerShift(model.pheromones, t)
    let x = x0 - shift

    model.pheromones.forEach((entry, i) => {
      const color = i === 0 && shift > 0 ? HIVE_COLOR.white : entry.isLoud ? HIVE_COLOR.yellow : HIVE_COLOR.cyan

      for (const ch of `${i > 0 ? '  ⬡  ' : ''}${entry.text}`) {
        if (x >= x0 && x < x0 + width) grid.set(x, 5, ch, ch === '⬡' ? HIVE_COLOR.wall : color)
        x += 1
      }
    })
  }

  const keys = model.keys.length === 0 ? 'no shared-memory keys' : model.keys.map(key => `⬢ ${key}`).join('  ')

  grid.text(x0, 6, keys.slice(0, width), HIVE_COLOR.wall)
}

export function stripPicture(model: StripModel, columns: number, t: number): Grid {
  const grid = new Grid(columns, STRIP_ROWS)
  const x0 = SHIELD_W + 2
  const width = Math.max(10, columns - x0 - 1)

  drawShield(grid, model.shield, model.strategy)
  drawTimeline(grid, model, x0, width)
  drawTicker(grid, model, x0, width, t)

  return grid
}
