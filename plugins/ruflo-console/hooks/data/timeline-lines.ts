/**
 * The Timeline page as lines of coloured cells (ADR-474): one axis line, one line for the events, a header per lane group, a line per
 * lane and a parallelism strip. The same lines are drawn as a picture where the terminal has a Raster, and as text where it has not:
 * the two carry exactly the same information because they are built from this one list. Pure.
 */
import type { LaneStore, LaneView, Span } from './timeline-model'
import { axisLine, cellsOf, markerIndex } from './timeline-model'
import type { Concurrency } from './timeline-model'
import type { ConsoleEvent } from './events'

export type Tone = 'busy' | 'idle' | 'tool' | 'none' | 'warn' | 'bad' | 'dim' | 'plain'
export type Cell = { ch: string; tone: Tone }
export type Line = { kind: 'axis' | 'events' | 'group' | 'lane' | 'conc'; label: string; cells: Cell[]; laneId?: string; isCursor?: boolean }

const BLOCKS = '▁▂▃▄▅▆▇█'
const CELL: Cell[] = [
  { ch: '·', tone: 'none' },
  { ch: '▁', tone: 'idle' },
  { ch: '█', tone: 'busy' },
  { ch: '▮', tone: 'tool' },
]

export const labelWidthOf = (columns: number): number => Math.max(8, Math.min(16, Math.floor(columns / 5)))
const fit = (label: string, width: number): string => (label.length > width ? `${label.slice(0, width - 1)}…` : label.padEnd(width))

/** The group header for a window page: `▾ ruflo (3)`. */
export const groupLabel = (group: string, count: number, isOpen: boolean): string => `${isOpen ? '▾' : '▸'} ${group} (${count})`

export type PageEntry = { type: 'group'; group: string; count: number; isOpen: boolean } | { type: 'lane'; lane: LaneView }

export function buildLines(entries: readonly PageEntry[], store: LaneStore, events: readonly ConsoleEvent[], allLanes: readonly LaneView[], win: Span, conc: Concurrency, columns: number, cursorLane: string | null): Line[] {
  const labelW = labelWidthOf(columns)
  const cellsN = Math.max(8, columns - labelW - 1)
  const lines: Line[] = [{ kind: 'axis', label: fit('', labelW), cells: [...axisLine(win, cellsN)].map(ch => ({ ch, tone: 'dim' as const })) }]
  const index = markerIndex(events, allLanes, win, cellsN)
  const top = index.get('') ?? new Array(cellsN).fill(null)

  lines.push({ kind: 'events', label: fit('events', labelW), cells: top.map(level => (level === 'bad' ? { ch: '▲', tone: 'bad' as const } : level === 'warn' ? { ch: '△', tone: 'warn' as const } : { ch: '·', tone: 'none' as const })) })

  for (const entry of entries) {
    if (entry.type === 'group') {
      lines.push({ kind: 'group', label: fit(groupLabel(entry.group, entry.count, entry.isOpen), labelW + 8).trimEnd(), cells: [] })
      continue
    }

    const grid = cellsOf(entry.lane, win, cellsN, store)
    const marks = index.get(entry.lane.lane) ?? []

    lines.push({
      kind: 'lane',
      label: fit(entry.lane.label, labelW),
      laneId: entry.lane.lane,
      isCursor: entry.lane.lane === cursorLane,
      cells: Array.from({ length: cellsN }, (_, i) => {
        const mark = marks[i]

        if (mark === 'bad') return { ch: '▲', tone: 'bad' as const }
        if (mark === 'warn') return { ch: '△', tone: 'warn' as const }

        return CELL[grid[i] as number] as Cell
      }),
    })
  }

  const top2 = Math.max(1, conc.peak)

  lines.push({ kind: 'conc', label: fit('parallel', labelW), cells: Array.from({ length: cellsN }, (_, i) => {
    const n = conc.counts[Math.min(conc.counts.length - 1, Math.floor((i / cellsN) * conc.counts.length))] ?? 0

    return n === 0 ? { ch: '·', tone: 'none' as const } : { ch: BLOCKS[Math.min(BLOCKS.length - 1, Math.ceil((n / top2) * BLOCKS.length) - 1)] as string, tone: 'busy' as const }
  }) })

  return lines
}

/** Runs of cells of one tone, for a row of Text elements. */
export function runsOf(cells: readonly Cell[]): { text: string; tone: Tone }[] {
  const out: { text: string; tone: Tone }[] = []

  for (const cell of cells) {
    const last = out[out.length - 1]

    if (last !== undefined && last.tone === cell.tone) last.text += cell.ch
    else out.push({ text: cell.ch, tone: cell.tone })
  }

  return out
}

/** The legend, one line: what each cell means. */
export const LEGEND = '█ busy · ▁ idle · ▮ tool call · △ warn ▲ bad event · · not observed'
