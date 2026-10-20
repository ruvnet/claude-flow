import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import type { TaskRecord } from '../hooks/data/parse'
import type { Host } from '../hooks/host'
import { activeMission, advance, createSpec, derive, instructionOf, mcOf, missionActions, nextTask, progressOf, resultOf, setGoal, setProfile, type MissionRecord } from '../hooks/mission-control'
import { MISSION_SKILLS } from '../hooks/mission-skills'
import { missionAnswer, planText } from '../hooks/mission-text'
import { newState, type State } from '../hooks/state'
import type { Runner } from '../hooks/runner'
import { missionPart } from '../hooks/views/bar'

const ID = 'msn_0123456789abcdef01234567'
const out = (data: unknown) => `[INFO] Executing tool\nResult:\n${JSON.stringify(data, null, 2)}\n[INFO] done`

type Calls = { runs: string[][]; prompts: string[]; fills: string[]; slashes: string[]; stored: Map<string, unknown> }

function hostOf(calls: Calls, answer: (tool: string, params: Record<string, unknown>) => unknown = () => ({ ok: true })): Host {
  return {
    run: async (argv: readonly string[]) => {
      calls.runs.push([...argv])

      const at = argv.indexOf('-t')
      const tool = at >= 0 ? (argv[at + 1] as string) : ''
      const params = at >= 0 ? (JSON.parse(argv[argv.indexOf('-p') + 1] as string) as Record<string, unknown>) : {}

      return { exitCode: 0, stdout: out(answer(tool, params)), stderr: '' }
    },
    storeGet: async (key: string) => calls.stored.get(key),
    storeSet: async (key: string, value: unknown) => void calls.stored.set(key, value),
    invalidate: () => undefined,
    after: () => ({ cancel: () => undefined }),
    submitPrompt: async (text: string) => void calls.prompts.push(text),
    fillPrompt: async (text: string) => (calls.fills.push(text), true),
    runSlash: async (command: string, args: string) => void calls.slashes.push(`${command} ${args}`),
    listCommands: async () => ['ruflo-goals:goal-plan'],
  } as unknown as Host
}

const fresh = (): Calls => ({ runs: [], prompts: [], fills: [], slashes: [], stored: new Map() })
const task = (id: string, status: string, tags: string[], extra: Partial<TaskRecord> = {}): TaskRecord => ({ id, type: 'feature', description: '', status, assignedTo: [], tags, ...extra })

/** A mission of three tasks whose ruflo task ids are r1..r3: t1 → t2 → t3, with t2 and t3 both after t1. */
function missionOf(): MissionRecord {
  return {
    id: ID,
    objective: 'add a dark mode toggle',
    profile: 'feature',
    rigor: 'standard',
    tasks: [
      { id: 't1', title: 'Specify', phase: 'S', agent: 'specification', requirement: 'a written specification', dependsOn: [], rufloTaskId: 'r1' },
      { id: 't2', title: 'Design', phase: 'A', agent: 'architecture', requirement: 'a design', dependsOn: ['t1'], rufloTaskId: 'r2' },
      { id: 't3', title: 'Pseudocode', phase: 'P', agent: 'pseudocode', requirement: 'pseudocode', dependsOn: ['t1'], rufloTaskId: 'r3' },
    ],
    acceptance: [{ id: 'ac-specified', check: 'a specification exists' }],
    events: [],
    paused: false,
    cancelled: false,
    auto: false,
    createdAtMs: 1,
  }
}

function stateWith(tasks: TaskRecord[]): State {
  const state = newState({})

  state.snapshot = { tasks, agents: [], claims: [], swarm: null, plugins: { missingFromClone: [] }, alerts: [] } as never

  return state
}

