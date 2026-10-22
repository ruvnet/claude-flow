/**
 * Edit records for intelligence.cjs `consolidate()`, in the line format
 * `recordEdit` appends to `.claude-flow/data/pending-insights.jsonl`.
 *
 * `$.fs` has no append, so records are held in memory and written once per
 * turn (and at session end) by reading the file, adding the lines and writing
 * it back, with recordEdit's own cap (keep the last 2000 lines). A classic
 * writer appending in the same instant can lose a line; the window is one
 * read-write per turn instead of one per edit (ADR-404).
 */

export const PENDING_PATH = '.claude-flow/data/pending-insights.jsonl'
export const SESSION_PATH = '.claude-flow/sessions/current.json'
export const MAX_LINES = 2000
/** hook-handler.cjs `post-edit` matches these tools (settings-generator.ts). */
export const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])

export type EditRecord = {
  readonly type: 'edit'
  readonly file: string
  readonly success: boolean
  readonly timestamp: number
  readonly sessionId: string | null
}

/** The file an edit tool's arguments name, or `unknown` as recordEdit says. */
export function editedFile(input: unknown): string {
  const path = input !== null && typeof input === 'object' ? (input as { file_path?: unknown }).file_path : undefined
  return typeof path === 'string' && path.length > 0 && path.length <= 4096 ? path : 'unknown'
}

/**
 * `context.sessionId` of `.claude-flow/sessions/current.json`, as
 * intelligence.cjs `sessionGet('sessionId')` reads it, or null.
 */
export function rufloSessionId(text: string | undefined): string | null {
  if (!text) return null
  try {
    const session = JSON.parse(text) as { context?: { sessionId?: unknown } } | null
    const value = session?.context?.sessionId
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

/**
 * The pending file's next text: what it held plus the new records, capped.
 *
 * @param existing the file's current text ('' when absent)
 * @param records the records to add
 */
export function appendRecords(existing: string, records: readonly EditRecord[]): string {
  const lines = existing.split('\n').filter(Boolean)
  for (const r of records) lines.push(JSON.stringify(r))
  const kept = lines.length > MAX_LINES ? lines.slice(-MAX_LINES) : lines
  return kept.length ? `${kept.join('\n')}\n` : ''
}
