/** Counters the mod keeps for the session and writes to `.claude-flow/goals-mod/status.json` for the console. */
export type Stats = {
  blocked: number
  scans: number
  commands: number
  lastDenied?: string
}

export const newStats = (): Stats => ({ blocked: 0, scans: 0, commands: 0 })

export const STATUS_PATH = '.claude-flow/goals-mod/status.json'

/** The file's text: mode flags plus the counters; `version` lets the console refuse a shape it does not know. */
export function statusText(stats: Stats, mode: Record<string, boolean>, nowMs: number): string {
  return `${JSON.stringify({ version: 1, updatedMs: nowMs, ...mode, ...stats }, null, 2)}\n`
}
