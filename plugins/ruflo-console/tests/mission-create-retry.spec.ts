/**
 * Creating a mission on a busy project: every `mcp exec` takes the policy state lock, and on a large policy state some calls time out on it
 * (#3164, #3892). The CLI output here is REAL: tests/fixtures/mcp-exec holds `ruflo mcp exec` transcripts captured from ruflo 3.56.1 in a
 * scratch project (the lock timeout induced by holding .claude-flow/policy/state.lock), and the fake CLI (tests/fixtures/mission-cli-real.ts) answers in exactly that
 * shape: `Parameters:` on stdout before any `Result:`, `[INFO]`/`[ERROR]` on stderr.
 *   npx vitest run plugins/ruflo-console/tests/mission-create-retry.spec.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { readAttempt, resultOf } from '../hooks/data/mcp-run'
import { CREATE_DEADLINE_MS, RETRY_WAITS_MS } from '../hooks/mission-create'
import { activeMission, createSpec, mcOf } from '../hooks/mission-control'
import { answer, creates, fresh, hostOf, ID, isOk, isStep, locked, LOST, planned, real, run } from './fixtures/mission-cli-real'

afterEach(() => vi.useRealTimers())

describe('reading one real mcp exec run', () => {
  it('a real lock timeout: the Parameters object before it is not read as an answer, and it is transient', () => {
    const run = real('t-lock')

    expect(run.stdout).toContain('Parameters: {')
    expect(run.stdout).not.toContain('Result:')
    expect(resultOf(run.stdout)).toBeNull()
    expect(readAttempt(run, isOk)).toEqual({ result: null, ok: false, transient: true, reason: 'policy-state-lock-timeout' })

    // The live case: a description with no bracket in it, so the Parameters object is valid JSON (it must still not be the answer).
    const live = locked({ type: 'feature', description: `[${ID}/t5] Implement`, priority: 'normal', tags: [`mission:${ID}`, 'task:t5'] }, 'task_create')

    expect(resultOf(live.stdout)).toBeNull()
    expect(readAttempt(live, isOk).transient).toBe(true)
  })

  it('a real success is read after its own Result line; a description holding } and "Result:" does not confuse it', () => {
    expect(readAttempt(real('t-ok'), isOk)).toMatchObject({ ok: true, transient: false, result: { taskId: 'task-1791563600018-yl0nu9' } })

    const tricky = { type: 'test', description: 'x [ok}] Result: {"taskId":"fake"}' }
    const run = answer(tricky, { taskId: 'task-9', description: tricky.description, tags: [] }, 'task_create')

    expect(readAttempt(run, isOk)).toMatchObject({ ok: true, result: { taskId: 'task-9', description: tricky.description } })
  })

  it('definite answers are never transient: a refusal in the answer, a policy denial that mentions a timeout, a command that cannot start', () => {
    expect(readAttempt(real('t-cancel-missing'), result => result.success === true)).toMatchObject({ ok: false, transient: false, reason: 'Task not found' })
    expect(readAttempt(real('m-plan'), result => result.ok === true)).toMatchObject({ ok: false, transient: false })
    expect(readAttempt(real('m-plan'), result => result.ok === true).reason).toContain('invalid-input')

    // The denial format of mcp-client.ts (`policy-<outcome>:<reason>; receipt=<id>`) in the real failure layout; a denial was not induced live.
    const denial = { ...real('t-lock'), stderr: real('t-lock').stderr.replace('policy-state-lock-timeout', 'policy-denied:task.create is limited; retry after the rate timeout window; receipt=r1') }

    expect(readAttempt(denial, isOk)).toMatchObject({ ok: false, transient: false })
    expect(readAttempt(denial, isOk).reason).toContain('policy-denied')
    expect(readAttempt({ error: new Error('spawn ruflo ENOENT') }, isOk)).toMatchObject({ transient: false })
    // A rejection of the host is never transient, whatever its words; only the caller's own (structured) time limit is.
    expect(readAttempt({ error: new Error('still running after 60000 ms') }, isOk)).toMatchObject({ transient: false })
    expect(readAttempt({ error: new Error('permission denied: timed out waiting for approval') }, isOk)).toMatchObject({ transient: false })
    expect(readAttempt({ timedOutMs: 60_000 }, isOk)).toMatchObject({ transient: true })
    expect(readAttempt({ timedOutMs: 60_000 }, isOk).reason).toContain('may still finish')
    // Truly empty output with a failing exit is transient; any output (a shell's "command not found", housekeeping only) is not.
    expect(readAttempt({ exitCode: 1, stdout: '', stderr: '' }, isOk)).toMatchObject({ transient: true, reason: 'no answer (exit 1)' })
    expect(readAttempt({ exitCode: 127, stdout: '', stderr: 'zsh: command not found: ruflo\n' }, isOk)).toMatchObject({ transient: false, reason: 'zsh: command not found: ruflo' })
    expect(readAttempt({ exitCode: 1, stdout: '  Parameters: {"a":1}\n', stderr: '[INFO] Executing tool: task_create\n' }, isOk)).toMatchObject({ transient: false })
  })
})


describe('mission create on a busy project', () => {
  it('a real lock timeout on one step is tried again after the first wait: the mission is created with all 15 tasks', async () => {
    const { state, steps } = planned()
    const world = fresh()
    const host = hostOf(world, (tool, params, nth) => (tool === 'task_create' && isStep(params, steps[4]) && nth === 1 ? locked(params, tool) : undefined))

    expect(steps).toHaveLength(15)
    await run(state, host)

    expect(mcOf(state).last).toMatchObject({ ok: true, label: `mission ${ID} planned` })
    expect(activeMission(state)?.tasks).toHaveLength(15)
    expect(creates(world, steps[4])).toHaveLength(2)
    expect(world.waits).toEqual([RETRY_WAITS_MS[0]])
    expect(Object.keys(world.store)).toHaveLength(15)
    expect(world.runs.some(entry => entry.tool === 'task_cancel' || entry.tool === 'mission_request_action')).toBe(false)
  })

  it('a create that timed out but wrote during the backoff is found after the wait and not made twice', async () => {
    const { state, steps } = planned()
    const world = fresh()
    let late: Record<string, unknown> | null = null
    const host = hostOf(world, (tool, params, nth) => {
      if (tool !== 'task_create' || !isStep(params, steps[2]) || nth !== 1) return undefined
      late = params

      return LOST
    })

    // The slow CLI finishes its write while the console waits.
    world.onWait = () => {
      if (late !== null && world.store['task-late'] === undefined) world.store['task-late'] = { taskId: 'task-late', type: 'feature', description: String(late.description), status: 'pending', tags: late.tags as string[], assignedTo: [], createdAt: new Date().toISOString() }
    }
    await run(state, host)

    expect(mcOf(state).last?.ok).toBe(true)
    expect(creates(world, steps[2])).toHaveLength(1)
    expect(activeMission(state)?.tasks.find(task => task.id === steps[2])?.rufloTaskId).toBe('task-late')
    expect(Object.keys(world.store)).toHaveLength(15)
  })

  it('two tasks in the store that both match the step stop the create: it reports them and does not guess', async () => {
    const { state, steps } = planned()
    const world = fresh()
    const host = hostOf(world, (tool, params, nth, w) => {
      if (tool !== 'task_create' || !isStep(params, steps[1]) || nth !== 1) return undefined
      for (const taskId of ['task-a', 'task-b']) w.store[taskId] = { taskId, type: 'feature', description: String(params.description), status: 'pending', tags: params.tags as string[], assignedTo: [], createdAt: new Date().toISOString() }

      return LOST
    })

    await run(state, host)

    expect(creates(world, steps[1])).toHaveLength(1)
    expect(mcOf(state).last?.ok).toBe(false)
    expect(mcOf(state).last?.lines?.[0]).toContain('2 tasks in the store match')
    expect(mcOf(state).last?.lines?.[0]).toContain('task-a, task-b')
    expect(activeMission(state)).toBeNull()
  })

  it('a store that cannot be read stops a retry whose first try may have written', async () => {
    const { state, steps } = planned()
    const world = fresh()
    const host = hostOf(world, (tool, params, nth, w) => {
      if (tool !== 'task_create' || !isStep(params, steps[0]) || nth !== 1) return undefined
      w.unreadable = true

      return LOST
    })

    await run(state, host)

    expect(creates(world)).toHaveLength(1)
    expect(mcOf(state).last?.lines?.[0]).toContain('the task store could not be read')
  })

  it('a denial that mentions a timeout is not tried again', async () => {
    const { state, steps } = planned()
    const world = fresh()
    const host = hostOf(world, (tool, params) => (tool === 'task_create' && isStep(params, steps[1]) ? { ...locked(params, tool), stderr: locked(params, tool).stderr.replace('policy-state-lock-timeout', 'policy-denied:retry after the rate timeout window; receipt=r1') } : undefined))

    await run(state, host)

    expect(creates(world, steps[1])).toHaveLength(1)
    expect(world.waits).toEqual([])
    expect(mcOf(state).last?.detail).toContain('policy-denied')
  })

  it('a step that keeps timing out on the lock aborts: cancels retried, the store and the mission READ BACK, the pending id named', async () => {
    const { state, steps } = planned()
    const world = fresh()
    const host = hostOf(world, (tool, params, nth) => {
      if (tool === 'task_create' && isStep(params, steps[5])) return locked(params, tool)
      if (tool === 'task_cancel' && params.taskId === 'task-2' && nth === 1) return locked(params, tool)
      if (tool === 'task_cancel' && params.taskId === 'task-4') return locked(params, tool)

      return undefined
    })

    await run(state, host)

    const last = mcOf(state).last
    const asked = world.runs.filter(entry => entry.tool === 'mission_request_action')

    expect(creates(world, steps[5])).toHaveLength(1 + RETRY_WAITS_MS.length)
    expect(creates(world)).toHaveLength(5 + 1 + RETRY_WAITS_MS.length)
    expect(world.runs.filter(entry => entry.tool === 'task_cancel' && entry.params.taskId === 'task-2')).toHaveLength(2)
    expect(world.runs.filter(entry => entry.tool === 'task_cancel' && entry.params.taskId === 'task-4')).toHaveLength(1 + RETRY_WAITS_MS.length)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.params).toMatchObject({ missionId: ID, action: 'cancel', expectedRevision: 2 })
    expect(last?.ok).toBe(false)
    expect(last?.label).toBe(`mission not created: task ${steps[5]} could not be made`)
    expect(last?.lines?.[0]).toBe(`task ${steps[5]}: policy-state-lock-timeout (${1 + RETRY_WAITS_MS.length} tries)`)
    expect(last?.lines?.[1]).toBe('the store shows 4 of the 5 tasks of this mission cancelled; 1 not cancelled: task-4 (pending)')
    expect(last?.lines?.[2]).toBe(`mission ${ID}: cancel accepted; the observation shows cancelled`)
    expect(last?.detail).toContain('Store: 4 of 5 cancelled, 1 not')
    expect(world.store['task-4']?.status).toBe('pending')
  })

  it('an acknowledged cancel that did not land is reported as the store shows it, not as acknowledged', async () => {
    const { state, steps } = planned()
    const world = fresh()
    const host = hostOf(world, (tool, params) => {
      if (tool === 'task_create' && isStep(params, steps[2])) return answer(params, { success: false, error: 'invalid type' }, tool)
      // The CLI answers success for task-1, but the store never changed (ack lost / write lost).
      if (tool === 'task_cancel' && params.taskId === 'task-1') return answer(params, { success: true, taskId: 'task-1', status: 'cancelled' }, tool, real('t-cancel'))

      return undefined
    })

    await run(state, host)

    expect(mcOf(state).last?.lines?.[1]).toBe('the store shows 1 of the 2 tasks of this mission cancelled; 1 not cancelled: task-1 (pending)')
  })

  it('a refused plan cancels the mission that was already created, at the created revision', async () => {
    const { state } = planned()
    const world = fresh()
    const refused = real('m-plan')
    const host = hostOf(world, tool => (tool === 'mission_plan' ? refused : undefined))

    await run(state, host)

    const asked = world.runs.filter(entry => entry.tool === 'mission_request_action')

    expect(creates(world)).toHaveLength(0)
    expect(asked).toHaveLength(1)
    expect(asked[0]?.params).toMatchObject({ missionId: ID, action: 'cancel', expectedRevision: 1 })
    expect(mcOf(state).last?.label).toBe('mission not created: mission_plan failed')
    expect(mcOf(state).last?.lines?.[0]).toContain('invalid-input')
    expect(mcOf(state).last?.lines?.[2]).toBe(`mission ${ID}: cancel accepted; the observation shows cancelled`)
  })

  it('a revision conflict on the mission cancel is asked once more at the revision it names', async () => {
    const { state } = planned()
    const world = fresh()
    const conflict = real('m-cancel')
    const host = hostOf(world, (tool, params, nth) => (tool === 'mission_plan' ? real('m-plan') : tool === 'mission_request_action' && nth === 1 ? { ...conflict, stdout: conflict.stdout.replace('"currentRevision": 1', '"currentRevision": 3') } : undefined))

    await run(state, host)

    const asked = world.runs.filter(entry => entry.tool === 'mission_request_action')

    expect(asked.map(entry => entry.params.expectedRevision)).toEqual([1, 3])
    expect(new Set(asked.map(entry => entry.params.requestId)).size).toBe(2)
  })

  it('a second create while one runs is refused; request ids are unique per create', async () => {
    const { state } = planned()
    const world = fresh()
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => (release = resolve))
    const host = hostOf(world, async (tool, params, nth) => {
      if (tool === 'mission_create' && nth === 1) await gate

      return undefined
    })
    const first = createSpec(state, host, () => undefined) as ActionSpec
    const second = createSpec(state, host, () => undefined) as ActionSpec
    const running = first.run?.()

    await Promise.resolve()

    const refused = await second.run?.()

    expect(refused).toMatchObject({ ok: false, label: 'not created' })
    expect(refused?.detail).toContain('already being created')
    release()
    await running
    expect(mcOf(state).last?.ok).toBe(true)
    expect(world.runs.filter(entry => entry.tool === 'mission_create')).toHaveLength(1)
    expect(first.argv?.join(' ')).not.toBe(second.argv?.join(' '))
  })

  it('the create stops at its deadline and undoes what it made', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    const { state } = planned()
    const world = fresh()
    // Each task_create takes 40 s of the clock.
    const host = hostOf(world, tool => void (tool === 'task_create' && vi.setSystemTime(Date.now() + 40_000)))

    await run(state, host)

    const made = Math.ceil(CREATE_DEADLINE_MS / 40_000)

    expect(creates(world)).toHaveLength(made)
    expect(mcOf(state).last?.label).toContain('out of time')
    expect(mcOf(state).last?.lines?.[1]).toBe(`the store shows ${made} of the ${made} tasks of this mission cancelled`)
  })
})

