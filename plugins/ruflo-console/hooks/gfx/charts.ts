/**
 * Charts for the learning, MetaHarness and cost views: the learning pipeline, a score radar, a trend line, a budget
 * gauge and a sparkline over timed samples. Pure functions of data, size and the real clock; each returns a grid of
 * exactly the size asked for.
 */
import { Braille, COLOR, Grid, mix, ramp, sparkline } from './raster'

export type Stage = { name: string; count: number | null; source: string }

/**
 * RETRIEVE → JUDGE → DISTILL → CONSOLIDATE as four boxes with their counts. When a count grew in the last 1.5 s a dot
 * runs along the arrow into that stage: the motion is new learning arriving, nothing else.
 */
export function pipelinePicture(stages: readonly Stage[], columns: number, t: number, grewAtMs: readonly (number | null)[]): Grid {
  const rows = 4
  const grid = new Grid(columns, rows)
  const n = Math.max(1, stages.length)
  const box = Math.max(8, Math.floor((columns - (n - 1) * 3) / n))

  stages.forEach((stage, i) => {
    const x0 = i * (box + 3)
    const count = stage.count === null ? 'n/a' : stage.count >= 10_000 ? `${(stage.count / 1000).toFixed(1)}k` : String(stage.count)
    const grew = grewAtMs[i] ?? null
    const lit = grew !== null && t - grew >= 0 && t - grew < 1_500

    grid.text(x0, 0, `╭${'─'.repeat(box - 2)}╮`, lit ? COLOR.warn : COLOR.line)
    grid.text(x0, 1, `│${stage.name.padEnd(box - 2).slice(0, box - 2)}│`, COLOR.accent)
    grid.text(x0, 2, `│${count.padStart(box - 2).slice(0, box - 2)}│`, stage.count === null ? COLOR.dim : ramp(0.7))
    grid.text(x0, 3, `╰${'─'.repeat(box - 2)}╯`, lit ? COLOR.warn : COLOR.line)

    if (i > 0) {
      const ax = x0 - 3

      grid.text(ax, 1, '──▶', COLOR.line)

      if (lit) grid.set(ax + Math.min(2, Math.floor(((t - (grew ?? 0)) / 500) % 3)), 1, '●', COLOR.warn)
    }
  })

  return grid
}

/**
 * A radar of 0-100 scores on equal axes (braille): rings at 25/50/75/100 and the polygon of the values, which grows to
 * full size over 700 ms after `sinceMs` (decoration). Axis labels sit at each spoke's end.
 */
export function radarPicture(dims: readonly { name: string; value: number }[], columns: number, rows: number, t: number, sinceMs: number): Grid {
  const grid = new Grid(columns, rows)
  const canvas = new Braille(columns, rows)
  const n = dims.length
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const r = Math.max(3, Math.min(canvas.height / 2 - 3, canvas.width / 4 - 6))
  const grow = 1 - (1 - Math.max(0, Math.min(1, (t - sinceMs) / 700))) ** 3
  const at = (i: number, value: number) => {
    const angle = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2

    return { x: cx + Math.cos(angle) * r * 2 * value, y: cy + Math.sin(angle) * r * value }
  }

  if (n < 3) return grid

  for (const ring of [0.25, 0.5, 0.75, 1]) {
    for (let i = 0; i < n; i++) {
      const p = at(i, ring)
      const q = at((i + 1) % n, ring)

      canvas.line(p.x, p.y, q.x, q.y, ring === 1 ? COLOR.line : mix(COLOR.line, 0x000000, 0.4))
    }
  }

  for (let i = 0; i < n; i++) {
    const p = at(i, 1)

    canvas.line(cx, cy, p.x, p.y, mix(COLOR.line, 0x000000, 0.4))
  }

  for (let i = 0; i < n; i++) {
    const a = dims[i] as { value: number }
    const b = dims[(i + 1) % n] as { value: number }
    const p = at(i, (a.value / 100) * grow)
    const q = at((i + 1) % n, (b.value / 100) * grow)

    canvas.line(p.x, p.y, q.x, q.y, ramp(((a.value + b.value) / 200) * 0.9 + 0.1))
  }

  canvas.blitInto(grid, 0, 0)

  dims.forEach((dim, i) => {
    const p = at(i, 1.18)
    const label = `${dim.name.slice(0, 10)} ${Math.round(dim.value)}`
    const x = Math.round(p.x / 2 - (Math.cos(-Math.PI / 2 + (i / n) * Math.PI * 2) < -0.2 ? label.length : Math.cos(-Math.PI / 2 + (i / n) * Math.PI * 2) > 0.2 ? 0 : label.length / 2))

    grid.text(Math.max(0, Math.min(columns - label.length, x)), Math.max(0, Math.min(rows - 1, Math.round(p.y / 4))), label, ramp(dim.value / 100))
  })

  return grid
}

