import { describe, expect, it } from 'vitest'
import { cancelSpec, dispatchSpec } from '../hooks/mission-specs'
import { mcOf } from '../hooks/mission-control'
import { newState } from '../hooks/state'
import type { MissionRecord } from '../hooks/mission-types'
import type { Host } from '../hooks/host'

const id = 'msn_0123456789abcdef01234567'
function setup(revision: number | null = 7) {
  const state = newState({})
  const mission: MissionRecord = { id, objective: 'fix reconnect', profile: 'bugfix', rigor: 'standard',
    tasks: [{ id: 't1', title: 'Implement', phase: 'R', agent: 'coder', requirement: 'tests pass', dependsOn: [], rufloTaskId: 'rt1' }],
    acceptance: [{ id: 'a', check: 'no duplicates' }], events: [], paused: false, cancelled: false, auto: true, createdAtMs: 1 }
  const tasks = [{ id: 'rt1', type: 'feature', description: '', status: 'pending', assignedTo: [], tags: [] }]
  state.snapshot = { tasks, missions: { missions: revision === null ? [] : [{ id, revision }] } } as never
  mcOf(state).missions.set(id, mission)
  mcOf(state).active = id
  const calls: { tool: string; input: Record<string, unknown> }[] = []
  let answer: unknown = { ok: true, data: { missionId: id, revision: 9, state: 'cancelled' } }
  let taskSuccess = true
  const host = { invalidate: () => {}, storeSet: async () => {}, after: () => ({ cancel() {} }),
    run: async (argv: string[]) => {
      const tool = argv[argv.indexOf('-t') + 1]!
      const input = JSON.parse(argv[argv.indexOf('-p') + 1]!)
      calls.push({ tool, input })
      return { exitCode: 0, stdout: `Result:\n${JSON.stringify(tool === 'mission_request_action' ? answer : { success: taskSuccess })}`, stderr: '' }
    } } as unknown as Host
  return { state, mission, tasks, calls, host, setAnswer: (next: unknown) => { answer = next }, failTask: () => { taskSuccess = false } }
}

describe('mission approval binds the reviewed plan and revision', () => {
  it('uses the observed revision, cancels the authoritative record before tasks, and disables dispatch', async () => {
    const w = setup()
    await cancelSpec(w.state, w.host, w.mission, w.tasks).run?.()
    expect(w.calls.map(c => c.tool)).toEqual(['mission_request_action', 'task_cancel'])
    expect(w.calls[0]?.input.expectedRevision).toBe(7)
    expect(w.mission.cancelled).toBe(true)
    expect(w.mission.auto).toBe(false)
    expect(mcOf(w.state).last?.ok).toBe(true)
  })

  it('a stale revision rejection leaves tasks and local mission untouched', async () => {
    const w = setup()
    w.setAnswer({ ok: false, code: 'revision-conflict', message: 'expected 7, current 8' })
    await cancelSpec(w.state, w.host, w.mission, w.tasks).run?.()
    expect(w.calls.map(c => c.tool)).toEqual(['mission_request_action'])
    expect(w.mission.cancelled).toBe(false)
    expect(mcOf(w.state).last?.ok).toBe(false)
  })

  it('unknown revision cannot authorize a mutation', async () => {
    const w = setup(null)
    await cancelSpec(w.state, w.host, w.mission, w.tasks).run?.()
    expect(w.calls).toEqual([])
    expect(w.mission.cancelled).toBe(false)
  })

  it('a modified task plan invalidates the cancellation card before writes', async () => {
    const w = setup()
    const spec = cancelSpec(w.state, w.host, w.mission, w.tasks)
    w.mission.tasks[0]!.requirement = 'publish immediately'
    await spec.run?.()
    expect(w.calls).toEqual([])
  })

  it('a modified acceptance criterion invalidates dispatch before task_update or prompt', async () => {
    const w = setup()
    let sends = 0
    const spec = dispatchSpec(w.state, w.host, w.mission, w.mission.tasks[0]!, async () => { sends++ })
    w.mission.acceptance[0]!.check = 'skip verification'
    await spec.run?.()
    expect(w.calls).toEqual([])
    expect(sends).toBe(0)
  })

  it('a changed outcome or wrong mission ID cannot be reported as cancelled', async () => {
    for (const data of [{ missionId: id, state: 'cancelRequested' }, { missionId: 'other', state: 'cancelled' }]) {
      const w = setup()
      w.setAnswer({ ok: true, data })
      await cancelSpec(w.state, w.host, w.mission, w.tasks).run?.()
      expect(w.calls).toHaveLength(1)
      expect(w.mission.cancelled).toBe(false)
      expect(mcOf(w.state).last?.ok).toBe(false)
    }
  })

  it('cancellation during the asynchronous task update cannot start a billed turn or reset a task', async () => {
    const w = setup()
    let sends = 0
    const run = w.host.run
    w.host.run = async (...args) => { const result = await run(...args); w.mission.cancelled = true; return result }
    await dispatchSpec(w.state, w.host, w.mission, w.mission.tasks[0]!, async () => { sends++ }).run?.()
    expect(w.calls.map(c => c.tool)).toEqual(['task_update'])
    expect(sends).toBe(0)
    expect(mcOf(w.state).last?.detail).toContain('No prompt was sent')
  })

  it('partial cleanup stops dispatch but explicitly reports unconfirmed tasks', async () => {
    const w = setup()
    w.failTask()
    await cancelSpec(w.state, w.host, w.mission, w.tasks).run?.()
    expect(w.mission.cancelled).toBe(true)
    expect(mcOf(w.state).last?.ok).toBe(false)
    expect(mcOf(w.state).last?.detail).toContain('unconfirmed: t1')
  })

  it('double acceptance does not duplicate task cancellation', async () => {
    const w = setup()
    const spec = cancelSpec(w.state, w.host, w.mission, w.tasks)
    await Promise.all([spec.run?.(), spec.run?.()])
    expect(w.calls).toHaveLength(2)
  })
})
