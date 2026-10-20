/**
 * ADR-470: bounded parallel hand-over, the spend reading and the band segment.
 * Pure and in-memory (the ap-rig disk and fake host). Run with
 *   npx vitest run plugins/ruflo-console/tests/ap-parallel.spec.ts --testTimeout=30000
 */

import { describe, expect, it } from 'vitest'
import { apTick, storeOf, wireAutopilot } from '../hooks/ap-live'
import { pickTask, readSpend } from '../hooks/ap-pick'
import { DEFAULTS, promote } from '../hooks/data/ap-adapt'
import { hashOf, seal, type Envelope } from '../hooks/data/ap-envelope'
import { readingOf, spendSource, windowArgvs } from '../hooks/data/ap-spend'
import { startedCount } from '../hooks/data/ap-journal'
import { mcOf, nextTask, startable, type MissionRecord } from '../hooks/mission-control'
import { barParts } from '../hooks/views/bar'
import { autopilotPart } from '../hooks/views/ap-band'
import { boardRows } from '../hooks/views/ap-panel'
import type { ReadCache } from '../hooks/data/files'
import { readSnapshot } from '../hooks/data/snapshot'
import { newState } from '../hooks/state'
import { RUFLO_FILES } from './fixtures/ruflo-run'
import '../hooks/views/wf-register'
import { CWD, E, ENV, J, KILL, T0, envOf, journal, rig, started, stateWith, task, words } from './fixtures/ap-rig'

const three: MissionRecord['tasks'] = [
  { id: 'a', title: 'Fix the parser bug', phase: 'S', agent: 'coder', requirement: 'tests pass', dependsOn: [], rufloTaskId: 'ra' },
  { id: 'b', title: 'Review the module', phase: 'S', agent: 'coder', requirement: 'a summary', dependsOn: [], rufloTaskId: 'rb' },
  { id: 'c', title: 'Publish the package to npm', phase: 'A', agent: 'coder', requirement: 'it is published', dependsOn: [], rufloTaskId: 'rc' },
  { id: 'd', title: 'Update the docs', phase: 'A', agent: 'coder', requirement: 'docs say so', dependsOn: ['a'], rufloTaskId: 'rd' },
  { id: 'e', title: 'Add a test for the lexer', phase: 'A', agent: 'coder', requirement: 'a test', dependsOn: [], rufloTaskId: 're' },
]

function parallelRig(concurrency: number, parallelism: number, statuses: Record<string, string> = {}) {
  const r = rig()
  const env: Envelope = { ...ENV, concurrency, verify: [] }
  const state = stateWith(three.map(t => task(t.rufloTaskId as string, statuses[t.rufloTaskId as string] ?? 'pending')))
  const mission: MissionRecord = { ...(mcOf(state).missions.get('msn_0123456789abcdef01234567') as MissionRecord), tasks: three.map(t => ({ ...t })) }

  mcOf(state).missions.set(mission.id, mission)

  const receipt = parallelism > 1 ? promote({ id: 'par', change: { path: 'parallelism', from: '1', to: String(parallelism) }, direction: 'aggressive', reason: 'forced for the test' }, { verdict: 'supported', evidence: 'forced' }, DEFAULTS, env, 'genesis', T0) : null

  // The start line and the sealed file must name the same envelope.
  r.files.set(E, JSON.stringify(seal(env, 1, T0)))
  r.files.set(J, journalWith(r, env, receipt?.ok === true ? receipt.receipt : null))
  wireAutopilot(state, r.host)
  storeOf(state).spend = { hourUsd: 0, dayUsd: 0, totalUsd: 0 }
  storeOf(state).spendAtMs = T0 + 1000

  return { r, state, mission, env }
}

import { encodeLine } from '../hooks/data/ap-journal'

function journalWith(_r: ReturnType<typeof rig>, env: Envelope, receipt: unknown): string {
  const events = [{ t: 'start', at: T0, envHash: hashOf(env), revision: 1, anatole: 'on' }, ...(receipt === null ? [] : [{ t: 'adapt', at: T0 + 1, receipt }])] as Parameters<typeof encodeLine>[0][]

  return events.map(encodeLine).join('')
}

