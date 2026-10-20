/**
 * Regressions from the 0.12.0 adversarial review: a model turn never starts without a confirm, a stale ask never sends a goal
 * it was not asked about, a task is never handed over twice or left stuck, a half answer is not a screen, and auto-run does not
 * survive a restart.
 */
import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import type { TaskRecord } from '../hooks/data/parse'
import type { Host } from '../hooks/host'
import { guidanceSpec } from '../hooks/mission-guidance'
import { dispatchSpec, loadLedger, mcOf, missionActions, setGoal, type MissionRecord } from '../hooks/mission-control'
import { blocksGuidance, capabilitiesOf, screenText } from '../hooks/mission-options'
import type { Runner } from '../hooks/runner'
import { newState, type State } from '../hooks/state'

const ID = 'msn_0123456789abcdef01234567'
const out = (data: unknown) => `[INFO] Executing tool\nResult:\n${JSON.stringify(data, null, 2)}`
const tick = () => new Promise(resolve => setTimeout(resolve, 5))
const task = (id: string, status: string): TaskRecord => ({ id, type: 'feature', description: '', status, assignedTo: [], tags: [] })

function mission(): MissionRecord {
  return {
    id: ID, objective: 'x', profile: 'feature', rigor: 'standard', acceptance: [], events: [], paused: false, cancelled: false, auto: true, createdAtMs: 1,
    tasks: [{ id: 't1', title: 'Specify', phase: 'S', agent: 'specification', requirement: 'spec', dependsOn: [], rufloTaskId: 'r1' }],
  }
}

type Answer = (tool: string) => unknown

function host(answer: Answer = () => ({ ok: true }), fails: { send?: boolean } = {}) {
  const runs: string[] = []
  const prompts: string[] = []
  const h = {
    run: async (argv: readonly string[]) => {
      const tool = argv[argv.indexOf('-t') + 1] as string

      runs.push(tool)

      return { exitCode: 0, stdout: out(answer(tool)), stderr: '' }
    },
    storeGet: async () => undefined,
    storeSet: async () => undefined,
    invalidate: () => undefined,
    after: () => ({ cancel: () => undefined }),
    submitPrompt: async (text: string) => {
      if (fails.send === true) throw new Error('the box is busy')

      prompts.push(text)
    },
    fillPrompt: async () => true,
    runSlash: async () => undefined,
  } as unknown as Host

  return { h, runs, prompts }
}

const stateWith = (tasks: TaskRecord[]): State => {
  const state = newState({})

  state.snapshot = { tasks } as never

  return state
}

