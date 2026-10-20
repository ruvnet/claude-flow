/** Counters the mod keeps for the session and writes to `.claude-flow/creator-mod/status.json`. */
export type Stats = { checked: number; reserved: number; lastTarget?: string }

export const newStats = (): Stats => ({ checked: 0, reserved: 0 })

export const STATUS_PATH = '.claude-flow/creator-mod/status.json'

/** The file's text; `version` lets a reader refuse a shape it does not know. */
export const statusText = (stats: Stats, nowMs: number): string => `${JSON.stringify({ version: 1, updatedMs: nowMs, ...stats }, null, 2)}\n`
