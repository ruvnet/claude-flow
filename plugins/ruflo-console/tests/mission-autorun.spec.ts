/**
 * Mission auto-run hands out billed Claude turns only as the person agreed (ADR-443, #3818): a hand-out the task store did not take sends no
 * prompt and is retried a limited number of times; a spend cap is checked against a fresh reading and the reading is kept fresh off the
 * Missions page; a cap of 0 is refused, not "no cap". Real advance(), dispatchSpec and controller over a fake host.
 */
import { describe, expect, it } from 'vitest'

import { COST_PLUGIN } from '../hooks/data/cost-ledger'
import { advance, mcOf } from '../hooks/mission-control'
import { capGate, capOf, isCapReached } from '../hooks/mission-guard'
import { MAX_HANDOUTS } from '../hooks/mission-specs'
import type { MissionRecord } from '../hooks/mission-types'
import { AI_KEY, capText, loadAiPrefs, saveAiPrefs, settingsOf } from '../hooks/settings'
import type { State } from '../hooks/state'
import { rig, type RunAnswer } from './fixtures/real-rig'

const ID = 'msn_0123456789abcdef01234567'
const CREATED = 1_000
const ROOT = '/p/ruflo-cost-tracker/0.28.0'
const ok: RunAnswer = { exitCode: 0, stdout: 'Result:\n{"success": true}', stderr: '' }
const ledger = (usd: number) => ({ exitCode: 0, stderr: '', stdout: JSON.stringify({ rows: 3, totals: { usd, credits: 0 }, unpriced: {}, window: { from: new Date(CREATED).toISOString() } }) })

const mission = (): MissionRecord => ({ id: ID, objective: 'ship it', profile: 'feature', rigor: 'standard', tasks: [{ id: 't1', title: 'one', phase: 'S', agent: 'coder', requirement: 'r', dependsOn: [], rufloTaskId: 'r1' }], acceptance: [], events: [], paused: false, cancelled: false, auto: true, createdAtMs: CREATED })

function world(options: { run?: (argv: readonly string[]) => RunAnswer, cap?: string } = {}) {
  const w = rig({ run: argv => (options.run ?? (() => ok))(argv) })
  const m = mission()

  w.state.cwd = '/work'
  mcOf(w.state).missions.set(ID, m)
  mcOf(w.state).active = ID
  w.state.snapshot = { tasks: [{ id: 'r1', type: 'feature', description: '', status: 'pending', assignedTo: [], tags: [] }], plugins: { installed: [{ id: COST_PLUGIN, name: 'ruflo-cost-tracker', version: '0.28.0', installPath: ROOT }] } } as never
  if (options.cap !== undefined) settingsOf(w.state).ai.missionCapUsd = options.cap

  return { ...w, m }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 10))
const reading = (state: State, usd: number, okAtMs: number, fromMs = CREATED) => state.probes.set('mission-cost', { value: { usd, credits: null, unpriced: [], rows: 1, fromMs }, okAtMs, error: null, errorAtMs: null, isRunning: false })
const updates = (w: ReturnType<typeof world>) => w.seen.runs.filter(argv => argv.includes('task_update'))

describe('a failed hand-out sends no prompt and is not repeated without end (#3818)', () => {
  it('task_update failing: no prompt, the task is tried at most MAX_HANDOUTS times, then the mission pauses with an event', async () => {
    const w = world({ run: argv => (argv.includes('task_update') ? { exitCode: 1, stdout: '', stderr: 'boom' } : ok) })

    for (let i = 0; i < 8; i++) {
      advance(w.state, w.host)
      await settle()
      w.fireTimers()
    }

    expect(w.seen.prompts).toEqual([])
    expect(updates(w)).toHaveLength(MAX_HANDOUTS)
    expect(w.m.paused).toBe(true)
    expect(w.m.events.map(event => event.type)).toContain('handout.limit')
    expect(w.m.events.filter(event => event.type === 'task.dispatched')).toEqual([])
  })

  it('an update that exits 0 but reports success:false counts as failed too', async () => {
    const w = world({ run: argv => (argv.includes('task_update') ? { exitCode: 0, stdout: 'Result:\n{"success": false, "error": "no such task"}', stderr: '' } : ok) })

    advance(w.state, w.host)
    await settle()
    expect(w.seen.prompts).toEqual([])
  })

  it('a task that did take is handed out once; a task that keeps coming back stops after MAX_HANDOUTS prompts and pauses', async () => {
    const w = world()

    for (let i = 0; i < 8; i++) {
      advance(w.state, w.host)
      await settle()
      w.fireTimers()
    }

    expect(w.seen.prompts).toHaveLength(MAX_HANDOUTS)
    expect(w.m.paused).toBe(true)
  })

  it('resuming gives each task its hand-outs again', async () => {
    const w = world()

    w.m.tasks[0]!.handouts = MAX_HANDOUTS
    advance(w.state, w.host)
    expect(w.m.paused).toBe(true)
    mcOf(w.state).active = ID
    w.control.actions.mission.resume()
    expect(w.m.tasks[0]?.handouts).toBe(0)
    expect(w.m.paused).toBe(false)
  })
})

