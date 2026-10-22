/**
 * The security audit, live half (ADR-465, ADR-466): the autopilot loop on an in-memory disk and a fake host, attacked through the files
 * the steps can write. Each case failed before its fix and fails again if the fix is taken out. Run with
 *   npx vitest run plugins/ruflo-console/tests/security-audit-live.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { apTick, stopNow, storeOf, wireAutopilot } from '../hooks/ap-live'
import { seal } from '../hooks/data/ap-envelope'
import { encodeLine, type JournalEvent } from '../hooks/data/ap-journal'
import { foldJournal } from '../hooks/data/ap-loop'
import { draftOf, startSpec } from '../hooks/views/ap-panel'
import '../hooks/views/wf-register'
import { dangling, E, ENV, envOf, J, journal, KILL, ready, rig, settle, started, stateWith, T0, task } from './fixtures/security-rig'

describe('live: policy that depends on a fresh Anatole', () => {
  it('a loop whose envelope does not accept running without Anatole pauses on a stale status, in a real tick', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')], { mode: 'enforce', updatedMs: T0 - 30 * 3_600_000, degraded: false })

    started(r, [], { ...ENV, acceptWithoutAnatole: false })
    wireAutopilot(state, r.host)
    storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
    storeOf(state).spendAtMs = T0 + 1000
    await apTick(state, r.host, T0 + 1000)
    expect(r.prompts).toEqual([])
    expect(journal(r).at(-1)).toMatchObject({ t: 'pause' })
  })
})

describe('the confirm card shows what it grants', () => {
  it('lists every verify argv, the repos and the secret variable NAMES, not a count', () => {
    const r = rig()
    const state = stateWith([])

    wireAutopilot(state, r.host)
    draftOf(state).value = { ...ENV, verify: [['npx', 'vitest', 'run', 'tests/x.spec.ts']], repos: ['ruvnet/ruflo'], secretEnv: ['OPENROUTER_API_KEY'] } as never

    const shows = startSpec(envOf(state, T0))?.shows ?? ''

    expect(shows).toContain('npx vitest run tests/x.spec.ts')
    expect(shows).toContain('ruvnet/ruflo')
    expect(shows).toContain('OPENROUTER_API_KEY')
  })
})

describe('live: tampering with the files the steps can write', () => {
  it('an extra start line appended after a confirmed Start (a replay of the stop-then-start trick) stops the loop and hands nothing over', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    wireAutopilot(state, r.host)
    await startSpec(envOf(state, T0))?.run?.()
    await settle(state)
    expect(journal(r)[0]).toMatchObject({ t: 'start' })
    expect(storeOf(state).pin).toMatchObject({ starts: 1 })

    const first = journal(r)[0] as Extract<JournalEvent, { t: 'start' }>

    r.files.set(J, `${r.files.get(J)}${encodeLine({ t: 'stop', at: Date.now(), reason: 'you' })}${encodeLine(first)}`)
    state.cache.clear()
    ready(state, Date.now())
    await apTick(state, r.host, Date.now() + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop', reason: expect.stringContaining('2 start lines') })
  })

  it('an envelope rewritten with a matching hash and a start line for it (the hash is not a MAC) is not the one the person approved', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    wireAutopilot(state, r.host)
    await startSpec(envOf(state, T0))?.run?.()
    await settle(state)

    const wider = seal({ ...ENV, concurrency: 8, spend: { hourUsd: 900, dayUsd: 900, totalUsd: 900 } }, 2, Date.now())

    r.files.set(E, JSON.stringify(wider))
    r.files.set(J, `${r.files.get(J)}${encodeLine({ t: 'start', at: Date.now(), envHash: wider.hash, revision: 2, anatole: 'on' })}`)
    state.cache.clear()
    ready(state, Date.now())
    await apTick(state, r.host, Date.now() + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop' })
  })

  it('a running journal with no recorded approval in a readable host store is stopped; an unreadable store adopts what is there and says nothing is lost', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    ;(r.host as { storeGet?: unknown }).storeGet = async () => undefined
    wireAutopilot(state, r.host)
    ready(state, T0 + 1000)
    await apTick(state, r.host, T0 + 1000)
    expect(r.prompts).toEqual([])
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop', reason: expect.stringContaining('no recorded approval') })

    const r2 = rig()
    const s2 = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r2)
    wireAutopilot(s2, r2.host)
    ready(s2, T0 + 1000)
    await apTick(s2, r2.host, T0 + 1000)
    expect(r2.prompts.length).toBe(1)
  })
})

describe('live: kill-switch latency and TOCTOU', () => {
  it('a kill flag that appears while the verify commands run (minutes) stops the hand-over of the next task in the same tick', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [dangling()])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 - 1
    ready(state, T0 + 1000)
    r.onRun.fn = argv => { if (argv[0] === 'true') r.files.set(KILL, '') }
    await apTick(state, r.host, T0 + 1000)

    expect(r.runs.some(a => a[0] === 'true')).toBe(true)
    expect(r.prompts).toEqual([])
    // The review's stop-race re-read catches it before the step is even journaled: nothing is started, nothing handed over.
    expect(journal(r).some(e => e.t === 'step.started' && e.id !== 's-dangling00001')).toBe(false)
  })

  it('a kill flag that appears while the step start is being journaled still stops the hand-over (the recheck right before it)', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [dangling()])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 - 1
    ready(state, T0 + 1000)
    r.onAppend.fn = text => { if (text.includes('"t":"step.started"')) r.files.set(KILL, ''); return text }
    await apTick(state, r.host, T0 + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).some(e => e.t === 'step.failed' && e.why.includes('stopped before the hand-over'))).toBe(true)
  })

  it('a stop pressed while the tick is mid-flight is not outrun: the in-memory stop blocks the hand-over too', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [dangling()])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 - 1
    ready(state, T0 + 1000)
    r.onRun.fn = argv => { if (argv[0] === 'true') storeOf(state).loop = foldJournal([{ t: 'stop', at: T0 + 500, reason: 'you pressed stop' }], storeOf(state).loop) }
    await apTick(state, r.host, T0 + 1000)
    expect(r.prompts).toEqual([])
  })
})

describe('live: per-command permission', () => {
  it('a verify command the person\'s rules deny is not run even when the class-level preflight allows Bash', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [dangling()])
    wireAutopilot(state, r.host, { toolCheck: async (_tool, input) => ({ decision: input === undefined ? 'allow' : 'deny' }) })
    storeOf(state).bootMs = T0 - 1
    ready(state, T0 + 1000)
    await apTick(state, r.host, T0 + 1000)

    expect(r.runs.some(a => a[0] === 'true')).toBe(false)
    expect(journal(r).some(e => e.t === 'step.done')).toBe(false)
  })
})

describe('live: double execution', () => {
  it('two sessions that both start the same step: neither hands it over', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    wireAutopilot(state, r.host)
    ready(state, T0 + 1000)
    // The other session's identical line lands in the same append window.
    r.onAppend.fn = text => (text.includes('step.started') ? text + text : text)
    await apTick(state, r.host, T0 + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).some(e => e.t === 'step.failed' && e.why.includes('second start'))).toBe(true)
  })

  it('a step lost to a restart is not run again by the next tick: its task is parked with the question', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [dangling()])
    wireAutopilot(state, r.host)
    storeOf(state).bootMs = T0 + 100
    ready(state, T0 + 1000)
    await apTick(state, r.host, T0 + 1000)
    ready(state, T0 + 600_000)
    await apTick(state, r.host, T0 + 600_000)

    expect(journal(r).some(e => e.t === 'parked' && e.question.includes('may have run'))).toBe(true)
    expect(r.prompts.some(p => p.includes('Fix the parser bug'))).toBe(false)
  })
})

describe('live: permission laundering', () => {
  it('a verify command the engine would deny is never run by the console, and the step fails rather than counting as verified', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'completed'), task('r2', 'pending'), task('r3', 'pending')])

    started(r, [dangling()])
    wireAutopilot(state, r.host, { toolCheck: async tool => ({ decision: tool === 'Bash' ? 'deny' : 'allow' }) })
    storeOf(state).bootMs = T0 - 1
    ready(state, T0 + 1000)
    await apTick(state, r.host, T0 + 1000)

    expect(r.runs.some(a => a[0] === 'true')).toBe(false)
    expect(journal(r).some(e => e.t === 'step.failed' && e.id === 's-dangling00001')).toBe(true)
    expect(journal(r).some(e => e.t === 'step.done')).toBe(false)
  })
})

describe('live: the journal rotation cannot lose the old journal to a pre-made archive name', () => {
  it('an archive that already exists stops the rotation: the long journal stays', async () => {
    const r = rig()
    const state = stateWith([])

    started(r, Array.from({ length: 42_000 }, (_, i) => ({ t: 'beat', at: T0 + i }) as JournalEvent))
    expect((r.files.get(J) as string).length).toBeGreaterThan(1_200_000)
    expect((r.files.get(J) as string).length).toBeLessThan(1_500_000)

    const now = T0 + 100_000_000
    const stamp = new Date(now).toISOString().replace(/[^0-9]/g, '').slice(0, 14)

    r.files.set(`${J}.${stamp}`, 'planted')
    wireAutopilot(state, r.host)
    ready(state, now)
    await apTick(state, r.host, now)

    expect((r.files.get(J) as string).length).toBeGreaterThan(1_200_000)
    expect(r.files.get(`${J}.${stamp}`)).toBe('planted')
  })
})

describe('live: bounded reads and deleted stop lines', () => {
  it('a journal that grows past its cap between the append and the hand-over is not read: the step is not handed over', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    started(r)
    wireAutopilot(state, r.host)
    ready(state, T0 + 1000)
    r.onAppend.fn = text => (text.includes('step.started') ? `${text}${'x'.repeat(2_000_000)}\n` : text)
    await apTick(state, r.host, T0 + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).some(e => e.t === 'step.failed' && e.why.includes('over its cap'))).toBe(true)
  })

  it('deleting the stop line and the kill flag does not bring a stopped loop back: the recorded stop is pinned outside the project', async () => {
    const r = rig()
    const state = stateWith([task('r1', 'pending'), task('r2', 'pending'), task('r3', 'pending')])

    wireAutopilot(state, r.host)
    await startSpec(envOf(state, T0))?.run?.()
    await settle(state)
    await stopNow(state, r.host, 'you pressed stop')
    expect(storeOf(state).pin).toMatchObject({ stopped: true })

    // The step removes the flag and cuts the journal back to its first line (a start): hash and start count still match the pin.
    const first = (r.files.get(J) as string).split('\n')[0] as string

    r.files.set(J, `${first}\n`)
    r.files.delete(KILL)
    state.cache.clear()
    storeOf(state).loop = foldJournal([])
    ready(state, Date.now())
    await apTick(state, r.host, Date.now() + 1000)

    expect(r.prompts).toEqual([])
    expect(journal(r).at(-1)).toMatchObject({ t: 'stop', reason: expect.stringContaining('stop line was removed') })
  })
})
