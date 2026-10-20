/**
 * Mission context (ADR-443): the one short section Claude's system prompt carries while a mission is active, so Claude knows
 * the mission between hand-offs. Pure text in, text out. The section only holds the mission's own fields, each capped, with
 * control characters stripped. Its key changes only when something Claude must act on changes (mission, active task, that
 * task's status, paused, cancelled, loop on or off): a changed system prompt makes Claude re-read the conversation at
 * cache-write price, so event counts, timestamps and spend never reach the key.
 */
import { plain } from './data/parse'
import { MISSION_OBJECTIVE_MAX } from './full-text'
import type { Derived, LedgerTask, MissionRecord } from './mission-types'

export const CONTEXT_SECTION_ID = 'ruflo-console:mission'
export const CONTEXT_MAX = MISSION_OBJECTIVE_MAX + 1200
/** The settings key the row stores under, beside the other AI preferences. */
export const CONTEXT_PREF_KEY = 'missionContext'

const EVIDENCE_RULE = 'A task is done only with evidence: record it with task_complete and put what you ran and what it printed in the result.'
const STOP_RULE = 'Stop when every task is done or the person says stop; if blocked, mark the task failed with the reason instead of guessing.'
const HALTED = 'Do not start new work.'
const MAX_CHECKS = 3

type LoopInfo = { interval: string; status: string } | null

/** Where a task stands, from the ruflo task store (derive() in mission-control.ts needs the store, so the caller passes the result). */
export type TaskStatus = Derived

const clip = (value: unknown, max: number): string => plain(value, max)

function halted(mission: MissionRecord): string | null {
  return mission.cancelled ? 'cancelled' : mission.paused ? 'paused' : null
}

/** The section's text: deterministic, at most CONTEXT_MAX characters. `status` is the active task's derived status. */
export function missionContextText(mission: MissionRecord, task: LedgerTask | null, loop: LoopInfo, status: TaskStatus = 'ready', adrBlock = '', nudge = ''): string {
  const lines: string[] = [`Mission ${clip(mission.id, 40)}: ${clip(mission.objective, MISSION_OBJECTIVE_MAX)}`]
  const stop = halted(mission)

  if (task !== null) {
    lines.push(`Active task ${clip(task.id, 20)} (${status}): ${clip(task.title, 80)}. Done when: ${clip(task.requirement, 120)}`)

    const checks = mission.acceptance.slice(0, MAX_CHECKS).map(item => `- ${clip(item.check, 80)}`)

    if (checks.length > 0) lines.push(`Acceptance checks:\n${checks.join('\n')}`)
  }

  if (loop !== null) lines.push(`Loop: ${clip(loop.interval, 12)}, ${clip(loop.status, 12)}.`)

  lines.push(EVIDENCE_RULE, STOP_RULE)
  if (stop !== null) lines.push(`The mission is ${stop}. ${HALTED}`)

  const text = lines.join('\n')

  const base = text.length <= CONTEXT_MAX ? text : `${text.slice(0, CONTEXT_MAX - 1)}…`

  // The attached ADRs (ADR-480) follow the mission's own lines, under their own cap (data/adr-scope.ts), already masked.
  const withAdrs = adrBlock === '' ? base : `${base}\n${adrBlock}`

  // ADR-487: one fixed line from grounding.ts (already through modelLine); empty unless the optional ruvnet-brain plugin is on.
  return nudge === '' ? withAdrs : `${withAdrs}\n${nudge}`
}

/** A short, stable hash of the ADR block: the key changes when an attached record's status or decision does, and not otherwise. */
const hashOf = (text: string): string => {
  let hash = 5381

  for (let i = 0; i < text.length; i += 1) hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0

  return hash.toString(36)
}

/** What the section depends on, nothing else: the same key means Claude's prompt is byte-identical, so its cache holds. */
export function missionContextKey(mission: MissionRecord, task: LedgerTask | null, loop: LoopInfo, status: TaskStatus = 'ready', adrBlock = '', nudge = ''): string {
  return [mission.id, task === null ? '-' : `${task.id}:${status}`, mission.paused ? 'paused' : 'live', mission.cancelled ? 'cancelled' : 'open', loop === null ? 'noloop' : 'loop', adrBlock === '' ? '-' : `adr${hashOf(adrBlock)}`, nudge === '' ? '-' : 'ground'].join('|')
}

/** Only the exact value 'off' (or false) turns the section off; anything else, including no value at all, leaves it on. */
export const contextEnabled = (value: unknown): boolean => value !== 'off' && value !== false

type ContextPrefs = { [CONTEXT_PREF_KEY]?: boolean }

/** The Settings row, shaped like the entries of LOOP_ROWS (settings.ts); the integrator appends it to that list. */
export const CONTEXT_ROW: { id: string; title: string; description: string; extra: string; options: readonly string[]; current: (p: ContextPrefs) => string; isChanged: (p: ContextPrefs) => boolean; patch: (value: string) => ContextPrefs } = {
  id: 'ctx-mission',
  title: 'Mission context in Claude’s prompt',
  description: 'while a mission is active, Claude’s prompt carries its objective, the active task, the evidence rule and the stop rule; it changes only when the task or mission state does (default on)',
  extra: 'mission context prompt claude system section cache',
  options: ['on', 'off'],
  current: p => (contextEnabled(p[CONTEXT_PREF_KEY]) ? 'on' : 'off'),
  isChanged: p => !contextEnabled(p[CONTEXT_PREF_KEY]),
  patch: value => ({ [CONTEXT_PREF_KEY]: value !== 'off' }),
}

export type TurnReason = 'answer' | 'aborted' | 'refusal' | 'error'

const TURN_NOTE: Record<TurnReason, string> = {
  answer: 'Claude finished a turn on this task; completion is recorded by task_complete, not by this note.',
  aborted: 'A turn on this task was aborted before it finished.',
  refusal: 'Claude declined a turn on this task.',
  error: 'A turn on this task ended in an error.',
}

/** The ledger event a finished turn leaves: null with no active task; it never says the task is finished. */
export function turnNote(reason: TurnReason, task: LedgerTask | null): { type: string; taskId?: string; note: string } | null {
  if (task === null) return null

  return { type: 'turn', taskId: clip(task.id, 20), note: TURN_NOTE[reason] ?? TURN_NOTE.error }
}
