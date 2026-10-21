/**
 * The wiring of ADR-443: the mission in Claude's prompt (changing only with the task), loop ticks recognised by their marker, gate
 * evidence, the loop manager's hand-offs, the spend cap in auto-run, the probe's readiness and the Loop tab. The pure modules have
 * their own specs; this is what joins them to Mission Control.
 */
import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { missionCostProbe } from '../hooks/data/cost-probes'
import type { TaskRecord } from '../hooks/data/parse'
import type { Host } from '../hooks/host'
import { claudeActions, contextSection, loopOf, onPromptSubmit, onTurnComplete } from '../hooks/mission-claude'
import { activeMission, advance, mcOf, record, type MissionRecord } from '../hooks/mission-control'
import { loopMarker } from '../hooks/mission-loop'
import type { Runner } from '../hooks/runner'
import { settingsOf } from '../hooks/settings'
import { newState, type State } from '../hooks/state'
import type { Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'

const ID = `msn_${'a'.repeat(24)}`
const OTHER = `msn_${'b'.repeat(24)}`
const task = (id: string, status: string, tags: string[]): TaskRecord => ({ id, type: 'feature', description: '', status, assignedTo: [], tags })

const mission = (id = ID): MissionRecord => ({
  id,
  objective: 'add a dark mode toggle',
  profile: 'feature',
  rigor: 'standard',
  tasks: [
    { id: 't1', title: 'Specify', phase: 'S', agent: 'specification', requirement: 'a written specification', dependsOn: [], rufloTaskId: 'r1' },
    { id: 't2', title: 'Design', phase: 'A', agent: 'architecture', requirement: 'a design', dependsOn: ['t1'], rufloTaskId: 'r2' },
  ],
  acceptance: [{ id: 'ac-1', check: 'a specification exists' }],
  events: [],
  paused: false,
  cancelled: false,
  auto: false,
  createdAtMs: 1_000,
})

function stateWith(tasks: TaskRecord[], m: MissionRecord = mission()): State {
  const state = newState({})

  state.snapshot = { tasks, agents: [], claims: [], swarm: null, plugins: { missingFromClone: [], installed: [] }, alerts: [] } as never
  mcOf(state).missions.set(m.id, m)
  mcOf(state).active = m.id

  return state
}

const open = [task('r1', 'pending', [`mission:${ID}`, 'task:t1']), task('r2', 'pending', [`mission:${ID}`, 'task:t2'])]
const t1Done = [task('r1', 'completed', [`mission:${ID}`, 'task:t1']), task('r2', 'pending', [`mission:${ID}`, 'task:t2'])]
const t1Running = [task('r1', 'in_progress', [`mission:${ID}`, 'task:t1']), task('r2', 'pending', [`mission:${ID}`, 'task:t2'])]

function fakeHost() {
  const log = { runs: [] as (readonly string[])[], fills: [] as string[], stored: new Map<string, unknown>() }
  const host = {
    run: async (argv: readonly string[]) => {
      log.runs.push([...argv])

      return { exitCode: argv.includes('fail') ? 2 : 0, stdout: 'ok\n', stderr: '' }
    },
    storeGet: async (key: string) => log.stored.get(key),
    storeSet: async (key: string, value: unknown) => void log.stored.set(key, value),
    fillPrompt: async (text: string) => (log.fills.push(text), true),
    invalidate: () => undefined,
    after: () => ({ cancel: () => undefined }),
  } as unknown as Host

  return { host, log }
}

function fakeRunner() {
  const asked: ActionSpec[] = []
  const runner = { ask: (spec: ActionSpec | null) => void (spec !== null && asked.push(spec)) } as unknown as Runner

  return { runner, asked }
}

describe('the mission in Claude\'s prompt', () => {
  it('is absent without a mission, with the setting off, and once every task is done', () => {
    expect(contextSection(newState({}))).toBeNull()

    const off = stateWith(open)

    settingsOf(off).ai.missionContext = false
    expect(contextSection(off)).toBeNull()
    expect(contextSection(stateWith([task('r1', 'completed', [`mission:${ID}`, 'task:t1']), task('r2', 'completed', [`mission:${ID}`, 'task:t2'])]))).toBeNull()
  })

  it('names the mission and the task Claude is on, as a session section', () => {
    const section = contextSection(stateWith(t1Running))

    expect(section).toMatchObject({ id: 'ruflo-console:mission', scope: 'session' })
    expect(section?.text).toContain('add a dark mode toggle')
    expect(section?.text).toContain('Specify')
  })

  it('does not change when events pile up, only when the task does (a changed prompt makes Claude re-read the chat)', () => {
    const state = stateWith(t1Running)
    const first = contextSection(state)?.text

    for (let i = 0; i < 20; i++) record(activeMission(state) as MissionRecord, { type: 'turn', note: `turn ${i}` })
    expect(contextSection(state)?.text).toBe(first)

    state.snapshot = { ...(state.snapshot as object), tasks: t1Done } as never
    expect(contextSection(state)?.text).not.toBe(first)
    expect(contextSection(state)?.text).toContain('Design')
  })
})

describe('turns and loop ticks', () => {
  it('notes a turn on the running task and says nothing when no task is running', () => {
    const { host } = fakeHost()
    const running = stateWith(t1Running)
    const idle = stateWith(open)

    onTurnComplete(running, host, 'answer')
    onTurnComplete(idle, host, 'answer')
    expect(activeMission(running)?.events.map(event => event.type)).toEqual(['turn'])
    expect(activeMission(idle)?.events).toEqual([])
  })

  it('counts only a prompt that carries this mission\'s marker as a tick, arming the loop on the first', () => {
    const { host } = fakeHost()
    const state = stateWith(open, mission())
    const other = mission(OTHER)

    mcOf(state).missions.set(other.id, other)
    onPromptSubmit(state, host, 'just a prompt')
    onPromptSubmit(state, host, `${loopMarker(OTHER)} check progress`)
    expect(loopOf(activeMission(state) as MissionRecord)).toBeNull()
    expect(loopOf(other)?.ticks).toBe(1)

    onPromptSubmit(state, host, `/loop 5m ${loopMarker(ID)} check progress`)
    onPromptSubmit(state, host, `${loopMarker(ID)} check progress`)
    expect(loopOf(activeMission(state) as MissionRecord)).toMatchObject({ status: 'armed', ticks: 2 })
    expect(activeMission(state)?.events.filter(event => event.type === 'loop.tick')).toHaveLength(2)
  })
})

describe('verify and the loop manager', () => {
  it('says there are no gates rather than inventing any', () => {
    const { host } = fakeHost()
    const { runner, asked } = fakeRunner()
    const state = stateWith(t1Running)

    claudeActions(state, host, runner).verify()
    expect(asked).toEqual([])
    expect(mcOf(state).last).toMatchObject({ ok: false })
    expect(mcOf(state).last?.detail).toContain('no gates configured')
  })

  it('asks first with the exact commands, runs them without a shell, and records each exit code as evidence', async () => {
    const { host, log } = fakeHost()
    const { runner, asked } = fakeRunner()
    const state = stateWith(t1Running)

    settingsOf(state).ai.loopGates = 'npm test\nnode check.mjs fail'
    claudeActions(state, host, runner).verify()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.shows).toContain('npm test')
    expect(log.runs).toEqual([])

    await asked[0]?.run?.()
    expect(log.runs).toEqual([['npm', 'test'], ['node', 'check.mjs', 'fail']])
    expect(activeMission(state)?.events.filter(event => event.type === 'evidence.gate').map(event => event.status)).toEqual(['passed', 'failed'])
    expect(mcOf(state).last?.ok).toBe(false)
  })

  it('refuses a gate with shell characters', () => {
    const { host } = fakeHost()
    const { runner, asked } = fakeRunner()
    const state = stateWith(t1Running)

    settingsOf(state).ai.loopGates = 'npm test; rm x'
    claudeActions(state, host, runner).verify()
    expect(asked).toEqual([])
  })

  it('prepares the /loop text (with the marker) in the prompt box only after the confirm, and schedules nothing itself', async () => {
    const { host, log } = fakeHost()
    const { runner, asked } = fakeRunner()
    const state = stateWith(open)

    claudeActions(state, host, runner).loop.start()
    expect(asked[0]?.shows).toContain('/loop 5m')
    expect(log.fills).toEqual([])

    await asked[0]?.run?.()
    expect(log.fills[0]).toContain(loopMarker(ID))
    expect(log.fills[0]?.startsWith('/loop 5m')).toBe(true)
    expect(activeMission(state)?.events.map(event => event.type)).toContain('loop.prepared')
  })

  it('has nothing to stop or re-arm without a loop', () => {
    const { host } = fakeHost()
    const { runner, asked } = fakeRunner()
    const state = stateWith(open)
    const actions = claudeActions(state, host, runner)

    actions.loop.stop()
    actions.loop.rearm()
    expect(asked).toEqual([])
  })
})

