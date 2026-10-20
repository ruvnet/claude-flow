/**
 * The federation map, the plugin health matrix and the agent timeline. Pure functions of data, size and the real clock.
 */
import { Braille, COLOR, Grid, mix } from './raster'

export type FedNode = { label: string; trust: 'pinned' | 'channel' | 'key' | 'roster'; /** When traffic was last seen with it. */ trafficAtMs?: number }

const TRUST_COLOR: Record<FedNode['trust'], number> = { pinned: COLOR.ok, channel: COLOR.info, key: COLOR.accent, roster: COLOR.dim }
/** Dots drawn per step along an edge: solid for a pinned peer, dashed for a channel, sparse for an untrusted member. */
const TRUST_DASH: Record<FedNode['trust'], number> = { pinned: 1, key: 1, channel: 2, roster: 4 }

/**
 * This node in the middle, the others around it, each edge drawn by trust: solid (pinned peer, own key), dashed
 * (channel), sparse (roster member, unvetted). A dot runs along an edge for 2 s after traffic with that node (data).
 */
export function federationPicture(center: string, nodes: readonly FedNode[], columns: number, rows: number, t: number): Grid {
  const grid = new Grid(columns, rows)
  const canvas = new Braille(columns, rows)
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  const r = Math.max(4, Math.min(canvas.height / 2 - 3, canvas.width / 4 - 4))
  const shown = nodes.slice(0, 16)
  const points = shown.map((_, i) => {
    const angle = -Math.PI / 2 + (i / Math.max(1, shown.length)) * Math.PI * 2

    return { x: cx + Math.cos(angle) * r * 2, y: cy + Math.sin(angle) * r }
  })

  shown.forEach((node, i) => {
    const p = points[i] as { x: number; y: number }
    const steps = Math.ceil(Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy)))
    const dash = TRUST_DASH[node.trust]

    for (let s = 0; s <= steps; s += dash) canvas.dot(cx + ((p.x - cx) * s) / steps, cy + ((p.y - cy) * s) / steps, mix(TRUST_COLOR[node.trust], 0x000000, 0.35))

    const k = node.trafficAtMs === undefined ? -1 : ((t - node.trafficAtMs) % 1_000) / 1_000

    if (node.trafficAtMs !== undefined && t - node.trafficAtMs >= 0 && t - node.trafficAtMs < 2_000 && k >= 0) {
      canvas.dot(cx + (p.x - cx) * k, cy + (p.y - cy) * k, 0xffffff)
      canvas.dot(cx + (p.x - cx) * k + 1, cy + (p.y - cy) * k, 0xffffff)
    }
  })

  canvas.blitInto(grid, 0, 0)

  const ccx = Math.floor(cx / 2)
  const ccy = Math.floor(cy / 4)

  grid.set(ccx, ccy, '◉', COLOR.accent)
  grid.text(Math.max(0, ccx - Math.floor(center.length / 2)), Math.min(rows - 1, ccy + 1), center, COLOR.accent)

  shown.forEach((node, i) => {
    const p = points[i] as { x: number; y: number }
    const x = Math.floor(p.x / 2)
    const y = Math.floor(p.y / 4)
    const label = node.label.slice(0, 14)

    grid.set(x, y, node.trust === 'roster' ? '○' : '●', TRUST_COLOR[node.trust])
    grid.text(Math.max(0, Math.min(columns - label.length, x - Math.floor(label.length / 2))), Math.min(rows - 1, y + 1), label, TRUST_COLOR[node.trust])
  })

  if (nodes.length > shown.length) grid.text(0, rows - 1, `+${nodes.length - shown.length} more`, COLOR.dim)

  return grid
}

export type HealthRow = { name: string; cells: (boolean | null)[] }

/** A health matrix: one row per plugin, a coloured block per check (green yes, red no, grey unknown), two columns wide. */
export function heatmapPicture(rows: readonly HealthRow[], checks: readonly string[], columns: number, height: number): Grid {
  const grid = new Grid(columns, height)
  const half = Math.floor(columns / 2)
  const nameWidth = Math.max(6, half - checks.length * 2 - 2)
  const perColumn = height - 1

  for (let side = 0; side < 2; side++) {
    checks.forEach((check, c) => grid.text(side * half + nameWidth + c * 2, 0, check.slice(0, 1).toUpperCase(), COLOR.dim))
  }

  rows.slice(0, perColumn * 2).forEach((row, i) => {
    const side = Math.floor(i / perColumn)
    const y = 1 + (i % perColumn)
    const x0 = side * half

    grid.text(x0, y, row.name.slice(0, nameWidth - 1), 0xd0d0d0)
    row.cells.forEach((cell, c) => grid.set(x0 + nameWidth + c * 2, y, cell === null ? '·' : '■', cell === null ? COLOR.dim : cell ? COLOR.ok : COLOR.bad))
  })

  return grid
}

export type Lane = { label: string; spans: { fromMs: number; toMs: number; busy: boolean }[]; ticks: number[] }

/**
 * Agents × time: a row per agent over [fromMs, toMs], busy stretches amber, idle blue, a white tick per tool call the
 * console saw. Only what was observed since the console loaded is drawn; before that the row is blank.
 */
export function ganttPicture(lanes: readonly Lane[], columns: number, fromMs: number, toMs: number): Grid {
  const rows = Math.max(2, Math.min(lanes.length, 30) + 1)
  const grid = new Grid(columns, rows)
  const labelWidth = Math.min(16, Math.max(6, ...lanes.map(lane => lane.label.length + 1)))
  const width = Math.max(4, columns - labelWidth)
  const xOf = (ms: number) => labelWidth + Math.floor(((ms - fromMs) / Math.max(1, toMs - fromMs)) * (width - 1))
  const minutes = Math.max(1, Math.round((toMs - fromMs) / 60_000))

  grid.text(labelWidth, 0, `${minutes}m ago`, COLOR.dim)
  grid.text(columns - 4, 0, 'now▾', COLOR.dim)

  lanes.slice(0, rows - 1).forEach((lane, i) => {
    const y = i + 1

    grid.text(0, y, lane.label.slice(0, labelWidth - 1), 0xd0d0d0)

    for (const span of lane.spans) {
      for (let x = Math.max(labelWidth, xOf(span.fromMs)); x <= Math.min(columns - 1, xOf(span.toMs)); x++) grid.set(x, y, span.busy ? '█' : '▁', span.busy ? COLOR.warn : mix(COLOR.info, 0x000000, 0.3))
    }

    for (const tick of lane.ticks) {
      if (tick >= fromMs) grid.set(Math.min(columns - 1, xOf(tick)), y, '▮', 0xffffff)
    }
  })

  return grid
}