describe('bounded parallel hand-over (ADR-470 §2.2)', () => {
  it('hands over up to the cap in one pass, parks what the envelope forbids, and never starts a task whose dependency is not done', async () => {
    const { r, state } = parallelRig(3, 3)

    await apTick(state, r.host, T0 + 2000)

    const starts = journal(r).filter(e => e.t === 'step.started')

    expect(starts.map(e => (e as { task: string }).task)).toEqual(['a', 'b', 'e'])
    expect(r.prompts.length).toBe(3)
    expect(r.prompts.join('\n')).not.toContain('Publish the package')
    expect(r.prompts.join('\n')).not.toContain('Update the docs')
    expect(journal(r).filter(e => e.t === 'parked').map(e => (e as { task: string }).task)).toEqual(['c'])

    // The journal holds exactly one start per step, and every start came before its prompt (the journal is written first).
    for (const s of starts) expect(startedCount(r.files.get(J) as string, (s as { id: string }).id)).toBe(1)

    // A second pass starts nothing more: all three are in flight, so the cap is full.
    await apTick(state, r.host, T0 + 3000)
    expect(r.prompts.length).toBe(3)
    expect(journal(r).filter(e => e.t === 'step.started').length).toBe(3)
  })

  it('stays at one at a time when the envelope (or adaptation) says so', async () => {
    const one = parallelRig(3, 1)

    await apTick(one.state, one.r.host, T0 + 2000)
    expect(one.r.prompts.length).toBe(1)

    const capped = parallelRig(1, 1)

    await apTick(capped.state, capped.r.host, T0 + 2000)
    expect(capped.r.prompts.length).toBe(1)
  })

  it('counts tasks the store already shows running against the cap, and runs nothing past a failed task', async () => {
    const busy = parallelRig(3, 3, { ra: 'in_progress', rb: 'in_progress' })

    await apTick(busy.state, busy.r.host, T0 + 2000)
    expect(busy.r.prompts.length).toBe(1)
    expect(busy.r.prompts[0]).toContain('Add a test for the lexer')

    // Two tasks running in the store fill a cap of two even though autopilot started neither: the dependent task waits.
    const full = parallelRig(2, 2, { ra: 'completed', rb: 'in_progress', re: 'in_progress' })

    await apTick(full.state, full.r.host, T0 + 2000)
    expect(full.r.prompts).toEqual([])
    expect(journal(full.r).filter(e => e.t === 'step.started')).toEqual([])

    const failed = parallelRig(3, 3, { rb: 'failed' })

    await apTick(failed.state, failed.r.host, T0 + 2000)
    expect(failed.r.prompts).toEqual([])
  })

  it('a paused mission, a kill flag and a stopped loop hand nothing over', async () => {
    const paused = parallelRig(3, 3)

    paused.mission.paused = true
    await apTick(paused.state, paused.r.host, T0 + 2000)
    expect(paused.r.prompts).toEqual([])

    const killed = parallelRig(3, 3)

    killed.r.files.set(KILL, '')
    await apTick(killed.state, killed.r.host, T0 + 2000)
    expect(killed.r.prompts).toEqual([])
    expect(journal(killed.r).at(-1)).toMatchObject({ t: 'stop', reason: 'kill switch' })
  })

  it('startable(…, 1) is the mission\'s own one-at-a-time rule; the cap only widens the running limit', () => {
    const state = stateWith([])
    const mission = { ...(mcOf(state).missions.get('msn_0123456789abcdef01234567') as MissionRecord), tasks: three.map(t => ({ ...t })) }
    const statuses = [{}, { ra: 'in_progress' }, { rb: 'failed' }, { ra: 'completed' }, { ra: 'completed', rd: 'in_progress' }] as Record<string, string>[]

    for (const s of statuses) {
      const tasks = three.map(t => task(t.rufloTaskId as string, s[t.rufloTaskId as string] ?? 'pending'))
      const next = nextTask(mission, tasks)
      // At a cap of one the first startable task is the one the mission's own rule would hand over, and none is when it hands over none.
      const first = mission.tasks.find(t => startable(mission, tasks, t, 1))

      expect(first?.id ?? null, JSON.stringify(s)).toBe(next?.id ?? null)
    }

    const running = three.map(t => task(t.rufloTaskId as string, t.id === 'a' ? 'in_progress' : 'pending'))

    expect(startable(mission, running, mission.tasks[1] as never, 1)).toBe(false)
    expect(startable(mission, running, mission.tasks[1] as never, 2)).toBe(true)
    expect(startable({ ...mission, paused: true }, running, mission.tasks[1] as never, 8)).toBe(false)
    expect(startable(mission, running, mission.tasks[3] as never, 8)).toBe(false)
  })

  it('pickTask skips parked and stepped tasks and respects the cap', () => {
    const state = stateWith(three.map(t => task(t.rufloTaskId as string, 'pending')))
    const mission = { ...(mcOf(state).missions.get('msn_0123456789abcdef01234567') as MissionRecord), tasks: three.map(t => ({ ...t })) }

    expect(pickTask(mission, state, new Set(['a']), 2)?.ledger.id).toBe('b')
    expect(pickTask(mission, state, new Set(['a', 'b', 'c', 'e']), 2)).toBeNull()
  })
})