describe('the spend cap in auto-run', () => {
  const reading = (fromMs: number, usd: number) => ({ value: { usd, credits: null, unpriced: [], rows: 3, fromMs }, okAtMs: 1, error: null, errorAtMs: null, isRunning: false })

  it('pauses an auto-run mission whose spend reached its cap, and says so in the ledger', () => {
    const { host } = fakeHost()
    const state = stateWith(t1Running)
    const m = activeMission(state) as MissionRecord

    m.auto = true
    settingsOf(state).ai.missionCapUsd = '5'
    state.probes.set('mission-cost', reading(m.createdAtMs, 5))
    advance(state, host)
    expect(m.paused).toBe(true)
    expect(m.events.map(event => event.type)).toContain('cap.reached')
  })

  it('does not pause below the cap, with no cap, or on a reading for another mission', () => {
    for (const [cap, usd, from] of [['5', 4.99, 1_000], ['', 50, 1_000], ['5', 50, 999]] as const) {
      const { host } = fakeHost()
      const state = stateWith(t1Running)
      const m = activeMission(state) as MissionRecord

      m.auto = true
      settingsOf(state).ai.missionCapUsd = cap
      state.probes.set('mission-cost', reading(from, usd))
      advance(state, host)
      expect(m.paused, `${cap} ${usd} ${from}`).toBe(false)
    }
  })
})

