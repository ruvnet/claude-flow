/**
 * The numbers behind the Events page's charts (ADR-474): a window of time, how it is cut into bars, how many events of each kind or
 * level fall in each bar, and a day by hour strip. Pure.
 */
import { levelOf, type Level } from './event-severity'
import type { ConsoleEvent } from './events'

export type WindowId = 'session' | '15m' | '1h' | '24h' | 'all'

export const WINDOWS: readonly { id: WindowId; label: string; ms: number | null }[] = [
  { id: 'session', label: 'session', ms: null },
  { id: '15m', label: '15 min', ms: 15 * 60_000 },
  { id: '1h', label: '1 h', ms: 3_600_000 },
  { id: '24h', label: '24 h', ms: 86_400_000 },
  { id: 'all', label: 'all kept', ms: null },
]

export const isWindowId = (value: unknown): value is WindowId => WINDOWS.some(entry => entry.id === value)

/** The earliest time a window shows: null for all kept, the console's load time for the session. */
export function windowStart(id: WindowId, nowMs: number, loadedAtMs: number): number | null {
  const entry = WINDOWS.find(item => item.id === id)

  if (id === 'session') return loadedAtMs
  if (entry?.ms === null || entry === undefined) return null

  return nowMs - entry.ms
}

/** Bars by minute up to an hour, by ten minutes up to a day, by hour past that. */
export function bucketMs(spanMs: number): number {
  return spanMs <= 3_600_000 ? 60_000 : spanMs <= 86_400_000 ? 600_000 : 3_600_000
}

export type Bars = { fromMs: number; stepMs: number; stacks: number[][] }

/** `n` bars ending at `nowMs`, each a stack by `keys` (kinds or levels). Events outside the span are not counted. */
export function bars(events: readonly ConsoleEvent[], keys: readonly string[], keyOf: (event: ConsoleEvent) => string, spanMs: number, nowMs: number, maxBars = 48): Bars {
  const step = Math.max(bucketMs(spanMs), Math.ceil(spanMs / maxBars / 60_000) * 60_000)
  const count = Math.max(1, Math.min(maxBars, Math.ceil(spanMs / step)))
  const fromMs = nowMs - count * step
  const stacks = Array.from({ length: count }, () => new Array<number>(keys.length).fill(0))

  for (const event of events) {
    const at = Math.floor((event.atMs - fromMs) / step)
    const k = keys.indexOf(keyOf(event))

    if (at >= 0 && at < count && k >= 0) (stacks[at] as number[])[k] = ((stacks[at] as number[])[k] ?? 0) + 1
  }

  return { fromMs, stepMs: step, stacks }
}

export const levelKey = (event: ConsoleEvent): Level => levelOf(event.kind, event.text)

const BLOCKS = '▁▂▃▄▅▆▇█'

/** One text line of a stack: the height of each bar, scaled to the tallest. Empty bars are a dot. */
export function barsLine(data: Bars): string {
  const totals = data.stacks.map(stack => stack.reduce((a, b) => a + b, 0))
  const top = Math.max(1, ...totals)

  return totals.map(total => (total === 0 ? '·' : (BLOCKS[Math.min(BLOCKS.length - 1, Math.ceil((total / top) * BLOCKS.length) - 1)] as string))).join('')
}

/** 7 days by 24 hours of counts (local time), newest day last, for a window past a day. Rows are days, columns hours. */
export function dayHour(events: readonly ConsoleEvent[], nowMs: number, days = 7): number[][] {
  const grid = Array.from({ length: days }, () => new Array<number>(24).fill(0))
  const today = new Date(nowMs)

  today.setHours(0, 0, 0, 0)

  for (const event of events) {
    const at = new Date(event.atMs)
    const back = Math.round((today.getTime() - new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime()) / 86_400_000)

    if (back >= 0 && back < days) (grid[days - 1 - back] as number[])[at.getHours()]!++
  }

  return grid
}

export const heatLine = (counts: readonly number[]): string => {
  const top = Math.max(1, ...counts)

  return counts.map(n => (n === 0 ? '·' : (BLOCKS[Math.min(BLOCKS.length - 1, Math.ceil((n / top) * BLOCKS.length) - 1)] as string))).join('')
}

/** The window one bar names: the narrowed span when a bar is pressed. */
export const narrow = (fromMs: number, stepMs: number, index: number): { fromMs: number; toMs: number } => ({ fromMs: fromMs + index * stepMs, toMs: fromMs + (index + 1) * stepMs })
