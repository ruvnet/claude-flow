import { idOf } from './reader/parse'
import type { State } from './state'

/** At most this many rows wait for a flush; past it the oldest are dropped and counted. */
export const AUDIT_MAX = 200
export const AUDIT_FLUSH_MS = 30_000
export const AUDIT_NAMESPACE = 'ruflo-swarm-audit'

/** Events never recorded: the render and timer traffic would drown the trail, and the trail's own writes would feed it. */
const SKIP = /^(ui\.|clock\.|store\.|fs\.|process\.run|session\.usage|agent\.list|env\.|config\.describe)/

const NAME = /^[A-Za-z0-9_.:-]{1,64}$/

/**
 * One row of the trail: the event's name, the tool's name and the agent's id where the event has them, and the time.
 * Never prompt text, arguments, file paths, results or anything a tool returned: the trail says what happened, not what was said.
 */
export function auditRow(event: string, e: unknown, nowMs: number): string | null {
  if (SKIP.test(event) || !NAME.test(event)) {
    return null
  }

  const value = (e ?? {}) as Record<string, unknown>
  const tool = typeof value.tool === 'string' && NAME.test(value.tool) ? value.tool : undefined
  const agent = idOf(value.agentId)

  return JSON.stringify({ t: nowMs, event, ...(tool !== undefined && { tool }), ...(agent !== null && { agent }) })
}

/** Adds a row on the hot path: a push and, when full, a shift. Nothing waits on I/O here. */
export function noteAudit(state: State, row: string | null): void {
  if (row === null) {
    return
  }

  state.audit.buffer.push(row)

  if (state.audit.buffer.length > AUDIT_MAX) {
    state.audit.buffer.shift()
    state.audit.dropped += 1
  }
}

/** The rows to write now and the argv after the CLI prefix that stores them, or null when there is nothing to write. */
export function takeFlush(state: State, nowMs: number): { args: string[]; rows: number } | null {
  if (state.audit.buffer.length === 0) {
    return null
  }

  const rows = state.audit.buffer.splice(0, state.audit.buffer.length)
  const dropped = state.audit.dropped

  state.audit.dropped = 0
  state.audit.flushedAtMs = nowMs

  const value = JSON.stringify({ rows: rows.map(row => JSON.parse(row) as unknown), ...(dropped > 0 && { dropped }) })

  return { args: ['memory', 'store', '--namespace', AUDIT_NAMESPACE, '--key', `audit-${nowMs}`, '--value', value], rows: rows.length }
}
