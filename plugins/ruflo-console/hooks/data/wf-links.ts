/**
 * Mission task <-> agent links (ADR-460). Pure: records in, a link index out. Only links the data really carries are made, and an
 * agent or task with none is reported as unlinked, with the reason, never guessed from a similar word:
 *
 *   ruflo agent      WfAgent.ruflo.id is in a ruflo task's `assignedTo`, and that task carries the `mission:<id>` and `task:<id>` tags
 *                    mission-specs.ts writes (or its id is a ledger task's `rufloTaskId`)
 *   workflow agent   its journal label begins with the tag `[mission:<id> task:<id>]`, which a script drafted by data/wf-mission-script.ts
 *                    puts there. A hand-written script has no such tag, so its agents are honestly unlinked.
 */
import type { MissionRecord } from '../mission-types'
import type { Mission } from './missions'
import { plain, type TaskRecord } from './parse'
import { taskStatusOf } from './automate'
import type { WfRun } from './workflows'

/** A mission task as either source names it: the console's ledger, or the ADR-406 observation. */
export type MissionTaskRef = { missionId: string; taskId: string; title: string; rufloTaskId?: string }

export type LinkVia = 'ruflo-task' | 'label-tag'

export type AgentLink = {
  missionId: string
  taskId: string
  title: string
  runId: string
  agentId: string
  agentLabel: string
  via: LinkVia
  /** The ruflo task's own status, where the link came through one. */
  taskStatus?: string
  /** False when the mission or task is named by the agent's side only (it is in no ledger this console holds). */
  isKnown: boolean
}

export type Unlinked = { runId: string; agentId: string; label: string; why: string }

export type LinkIndex = {
  links: AgentLink[]
  unlinked: Unlinked[]
  /** `<runId>/<agentId>` to that agent's links, open tasks first. */
  byAgent: Map<string, AgentLink[]>
  /** `<missionId>/<taskId>` to the agents on that task. */
  byTask: Map<string, AgentLink[]>
}

const ID = '[A-Za-z0-9_.:-]{1,60}'
const TAG = new RegExp(`^\\[mission:(${ID}) task:(${ID})\\]\\s*`)
const PART = new RegExp(`^${ID}$`)

export const agentKey = (runId: string, agentId: string): string => `${runId}/${agentId}`
export const taskKey = (missionId: string, taskId: string): string => `${missionId}/${taskId}`

/** The tag a drafted script puts at the front of an agent's label, or null when an id could not survive being read back. */
export const labelTag = (missionId: string, taskId: string): string | null => (PART.test(missionId) && PART.test(taskId) ? `[mission:${missionId} task:${taskId}]` : null)

/** The ids a label's leading tag names; `malformed` is true for a label that starts like a tag but is not one. */
export function readLabelTag(label: string): { missionId: string; taskId: string; rest: string } | { malformed: true } | null {
  const match = TAG.exec(label)

  if (match !== null) return { missionId: match[1] as string, taskId: match[2] as string, rest: label.slice(match[0].length) }

  return label.startsWith('[mission:') ? { malformed: true } : null
}

export function refsOfLedger(missions: Iterable<MissionRecord>): MissionTaskRef[] {
  const out: MissionTaskRef[] = []

  for (const mission of missions) {
    for (const task of mission.tasks) out.push({ missionId: mission.id, taskId: task.id, title: task.title, ...(task.rufloTaskId !== undefined && { rufloTaskId: task.rufloTaskId }) })
  }

  return out
}

export const refsOfObservation = (missions: readonly Mission[] | null | undefined): MissionTaskRef[] => (missions ?? []).flatMap(mission => mission.plan.tasks.map(task => ({ missionId: mission.id, taskId: task.id, title: task.title })))

/** Both sources in one list; where both name a task, the ledger's entry (it knows the ruflo task id) wins. */
export function refsOf(ledger: Iterable<MissionRecord>, observed: readonly Mission[] | null | undefined): MissionTaskRef[] {
  const out = new Map<string, MissionTaskRef>()

  for (const ref of [...refsOfObservation(observed), ...refsOfLedger(ledger)]) out.set(taskKey(ref.missionId, ref.taskId), ref)

  return [...out.values()]
}

const tagOf = (task: TaskRecord, prefix: 'mission' | 'task'): string | undefined => task.tags?.find(tag => tag.startsWith(`${prefix}:`))?.slice(prefix.length + 1)
export const isOpen = (status: string | undefined): boolean => !['completed', 'failed', 'cancelled'].includes(taskStatusOf(status))