/** A braille line over points 0..`max`, oldest left, with the axis words given; one point or none is said in words. */
export function trendPicture(values: readonly number[], columns: number, rows: number, max: number, words: { top: string; bottom: string; empty: string }): Grid {
  const grid = new Grid(columns, rows)
  const label = Math.max(words.top.length, words.bottom.length) + 1
  const canvas = new Braille(Math.max(1, columns - label), rows)

  grid.text(0, 0, words.top, COLOR.dim)
  grid.text(0, rows - 1, words.bottom, COLOR.dim)

  if (values.length < 2) {
    grid.text(label + 1, Math.floor(rows / 2), words.empty, COLOR.dim)

    return grid
  }

  const xOf = (i: number) => (i / (values.length - 1)) * (canvas.width - 1)
  const yOf = (v: number) => (1 - Math.max(0, Math.min(1, v / max))) * (canvas.height - 1)

  for (let i = 1; i < values.length; i++) canvas.line(xOf(i - 1), yOf(values[i - 1] as number), xOf(i), yOf(values[i] as number), ramp(1 - (values[i] as number) / max))

  canvas.blitInto(grid, label, 0)

  return grid
}

/**
 * Spend against a budget as a half-ring gauge: the arc is coloured by the ladder (green to 50%, amber to 90%, red past),
 * the needle at spend / limit. With no limit the arc is grey and the needle absent: there is nothing to measure against.
 */
export function gaugePicture(spend: number | null, limit: number | null, columns: number, rows: number): Grid {
  const grid = new Grid(columns, rows)
  const canvas = new Braille(columns, rows)
  const cx = canvas.width / 2
  const cy = canvas.height - 2
  const r = Math.max(4, Math.min(canvas.height - 4, canvas.width / 4))
  const point = (fraction: number, radius: number) => ({ x: cx - Math.cos(fraction * Math.PI) * radius * 2, y: cy - Math.sin(fraction * Math.PI) * radius })

  for (let i = 0; i <= 120; i++) {
    const f = i / 120
    const p = point(f, r)
    const color = limit === null ? COLOR.line : f < 0.5 ? COLOR.ok : f < 0.9 ? COLOR.warn : COLOR.bad

    canvas.dot(p.x, p.y, color)
  }

  if (spend !== null && limit !== null && limit > 0) {
    const f = Math.max(0, Math.min(1, spend / limit))
    const tip = point(f, r * 0.9)

    canvas.line(cx, cy, tip.x, tip.y, 0xffffff)
  }

  canvas.blitInto(grid, 0, 0)

  const words = limit === null ? 'no budget set' : spend === null ? `limit $${limit.toFixed(2)} · spend n/a` : `$${spend.toFixed(2)} of $${limit.toFixed(2)} (${Math.round((spend / limit) * 100)}%)`

  grid.text(Math.max(0, Math.floor((columns - words.length) / 2)), rows - 1, words, limit === null ? COLOR.dim : 0xffffff)

  return grid
}

/** A labelled sparkline over timed samples (oldest left), scaled between their own min and max. */
export function samplesPicture(label: string, samples: readonly { value: number }[], columns: number): Grid {
  const grid = new Grid(columns, 1)
  const width = Math.max(4, columns - label.length - 1)
  const values = samples.map(sample => sample.value)
  const lo = Math.min(...values, Number.POSITIVE_INFINITY)

  grid.text(0, 0, label, COLOR.dim)
  sparkline(grid, label.length + 1, 0, width, values.map(value => value - (Number.isFinite(lo) ? lo : 0) + (values.length > 0 ? 1 : 0)), v => ramp(0.3 + v * 0.6))

  return grid
}
