/**
 * What a workflow read changed that a person would want announced beyond what the page already says (ADR-460). The page's own
 * pass (wf-live.ts runNotices) announces a run that finished or failed; this adds what it does not: an agent that failed, an agent or
 * run that has gone quiet (the read's own `stale` / `stalled` judgement, STALE_MS without a transcript line), and, for an agent a
 * mission tagged (data/wf-links.ts), a finished one. Every function is pure and sees only two reads, so the first read announces
 * nothing. The ruflo swarm is folded into the page's run list after the read, so it never reaches here: only workflow runs do.
 *
 * Each change is returned twice, as a band notice draft and as a mission event, so the merge owner can record the second into the
 * mission ledger (`applyMissionEvents`) from the one place that holds the ledger. Text comes from labels, so it is washed first.
 */
import type { MissionRecord } from '../mission-types'
import type { NoticeDraft } from '../notices'
import { cleanText } from './wf-clean'
import { readLabelTag } from './wf-links'
import { STALE_MS, type WfRun } from './workflows'

export type MissionEventKind = 'agent-failed' | 'agent-stuck' | 'agent-done'
export type MissionEvent = { missionId: string; taskId: string; kind: MissionEventKind; note: string; key: string }
export type RunChanges = { notices: NoticeDraft[]; mission: MissionEvent[] }

const tail = (id: string): string => id.replace(/[^A-Za-z0-9]/g, '').slice(-8)
const minutes = Math.round(STALE_MS / 60_000)

/** What changed between two reads of the workflow runs; `prev` null (no read before) announces nothing. */
export function eventsBetween(prev: readonly WfRun[] | null, next: readonly WfRun[]): RunChanges {
  const out: RunChanges = { notices: [], mission: [] }

  if (prev === null) return out

  const before = new Map(prev.flatMap(run => [[`${run.id}`, run.state] as const, ...run.phases.flatMap(phase => phase.agents.map(agent => [`${run.id}/${agent.id}`, agent.state] as const))]))

  for (const run of next) {
    const name = cleanText(run.name)

    // A ruflo swarm's stall is its record's day-old write, not STALE_MS without a transcript line: no "N min" notice for it.
    if (run.kind === 'workflow' && run.state === 'stalled' && before.has(run.id) && before.get(run.id) !== 'stalled') out.notices.push({ level: 'warn', text: `workflow ${name} looks stuck: nothing written for ${minutes} min`, key: `r-${tail(run.id)}-stuck`, go: 'workflows' })

    for (const phase of run.phases) {
      for (const agent of phase.agents) {
        const was = before.get(`${run.id}/${agent.id}`)

        if (was === agent.state) continue

        const label = cleanText(agent.label)
        const tag = readLabelTag(agent.label)
        const mission = tag !== null && !('malformed' in tag) ? tag : null
        const where = mission === null ? `${label} in ${name}` : `${cleanText(mission.rest) || label} (mission ${cleanText(mission.missionId)}, task ${cleanText(mission.taskId)})`
        const kind: MissionEventKind | null = agent.state === 'failed' ? 'agent-failed' : agent.state === 'stale' ? 'agent-stuck' : agent.state === 'done' && mission !== null ? 'agent-done' : null

        if (kind === null) continue

        const key = `a-${tail(run.id)}${tail(agent.id)}-${kind.slice(6, 7)}`
        const words = kind === 'agent-failed' ? `failed: ${where}` : kind === 'agent-stuck' ? `looks stuck (${minutes} min quiet): ${where}` : `finished: ${where}`

        out.notices.push({ level: kind === 'agent-failed' ? 'bad' : kind === 'agent-stuck' ? 'warn' : 'ok', text: `agent ${words}`, key, go: 'workflows' })
        if (mission !== null) out.mission.push({ missionId: mission.missionId, taskId: mission.taskId, kind, note: `workflow agent ${words}`.slice(0, 160), key })
      }
    }
  }

  return out
}

/**
 * Appends each event to its mission's record, once (an event's key is its `evidenceRef`), for a mission and task the ledger holds.
 * Mutates the records it is handed and returns how many were added; the caller saves the ledger when it is above zero.
 */
export function applyMissionEvents(missions: ReadonlyMap<string, MissionRecord>, events: readonly MissionEvent[], nowMs: number): number {
  let added = 0

  for (const event of events) {
    const mission = missions.get(event.missionId)

    if (mission === undefined || !mission.tasks.some(task => task.id === event.taskId)) continue
    if (mission.events.some(held => held.type === 'workflow' && held.evidenceRef === event.key)) continue

    mission.events.push({ seq: Math.max(0, ...mission.events.map(held => held.seq)) + 1, atMs: nowMs, type: 'workflow', taskId: event.taskId, status: event.kind, evidenceRef: event.key, note: cleanText(event.note) })
    if (mission.events.length > 500) mission.events.splice(0, mission.events.length - 500)
    added += 1
  }

  return added
}
