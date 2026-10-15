import type { Item } from './recall'

/** Counters the mod keeps for the session and writes to `.claude-flow/agentdb-mod/status.json` for the console. */
export type Stats = {
  attached: number
  skipped: number
  timedOut: number
  cached: number
  dropped: number
  blocked: number
  errors: number
  lastMs?: number
  lastTool?: string
  /** The MCP tool that answered last (agentdb_hierarchical-recall, memory_search, ...); `lastTool` is only its family. */
  lastReader?: string
  /** Why the last reader call failed (a permission refusal, a server error), short and without the query. */
  lastError?: string
  recent: { atMs: number; source: string; score?: number; snippet: string }[]
}

export const newStats = (): Stats => ({ attached: 0, skipped: 0, timedOut: 0, cached: 0, dropped: 0, blocked: 0, errors: 0, recent: [] })

export const STATUS_PATH = '.claude-flow/agentdb-mod/status.json'
const RECENT = 5

/** Notes what was attached (a short snippet, source and score; the items were screened before they got here). */
export function noteAttached(stats: Stats, items: readonly Item[], nowMs: number): void {
  stats.attached++
  for (const item of items) stats.recent.push({ atMs: nowMs, source: item.source, ...(item.score === undefined ? {} : { score: item.score }), snippet: item.text.slice(0, 120) })
  if (stats.recent.length > RECENT) stats.recent.splice(0, stats.recent.length - RECENT)
}

/** The file's text: mode and tool plus the counters; `version` lets the console refuse a shape it does not know. */
export function statusText(stats: Stats, mode: { recall: boolean; guard: boolean; source: string }, nowMs: number): string {
  return `${JSON.stringify({ version: 1, updatedMs: nowMs, recall: mode.recall, guard: mode.guard, source: mode.source, ...stats }, null, 2)}\n`
}
