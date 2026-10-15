/**
 * Mission create under lost answers and strict time, what counts as transient, and how the outcome of a long run (and of an ADR page write)
 * reaches console_state's lastResult. The CLI output is the real transcripts' (tests/fixtures/mission-cli-real.ts).
 *   npx vitest run plugins/ruflo-console/tests/mission-create-time.spec.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { adrOf, proposeSpec } from '../hooks/adr'
import type { Host } from '../hooks/host'
import { CALL_MS, CLEANUP_BUDGET_MS, CREATE_DEADLINE_MS, isCreating, RETRY_WAITS_MS } from '../hooks/mission-create'
import { activeMission, createSpec, mcOf } from '../hooks/mission-control'
import { callTool } from '../hooks/model-tools'
import { createRunner } from '../hooks/runner'
import type { State } from '../hooks/state'
import { cleanAfter, loaded, TODAY } from './adr-helpers'
import { setup } from './fixtures/control-setup'
import { creates, fresh, hostOf, ID, isStep, locked, LOST, planned, run } from './fixtures/mission-cli-real'
import { useNativeWriteFlavor } from './fixtures/write-flavor'

cleanAfter()
afterEach(() => vi.useRealTimers())

describe('lost answers, strict time, and what counts as transient', () => {
  it('the last try writes and its answer is lost: a final store read finds it, so the mission is created without a duplicate', async () => {
    const { state, steps } = planned()
    const world = fresh()
    const host = hostOf(world, (tool, params, nth, w) => {
      if (tool !== 'task_create' || !isStep(params, steps[3])) return undefined
      if (nth <= RETRY_WAITS_MS.length) return locked(params, tool)
      // The last try writes the task, then its answer is lost.
      w.store['task-lost'] = { taskId: 'task-lost', type: 'feature', description: String(params.description), status: 'pending', tags: params.tags as string[], assignedTo: [], createdAt: new Date().toISOString() }

      return LOST
    })

    await run(state, host)

    expect(creates(world, steps[3])).toHaveLength(1 + RETRY_WAITS_MS.length)
    expect(mcOf(state).last?.ok).toBe(true)
    expect(activeMission(state)?.tasks.find(task => task.id === steps[3])?.rufloTaskId).toBe('task-lost')
    expect(Object.keys(world.store)).toHaveLength(15)
  })

  it('cleanup cancels every open task of the mission in the store, not only the acknowledged ones', async () => {
    const { state, steps } = planned()
    const world = fresh()
    const host = hostOf(world, (tool, params, nth, w) => {
      if (tool !== 'task_create' || !isStep(params, steps[1]) || nth !== 1) return undefined
      for (const taskId of ['task-a', 'task-b']) w.store[taskId] = { taskId, type: 'feature', description: String(params.description), status: 'pending', tags: params.tags as string[], assignedTo: [], createdAt: new Date().toISOString() }

      return LOST
    })

    await run(state, host)

    const cancelled = world.runs.filter(entry => entry.tool === 'task_cancel').map(entry => entry.params.taskId)

    expect(cancelled).toEqual(expect.arrayContaining(['task-1', 'task-a', 'task-b']))
    expect(mcOf(state).last?.lines?.[1]).toBe('the store shows 3 of the 3 tasks of this mission cancelled')
    expect(Object.values(world.store).every(task => task.status === 'cancelled')).toBe(true)
  })

  it('a store task stamped before the console started (clock skew) is still this step\'s late success: no duplicate', async () => {
    const { state, steps } = planned()
    const world = fresh()
    const skewed = new Date(Date.now() - 2_000).toISOString()
    const host = hostOf(world, (tool, params, nth, w) => {
      if (tool !== 'task_create' || !isStep(params, steps[0]) || nth !== 1) return undefined
      w.store['task-skew'] = { taskId: 'task-skew', type: 'feature', description: String(params.description), status: 'pending', tags: params.tags as string[], assignedTo: [], createdAt: skewed }

      return LOST
    })

    await run(state, host)

    expect(creates(world, steps[0])).toHaveLength(1)
    expect(activeMission(state)?.tasks[0]?.rufloTaskId).toBe('task-skew')
    expect(Object.keys(world.store)).toHaveLength(15)
  })

  it('a CLI that is not there is not retried', async () => {
    const { state } = planned()
    const world = fresh()
    const host = hostOf(world, () => ({ exitCode: 127, stdout: '', stderr: 'zsh: command not found: ruflo\n' }))

    await run(state, host)

    expect(world.runs).toHaveLength(1)
    expect(world.waits).toEqual([])
    expect(mcOf(state).last?.detail).toContain('command not found')
  })

  it('a host rejection that mentions a timeout (an approval that timed out) is not retried', async () => {
    const { state } = planned()
    const world = fresh()
    const host = hostOf(world, () => new Error('permission denied: timed out waiting for approval'))

    await run(state, host)

    expect(world.runs).toHaveLength(1)
    expect(world.waits).toEqual([])
  })

  it('no call starts after its deadline: cleanup stops at its own and names what it left', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    const { state } = planned()
    const world = fresh()
    const t0 = Date.now()
    const starts: { tool: string; atMs: number }[] = []
    // Each task_create takes 40 s of the clock, each task_cancel 50 s.
    const host = hostOf(world, tool => {
      starts.push({ tool, atMs: Date.now() - t0 })
      if (tool === 'task_create') vi.setSystemTime(Date.now() + 40_000)
      if (tool === 'task_cancel') vi.setSystemTime(Date.now() + 50_000)

      return undefined
    })

    await run(state, host)

    const cleanupEnd = CREATE_DEADLINE_MS + CLEANUP_BUDGET_MS

    expect(starts.filter(entry => entry.tool === 'task_create').every(entry => entry.atMs < CREATE_DEADLINE_MS)).toBe(true)
    expect(starts.every(entry => entry.atMs < cleanupEnd)).toBe(true)
    expect(starts.filter(entry => entry.tool === 'task_cancel')).toHaveLength(2)
    expect(starts.some(entry => entry.tool === 'mission_request_action')).toBe(false)
    expect(mcOf(state).last?.lines?.join('\n')).toContain('out of cleanup time: not asked to cancel task-3, task-4, task-5')
  })

  it('a call the host never answers is let go at the time left: the create ends, the guard is released, the report says it may still finish', async () => {
    vi.useFakeTimers()

    const { state, steps } = planned()
    const world = fresh()
    const host = hostOf(world, (tool, params) => (tool === 'task_create' && isStep(params, steps[0]) ? new Promise<undefined>(() => undefined) : undefined))
    let settled = false
    const running = run(state, host).then(() => (settled = true))

    for (let i = 0; i < 40 && !settled; i++) await vi.advanceTimersByTimeAsync(CALL_MS)
    await running

    expect(settled).toBe(true)
    expect(isCreating(state)).toBe(false)
    expect(mcOf(state).last?.ok).toBe(false)
    expect(mcOf(state).last?.lines?.[0]).toContain('the CLI process may still finish')
    expect(world.runs.filter(entry => entry.tool === 'mission_request_action')).toHaveLength(1)
  })
})

/** Asks for `spec` through the real runner, says yes, waits for its own run, then reads lastResult as console_state hands it to Claude. */
async function lastResultAfter(state: State, host: Host, spec: ActionSpec, meanwhile?: () => void): Promise<{ label: string; ok: boolean; detail: string; lines: string[] } | null> {
  const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })
  const { deps } = setup('read')

  // An older, unrelated result sits in the slot, as it did live.
  state.outcome = { label: 'an older read', ok: true, verified: 'n/a', detail: 'unrelated', atMs: Date.now() - 1_000 }
  runner.ask(spec, '')
  await runner.confirm()
  meanwhile?.()
  await runner.finished()
  // The stub snapshot is not a full one: the screen text console_state also builds reads the disk as not read yet.
  state.snapshot = null

  const text = await callTool('console_state', {}, { ...deps, state })

  if (!text.startsWith('{')) throw new Error(text)

  return (JSON.parse(text) as { lastResult: { label: string; ok: boolean; detail: string; lines: string[] } | null }).lastResult
}