describe('review regressions', () => {
  it('a slash launch asks first, and is refused outright for a goal AIDefence flagged', async () => {
    const state = stateWith([])
    const { h } = host()
    const asked: (ActionSpec | null)[] = []
    const slashes: string[] = []

    ;(h as unknown as { runSlash: (c: string) => Promise<void> }).runSlash = async c => void slashes.push(c)
    state.commandNames = ['ruflo-ruos:deploy']
    setGoal(state, 'ship it')

    const actions = missionActions(state, h, { ask: (spec: ActionSpec | null) => void asked.push(spec) } as unknown as Runner)

    actions.capability('ruflo-ruos:deploy')
    expect(slashes).toEqual([])
    expect(asked[0]?.label).toContain('run /ruflo-ruos:deploy on the goal')
    mcOf(state).screen = { status: 'unsafe', detail: 'UNSAFE · 1 threat' }
    actions.capability('ruflo-ruos:deploy')
    expect(asked).toHaveLength(1)
    expect(mcOf(state).last?.label).toContain('blocked')
  })

  it('a guidance ask only goes out for the goal it was made for, and not once the goal is flagged', async () => {
    const state = stateWith([])
    const { h, runs } = host()

    setGoal(state, 'first goal')

    const spec = guidanceSpec(state, h, mcOf(state)) as ActionSpec

    setGoal(state, 'a different goal')
    await spec.run?.()
    await tick()
    expect(runs).toEqual([])
    expect(mcOf(state).guidance).toBeNull()
  })

  it('a task is handed over once: a second confirm, a paused or cancelled mission, and a stale ask do nothing', async () => {
    const state = stateWith([task('r1', 'pending')])
    const { h, runs, prompts } = host()
    const m = mission()
    const t = m.tasks[0]!
    const send = (text: string) => h.submitPrompt(text)

    await dispatchSpec(state, h, m, t, send).run?.()
    await dispatchSpec(state, h, m, t, send).run?.()
    expect(prompts).toHaveLength(1)
    expect(runs.filter(tool => tool === 'task_update')).toHaveLength(1)

    const m2 = mission()

    m2.paused = true
    await dispatchSpec(state, h, m2, m2.tasks[0]!, send).run?.()
    expect(prompts).toHaveLength(1)
  })

  it('a prompt that could not be sent puts the task back, so the mission does not stall on it', async () => {
    const state = stateWith([task('r1', 'pending')])
    const { h, runs } = host(() => ({ ok: true }), { send: true })
    const m = mission()
    const t = m.tasks[0]!

    await dispatchSpec(state, h, m, t, text => h.submitPrompt(text)).run?.()
    expect(runs.filter(tool => tool === 'task_update')).toHaveLength(2)
    expect(t.dispatchedAtMs).toBeUndefined()
    expect(mcOf(state).last?.ok).toBe(false)
    // and it can be handed over again at once
    await dispatchSpec(state, h, m, t, async () => undefined).run?.()
    expect(runs.filter(tool => tool === 'task_update')).toHaveLength(3)
  })

  it('half a screen is not a screen: one detector silent is unavailable, an unsafe answer wins, and PII is read from hasPII', async () => {
    const state = stateWith([])
    const answer = (safe: unknown, pii: unknown): Answer => tool => (tool === 'aidefence_is_safe' ? safe : pii)
    const run = (safe: unknown, pii: unknown) => screenText(state, host(answer(safe, pii)).h, 'add a toggle')

    expect((await run({ safe: true, threats: [] }, { hasPII: false })).status).toBe('safe')
    expect((await run({ safe: true, threats: [] }, { nothing: true })).status).toBe('unavailable')
    expect((await run({ nothing: true }, { hasPII: false })).status).toBe('unavailable')
    expect((await run({ safe: false, threats: [{ type: 'injection', severity: 'high' }] }, { nothing: true })).status).toBe('unsafe')
    expect((await run({ safe: true, threats: [] }, { hasPII: true })).status).toBe('pii')
    expect(blocksGuidance({ status: 'unavailable', detail: '' })).toBe(false)
  })

  it('a new goal forgets the old goal’s verdict', () => {
    const state = stateWith([])

    setGoal(state, 'first')
    mcOf(state).screen = { status: 'safe', detail: 'ok' }
    setGoal(state, 'second')
    expect(mcOf(state).screen).toBeNull()
  })

  it('auto-run does not survive a restart, and a ledger with a malformed task is dropped, not crashed on', async () => {
    const state = newState({})
    const good = { ...mission(), auto: true }
    const bad = { ...mission(), id: 'msn_aaaaaaaaaaaaaaaaaaaaaaaa', tasks: [null] }
    const { h } = host()

    ;(h as unknown as { storeGet: () => Promise<unknown> }).storeGet = async () => ({ active: ID, missions: [good, bad] })
    await loadLedger(state, h)
    expect(mcOf(state).missions.get(ID)?.auto).toBe(false)
    expect(mcOf(state).missions.has('msn_aaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false)
  })

  it('commands listed twice are offered once', () => {
    const state = stateWith([])

    state.commandNames = ['ruflo-sparc:sparc', 'ruflo-sparc:sparc', 'ruflo-ruos:deploy']
    expect(capabilitiesOf(state).flatMap(group => group.items.map(item => item.slash)).sort()).toEqual(['ruflo-ruos:deploy', 'ruflo-sparc:sparc'])
  })
})