describe('mission control: status comes from the ruflo task store', () => {
  it('derives done, running, ready and waiting from the stored status and the dependencies', () => {
    const mission = missionOf()
    const tasks = [task('r1', 'completed', []), task('r2', 'in_progress', []), task('r3', 'pending', [])]
    const status = derive(mission, tasks)

    expect(status.get('t1')).toBe('done')
    expect(status.get('t2')).toBe('running')
    expect(status.get('t3')).toBe('ready')
    expect(derive(mission, [task('r1', 'pending', [])]).get('t2')).toBe('waiting')
    expect(derive(mission, [task('r1', 'failed', [])]).get('t1')).toBe('failed')
    expect(progressOf(mission, tasks)).toEqual({ done: 1, total: 3 })
  })

  it('never hands a task an older CLI stored as "complete" to Claude again', () => {
    const mission = missionOf()

    expect(derive(mission, [task('r1', 'complete', [])]).get('t1')).toBe('done')
    expect(nextTask(mission, [task('r1', 'complete', [])])?.id).toBe('t2')
    expect(derive(mission, [task('r1', ' Done ', [])]).get('t1')).toBe('done')
    expect(derive(mission, [task('r1', 'canceled', [])]).get('t1')).toBe('cancelled')
  })

  it('hands out the first ready task, none while one is running or failed, none while paused or cancelled', () => {
    const mission = missionOf()

    expect(nextTask(mission, [task('r1', 'pending', [])])?.id).toBe('t1')
    expect(nextTask(mission, [task('r1', 'completed', [])])?.id).toBe('t2')
    expect(nextTask(mission, [task('r1', 'completed', []), task('r2', 'in_progress', [])])).toBeNull()
    expect(nextTask(mission, [task('r1', 'failed', [])])).toBeNull()
    mission.paused = true
    expect(nextTask(mission, [task('r1', 'pending', [])])).toBeNull()
    mission.paused = false
    mission.cancelled = true
    expect(nextTask(mission, [task('r1', 'pending', [])])).toBeNull()
  })

  it('the instruction names the task, its role, what done means, and how to record it, with the ruflo task id', () => {
    const text = instructionOf(missionOf(), (missionOf().tasks[1] as never))

    expect(text).toContain(ID)
    expect(text).toContain('Task t2 (Architecture): Design')
    expect(text).toContain('Act as: architecture')
    expect(text).toContain('task_complete with taskId "r2"')
    expect(text).toContain('status "failed"')
    expect(text).toContain('Already done: t1 (Specify)')
  })
})

describe('mission control: goal, plan, create', () => {
  it('a goal is planned (nothing written) with the profile its words name, and re-planned when the person picks a kind', () => {
    const state = stateWith([])

    setGoal(state, 'fix the crash when the password is empty')
    expect(mcOf(state).profile).toBe('bugfix')
    expect(mcOf(state).planned?.steps.map(step => step.action.id)).toContain('reproduce')
    setProfile(state, 'feature', 'lean')
    expect(mcOf(state).planned?.steps.map(step => step.action.id)).toContain('specify')
    setGoal(state, 'investigate why recall drops')
    expect(mcOf(state).profile).toBe('feature') // a picked kind sticks
    expect(planText(mcOf(state).planned as never, mcOf(state).goal)).toContain('wave 1:')
  })

  it('create runs mission_create, mission_plan, then task_create per node; the ledger and active mission follow; every argv is fixed', async () => {
    const state = stateWith([])
    const calls = fresh()
    let n = 0
    const host = hostOf(calls, (tool, params) => {
      if (tool === 'mission_create') return { ok: true, data: { missionId: ID, revision: 1, state: 'draft' } }
      if (tool === 'mission_plan') return { ok: true, data: { missionId: ID, revision: 2, state: 'planned', planDigest: 'sha256:abc' } }
      if (tool === 'task_create') return { taskId: `task-${++n}`, ...params }

      return { ok: true }
    })

    setGoal(state, 'add a dark mode toggle to settings')

    const spec = createSpec(state, host, () => undefined) as ActionSpec

    expect(spec.label).toContain('create the mission and its')
    expect(calls.runs).toEqual([]) // building the spec runs nothing
    await spec.run?.()

    const tools = calls.runs.map(argv => argv[argv.indexOf('-t') + 1])
    const tasks = mcOf(state).planned?.steps.length ?? 0

    expect(tools).toEqual(['mission_create', 'mission_plan', ...Array(tasks).fill('task_create')])
    expect(calls.runs.every(argv => argv.includes('mcp') && argv.includes('exec'))).toBe(true)

    const mission = activeMission(state) as MissionRecord

    expect(mission.id).toBe(ID)
    expect(mission.tasks).toHaveLength(tasks)
    expect(mission.tasks.every(candidate => candidate.rufloTaskId?.startsWith('task-'))).toBe(true)
    expect(mission.events.map(event => event.type)).toEqual(['mission.created', 'plan.validated', 'tasks.created'])
    expect(mission.events.map(event => event.seq)).toEqual([1, 2, 3])
    expect(calls.stored.get('mission-ledger')).toBeDefined()

    const plan = JSON.parse(calls.runs[1]?.[calls.runs[1].indexOf('-p') + 1] as string) as { plan: { tasks: { executor: { mode: string } }[] } }

    expect(plan.plan.tasks.every(candidate => candidate.executor.mode === 'session-bound')).toBe(true)
  })

  it('create stops and says why when the mission record refuses; no task is created', async () => {
    const state = stateWith([])
    const calls = fresh()
    const host = hostOf(calls, tool => (tool === 'mission_create' ? { ok: false, code: 'invalid-input', message: 'objective too long' } : { ok: true }))

    setGoal(state, 'add a thing')
    await (createSpec(state, host, () => undefined) as ActionSpec).run?.()
    expect(calls.runs).toHaveLength(1)
    expect(mcOf(state).last?.ok).toBe(false)
    expect(mcOf(state).last?.detail).toContain('objective too long')
    expect(activeMission(state)).toBeNull()
  })
})