/** Builds the index over every agent of `runs` (the ruflo swarm folded in as a run, as the page holds it). */
export function linkAgents(refs: readonly MissionTaskRef[], runs: readonly WfRun[], tasks: readonly TaskRecord[]): LinkIndex {
  const byKey = new Map(refs.map(ref => [taskKey(ref.missionId, ref.taskId), ref]))
  const byRuflo = new Map(refs.flatMap(ref => (ref.rufloTaskId === undefined ? [] : [[ref.rufloTaskId, ref] as const])))
  const links: AgentLink[] = []
  const unlinked: Unlinked[] = []

  for (const run of runs) {
    for (const phase of run.phases) {
      for (const agent of phase.agents) {
        const mine: AgentLink[] = []
        const base = { runId: run.id, agentId: agent.id, agentLabel: agent.label }

        if (agent.ruflo !== undefined) {
          for (const task of tasks.filter(candidate => candidate.assignedTo.includes(agent.id))) {
            const known = byRuflo.get(task.id)
            const missionId = known?.missionId ?? tagOf(task, 'mission')
            const taskId = known?.taskId ?? tagOf(task, 'task')

            if (missionId === undefined || taskId === undefined) continue

            const ref = known ?? byKey.get(taskKey(missionId, taskId))

            mine.push({ ...base, missionId, taskId, title: ref?.title ?? plain(task.description, 80), via: 'ruflo-task', taskStatus: task.status, isKnown: ref !== undefined })
          }
        } else {
          const tag = readLabelTag(agent.label)

          if (tag !== null && !('malformed' in tag)) {
            const ref = byKey.get(taskKey(tag.missionId, tag.taskId))

            mine.push({ ...base, missionId: tag.missionId, taskId: tag.taskId, title: ref?.title ?? plain(tag.rest, 80), via: 'label-tag', isKnown: ref !== undefined })
          } else if (tag !== null) {
            unlinked.push({ ...base, label: agent.label, why: 'its label starts like a mission tag but is not [mission:<id> task:<id>]' })
            continue
          }
        }

        if (mine.length === 0) {
          unlinked.push({ ...base, label: agent.label, why: agent.ruflo !== undefined ? 'no ruflo task with mission:/task: tags is assigned to this agent' : 'its label has no [mission:<id> task:<id>] tag (a script the console drafts adds one)' })
          continue
        }

        // Open tasks first: an agent shows the task it is on before the ones it finished.
        links.push(...[...mine].sort((a, b) => Number(isOpen(b.taskStatus)) - Number(isOpen(a.taskStatus))))
      }
    }
  }

  const byAgent = new Map<string, AgentLink[]>()
  const byTask = new Map<string, AgentLink[]>()

  for (const link of links) {
    for (const [map, key] of [[byAgent, agentKey(link.runId, link.agentId)], [byTask, taskKey(link.missionId, link.taskId)]] as const) map.set(key, [...(map.get(key) ?? []), link])
  }

  return { links, unlinked, byAgent, byTask }
}

/** The one line an agent row shows for its mission task, or says it is unlinked and why. */
export function agentLinkLine(index: LinkIndex, runId: string, agentId: string): string {
  const mine = index.byAgent.get(agentKey(runId, agentId)) ?? []
  const first = mine[0]

  if (first === undefined) return `unlinked: ${index.unlinked.find(entry => entry.runId === runId && entry.agentId === agentId)?.why ?? 'not read'}`

  return `${first.missionId} / ${first.taskId}: ${first.title}${first.taskStatus === undefined ? '' : ` (${first.taskStatus})`}${first.isKnown ? '' : ' · not in this console\'s mission ledger'}${mine.length > 1 ? ` · +${mine.length - 1} more` : ''}`
}

/** The line a mission task shows for its agents, or says none is working on it. */
export function taskLinkLine(index: LinkIndex, ref: MissionTaskRef): string {
  const mine = index.byTask.get(taskKey(ref.missionId, ref.taskId)) ?? []

  return mine.length === 0 ? 'unlinked: no ruflo agent or workflow agent names this task' : mine.map(link => `${link.agentLabel} (${link.via === 'ruflo-task' ? 'ruflo task' : 'label tag'})`).join(', ')
}
