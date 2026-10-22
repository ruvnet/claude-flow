/**
 * Which mission task a tool row belongs to, pure: attributed once, at first sight while the call runs, to the one running
 * task of an active mission, and never guessed. Run with
 *   npx vitest run plugins/ruflo-console/tests/tool-owner.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { mcOf, type MissionRecord } from '../hooks/mission-control'
import { newState, type State } from '../hooks/state'
import { ownerLine, ownerOf, runningOwner } from '../hooks/tool-owner'

const task = (id: string, title: string, phase: string, dependsOn: string[] = []) => ({ id, title, phase, agent: 'coder', requirement: 'r', dependsOn, rufloTaskId: `rt-${id}` })
const mission = (over: Partial<MissionRecord> = {}): MissionRecord => ({
  id: 'm1', objective: 'o', profile: 'feature', rigor: 'standard', tasks: [task('a', 'Research it', 'research'), task('b', 'Write the tests', 'test', ['a'])], acceptance: [], events: [], paused: false, cancelled: false, auto: false, createdAtMs: 0, ...over,
})

function stateWith(record: MissionRecord, statuses: Record<string, string>): State {
  const state = newState({})

  mcOf(state).missions.set(record.id, record)
  mcOf(state).active = record.id
  ;(state as unknown as { snapshot: unknown }).snapshot = { tasks: Object.entries(statuses).map(([id, status]) => ({ id: `rt-${id}`, status })) }

  return state
}

describe('tool row owner', () => {
  it('the one running task owns a call first seen while it runs, and keeps it after the task ends', () => {
    const state = stateWith(mission(), { a: 'in_progress', b: 'pending' })

    expect(ownerOf(state, 'call-1', true)).toMatchObject({ taskId: 'a', title: 'Research it', phase: 'research' })
    ;(state as unknown as { snapshot: unknown }).snapshot = { tasks: [{ id: 'rt-a', status: 'completed' }, { id: 'rt-b', status: 'in_progress' }] }
    expect(ownerOf(state, 'call-1', false)?.taskId).toBe('a')
    expect(ownerOf(state, 'call-2', true)?.taskId).toBe('b')
  })

  it('a call first seen already finished, or with no running task, belongs to none', () => {
    const state = stateWith(mission(), { a: 'in_progress', b: 'pending' })

    expect(ownerOf(state, 'old', false)).toBeNull()
    expect(ownerOf(stateWith(mission(), { a: 'pending', b: 'pending' }), 'x', true)).toBeNull()
  })

  it('two running tasks, a paused mission or a cancelled one attribute nothing', () => {
    expect(runningOwner(stateWith(mission({ tasks: [task('a', 'A', 'x'), task('b', 'B', 'y')] }), { a: 'in_progress', b: 'in_progress' }))).toBeNull()
    expect(runningOwner(stateWith(mission({ paused: true }), { a: 'in_progress' }))).toBeNull()
    expect(runningOwner(stateWith(mission({ cancelled: true }), { a: 'in_progress' }))).toBeNull()
    expect(runningOwner(newState({}))).toBeNull()
  })

  it('the row line names the task and its phase', () => {
    expect(ownerLine({ taskId: 'a', title: 'Research it', phase: 'research', missionId: 'm1' })).toBe('↳ mission task: Research it (research)')
  })
})