describe('the mission spend probe', () => {
  const installed = (version: string) => ({ id: 'ruflo-cost-tracker@ruflo', name: 'ruflo-cost-tracker', marketplace: 'ruflo', version, scope: 'user', installPath: '/p/ruflo-cost-tracker/x' })
  const withTracker = (version: string | null, withMission = true) => {
    const state = withMission ? stateWith(open) : newState({})

    state.cwd = '/work/app'
    state.snapshot = { ...(state.snapshot ?? { tasks: [] }), plugins: { installed: version === null ? [] : [installed(version)], missingFromClone: [] } } as never

    return state
  }

  it('runs only with a mission and a tracker new enough to filter by window, and asks for that mission\'s window and project', () => {
    expect(missionCostProbe.argvOf?.(withTracker(null))).toBeNull()
    expect(missionCostProbe.argvOf?.(withTracker('0.27.0'))).toBeNull()
    expect(missionCostProbe.argvOf?.(withTracker('0.27.1', false))).toBeNull()

    const argv = missionCostProbe.argvOf?.(withTracker('0.27.1')) ?? []

    expect(argv.slice(0, 2)).toEqual(['node', '/p/ruflo-cost-tracker/x/scripts/ledger.mjs'])
    expect(argv).toContain('--project')
    expect(argv[argv.indexOf('--project') + 1]).toBe('/work/app')
    expect(argv[argv.indexOf('--from') + 1]).toBe(new Date(1_000).toISOString())
    expect(argv).not.toContain('--to')
  })
})

describe('the Loop tab and the Settings rows', () => {
  const act = { mission: { verify: () => undefined, loop: { start: () => undefined, stop: () => undefined, rearm: () => undefined } } } as unknown as Actions

  it('shows the loop manager, the mission\'s spend and the gates', () => {
    const state = stateWith(open)

    mcOf(state).tab = 'loop'

    const text = viewText({ state, nowMs: 5_000, columns: 100, act }, 'missions')

    for (const word of ['Loop manager', 'Mission spend', 'Verify', 'No gates']) expect(text, word).toContain(word)
  })

  it('lists the three new settings', () => {
    const text = viewText({ state: newState({}), nowMs: 5, columns: 110, act: {} as Actions }, 'settings')

    for (const title of ['Mission context in Claude', 'Mission gates', 'Mission spend cap']) expect(text, title).toContain(title)
  })
})
