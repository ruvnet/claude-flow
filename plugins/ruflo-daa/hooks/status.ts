/** Counters the mod keeps for the session and writes to `.claude-flow/daa-mod/status.json`. */
export type Stats = { blocked: number }

export const newStats = (): Stats => ({ blocked: 0 })

export const STATUS_PATH = '.claude-flow/daa-mod/status.json'

/** The file's text; `version` lets a reader refuse a shape it does not know. */
export const statusText = (stats: Stats, guard: boolean, nowMs: number): string =>
  `${JSON.stringify({ version: 1, updatedMs: nowMs, guard, ...stats }, null, 2)}\n`
