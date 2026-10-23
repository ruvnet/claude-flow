/**
 * Autopilot on Windows (write flavor host-fs) is not available yet: its journal needs atomic appends (host-fs appends are read-then-write, so two
 * concurrent `step.started` lines can lose one and a step can be dispatched twice) and its folder fence and envelope-edit deny need Windows-aware
 * path checks. So every start refuses, writing nothing and dispatching nothing; stop and the kill-flag clear keep working. Elsewhere a start is
 * unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { setWriteFlavor } from '../hooks/data/write-flavor'
import { KILL_CLEARED } from '../hooks/data/ap-envelope'
import { resetSlots, slotsFor } from '../hooks/views/wf-slots'
import { boardRows, draftOf, editDraft, registerAutopilotSlots, startSpec } from '../hooks/views/ap-panel'
import { CWD, ctxOf, envOf, flat, journal, KILL, rig, stateWith, T0 } from './fixtures/ap-rig'

const MESSAGE = 'Autopilot is not yet available on Windows: its journal and path fence need atomic appends and Windows-aware path checks (follow-up).'

afterEach(() => setWriteFlavor(null))

async function world(flavor: 'host-fs' | 'gnu') {
  setWriteFlavor(flavor)

  const live = await import('../hooks/ap-live')
  const r = rig()
  const state = stateWith([], 'off')
  const fs = r.host.fs as unknown as Record<string, unknown>

  fs.write = async (p: string, t: string) => void r.files.set(p, t)
  fs.exists = async (p: string) => r.files.has(p)
  live.wireAutopilot(state, r.host)
  editDraft(draftOf(state), { kind: 'anatole' })

  return { r, state, live }
}

describe('autopilot start on a host-fs machine', () => {
  it('the card run refuses with the plain message and writes nothing, runs nothing, dispatches nothing', async () => {
    const { r, state, live } = await world('host-fs')
    const before = [...r.files.keys()]

    await startSpec(envOf(state, T0))?.run?.()

    expect(live.storeOf(state).error).toBe(MESSAGE)
    expect(r.toasts).toContain(MESSAGE)
    expect([...r.files.keys()]).toEqual(before)
    expect(r.runs).toEqual([])
    expect(r.prompts).toEqual([])
    expect(live.storeOf(state).loop.phase).not.toBe('running')
  })

  it('every start entry point converges on it: the Workflows action row, the pane button and the confirm they raise', async () => {
    const { r, state, live } = await world('host-fs')
    const before = [...r.files.keys()]

    resetSlots()
    registerAutopilotSlots()

    const slot = slotsFor('action').find(s => s.id === 'ap-start')

    await slot?.spec(envOf(state, T0))?.run?.()
    expect(live.storeOf(state).error).toBe(MESSAGE)

    live.storeOf(state).error = null

    const asked: unknown[] = []
    const ctx = { ...ctxOf(state, T0), act: { workflows: { ask: (spec: unknown) => void asked.push(spec) } } as never }
    const press = flat(boardRows({ ...envOf(state, T0), ctx })).find(el => el.kind === 'Button' && el.props.key === 'ap-start-btn')?.props.onPress as () => void

    press()
    expect(asked).toHaveLength(1)
    await (asked[0] as { run: () => Promise<void> }).run()
    expect(live.storeOf(state).error).toBe(MESSAGE)
    expect([...r.files.keys()]).toEqual(before)
    expect(r.runs).toEqual([])
    expect(r.prompts).toEqual([])
  })

  it('stop and the kill-flag clear still work: a stopped flag is cleared with the marker, and a stop writes it again', async () => {
    const { r, state, live } = await world('host-fs')
    const { killSeen } = await import('../hooks/data/ap-guard')

    await live.stopNow(state, r.host, 'because')
    expect(await killSeen(r.host.fs, CWD)).toBe(true)

    await startSpec(envOf(state, T0))?.run?.()
    expect(live.storeOf(state).error).toBe(MESSAGE)
    expect(await killSeen(r.host.fs, CWD)).toBe(true)

    await live.clearKill(state, r.host)
    expect(r.files.get(KILL)).toBe(KILL_CLEARED)
    expect(await killSeen(r.host.fs, CWD)).toBe(false)

    await live.stopNow(state, r.host, 'again')
    expect(await killSeen(r.host.fs, CWD)).toBe(true)
  })

  it('gnu: a start is unchanged (the envelope is written and a start line is journaled)', async () => {
    const { r, state, live } = await world('gnu')

    await startSpec(envOf(state, T0))?.run?.()

    expect(live.storeOf(state).error).toBeFalsy()
    expect(r.files.has(`${CWD}/.claude-flow/console/autopilot/envelope.json`)).toBe(true)
    expect(journal(r).some(event => event.t === 'start')).toBe(true)
  })
})