describe('the outcome of a long or page action reaches lastResult', () => {
  it('mission create: an abort, with the CLI reason and the read-back', async () => {
    const { state, steps } = planned()
    const world = fresh()
    const host = hostOf(world, (tool, params) => (tool === 'task_create' && isStep(params, steps[3]) ? locked(params, tool) : undefined))
    const result = await lastResultAfter(state, host, createSpec(state, host, () => undefined) as ActionSpec)

    expect(result?.ok).toBe(false)
    expect(result?.label).toBe(`mission not created: task ${steps[3]} could not be made`)
    expect(result?.lines.join('\n')).toContain('policy-state-lock-timeout')
    expect(result?.lines.join('\n')).toContain('the store shows 3 of the 3 tasks of this mission cancelled')
  })

  it('mission create: a success', async () => {
    const { state } = planned()
    const host = hostOf(fresh())
    const result = await lastResultAfter(state, host, createSpec(state, host, () => undefined) as ActionSpec)

    expect(result).toMatchObject({ ok: true, label: `mission ${ID} planned` })
  })

  it('another action that reports in the same millisecond the run started is not overwritten by the run\'s late result', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    const { state } = planned()
    const host = hostOf(fresh())
    const result = await lastResultAfter(state, host, createSpec(state, host, () => undefined) as ActionSpec, () => {
      state.outcome = { label: 'another action', ok: true, verified: 'n/a', detail: 'same millisecond', atMs: Date.now() }
    })

    expect(result?.label).toBe('another action')
  })

  it('a late completion does not overwrite a newer outcome of another action; it goes to the Events feed', async () => {
    const { state } = planned()
    const host = hostOf(fresh())
    const result = await lastResultAfter(state, host, createSpec(state, host, () => undefined) as ActionSpec, () => {
      state.outcome = { label: 'another action', ok: true, verified: 'n/a', detail: 'newer', atMs: Date.now() + 5 }
    })

    expect(result?.label).toBe('another action')
    expect(state.events.some(event => event.text.includes(`mission ${ID} planned`) && event.text.includes('finished after a newer result'))).toBe(true)
  })

})

