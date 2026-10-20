import { jsonObject, plain, recordOf } from './parse'
import { countOf, timeOf } from './safe'

/** What the ruflo-agentdb mod last wrote to `.claude-flow/agentdb-mod/status.json` (ADR-445): its settings, counters and the last items it attached. */
export type AgentdbMod = {
  recall: boolean
  guard: boolean
  source: string
  tool: string | null
  /** Epoch ms of the last write, or null when missing or not a time `Date` holds (never a count: a count is capped at 1e12, which turned a 2026 stamp into 2001). */
  updatedMs: number | null
  attached: number
  skipped: number
  cached: number
  timedOut: number
  dropped: number
  blocked: number
  errors: number
  lastMs: number | null
  recent: { source: string; score: number | null; snippet: string }[]
}

const whole = (v: unknown): number => countOf(v) ?? 0

/** Parses the status file; anything that is not version 1 of its shape is null (the console never guesses at a shape it does not know). */
export function parseAgentdbMod(text: string | null): AgentdbMod | null {
  const value = jsonObject(text)

  if (value === null || value.version !== 1) return null

  const recent = (Array.isArray(value.recent) ? value.recent : []).slice(-5).flatMap(item => {
    const r = recordOf(item)

    return r !== null && typeof r.snippet === 'string' ? [{ source: typeof r.source === 'string' ? plain(r.source, 24) : '?', score: typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : null, snippet: plain(r.snippet, 120) }] : []
  })

  return {
    recall: value.recall === true,
    guard: value.guard === true,
    source: typeof value.source === 'string' ? plain(value.source, 16) : 'auto',
    tool: typeof value.lastTool === 'string' ? plain(value.lastTool, 24) : null,
    updatedMs: timeOf(value.updatedMs) ?? null,
    attached: whole(value.attached),
    skipped: whole(value.skipped),
    cached: whole(value.cached),
    timedOut: whole(value.timedOut),
    dropped: whole(value.dropped),
    blocked: whole(value.blocked),
    errors: whole(value.errors),
    lastMs: typeof value.lastMs === 'number' ? whole(value.lastMs) : null,
    recent,
  }
}
