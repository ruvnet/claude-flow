/**
 * Nesting, guidance actions and the Workflows page's links/guide slots (ADR-460). Pure data first, then the slots through the page's
 * own registry with a recording kit. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-guide.spec.ts --testTimeout=30000
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import { guardText, guideActions, nestingOf, redirectText, type GuideInput } from '../hooks/data/wf-guide'
import { labelTag } from '../hooks/data/wf-links'
import type { AgentRecord, ClaimRecord, HiveInfo, SwarmInfo, TaskRecord } from '../hooks/data/parse'
import type { AgentState, WfAgent, WfRun } from '../hooks/data/workflows'
import type { Host } from '../hooks/host'
import { mcOf } from '../hooks/mission-control'
import type { MissionRecord } from '../hooks/mission-types'
import { newState, type State } from '../hooks/state'
import type { Actions, Ctx, Kit } from '../hooks/views/common'
import { launchSpec, recordRunEvents, registerGuide, REVIEW_LINES } from '../hooks/views/wf-guide'
import { registerSlot, resetSlots, slotsFor, type SlotEnv } from '../hooks/views/wf-slots'
import { draftScript, scriptMissionOf } from '../hooks/data/wf-mission-script'
import { workflowsActions } from '../hooks/wf-actions'
import { workflowsPage } from '../hooks/views/wf-page'

type El = { kind: string; props: Record<string, unknown> }

const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }), Input: (props: Record<string, unknown>): El => ({ kind: 'Input', props }) } as unknown as Kit
const flat = (node: unknown, out: El[] = []): El[] => {
  if (Array.isArray(node)) node.forEach(child => flat(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    flat((node as El).props?.children, out)
  }

  return out
}
const words = (tree: unknown): string => flat(tree).filter(el => el.kind === 'Text' && typeof el.props.children === 'string').map(el => el.props.children as string).join('\n')
const buttonOf = (tree: unknown, key: string): El | undefined => flat(tree).find(el => el.kind === 'Button' && el.props.key === key)

const ruflo = (id: string, status = 'busy'): AgentRecord => ({ id, type: 'coder', name: `${id}-n`, status })
const swarm: SwarmInfo = { id: 'swarm-1', topology: 'hierarchical', status: 'running', agentIds: ['agent-1', 'agent-2'] }
const hive = (over: Partial<HiveInfo> = {}): HiveInfo => ({ topology: 'hierarchical-mesh', strategy: 'raft', queen: 'queen-1', queenTerm: 1, workers: ['agent-1'], pending: [], history: [], broadcasts: [], memoryKeys: [], ...over }) as HiveInfo
const claim = (issueId: string, holder: string): ClaimRecord => ({ issueId, status: 'active', claimant: { kind: 'agent', id: holder, agentType: 'coder' }, isStealable: false })
const task = (id: string, assignedTo: string[], over: Partial<TaskRecord> = {}): TaskRecord => ({ id, type: 'feature', description: `desc ${id}`, status: 'in_progress', assignedTo, ...over })

describe('nestingOf', () => {
  const base = { swarm, hive: hive(), agents: [ruflo('agent-1'), ruflo('agent-2')], hiveAgents: [], claims: [claim('task-1', 'agent-1')], tasks: [task('task-1', ['agent-1'])] }

  it('nests swarm > hive > queen > worker > claim > task, each only from what the stores say', () => {
    const rows = nestingOf(base)

    expect(rows.map(row => `${row.depth}${row.kind}`)).toEqual(['0swarm', '1hive', '2queen', '2worker', '3claim', '4task', '1note'])
    expect(rows[3]?.detail).toMatch(/in the swarm/)
    expect(rows.at(-1)?.label).toMatch(/1 swarm agents outside the hive/)
  })

  it('says each missing level instead of drawing one: no swarm, no hive, no claim, a claim with no task record', () => {
    expect(nestingOf({ ...base, swarm: null, hive: null, claims: [], tasks: [] }).map(row => row.label)).toEqual(['no swarm', 'no hive-mind'])
    expect(nestingOf({ ...base, claims: [], tasks: [] }).some(row => row.label === 'no claim, no task')).toBe(true)
    expect(nestingOf({ ...base, tasks: [] }).some(row => row.label === 'no task record')).toBe(true)
    expect(nestingOf({ ...base, hive: hive({ queen: undefined }) }).some(row => row.label === 'no queen')).toBe(true)
  })

  it('a task assigned but unclaimed is shown as such, and a finished task is not shown as work', () => {
    const rows = nestingOf({ ...base, claims: [], tasks: [task('task-2', ['agent-1']), task('task-3', ['agent-1'], { status: 'completed' })] })

    expect(rows.filter(row => row.kind === 'task').map(row => row.label)).toEqual(['task-2'])
    expect(rows.find(row => row.label === 'task-2')?.detail).toMatch(/assigned, no claim/)
  })

  it('caps a large hive and says how many rows it left out', () => {
    const workers = Array.from({ length: 80 }, (_, i) => `agent-${i + 10}`)
    const rows = nestingOf({ ...base, hive: hive({ workers }), agents: workers.map(id => ruflo(id)) })

    expect(rows).toHaveLength(61)
    expect(rows.at(-1)?.label).toMatch(/^\+\d+ more rows$/)
  })
})

const flow = (state: AgentState = 'running'): WfAgent => ({ id: 'a1', label: `${labelTag('m1', 'implement')} Implement`, phase: 'Build', state, hasWorktree: false })
const wfRun = (over: Partial<WfRun> = {}): WfRun => ({ id: 'wf_abc12345', name: 'my flow', kind: 'workflow', state: 'running', phases: [{ title: 'Build', agents: [flow()], done: 0, total: 1, running: 1, failed: 0 }], running: 1, done: 0, failed: 0, idle: 0, total: 1, totalTokens: null, isTokensPartial: false, hasRecord: false, dir: '/home/u/.claude/projects/-p/sess/subagents/workflows/wf_abc12345', ...over })
const swarmRun = (): WfRun => wfRun({ id: 'swarm-1', kind: 'ruflo-swarm', dir: undefined, phases: [{ title: 'coder', agents: [{ id: 'agent-1', label: 'agent-1-n', phase: 'coder', state: 'running', hasWorktree: false, ruflo: ruflo('agent-1') }], done: 0, total: 1, running: 1, failed: 0 }] })

const input = (over: Partial<GuideInput> = {}): GuideInput => {
  const run = over.run ?? swarmRun()

  return { text: 'use the cache', run, agent: run.phases[0]?.agents[0] ?? null, hive: hive(), agents: [ruflo('agent-1'), ruflo('agent-2')], claims: [claim('task-1', 'agent-1')], tasks: [task('task-1', ['agent-1'])], nowMs: 1_700_000_000_000, prepare: async () => undefined, isRunPath: path => path.startsWith('/home/u/.claude/projects/') && !path.includes('..'), ...over }
}
const byId = (actions: ReturnType<typeof guideActions>, id: string) => actions.find(action => action.id === id)

describe('guideActions on a ruflo swarm', () => {
  it('offers the real verbs as fixed argv, each saying what is sent and whether anything acts on it', () => {
    const actions = guideActions(input())
    const broadcast = byId(actions, 'broadcast') as NonNullable<ReturnType<typeof byId>>

    expect(actions.map(action => action.id)).toEqual(['broadcast', 'propose', 'handoff', 'task-note', 'memory'])
    expect(broadcast.spec?.args).toEqual(['mcp', 'exec', '-t', 'hive-mind_broadcast', '-p', JSON.stringify({ message: 'use the cache', priority: 'normal', fromId: 'console-operator' })])
    expect(broadcast.acts).toMatch(/No worker is interrupted/)
    expect(broadcast.sends).toContain('hive-mind_broadcast')
    expect(byId(actions, 'propose')?.spec?.args.join(' ')).toContain('"type":"guidance"')
    expect(byId(actions, 'propose')?.kind).toBe('needs-votes')
    expect(byId(actions, 'handoff')?.spec?.args).toEqual(expect.arrayContaining(['claims_handoff']))
    expect(byId(actions, 'handoff')?.spec?.args.join(' ')).toContain('"to":"agent:agent-2:coder"')
  })

  it('the task note is one fixed argv with the result as an object, and is refused when it would replace a result', () => {
    const note = byId(guideActions(input()), 'task-note')?.spec as ActionSpec

    expect(note.args).toEqual(['mcp', 'exec', '-t', 'task_update', '-p', JSON.stringify({ taskId: 'task-1', result: { guidance: 'use the cache' } })])

    const held = byId(guideActions(input({ tasks: [task('task-1', ['agent-1'], { resultText: 'summary: done' })] })), 'task-note')

    expect(held?.spec).toBeNull()
    expect(held?.why).toMatch(/already has a result/)
  })

  it('refuses a proposal raft would refuse (one open per term), and says a missing hive or claim is missing', () => {
    const open = hive({ pending: [{ id: 'p-1', type: 'general', status: 'pending', strategy: 'raft', votesFor: 0, votesAgainst: 0, ballots: [], byzantine: [], term: 1 }] })

    expect(byId(guideActions(input({ hive: open })), 'propose')?.spec).toBeNull()
    expect(byId(guideActions(input({ hive: null })), 'broadcast')?.why).toMatch(/no hive-mind/)
    expect(byId(guideActions(input({ claims: [] })), 'handoff')?.why).toMatch(/no open claim/)
    expect(byId(guideActions(input({ agents: [ruflo('agent-1')] })), 'handoff')?.why).toMatch(/no other live agent/)
  })

  it('the memory note goes to the guidance namespace and says nothing pushes it into a running agent', () => {
    const memory = byId(guideActions(input()), 'memory')

    expect(memory?.spec?.args.slice(0, 2)).toEqual(['memory', 'store'])
    expect(memory?.spec?.args).toEqual(expect.arrayContaining(['--namespace', 'guidance']))
    expect(memory?.spec?.args[3]).toMatch(/^guidance-[A-Za-z0-9]{1,8}-1700000000000$/)
    expect(memory?.acts).toMatch(/nothing is pushed into a running agent/)
  })
})

describe('guideActions on a Claude Code workflow', () => {
  const actions = guideActions(input({ run: wfRun() }))

  it('has only the memory note and a prepared redirect: no broadcast, handoff or task write exists for a workflow agent', () => {
    expect(actions.map(action => action.id)).toEqual(['memory', 'redirect'])
  })

  it('the redirect only prepares text for the main session, and says it is the prompt-box fallback for the control tab', async () => {
    const sent: string[] = []
    const redirect = byId(guideActions(input({ run: wfRun(), prepare: async text => void sent.push(text) })), 'redirect')
    const spec = redirect?.spec as ActionSpec

    expect(spec.args).toEqual([])
    expect(spec.note).toMatch(/prompt-box fallback.*control tab/)
    expect(redirect?.kind).toBe('prompt-only')
    await spec.run?.()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('resumeFromRunId: "wf_abc12345"')
    expect(sent[0]).toContain('/home/u/.claude/projects/-p/sess/workflows/scripts/my flow-wf_abc12345.js')
    expect(sent[0]).toContain('use the cache')
  })

  it('a run directory outside Claude Code\'s projects folder, or with .. in it, is not shown as a path', () => {
    const run = wfRun({ dir: '/home/u/.claude/projects/../../etc/subagents/workflows/wf_abc12345' })

    expect(redirectText(run, null, 'x', path => !path.includes('..'))).toContain('<session>/workflows/scripts')
    expect(redirectText(run, null, 'x', path => !path.includes('..'))).not.toContain('etc')
    expect(redirectText({ ...run, id: 'bad id' }, null, 'x', () => true)).toBeNull()
  })
})

describe('what may be sent', () => {
  it('refuses empty text, text starting with a dash, and text that looks like a credential, with the reason', () => {
    expect(guardText('  ', 100)).toMatchObject({ ok: false, why: expect.stringMatching(/type the guidance/) })
    expect(guardText('--force', 100)).toMatchObject({ ok: false, why: expect.stringMatching(/dash/) })
    expect(guardText('use sk-ABCDEFGHIJKLMNOPQRSTUVWX12345', 100)).toMatchObject({ ok: false, why: expect.stringMatching(/credential/) })
    expect(guardText('use the cache', 100)).toEqual({ ok: true, text: 'use the cache' })

    const refused = guideActions(input({ text: 'token=abcdefghijklmnop' }))

    expect(refused).toHaveLength(1)
    expect(refused[0]?.spec).toBeNull()
  })

  it('strips control characters and bounds the text to one argv element', () => {
    const spec = byId(guideActions(input({ text: `a\u001b[31m ${'word '.repeat(100)}` })), 'broadcast')?.spec

    expect(JSON.stringify(spec?.args)).not.toContain('\\u001b')
    expect(spec?.args.length).toBe(6)
    expect(JSON.parse(spec?.args[5] ?? '{}').message.length).toBeGreaterThan(400)
  })
})

describe('the slots', () => {
  beforeEach(() => resetSlots())
  afterEach(() => resetSlots())

  it('register without a clash, with no hotkey, and a second registration is refused rather than thrown', () => {
    expect(registerGuide().every(result => result.ok)).toBe(true)
    expect(slotsFor('board').map(slot => slot.id)).toEqual(['links', 'nesting', 'mission-run'])
    expect(slotsFor('tab').map(slot => slot.id)).toEqual(['mission', 'guide'])
    expect(slotsFor('notice').map(slot => slot.id)).toEqual(['links'])
    expect(slotsFor('key')).toEqual([])
    expect(slotsFor('action')).toEqual([])
    expect(registerGuide().every(result => !result.ok)).toBe(true)
    expect(registerSlot({ kind: 'notice', id: 'links', between: () => [] })).toMatchObject({ ok: false })
  })

  const world = (): { state: State; ctx: Ctx; asked: { spec: ActionSpec | null; why: string }[] } => {
    const state = newState({})
    const asked: { spec: ActionSpec | null; why: string }[] = []
    const act = { workflows: { ask: (spec: ActionSpec | null, why = '') => void asked.push({ spec, why }), setUi: () => undefined } } as unknown as Actions

    return { state, ctx: { kit, state, nowMs: 1_000, columns: 120, pictures: new Map(), act }, asked }
  }
  const envOf = (ctx: Ctx, run: WfRun): SlotEnv => ({ ctx, runs: [run], run, phase: run.phases[0] ?? null, agent: run.phases[0]?.agents[0] ?? null, ui: { run: 0, phase: 0, agent: 0, column: 'agents', isInspecting: true }, nowMs: 1_000 })
  const slot = <K extends 'board' | 'tab'>(kind: K, id: string) => slotsFor(kind).find(candidate => (candidate as unknown as { id: string }).id === id) as never as { render: (env: SlotEnv) => unknown[]; when?: (env: SlotEnv) => boolean }
  const ledger = (state: State): MissionRecord => {
    const mission = { id: 'm1', objective: 'Ship it', profile: 'feature', rigor: 'standard', tasks: [{ id: 'implement', title: 'Implement', phase: 'R', stage: 'Build', agent: 'coder', requirement: 'it works', dependsOn: [] }], acceptance: [], events: [], paused: false, cancelled: false, auto: false, createdAtMs: 0 } as MissionRecord

    mcOf(state).missions.set('m1', mission)
    mcOf(state).active = 'm1'

    return mission
  }

  it('the links board counts links and unlinked agents from the records, and says so when there is no mission', () => {
    registerGuide()

    const { ctx } = world()

    const plain = wfRun({ phases: [{ title: 'Build', agents: [{ ...flow(), label: 'plain' }], done: 0, total: 1, running: 1, failed: 0 }] })

    expect(words(slot('board', 'links').render(envOf(ctx, plain)))).toMatch(/0 agent-to-task links · 1 agents unlinked · 0 mission tasks known/)
    expect(words(slot('board', 'links').render(envOf(ctx, plain)))).toMatch(/No mission yet/)

    ledger(ctx.state)

    const text = words(slot('board', 'links').render(envOf(ctx, wfRun())))

    expect(text).toMatch(/1 agent-to-task links · 0 agents unlinked · 1 mission tasks known/)
    expect(text).toMatch(/m1\/implement Implement -> .*\(label tag\)/)
  })

  it('the mission tab shows an agent\'s task, or that it is unlinked and why', () => {
    registerGuide()

    const { ctx } = world()

    expect(words(slot('tab', 'mission').render(envOf(ctx, wfRun())))).toMatch(/m1 \/ implement/)
    expect(words(slot('tab', 'mission').render(envOf(ctx, wfRun({ phases: [{ title: 'Build', agents: [{ ...flow(), label: 'plain' }], done: 0, total: 1, running: 1, failed: 0 }] }))))).toMatch(/unlinked: its label has no/)
  })

  it('the nesting board draws only for the ruflo swarm run', () => {
    registerGuide()

    const { ctx } = world()

    expect(words(slot('board', 'nesting').render(envOf(ctx, wfRun())))).toMatch(/Pick the ruflo swarm run/)
    expect(words(slot('board', 'nesting').render(envOf(ctx, swarmRun())))).toMatch(/no swarm/)
  })

  it('the mission board drafts the script for review, with the estimate, and its button asks (nothing runs until the confirm card)', () => {
    registerGuide()

    const { ctx, asked } = world()

    expect(words(slot('board', 'mission-run').render(envOf(ctx, wfRun())))).toMatch(/No active mission/)
    ledger(ctx.state)

    const tree = slot('board', 'mission-run').render(envOf(ctx, wfRun()))
    const text = words(tree)

    expect(text).toMatch(/\.claude\/workflows\/mission-m1\.js/)
    expect(text).toMatch(/1 agents in 1 level, at most 1 at once/)
    expect(flat(tree).some(el => el.kind === 'Button' && String(el.props.label).includes('Review the script'))).toBe(true)
    ;(buttonOf(tree, 'wf-mission-launch')?.props.onPress as () => void)()
    expect(asked).toHaveLength(1)
    expect(asked[0]?.spec?.args).toEqual([])
    expect(asked[0]?.spec?.note).toMatch(/Starts nothing here/)
  })

  it('the launch reports "not wired" instead of pretending when there is no host to prepare the prompt in', async () => {
    const { state } = world()
    const mission = ledger(state)
    const draft = draftScript(scriptMissionOf(mission))

    if (!draft.ok) throw new Error('draft')

    await launchSpec(state, draft, 'm1').run?.()
    expect(state.outcome).toMatchObject({ label: 'workflow script', ok: false, detail: expect.stringMatching(/not wired/) })
    expect(REVIEW_LINES).toBe(80)
  })

  it('a long script says how many lines the review does not draw', () => {
    registerGuide()

    const { ctx } = world()
    const mission = ledger(ctx.state)

    mission.tasks = Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, phase: 'R', stage: 'Build', agent: 'coder', requirement: 'ok', dependsOn: [] }))

    expect(words(slot('board', 'mission-run').render(envOf(ctx, wfRun())))).toMatch(/\d+ more lines are not drawn here/)
  })

  it('the guide tab lists each action with what it sends and whether it acts, and says where a workflow is stopped (the control tab, or Claude Code where it is not switched on)', () => {
    registerGuide()

    const { ctx } = world()
    const tree = slot('tab', 'guide').render(envOf(ctx, wfRun()))
    const text = words(tree)

    expect(flat(tree).some(el => el.kind === 'Input')).toBe(true)
    expect(text).toMatch(/guidance: none typed yet/)
    expect(text).toMatch(/control tab/)
  })

  it('draws on the real page: the boards under the run board, and the tabs once the inspector is open', () => {
    registerGuide()

    const { state } = world()
    const runner = { ask: () => undefined }
    const host = { invalidate: () => undefined } as unknown as Host

    state.view = 'workflows'
    state.wf.read = { runs: [wfRun()], root: '/r', capBytes: 1, skipped: 0, more: 0 }
    state.wf.ui = { run: 0, phase: 0, agent: 0, column: 'agents', isInspecting: true }

    const act = { workflows: workflowsActions(state, host, runner as never) } as unknown as Actions
    const text = words(workflowsPage({ kit, state, nowMs: 1_000, columns: 120, pictures: new Map(), act }))

    expect(text).toMatch(/Mission links/)
    expect(text).toMatch(/Run a mission as a workflow/)
    expect(text).toMatch(/Swarm nesting/)
    expect(flat(workflowsPage({ kit, state, nowMs: 1_000, columns: 120, pictures: new Map(), act })).some(el => el.kind === 'Button' && String(el.props.label).includes('guide'))).toBe(true)
  })

  it('the notice slot raises what changed between two reads, and survives odd input', () => {
    registerGuide()

    const between = (slotsFor('notice')[0] as { between: (prev: readonly WfRun[] | null, next: readonly WfRun[], nowMs: number) => { text: string }[] }).between

    expect(between(null, [wfRun()], 0)).toEqual([])
    expect(between([wfRun()], [wfRun({ phases: [{ title: 'Build', agents: [flow('failed')], done: 0, total: 1, running: 0, failed: 1 }] })], 0)[0]?.text).toMatch(/failed/)
  })

  it('recordRunEvents writes a mission event once and saves the ledger', () => {
    const { state } = world()
    const mission = ledger(state)
    let saved = 0
    const host = { storeSet: async () => void (saved += 1), invalidate: () => undefined } as unknown as Host
    const after = [wfRun({ phases: [{ title: 'Build', agents: [flow('failed')], done: 0, total: 1, running: 0, failed: 1 }] })]

    expect(recordRunEvents(state, host, [wfRun()], after, 5)).toBe(1)
    expect(recordRunEvents(state, host, [wfRun()], after, 6)).toBe(0)
    expect(saved).toBe(1)
    expect(mission.events).toHaveLength(1)
    expect(mission.events[0]).toMatchObject({ type: 'workflow', taskId: 'implement', status: 'agent-failed' })
  })
})
