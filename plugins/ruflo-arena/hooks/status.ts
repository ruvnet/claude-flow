/** Counters the mod keeps for the session and writes to `.claude-flow/arena-mod/status.json` for the console. */
export type Stats = { calls: number; blocked: number; startedMs: number }

export const newStats = (): Stats => ({ calls: 0, blocked: 0, startedMs: 0 })

export const STATUS_PATH = '.claude-flow/arena-mod/status.json'

/** The file's text; `version` lets the console refuse a shape it does not know. */
export function statusText(stats: Stats, mode: { guard: boolean }, nowMs: number): string {
  return `${JSON.stringify({ version: 1, updatedMs: nowMs, mod: 'arena', guard: mode.guard, ...stats }, null, 2)}\n`
}