describe('the outcome of an ADR page write reaches lastResult', () => {
  // A real disk: the write argv is the one this machine's tools take, found the way the console finds it at session start.
  useNativeWriteFlavor()

  it('adr-propose on a real disk: ✓, and the file exists', async () => {
    const { root, state, world } = await loaded('nygard')
    const spec = proposeSpec(state, world.host as never, 'Cache reads', TODAY) as ActionSpec
    const target = /create (\S+)/.exec(spec.shows ?? '')?.[1] as string
    const result = await lastResultAfter(state, world.host as never, spec)

    expect(result).toMatchObject({ ok: true, label: 'propose ADR 4', detail: `created ${target}` })
    expect(existsSync(join(root, target))).toBe(true)
    expect(readFileSync(join(root, target), 'utf8')).toContain('Cache reads')
  })

  it('adr-propose: the write fails', async () => {
    const { state, world } = await loaded('nygard')
    // The write command fails, as it did live: the page said so, and console_run said "Ran: propose ADR 4".
    const host = { ...world.host, run: async () => ({ exitCode: 1, stdout: '', stderr: 'install: illegal option -- D' }) }
    const spec = proposeSpec(state, host as never, 'Cache reads', TODAY) as ActionSpec
    const result = await lastResultAfter(state, host as never, spec)

    expect(adrOf(state).last?.ok).toBe(false)
    expect(result).toMatchObject({ ok: false, label: 'propose ADR 4' })
    expect(result?.detail).toContain('the write failed (exit 1: install: illegal option -- D)')
  })
})
