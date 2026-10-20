/**
 * Pictures of the Events and Timeline pages (ADR-474): a stacked activity chart and the Timeline's lanes. Pure functions of data that
 * return a Grid; both have a text twin built from the same data (views/events-parts.ts, views/timeline.ts).
 */
import type { Line, Tone } from '../data/timeline-lines'
import type { Bars } from '../data/event-stats'
import { COLOR, Grid, mix } from './raster'

const TONE: Record<Tone, number> = { busy: COLOR.warn, idle: mix(COLOR.info, 0x000000, 0.3), tool: 0xffffff, none: COLOR.line, warn: COLOR.warn, bad: COLOR.bad, dim: COLOR.dim, plain: 0xd0d0d0 }

/** Bars stacked by key: each column is one bucket, filled from the bottom in the keys' colours, scaled to the tallest bucket. */
export function stackedPicture(data: Bars, colors: readonly number[], columns: number, rows: number): Grid {
  const grid = new Grid(columns, rows)
  const totals = data.stacks.map(stack => stack.reduce((a, b) => a + b, 0))
  const top = Math.max(1, ...totals)
  const width = Math.max(1, Math.min(3, Math.floor((columns - 6) / Math.max(1, data.stacks.length))))

  grid.text(0, 0, String(top).padStart(4), COLOR.dim)
  grid.text(0, rows - 1, '   0', COLOR.dim)

  data.stacks.forEach((stack, i) => {
    const high = totals[i] === 0 ? 0 : Math.max(1, Math.round(((totals[i] as number) / top) * rows))
    let drawn = 0
    let acc = 0

    stack.forEach((n, k) => {
      acc += n

      const upTo = totals[i] === 0 ? 0 : Math.round((acc / (totals[i] as number)) * high)

      for (; drawn < upTo; drawn++) for (let w = 0; w < width; w++) grid.set(5 + i * width + w, rows - 1 - drawn, '█', colors[k] ?? COLOR.info)
    })

    if (high === 0) grid.set(5 + i * width, rows - 1, '·', COLOR.line)
  })

  return grid
}

/** The lines of data/timeline-lines.ts, one grid row each. */
export function linesPicture(lines: readonly Line[], columns: number): Grid {
  const grid = new Grid(columns, Math.max(1, lines.length))

  lines.forEach((line, y) => {
    grid.text(0, y, line.label, line.isCursor === true ? 0xffffff : line.kind === 'group' ? COLOR.accent : 0xd0d0d0)

    const x0 = line.label.length + 1

    line.cells.forEach((cell, x) => grid.set(x0 + x, y, cell.ch, TONE[cell.tone]))
  })

  return grid
}
