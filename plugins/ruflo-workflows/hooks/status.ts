/** Counters the mod keeps for the session and writes to `.claude-flow/wf-mod/status.json` for the console. */
export type Stats = { checked: number; blocked: number; seen: Record<string, number>; lastReason?: string }

export const newStats = (): Stats => ({ checked: 0, blocked: 0, seen: {} })

export const STATUS_PATH = '.claude-flow/wf-mod/status.json'

/** The file's text; `version` lets the console refuse a shape it does not know. */
export function statusText(stats: Stats, mode: { guard: boolean }, nowMs: number): string {
  return `${JSON.stringify({ version: 1, updatedMs: nowMs, guard: mode.guard, ...stats }, null, 2)}\n`
}
