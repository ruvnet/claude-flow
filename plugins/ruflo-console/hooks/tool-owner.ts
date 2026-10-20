/**
 * Which mission task a tool row belongs to. A call is attributed the first time its row is drawn while it runs: if the
 * active mission is neither paused nor cancelled and exactly one of its tasks is running (the one handed to the
 * session), that task owns the call, and keeps it after the task finishes. A call first seen already finished, or
 * while no task or several tasks run, belongs to no task: the row says nothing rather than guess.
 */
import { activeMission, derive } from './mission-control'
import type { State } from './state'

export type Owner = { taskId: string; title: string; phase: string; missionId: string }

const MAX_REMEMBERED = 500
const owners = new WeakMap<State, Map<string, Owner | null>>()

/** The one running task of the active mission, or null when none or more than one run (or the mission is paused or cancelled). */
export function runningOwner(state: State): Owner | null {
  const mission = activeMission(state)

  if (mission === null || mission.paused || mission.cancelled) return null

  const status = derive(mission, state.snapshot?.tasks ?? [])
  const running = mission.tasks.filter(task => status.get(task.id) === 'running')
  const [only] = running

  return running.length === 1 && only !== undefined ? { taskId: only.id, title: only.title, phase: only.phase, missionId: mission.id } : null
}

/** The owner of one call by its tool-use id: decided at first sight and remembered. */
export function ownerOf(state: State, toolUseId: string, isRunning: boolean): Owner | null {
  let known = owners.get(state)

  if (known === undefined) {
    known = new Map()
    owners.set(state, known)
  }

  if (known.has(toolUseId)) return known.get(toolUseId) ?? null

  const owner = isRunning ? runningOwner(state) : null

  known.set(toolUseId, owner)
  if (known.size > MAX_REMEMBERED) known.delete(known.keys().next().value as string)

  return owner
}

/** The one dim line a tool row carries under it, e.g. `↳ mission task: Write the tests (test)`. */
export const ownerLine = (owner: Owner): string => `↳ mission task: ${owner.title} (${owner.phase})`