describe('the spend cap is checked against a fresh reading (#3818)', () => {
  const NOW = 10_000_000

  it('a one-hour-old reading under the cap does not let auto-run hand out; it holds and asks for a new reading', async () => {
    const w = world({ cap: '1', run: argv => (argv.some(part => part.endsWith('ledger.mjs')) ? ledger(0.4) : ok) })

    reading(w.state, 0.4, Date.now() - 3_600_000)
    expect(capGate(w.state, w.m, Date.now())).toBe('hold')
    advance(w.state, w.host)
    await settle()
    // The hand-out waited for a new reading; once it landed (fresh, under the cap), the next idle hands the task out.
    expect(w.seen.runs.some(argv => argv.some(part => part.endsWith('ledger.mjs')))).toBe(true)
    advance(w.state, w.host)
    await settle()
    expect(w.seen.prompts).toHaveLength(1)
  })

  it('no reading at all with a cap set holds; with no cap the task goes out as before', async () => {
    const held = world({ cap: '5' })

    expect(capGate(held.state, held.m)).toBe('hold')

    const free = world()

    expect(capGate(free.state, free.m)).toBe('clear')
    advance(free.state, free.host)
    await settle()
    expect(free.seen.prompts).toHaveLength(1)
  })

  it('a reading for another mission, or a failed one, is not a reading', () => {
    const w = world({ cap: '5' })

    reading(w.state, 0.1, Date.now(), 777)
    expect(capGate(w.state, w.m)).toBe('hold')
    reading(w.state, 0.1, Date.now())
    expect(capGate(w.state, w.m)).toBe('clear')
    w.state.probes.set('mission-cost', { ...w.state.probes.get('mission-cost')!, error: 'x', errorAtMs: Date.now() + 1 })
    expect(capGate(w.state, w.m)).toBe('hold')
  })

  it('a fresh reading at or past the cap pauses the mission with an event', async () => {
    const w = world({ cap: '1' })

    reading(w.state, 1.5, Date.now())
    advance(w.state, w.host)
    await settle()
    expect(w.m.paused).toBe(true)
    expect(w.m.events.map(event => event.type)).toContain('cap.reached')
    expect(w.seen.prompts).toEqual([])
  })

  it('the cost probe keeps running while auto-run is on, whichever page is in front and whether or not the pane is shown', async () => {
    const w = world({ cap: '5', run: argv => (argv.some(part => part.endsWith('ledger.mjs')) ? ledger(0.2) : ok) })

    w.state.view = 'overview'
    w.state.pane.isOpen = false
    advance(w.state, w.host)
    await settle()
    expect(w.seen.runs.filter(argv => argv.some(part => part.endsWith('ledger.mjs')))).toHaveLength(1)
    expect(capGate(w.state, w.m)).toBe('clear')
    void NOW
  })
})

describe('a cap of 0 is refused, and the display matches what the guard enforces (#3818)', () => {
  it('capText accepts empty and 0.01 to 10000 only', () => {
    for (const good of ['', ' ', '0.01', '1', '5.50', '10000', '9999.99']) expect(capText(good), good).not.toBeNull()
    for (const bad of ['0', '0.00', '0.001', '10001', '99999', '1e3', '-1', 'abc', '1.234', '.5', '1,5', 'NaN', 'Infinity']) expect(capText(bad), bad).toBeNull()
    expect(capText(' 5 ')).toBe('5')
  })

  it('saving 0 keeps the old cap and says why; saving empty clears it', () => {
    const w = world({ cap: '5' })

    saveAiPrefs(w.state, w.host, { missionCapUsd: '0' })
    expect(settingsOf(w.state).ai.missionCapUsd).toBe('5')
    expect(w.state.outcome).toMatchObject({ ok: false })
    saveAiPrefs(w.state, w.host, { missionCapUsd: '' })
    expect(settingsOf(w.state).ai.missionCapUsd).toBe('')
  })

  it('a stored 0 loads as no cap shown, and a cap the guard cannot read holds auto-run rather than meaning no cap', async () => {
    const w = rig({ store: { [AI_KEY]: { missionCapUsd: '0' } } })

    await loadAiPrefs(w.state, w.host)
    expect(settingsOf(w.state).ai.missionCapUsd).toBe('')

    const hold = world({ cap: '0' })

    expect(capOf(hold.state)).toBeNaN()
    reading(hold.state, 5, Date.now())
    expect(capGate(hold.state, hold.m)).toBe('hold')
    expect(isCapReached(hold.state, hold.m)).toBe(false)
  })
})
