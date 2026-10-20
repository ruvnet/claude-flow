/** Counters the mod keeps for the session and writes to `.claude-flow/observe-mod/status.json` for the console. */
export type Stats = {
  checked: number
  blocked: number
  /** Why the last call was refused: a rule name, never the text that tripped it. */
  lastBlock?: string
}

export const newStats = (): Stats => ({ checked: 0, blocked: 0 })

export const STATUS_PATH = '.claude-flow/observe-mod/status.json'

/** The file's text; `version` lets the console refuse a shape it does not know. */
export function statusText(stats: Stats, mode: Record<string, unknown>, nowMs: number): string {
  return `${JSON.stringify({ version: 1, updatedMs: nowMs, ...mode, ...stats }, null, 2)}\n`
}
