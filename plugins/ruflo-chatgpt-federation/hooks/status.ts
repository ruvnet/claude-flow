/** Counters the mod keeps for the session and writes to `.claude-flow/chatgpt-mod/status.json` for the console. */
export type Stats = {
  /** Calls to this plugin's tools the guard looked at. */
  checked: number
  /** Calls it refused. */
  blocked: number
  /** Refusals by rule name (never by value). */
  byRule: Record<string, number>
  lastRule?: string
}

export const newStats = (): Stats => ({ checked: 0, blocked: 0, byRule: {} })

export const STATUS_PATH = '.claude-flow/chatgpt-mod/status.json'

export function noteBlocked(stats: Stats, rule: string): void {
  stats.blocked++
  stats.byRule[rule] = (stats.byRule[rule] ?? 0) + 1
  stats.lastRule = rule
}

/** The file's text; `version` lets the console refuse a shape it does not know. */
export function statusText(stats: Stats, mode: Record<string, unknown>, nowMs: number): string {
  return `${JSON.stringify({ version: 1, updatedMs: nowMs, ...mode, ...stats }, null, 2)}\n`
}
