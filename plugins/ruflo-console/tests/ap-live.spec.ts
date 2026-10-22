/**
 * The autopilot's live half and its panel (ADR-466): the start confirm and what it writes, the kill switch through the files, a tick
 * that hands a step over only after journaling it, crash-resume through a fresh process, parked questions, masking, and the slots.
 * An in-memory disk and a fake host: no engine. Run with
 *   npx vitest run plugins/ruflo-console/tests/ap-live.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { hashOf, seal } from '../hooks/data/ap-envelope'
import { apTick, appendEvents, answerParked, refreshAutopilot, storeOf, stopNow, wireAutopilot } from '../hooks/ap-live'
import { boardRows, defaultDraft, draftOf, editDraft, registerAutopilotSlots, startSpec } from '../hooks/views/ap-panel'
import { parkedRows } from '../hooks/views/ap-parked'
import { resetSlots, slotsFor } from '../hooks/views/wf-slots'
import '../hooks/views/wf-register'

import { CWD, E, ENV, J, KILL, T0, buttons, ctxOf, envOf, flat, journal, rig, started, stateWith, task, words } from './fixtures/ap-rig'

describe('the panel before and after wiring', () => {
  it('says it is not wired, then that autopilot is off, with no invented number', () => {
    const state = stateWith([])

    expect(words(boardRows(envOf(state, T0)))).toContain('not wired')

    const r = rig()

    wireAutopilot(state, r.host)

    const text = words(boardRows(envOf(state, T0)))

    expect(text).toContain('autopilot is off')
    expect(text).toContain('no envelope approved yet')
    expect(text).toContain('preflight not wired')
    expect(text).not.toContain('$0')
    expect(text).toContain('ledger not read')
  })

  it('draws the band line from the journal, spend n/a until read, and the parked count', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending')])

    started(r, [{ t: 'parked', at: T0 + 1, id: 'p-1', task: 't2', question: 'needs "publish", which autopilot can never do. Do it yourself, or deny it.' }])
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0 + 2 * 86_400_000)

    const text = words(boardRows(envOf(state, T0 + 2 * 86_400_000 + 10)))

    expect(text).toContain('autopilot day 3 · $n/a/$40 · 1 parked')
    expect(text).toContain(`hash ${hashOf(ENV).slice(0, 12)}`)
  })
})

describe('start: the one confirm', () => {
  it('offers no spec for an invalid draft and one with the hash, the ceilings and the never-list for a valid one', () => {
    const state = stateWith([])

    wireAutopilot(state, rig().host)
    expect(startSpec(envOf(state, T0))).not.toBeNull()

    draftOf(state).value.spend = { hourUsd: 9, dayUsd: 2, totalUsd: 1 }
    expect(startSpec(envOf(state, T0))).toBeNull()
    expect(words(boardRows(envOf(state, T0)))).toContain('draft is not valid')

    draftOf(state).value = defaultDraft(CWD)

    const spec = startSpec(envOf(state, T0))

    expect(spec?.declared).toBe('spend')
    expect(spec?.shows).toContain('never: publish, release, deploy, force-push, secret-access')
    expect(spec?.note).toContain('never bypassed')
  })

  it('refuses to start without Anatole unless the envelope accepted that; with it, writes the envelope, clears the flag and journals the start', async () => {
    const r = rig()
    const state = stateWith([], 'off')

    wireAutopilot(state, r.host)
    r.files.set(KILL, '')

    await startSpec(envOf(state, T0))?.run?.()
    expect(r.files.has(E)).toBe(false)
    expect(storeOf(state).error).toContain('Project Anatole is off')

    editDraft(draftOf(state), { kind: 'anatole' })
    await startSpec(envOf(state, T0))?.run?.()

    expect(r.files.has(E)).toBe(true)
    expect(r.files.has(KILL)).toBe(false)
    expect(journal(r)[0]).toMatchObject({ t: 'start', anatole: 'accepted-without', revision: 1 })
  })

  it('a changed envelope shows what it widens, and an unchanged running one has no spec', async () => {
    const r = rig()
    const state = stateWith([])

    started(r)
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0)
    draftOf(state).value = JSON.parse(JSON.stringify(ENV)) as Record<string, unknown>
    expect(startSpec(envOf(state, T0))).toBeNull()

    editDraft(draftOf(state), { kind: 'concurrency', by: 1 })
    expect(startSpec(envOf(state, T0))?.shows).toContain('WIDENS: concurrency: 1 to 2')
  })
})

describe('stop is immediate and needs no confirm', () => {
  it('journals a stop and leaves the flag file, and a tick in another process then never acts', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0)
    await stopNow(state, r.host, 'because')

    expect(r.files.has(KILL)).toBe(true)
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop', reason: 'because' })
    expect(r.toasts.join()).toContain('autopilot stopped')

    const other = stateWith([task('r1', 'pending')])

    wireAutopilot(other, r.host)
    await apTick(other, r.host, T0 + 1000)
    expect(r.prompts).toEqual([])
  })

  it('the flag file alone halts a running loop within one tick, before anything is handed over', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    r.files.set(KILL, '')
    wireAutopilot(state, r.host)
    await apTick(state, r.host, T0 + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop', reason: 'kill switch' })
  })
})

describe('a tick', () => {
  it('journals the step first, then hands the task to the session; and parks the publish task instead of running it', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    wireAutopilot(state, r.host)
    // Spend is read from the ledger, which this rig has not got: unknown spend waits, it never runs on a guess.
    await apTick(state, r.host, T0 + 1000)
    expect(r.prompts).toEqual([])
    expect(storeOf(state).status).toContain('spend not read')

    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 2000)

    expect(r.prompts.length).toBe(1)
    expect(r.prompts[0]).toContain('Fix the parser bug')

    const events = journal(r)

    expect(events.map(e => e.t)).toContain('step.started')
    expect(events.findIndex(e => e.t === 'step.started')).toBeLessThan(events.length)
  })

  it('parks the hard-deny task with a question and carries on with the next ready one', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    wireAutopilot(state, r.host)
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 2000)

    const parked = journal(r).find(e => e.t === 'parked')

    expect(parked).toMatchObject({ t: 'parked', task: 't2' })
    // ADR-470: a park does not hold the others back, so the same pass goes on to the next ready task (the parked one was never handed over).
    expect(r.prompts.length).toBe(1)
    expect(r.prompts[0]).toContain('Review the module')
    expect(r.prompts.join()).not.toContain('Publish the package')

    storeOf(state).adaptAtMs = T0 + 2000
    await apTick(state, r.host, T0 + 3000)

    expect(r.prompts.length).toBe(1)
  })

  it('crash-resume: a started step left by a dead process is settled by its effect, never run twice', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-dangling00001', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' }])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 + 100
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 1000)

    expect(journal(r).some(e => e.t === 'step.failed' && e.id === 's-dangling00001' && e.why.includes('lost on restart'))).toBe(true)
    // The lost step is settled; the tick did not also start a step in the same pass.
    expect(r.prompts).toEqual([])
    expect(journal(r).filter(e => e.t === 'step.started').length).toBe(1)
  })

  it('a task the store calls completed is only "done" when the verify commands pass; otherwise it fails and nothing is learned from it', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-verifyme0000001', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' }])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 - 1
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    r.failVerify.on = true
    await apTick(state, r.host, T0 + 1000)

    expect(r.runs.some(a => a[0] === 'true')).toBe(true)
    expect(journal(r).some(e => e.t === 'step.failed' && e.id === 's-verifyme0000001')).toBe(true)
    expect(journal(r).some(e => e.t === 'step.done')).toBe(false)
  })

  it('and with the verify commands passing the step is done and verified', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [{ t: 'step.started', at: T0 + 10, id: 's-verifyme0000002', task: 't1', cls: 'edit', attempt: 1, deadline: T0 + 1e9, tier: 'mid' }])
    wireAutopilot(state, r.host)
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 1000)

    expect(journal(r).find(e => e.t === 'step.done')).toMatchObject({ id: 's-verifyme0000002', verified: true })
  })

  it('refuses to run on an envelope whose hash is not the one the start recorded', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending')])

    started(r)
    r.files.set(E, JSON.stringify(seal({ ...ENV, spend: { hourUsd: 2, dayUsd: 10, totalUsd: 4000 } }, 2, T0)))
    wireAutopilot(state, r.host)
    await apTick(state, r.host, T0 + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop' })
  })
})

describe('the parked queue', () => {
  it('shows the question washed, approve-once and deny for an ordinary park, only deny for a hard deny, and journals the answer', async () => {
    const r = rig()
    const state = stateWith([])

    started(r, [
      { t: 'parked', at: T0 + 1, id: 'p-net', task: 't9', question: 'needs "network" \u001b[31mred\u001b[0m sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789. Approve once, or deny.' },
      { t: 'parked', at: T0 + 2, id: 'p-pub', task: 't2', question: 'needs "publish", which autopilot can never do. Do it yourself, or deny it.' },
    ])
    wireAutopilot(state, r.host)
    await refreshAutopilot(state, r.host, T0 + 5)

    const tree = parkedRows(envOf(state, T0 + 5))
    const text = words(tree)

    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('sk-ant-api03-abcdef')
    expect(buttons(tree)).toEqual(['approve once', 'deny', 'deny'])

    await answerParked(state, r.host, 'p-net', 'once')
    expect(journal(r).at(-1)).toMatchObject({ t: 'answered', id: 'p-net', answer: 'once' })
    expect(storeOf(state).loop.parked.find(p => p.id === 'p-net')?.answer).toBe('once')
  })

  it('has honest empty states', () => {
    const state = stateWith([])

    wireAutopilot(state, rig().host)
    expect(words(parkedRows(envOf(state, T0)))).toContain('has not started')
  })
})

describe('writes', () => {
  it('append through one fixed argv, the path a single element, and never through a link', async () => {
    const r = rig()
    const state = stateWith([])

    wireAutopilot(state, r.host)
    expect(await appendEvents(state, r.host, [{ t: 'beat', at: T0 }])).toBe(true)

    const dd = r.runs.find(a => a[0] === 'dd')

    expect(dd).toEqual(['dd', `of=${J}`, 'oflag=append', 'conv=notrunc', 'bs=1M', 'iflag=fullblock', 'status=none'])

    const linked = rig()

    linked.host.fs.stat = async (p: string) => (p === `${CWD}/.claude-flow` ? { kind: 'dir', isLink: true } : Promise.reject(new Error('ENOENT')))
    wireAutopilot(state, linked.host)
    expect(await appendEvents(state, linked.host, [{ t: 'beat', at: T0 }])).toBe(false)
    expect(linked.runs.filter(a => a[0] === 'dd')).toEqual([])
  })
})

describe('registration', () => {
  it('registers its board, key, action and notice slots with no refusal and no hotkey clash against the merged features', () => {
    const before = slotsFor('key').map(s => s.key)

    expect(slotsFor('board').map(s => s.id)).toEqual(expect.arrayContaining(['autopilot', 'ap-parked']))
    // ADR-470: no hotkeys. Digits and letters are view keys, and a slot hotkey equal to one loses to it.
    expect(slotsFor('key').find(s => s.id === 'ap-stop-key')).toBeUndefined()
    expect(slotsFor('action').find(s => s.id === 'ap-start')?.hotkey).toBeUndefined()
    expect(slotsFor('notice').map(s => s.id)).toContain('autopilot')

    const keys = [...before, ...slotsFor('action').map(s => s.hotkey)].filter(key => key !== undefined)

    expect(new Set(keys).size).toBe(keys.length)
    resetSlots()
    registerAutopilotSlots()
    expect(slotsFor('board').length).toBe(1)
  })
})
