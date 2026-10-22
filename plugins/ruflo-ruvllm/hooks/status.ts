import type { ModOptions } from './options'

/** Counters the mod keeps for the session and writes to `.claude-flow/ruvllm-mod/status.json`. */
export type Stats = { seen: number; blocked: number; lastBlocked?: string }

export const newStats = (): Stats => ({ seen: 0, blocked: 0 })

export const STATUS_PATH = '.claude-flow/ruvllm-mod/status.json'

/** The file's text; `version` lets a reader refuse a shape it does not know. */
export const statusText = (stats: Stats, opts: ModOptions, nowMs: number): string =>
  `${JSON.stringify({ version: 1, updatedMs: nowMs, guard: opts.guard, ...stats }, null, 2)}\n`