describe('the spend reading (ADR-470 §2.3)', () => {
  const tracker = (version: string) => ({ snapshot: { plugins: { installed: [{ id: 'ruflo-cost-tracker@ruflo', version, installPath: '/p/tracker' }], missingFromClone: [] } } }) as never

  it('says why it cannot read, for each cause', () => {
    expect(spendSource({ snapshot: { plugins: { installed: [], missingFromClone: [] } } } as never)).toMatchObject({ kind: 'unavailable', why: expect.stringContaining('not installed') })
    expect(spendSource(tracker('0.26.0'))).toMatchObject({ kind: 'unavailable', why: expect.stringContaining('older') })
    expect(spendSource(tracker('0.27.0'))).toMatchObject({ kind: 'unavailable', why: expect.stringContaining('window filters') })
    expect(spendSource(tracker('0.27.1'))).toEqual({ kind: 'ready', root: '/p/tracker' })
  })

  it('never reaches back before the Start: the hour and day windows begin at the Start when it is newer', () => {
    const now = Date.parse('2026-10-06T12:00:00Z')
    const start = now - 10 * 60_000
    const fresh = windowArgvs('/p/tracker', start, now, '/w')
    const old = windowArgvs('/p/tracker', now - 3 * 86_400_000, now, '/w')
    const from = (argv: readonly string[] | null): string => (argv as string[])[(argv as string[]).indexOf('--from') + 1] as string

    expect(from(fresh.hour)).toBe(new Date(start).toISOString())
    expect(from(fresh.day)).toBe(new Date(start).toISOString())
    expect(from(fresh.total)).toBe(new Date(start).toISOString())
    expect(from(old.hour)).toBe(new Date(now - 3_600_000).toISOString())
    expect(from(old.day)).toBe(new Date(now - 86_400_000).toISOString())
    expect(from(old.total)).toBe(new Date(now - 3 * 86_400_000).toISOString())
    expect((fresh.hour as string[]).slice(-4)).toEqual(['--project', '/w', '--provider', 'claude'])
    expect((fresh.total as string[]).slice(-2)).toEqual(['--provider', 'claude'])
  })

  const out = (usd: number | null, extra: Record<string, unknown> = {}): string => JSON.stringify({ totals: usd === null ? {} : { usd }, rows: 4, unpriced: {}, ...extra })

  it('reads three windows into a spend, and refuses a reading it cannot trust: unpriced models, an unknown total, no answer', () => {
    expect(readingOf({ hour: out(0.1), day: out(0.5), total: out(1.5) })).toEqual({ spend: { hourUsd: 0.1, dayUsd: 0.5, totalUsd: 1.5 }, why: null })
    expect(readingOf({ hour: out(0.1), day: out(0.5, { unpriced: { 'mystery-9': { messages: 2 } } }), total: out(1.5) }).why).toContain('mystery-9')
    expect(readingOf({ hour: out(0.1), day: out(null), total: out(1.5) }).spend).toBeNull()
    expect(readingOf({ hour: 'junk', day: out(0.5), total: out(1.5) }).why).toContain('did not answer')
  })

  it('a zero-row window is a true $0, not unknown', () => {
    expect(readingOf({ hour: JSON.stringify({ totals: {}, rows: 0 }), day: JSON.stringify({ totals: {}, rows: 0 }), total: JSON.stringify({ totals: {}, rows: 0 }) }).spend).toEqual({ hourUsd: 0, dayUsd: 0, totalUsd: 0 })
  })

  it('readSpend runs the three windows, and says why when the ledger is missing or errors; the loop waits and says why', async () => {
    const r = rig()
    const state = stateWith([])

    state.snapshot = { ...(state.snapshot as object), plugins: { installed: [{ id: 'ruflo-cost-tracker@ruflo', version: '0.27.1', installPath: '/p/tracker' }], missingFromClone: [] } } as never
    r.host.run = (async (argv: readonly string[]) => ({ exitCode: 0, stdout: out(argv.includes('--from') ? 0.25 : 9), stderr: '' })) as never

    const ok = await readSpend(state, r.host, T0, T0 + 5000)

    expect(ok.spend).toEqual({ hourUsd: 0.25, dayUsd: 0.25, totalUsd: 0.25 })

    r.host.run = (async () => ({ exitCode: 2, stdout: '', stderr: 'ledger: bad' })) as never
    expect((await readSpend(state, r.host, T0, T0 + 5000)).why).toContain('error')

    const none = stateWith([])
    const waiting = rig()

    started(waiting)
    wireAutopilot(none, waiting.host)
    await apTick(none, waiting.host, T0 + 1000)
    expect(storeOf(none).status).toContain('waiting: spend not read: the ruflo-cost-tracker plugin is not installed')
    expect(waiting.prompts).toEqual([])
    expect(words(boardRows(envOf(none, T0 + 1000)))).toContain('ledger not read: the ruflo-cost-tracker')
  })

  it('the panel says what the figure is once it is read', () => {
    const state = stateWith([])

    wireAutopilot(state, rig().host)
    storeOf(state).spend = { hourUsd: 0.1, dayUsd: 0.2, totalUsd: 0.3 }
    expect(words(boardRows(envOf(state, T0)))).toContain('every Claude Code turn in this project since Start')
  })
})

