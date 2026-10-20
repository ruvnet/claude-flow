/**
 * The Log sub-tab's data (ADR-459): a transcript's entries as one washed line each, a level filter, an agent scope (one agent or the
 * whole phase merged by time), and the window of lines on screen, which follows the newest line or stays where the person put it.
 * Pure. "Follow" is a pin to the last line that the page's own refresh re-draws; it is not a stream, and the page says so.
 */
import { isoOf } from './safe'
import { cleanLine, type Entry, type Parsed } from './wf-activity'

export type LogLevel = 'user' | 'assistant' | 'thinking' | 'tool' | 'error'
export type LevelFilter = 'all' | 'text' | 'tool' | 'error'
/** The order the level key cycles through. */
export const LEVEL_FILTERS: readonly LevelFilter[] = ['all', 'text', 'tool', 'error']
export type LogScope = 'agent' | 'phase'

export type LogLine = {
  /** Position of the entry in its agent's transcript (what the item level opens). */
  entry: number
  agentId: string
  agent: string
  atMs?: number
  level: LogLevel
  text: string
}

/** Rows of the log drawn at once. */
export const LOG_ROWS = 14

const levelOf = (entry: Entry): LogLevel => (entry.kind === 'call' ? (entry.status === 'error' ? 'error' : 'tool') : entry.role === 'result' ? 'tool' : entry.role)

const textOf = (entry: Entry): string =>
  entry.kind === 'call' ? `${entry.tool} ${entry.summary}${entry.status === 'pending' ? ' (no result in the part read)' : entry.status === 'error' ? ' (failed)' : ''}`.trim() : cleanLine(entry.body.text, 200)

/** One line per entry of an agent's transcript, in the order written. */
export const logLines = (parsed: Parsed, agent: { id: string; label: string }): LogLine[] =>
  parsed.entries.map(entry => ({ entry: entry.index, agentId: agent.id, agent: cleanLine(agent.label, 40), level: levelOf(entry), text: textOf(entry), ...(entry.atMs !== undefined && { atMs: entry.atMs }) }))

/** Several agents' lines as one log, ordered by time; lines with no timestamp keep their place after the lines of their own agent. */
export function mergeLines(lists: readonly (readonly LogLine[])[]): LogLine[] {
  const tagged = lists.flatMap((list, order) => list.map((line, at) => ({ line, order, at })))

  return tagged.sort((a, b) => (a.line.atMs ?? Number.POSITIVE_INFINITY) - (b.line.atMs ?? Number.POSITIVE_INFINITY) || a.order - b.order || a.at - b.at).map(item => item.line)
}

export function filterLines(lines: readonly LogLine[], filter: LevelFilter): LogLine[] {
  if (filter === 'all') return [...lines]

  return lines.filter(line => (filter === 'error' ? line.level === 'error' : filter === 'tool' ? line.level === 'tool' || line.level === 'error' : line.level === 'user' || line.level === 'assistant' || line.level === 'thinking'))
}

export const nextFilter = (filter: LevelFilter): LevelFilter => LEVEL_FILTERS[(LEVEL_FILTERS.indexOf(filter) + 1) % LEVEL_FILTERS.length] as LevelFilter

export type LogWindow = { from: number; rows: LogLine[]; total: number; /** Index of the selected line inside `rows`, or -1. */ at: number; /** Lines above the window. */ above: number; below: number }

/**
 * The lines to draw. Following pins the window to the end and the selection to the last line; otherwise the window keeps the selected
 * line (`sel`, an index into `lines`, clamped) on screen, as the board's lists do.
 */
export function tailWindow(lines: readonly LogLine[], opts: { size?: number; sel: number; follow: boolean }): LogWindow {
  const size = Math.max(1, opts.size ?? LOG_ROWS)
  const total = lines.length

  if (total === 0) return { from: 0, rows: [], total: 0, at: -1, above: 0, below: 0 }

  const sel = opts.follow ? total - 1 : Math.max(0, Math.min(total - 1, opts.sel))
  const from = Math.max(0, Math.min(total - size, sel - size + 1))

  return { from, rows: lines.slice(from, from + size), total, at: sel - from, above: from, below: Math.max(0, total - from - size) }
}

/** `20:03:45` in UTC, or `--:--:--` where the line has no timestamp. */
export const clockOf = (atMs: number | undefined): string => (atMs === undefined ? '--:--:--' : isoOf(atMs).slice(11, 19))