describe('mission control: handing work to the primary session', () => {
  const setup = (tasks: TaskRecord[]) => {
    const state = stateWith(tasks)
    const calls = fresh()
    const asked: { spec: ActionSpec | null; why: string }[] = []
    const runner = { ask: (spec: ActionSpec | null, why: string) => void asked.push({ spec, why }) } as unknown as Runner
    const host = hostOf(calls)
    const actions = missionActions(state, host, runner)
    const mission = missionOf()

    mcOf(state).missions.set(ID, mission)
    mcOf(state).active = ID

    return { state, calls, asked, actions, mission, host }
  }

  it('next asks first; on yes it marks the task in progress and submits one visible prompt naming the ruflo task id', async () => {
    const { calls, asked, actions } = setup([task('r1', 'pending', [])])

    actions.next()
    expect(asked).toHaveLength(1)
    expect(calls.prompts).toEqual([])
    await asked[0]?.spec?.run?.()
    expect(calls.runs.map(argv => argv[argv.indexOf('-t') + 1])).toEqual(['task_update'])
    expect(JSON.parse(calls.runs[0]?.[calls.runs[0].indexOf('-p') + 1] as string)).toEqual({ taskId: 'r1', status: 'in_progress', progress: 5 })
    expect(calls.prompts).toHaveLength(1)
    expect(calls.prompts[0]).toContain('task_complete with taskId "r1"')
  })

  it('next says why instead of asking when paused, or when a task is already running', () => {
    const paused = setup([task('r1', 'pending', [])])

    paused.actions.pause()
    paused.actions.next()
    expect(paused.asked).toHaveLength(0)
    expect(mcOf(paused.state).last?.detail).toContain('paused')

    const running = setup([task('r1', 'in_progress', [])])

    running.actions.next()
    expect(running.asked).toHaveLength(0)
    expect(mcOf(running.state).last?.ok).toBe(false)
  })

  it('pause and resume are ledger events with ordered sequence numbers; resume allows the next task again', () => {
    const { state, actions, mission } = setup([task('r1', 'pending', [])])

    actions.pause()
    actions.resume()
    expect(mission.events.map(event => `${event.seq}:${event.type}`)).toEqual(['1:mission.paused', '2:mission.resumed'])
    expect(nextTask(mission, state.snapshot?.tasks ?? [])?.id).toBe('t1')
  })

  it('auto-run hands over the next ready task once, only when on and Claude is idle', async () => {
    const { state, calls, mission, host } = setup([task('r1', 'pending', [])])

    advance(state, host)
    expect(calls.prompts).toHaveLength(0)
    mission.auto = true
    state.turnActive = true
    advance(state, host)
    expect(calls.prompts).toHaveLength(0)
    state.turnActive = false
    advance(state, host)
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls.prompts).toHaveLength(1)
    advance(state, host)
    expect(calls.prompts).toHaveLength(1)
  })

  it('ask aside runs /btw when the session is idle and prepares /btw in the prompt box while a turn runs; it never submits a prompt', async () => {
    const { state, calls, actions } = setup([])

    actions.aside('what does t2 depend on?')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls.slashes).toEqual(['btw what does t2 depend on?'])
    state.turnActive = true
    actions.aside('is this safe?')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls.fills).toEqual(['/btw is this safe?'])
    expect(calls.prompts).toEqual([])
  })

  it('guide asks first, then submits the instruction as a visible prompt; an empty one asks nothing', async () => {
    const { calls, asked, actions } = setup([])

    actions.guide('   ')
    expect(asked[0]?.spec).toBeNull()
    actions.guide('prefer the existing settings store')
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(calls.prompts).toEqual([])
    await asked[1]?.spec?.run?.()
    expect(calls.prompts).toEqual(['prefer the existing settings store'])
  })

  it('the ruflo-goals skills run in the main UI only when the session offers them: idle runs the slash command, mid-turn prepares it, and an absent one says how to get it', async () => {
    const { state, calls, actions, asked } = setup([])
    const confirm = async () => {
      await asked.at(-1)?.spec?.run?.()
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    setGoal(state, 'add a dark mode toggle')
    actions.skill('goal-plan')
    expect(mcOf(state).last?.ok).toBe(false)
    expect(mcOf(state).last?.label).toContain('ruflo-goals:goal-plan is not available')
    state.commandNames = ['ruflo-goals:goal-plan']
    actions.skill('goal-plan')
    expect(calls.slashes).toEqual([])
    expect(asked.at(-1)?.spec?.label).toContain('run /ruflo-goals:goal-plan on the goal')
    await confirm()
    expect(calls.slashes).toEqual(['ruflo-goals:goal-plan add a dark mode toggle'])
    state.turnActive = true
    actions.skill('goal-plan')
    await confirm()
    expect(calls.fills).toEqual(['/ruflo-goals:goal-plan add a dark mode toggle'])
    expect(MISSION_SKILLS.map(skill => skill.id)).toEqual(['goal-plan', 'horizon-track', 'deep-research', 'research-synthesize', 'dossier-collect'])
  })

  it('the transcript answers: status lists each task’s status; the plan prints; resultOf reads the JSON after Result:', () => {
    const { state } = setup([task('r1', 'completed', [])])

    expect(missionAnswer(state, 'mission-status')).toContain('1/3 tasks done')
    expect(missionAnswer(state, 'mission-status')).toContain('t1 done')
    expect(missionAnswer(state, 'spawn-coder')).toBeNull()
    expect(resultOf(out({ ok: true, data: { missionId: ID } }))).toEqual({ ok: true, data: { missionId: ID } })
    expect(resultOf('no json here')).toBeNull()
  })

  it('the band shows the active mission: progress and the running task, paused when paused, gone when finished or cancelled', () => {
    const state = stateWith([task('r1', 'completed', []), task('r2', 'in_progress', []), task('r3', 'pending', [])])
    const mission = missionOf()

    mcOf(state).missions.set(ID, mission)
    mcOf(state).active = ID

    const part = () => missionPart(state) ?? undefined

    expect(part()?.text).toBe('🎯 1/3 · t2 Design (1)')
    expect(part()?.tone).toBe('live')
    expect(part()?.go).toBe('missions')
    mission.paused = true
    expect(part()?.text).toBe('🎯 1/3 paused (1)')
    mission.paused = false
    mission.cancelled = true
    expect(part()).toBeUndefined()
    mission.cancelled = false
    state.snapshot = { tasks: [task('r1', 'completed', []), task('r2', 'completed', []), task('r3', 'completed', [])], agents: [], claims: [], swarm: null, plugins: { missingFromClone: [] }, alerts: [] } as never
    expect(part()).toBeUndefined()
  })
})