const memoryFs = (files: Record<string, string>) => ({
  read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: files[path].length } : Promise.reject(new Error('ENOENT'))),
  list: async () => Promise.reject(new Error('ENOENT')),
})

/** A console state with a real snapshot (the band reads alerts from it), cwd at the rig's folder. */
async function bandState() {
  const state = newState({})

  state.snapshot = await readSnapshot(memoryFs(Object.fromEntries(Object.entries(RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text]))), new Map() as ReadCache, '/work', '/home/dev', {}, 0)
  state.cwd = CWD

  return state
}

describe('the band segment (ADR-470 §2.4)', () => {
  it('draws nothing before autopilot starts, then the exact band text, and $n/a until the spend is read', async () => {
    const r = rig()
    const state = await bandState()

    wireAutopilot(state, r.host)
    await new Promise(resolve => setTimeout(resolve, 10)) // wiring reads the (then missing) files in the background
    expect(autopilotPart(state, T0)).toBeNull()
    expect(barParts(state, T0).some(p => p.text.startsWith('autopilot'))).toBe(false)

    started(r, [{ t: 'parked', at: T0 + 1, id: 'p-1', task: 't2', question: 'q' }, { t: 'parked', at: T0 + 2, id: 'p-2', task: 't3', question: 'q' }])
    state.cache.clear() // wiring read the (then missing) files in the background
    await (await import('../hooks/ap-live')).refreshAutopilot(state, r.host, T0 + 2 * 86_400_000)

    const unread = barParts(state, T0 + 2 * 86_400_000).find(p => p.text.startsWith('autopilot'))

    expect(unread?.text).toBe('autopilot day 3 · $n/a/$40 · 2 parked')
    expect(unread?.text).not.toContain('$0')
    expect(unread?.tone).toBe('attention')
    expect(unread?.go).toBe('workflows')

    storeOf(state).spend = { hourUsd: 1, dayUsd: 5, totalUsd: 12 }
    expect(barParts(state, T0 + 2 * 86_400_000).find(p => p.text.startsWith('autopilot'))?.text).toBe('autopilot day 3 · $12/$40 · 2 parked')
  })

  it('says paused when paused, and a failing source cannot blank the band', async () => {
    const r = rig()
    const state = await bandState()

    started(r, [{ t: 'pause', at: T0 + 1, reason: 'x' }])
    wireAutopilot(state, r.host)
    await (await import('../hooks/ap-live')).refreshAutopilot(state, r.host, T0 + 1000)
    expect(autopilotPart(state, T0 + 1000)?.text).toContain('autopilot paused day 1')
    expect(autopilotPart(state, T0 + 1000)?.tone).toBe('attention')
    expect(barParts(state, T0 + 1000).some(p => p.text.startsWith('autopilot paused'))).toBe(true)
  })
})

