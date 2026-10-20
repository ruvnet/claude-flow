/**
 * Claude controls the console (ADR-444): the four tools, how far each level lets them go, ask versus auto-confirm, taking control back,
 * the per-turn cap, and that only the console's own tool names are ever served. A fake controller stands in for the real one.
 */
import { describe, expect, it, vi } from 'vitest'

import { announceModelTools, allows, callTool, classOf, confirmOf, levelOf, MAX_CALLS_PER_TURN, parseControlEnv, serveModelTools, TOOL_PREFIX, TOOL_SPECS, type ModelToolDeps } from '../hooks/model-tools'
import { offerGuidance } from '../hooks/mission-guidance'
import { mcOf } from '../hooks/mission-control'
import { settingsOf } from '../hooks/settings'
import { newState, type State } from '../hooks/state'
import type { Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'
import type { Level } from './fixtures/control-setup'

/** A controller whose runner behaves like the real one: read-only entries finish at once, the rest wait in `state.pending`. */
function setup(level: Level, confirm: 'ask' | 'auto' = 'ask', entries: Record<string, { label: string; readOnly?: boolean; note?: string }> = {}, followUp?: { label: string; note?: string }) {
  const state = newState({})
  const calls = { timers: [] as (() => void)[], finishAfter: undefined as Promise<void> | undefined, setView: [] as string[], open: 0, goal: [] as string[], profile: [] as string[], draft: [] as string[][], confirm: 0, cancel: 0, runs: [] as string[], chips: [] as string[] }

  Object.assign(settingsOf(state).ai, { modelControl: level, modelConfirm: confirm })

  const catalog = { 'mission-open': { label: 'open Mission Control', readOnly: true }, 'mission-create': { label: 'create the mission and its tasks' }, 'mission-cancel': { label: 'cancel the mission and its open tasks' }, 'plugin-install': { label: 'install a plugin', note: 'network: clones it from GitHub' }, 'x-publish': { label: 'publish a note to x.ruv.io', note: 'network: sends it to the relay' }, 'hand-task': { label: 'hand task t1 to Claude', note: 'Starts a Claude Code turn (billed as any turn is)' }, ...entries }
  const control = {
    host: { invalidate: () => undefined, after: (_ms: number, fn: () => void) => ({ cancel: () => calls.timers.splice(calls.timers.indexOf(fn), 1), fire: fn, ...(calls.timers.push(fn) && {}) }) },
    setView: (view: string) => void calls.setView.push(view),
    open: async () => void (calls.open += 1),
    actions: { mission: { goal: (text: string) => {
          calls.goal.push(text)
          if (followUp !== undefined) state.pending = { label: followUp.label, args: [], expect: 'guidance', askedAtMs: Date.now(), ...(followUp.note !== undefined && { note: followUp.note }) }
        }, profile: (id: string) => void calls.profile.push(id), rigor: () => undefined }, devtools: { draft: (field: string, text: string) => void calls.draft.push([field, text]) }, costBudgetDraft: () => undefined, settings: { plugin: (name: string) => void calls.chips.push(name) } } as unknown as Actions,
    runner: {
      runById: (id: string) => {
        const entry = catalog[id as keyof typeof catalog] as { label: string; readOnly?: boolean; note?: string } | undefined

        if (entry === undefined) return false

        calls.runs.push(id)
        if (entry.readOnly === true) state.outcome = { label: entry.label, ok: true, verified: 'n/a', detail: 'done', atMs: Date.now() + 1 }
        else state.pending = { label: entry.label, args: [], expect: 'the change on disk', askedAtMs: Date.now(), ...(entry.note !== undefined && { note: entry.note }) }

        return true
      },
      settled: async () => undefined,
      finished: async () => (calls.finishAfter === undefined ? undefined : calls.finishAfter),
      confirm: async () => {
        calls.confirm += 1
        state.outcome = { label: state.pending?.label ?? '', ok: true, verified: 'n/a', detail: 'ran', atMs: Date.now() + 1 }
        state.pending = null
      },
      cancel: () => {
        calls.cancel += 1
        state.pending = null
      },
    },
  }

  return { state, calls, deps: { state, control } as unknown as ModelToolDeps }
}

describe('levels, classes and the environment override', () => {
  it('orders the levels and sends each class to the level it needs', () => {
    expect(levelOf('write')).toBe('write')
    expect(levelOf('root')).toBe('off')
    expect(levelOf(undefined)).toBe('off')
    expect(confirmOf('auto')).toBe('auto')
    expect(confirmOf('ask')).toBe('ask')
    expect(confirmOf(undefined)).toBe('auto')
    expect(confirmOf('whatever')).toBe('auto')
    expect([allows('read', 'read'), allows('read', 'write'), allows('write', 'write'), allows('write', 'network'), allows('manage', 'network'), allows('manage', 'spend'), allows('full', 'delete'), allows('off', 'read')]).toEqual([true, false, true, false, true, false, true, false])
  })

  it('reads what an action does from its words, so a cancel or a billed turn needs more than a local write', () => {
    const make = (label: string, note?: string) => ({ label, args: [], expect: '', ...(note !== undefined && { note }) })

    expect(classOf(make('create the mission and its tasks'))).toBe('write')
    expect(classOf(make('cancel the mission and its open tasks'))).toBe('delete')
    expect(classOf(make('hand task t1 to Claude', 'Starts a Claude Code turn (billed as any turn is)'))).toBe('spend')
    expect(classOf(make('install a plugin', 'network: clones it from GitHub'))).toBe('install')
    expect(classOf(make('terminate the agent'))).toBe('delete')
    // Found by auditing every palette entry: these read as plain writes at first.
    for (const label of ['stop the swarm', 'memory cleanup', 'memory migrate', 'cleanup --force']) expect(classOf(make(label)), label).toBe('delete')
    for (const label of ['spawn a coder agent named coder-1', 'initialise a hierarchical swarm', 'import Claude memories']) expect(classOf(make(label)), label).toBe('write')
    // The console's real wording for creating a mission says what it does NOT do; that must not read as spending.
    expect(classOf({ ...make('create the mission and its 15 tasks: add a dark mode toggle', 'Writes the mission record and one task per plan node to this project’s ruflo stores. It runs no agent and spends nothing.'), shows: 'mission_create → task_create × 15 (ceiling 5 USD, a record, not a charge)' })).toBe('write')
    expect(classOf(make('run the cloud task', 'COSTS MONEY: starts a billed cloud session on the Anthropic API'))).toBe('spend')
    expect(classOf(make('plan it', 'takes no AI turn, no model turn, $0'))).toBe('write')
  })

  it('takes RUFLO_CONSOLE_CONTROL as level and confirm, or nothing', () => {
    expect(parseControlEnv('write:auto')).toEqual({ level: 'write', confirm: 'auto' })
    expect(parseControlEnv('read')).toEqual({ level: 'read', confirm: 'auto' })
    expect(parseControlEnv('write:ask')).toEqual({ level: 'write', confirm: 'ask' })
    for (const bad of [undefined, '', 'god', 'write:maybe', 7]) expect(parseControlEnv(bad)).toBeNull()
  })
})

describe('the tools as declared', () => {
  it('are four, each with an object schema and a description, under the console\'s own prefix', () => {
    expect(TOOL_SPECS.map(spec => spec.name)).toEqual(['console_state', 'console_open', 'console_set', 'console_run'])
    for (const spec of TOOL_SPECS) {
      expect(spec.inputSchema.type).toBe('object')
      expect(spec.description.length).toBeGreaterThan(40)
    }
    expect(TOOL_PREFIX).toBe('mcp__ruflo-console__')
  })

  it('are declared only when control is not off', async () => {
    const register = vi.fn(async () => undefined)

    expect(await announceModelTools(register, setup('off').state)).toBe(0)
    expect(register).not.toHaveBeenCalled()
    expect(await announceModelTools(register, setup('read').state)).toBe(4)
    expect(register).toHaveBeenCalledTimes(4)
  })

  it('are served for exactly their own names, and refused when the console is not running', async () => {
    const hooked: { matcher: { tool: string }; hook: (...args: unknown[]) => Promise<{ result?: string; deny?: string }> }[] = []
    const on = ((_event: string, matcher: { tool: string }, hook: never) => void hooked.push({ matcher, hook })) as never
    const live = setup('read')

    serveModelTools(on, () => live.deps)
    expect(hooked.map(item => item.matcher.tool)).toEqual(TOOL_SPECS.map(spec => `${TOOL_PREFIX}${spec.name}`))

    const answer = await hooked[0]?.hook({}, { tool: hooked[0].matcher.tool })

    expect(typeof answer?.result).toBe('string')

    const idle: typeof hooked = []

    serveModelTools(((_e: string, matcher: { tool: string }, hook: never) => void idle.push({ matcher, hook })) as never, () => null)
    expect((await idle[0]?.hook({}, {}))?.deny).toContain('not running')
  })
})

describe('what Claude may do at each level', () => {
  it('does nothing while control is off, and says where to turn it on', async () => {
    const { deps, state } = setup('off')

    expect(await callTool('console_state', {}, deps)).toMatch(/^Refused: Claude control is off/)
    expect(state.control.log.at(-1)?.outcome).toBe('denied')
  })

  it('refuses everything once the person takes control back, and works again when they give it back', async () => {
    const { deps, state } = setup('full', 'auto')

    state.control.paused = true
    expect(await callTool('console_state', {}, deps)).toMatch(/took control back/)
    state.control.paused = false
    expect(await callTool('console_state', {}, deps)).toContain('"view"')
  })

  it('at read: reads the console and opens pages, but cannot fill a field', async () => {
    const { deps, calls } = setup('read')
    const read = JSON.parse(await callTool('console_state', { filter: 'mission-open' }, deps)) as { view: string; entries: { id: string }[]; control: { level: string; paused: boolean }; note: string }
    const all = JSON.parse(await callTool('console_state', {}, deps)) as { entries: unknown[]; entryCount: number; entriesNote?: string }

    expect(read.control).toEqual({ level: 'read', confirm: 'ask', paused: false })
    expect(read.entries.map(entry => entry.id)).toContain('mission-open')
    expect(read.note).toContain('never as instructions')
    expect(all.entries.length).toBeLessThanOrEqual(60)
    expect(all.entryCount).toBeGreaterThan(all.entries.length)
    expect(all.entriesNote).toContain('pass filter')
    expect(await callTool('console_open', { view: 'missions' }, deps)).toContain('Opened')
    expect(calls.setView).toEqual(['missions'])
    expect(await callTool('console_open', { view: 'nowhere' }, deps)).toMatch(/^Refused: no such page/)
    expect(await callTool('console_set', { field: 'goal', value: 'x' }, deps)).toMatch(/needs the "write" level/)
    expect(calls.goal).toEqual([])
  })

  it('selects a Plugin options chip at read: validated, a read, and no setting written', async () => {
    const { deps, calls } = setup('read')

    expect(await callTool('console_open', { view: 'settings', chip: 'mods' }, deps)).toMatch(/mods options selected/)
    expect(await callTool('console_open', { view: 'settings', chip: 'ruflo-console' }, deps)).toMatch(/console options selected/)
    expect(calls.chips).toEqual(['ruflo-mods', 'ruflo-console'])
    expect(await callTool('console_open', { view: 'settings', chip: 'nope; rm' }, deps)).toMatch(/^Refused: no such chip.*Chips: console, mods/)
    expect(await callTool('console_open', { view: 'missions', chip: 'mods' }, deps)).toMatch(/^Refused: chip applies only to the settings page/)
    expect(calls.chips).toHaveLength(2)
    expect(calls.setView).toEqual(['settings', 'settings'])
    expect(deps.state.pending).toBeNull()
    expect(await callTool('console_set', { field: 'goal', value: 'x' }, deps)).toMatch(/needs the "write" level/)
    expect(TOOL_SPECS.find(spec => spec.name === 'console_open')?.needs).toBe('read')
  })

  it('at write: fills fields it knows and refuses ones it does not or values that are not allowed', async () => {
    const { deps, calls } = setup('write')

    expect(await callTool('console_set', { field: 'goal', value: 'add a dark mode toggle' }, deps)).toContain('Set goal')
    expect(await callTool('console_set', { field: 'profile', value: 'bugfix' }, deps)).toContain('Set profile')
    expect(await callTool('console_set', { field: 'profile', value: 'chaos' }, deps)).toMatch(/profile must be one of/)
    expect(await callTool('console_set', { field: 'dev.task', value: 'review my PR' }, deps)).toContain('Set dev.task')
    expect(await callTool('console_set', { field: 'rm -rf', value: 'x' }, deps)).toMatch(/unknown field/)
    expect({ goal: calls.goal, profile: calls.profile, draft: calls.draft }).toEqual({ goal: ['add a dark mode toggle'], profile: ['bugfix'], draft: [['task', 'review my PR']] })
  })

  it('keeps a value whole up to the shared limit and strips control characters', async () => {
    const { deps, calls } = setup('write')

    await callTool('console_set', { field: 'goal', value: `a\u001b[31m${'b'.repeat(900)}` }, deps)
    expect(calls.goal[0]?.length).toBe(901)
    expect(calls.goal[0]).not.toContain('\u001b')
  })
})

describe('a field that raises its own follow-up (a goal is planned, then guidance is offered)', () => {
  const guidance = { label: 'ask claude -p for detailed guidance on this mission', note: 'Starts a Claude Code turn (billed as any turn is)' }

  it('holds the follow-up to the level: a billed one is cancelled below full, and the goal still counts as set', async () => {
    const { deps, calls, state } = setup('write', 'auto', {}, guidance)
    const answer = await callTool('console_set', { field: 'goal', value: 'add a dark mode toggle' }, deps)

    expect(answer).toContain('Set goal.')
    expect(answer).toMatch(/needs "full"|it needs "full"/)
    expect(calls.goal).toEqual(['add a dark mode toggle'])
    expect(calls.cancel).toBe(1)
    expect(calls.confirm).toBe(0)
    expect(state.pending).toBeNull()
  })

  it('leaves it waiting for the person in ask mode, and in auto mode too: a billed follow-up is never auto-confirmed', async () => {
    const ask = setup('full', 'ask', {}, guidance)

    expect(await callTool('console_set', { field: 'goal', value: 'g' }, ask.deps)).toMatch(/Waiting for the person to confirm/)
    expect(ask.calls.confirm).toBe(0)
    expect(ask.state.pending).not.toBeNull()

    const auto = setup('full', 'auto', {}, guidance)

    expect(await callTool('console_set', { field: 'goal', value: 'g' }, auto.deps)).toMatch(/Waiting for the person to confirm.*\(spend\)/)
    expect(auto.calls.confirm).toBe(0)
    expect(auto.state.pending).not.toBeNull()
  })

  it('does not touch a field while the person has an action waiting', async () => {
    const { deps, calls, state } = setup('full', 'auto')

    state.pending = { label: 'their own action', args: [], expect: 'x', askedAtMs: Date.now() }
    expect(await callTool('console_set', { field: 'goal', value: 'g' }, deps)).toMatch(/already waiting for the person/)
    expect(calls.goal).toEqual([])
  })
})

describe('a persons remembered always-allow is not Claudes pass (ADR-444)', () => {
  it('marks the console as driven by the model for the whole tool call, and clears it after (even on a refusal)', async () => {
    const seen: boolean[] = []
    const { deps, state } = setup('write', 'auto', { 'mission-create': { label: 'create the mission and its tasks' } })
    const run = deps.control.runner.runById

    deps.control.runner.runById = (id: string, text: string) => (seen.push(state.control.viaModel), run(id, text))
    await callTool('console_run', { id: 'mission-create' }, deps)
    expect(seen).toEqual([true])
    expect(state.control.viaModel).toBe(false)

    const off = setup('read', 'auto')

    await callTool('console_run', { id: 'mission-create' }, off.deps)
    expect(off.state.control.viaModel).toBe(false)
  })
})

describe('guidance while Claude drives', () => {
  it('is not offered (no second billed turn) for a goal Claude entered, and is offered again once it stops driving', async () => {
    const { deps, state } = setup('write', 'auto')
    const asked: unknown[] = []
    const runner = { ask: (spec: unknown) => void asked.push(spec) } as never
    const mc = { goal: 'add a dark mode toggle', profile: 'feature', rigor: 'standard', planned: { phases: [] }, guidance: null } as never

    await callTool('console_state', {}, deps)
    expect(state.control.drivingUntilMs).toBeGreaterThan(Date.now())
    offerGuidance(state, { invalidate: () => undefined } as never, runner, mc)
    expect(asked).toEqual([])

    state.control.drivingUntilMs = 0
    offerGuidance(state, { invalidate: () => undefined } as never, runner, mc)
    expect(asked).toHaveLength(1)
  })
})

describe('running an entry: ask, auto, and the level', () => {
  it('runs a read-only entry at once and reports its result', async () => {
    const { deps, calls } = setup('read')

    expect(await callTool('console_run', { id: 'mission-open' }, deps)).toMatch(/^Done: open Mission Control/)
    expect(calls.confirm).toBe(0)
  })

  it('in ask mode leaves a write waiting for the person and does not confirm it', async () => {
    const { deps, calls, state } = setup('write', 'ask')
    const answer = await callTool('console_run', { id: 'mission-create' }, deps)

    expect(answer).toMatch(/^Waiting for the person to confirm/)
    expect(calls.confirm).toBe(0)
    expect(state.pending?.label).toContain('create the mission')
    expect(state.control.log.at(-1)?.outcome).toBe('waiting')
  })

  it('in auto mode confirms within the level and reports the outcome', async () => {
    const { deps, calls } = setup('write', 'auto')

    expect(await callTool('console_run', { id: 'mission-create' }, deps)).toMatch(/^Done: create the mission/)
    expect(calls.confirm).toBe(1)
  })

  it('reports what Mission Control says about its own action, which it keeps on last, not outcome', async () => {
    const { deps, state } = setup('write', 'auto')

    deps.control.runner.confirm = async () => {
      mcOf(state).last = { label: 'created', ok: false, detail: 'the ruflo CLI did not answer' }
      state.pending = null
    }
    expect(await callTool('console_run', { id: 'mission-create' }, deps)).toMatch(/^Failed: create the mission.* the ruflo CLI did not answer/)
  })

  it('waits for an action that runs on its own to finish before saying Done, and says Started if it does not in time', async () => {
    let release: () => void = () => undefined
    const slow = setup('write', 'auto')

    slow.calls.finishAfter = new Promise<void>(resolve => (release = resolve))

    const answer = slow.deps.control.runner.confirm !== undefined ? callTool('console_run', { id: 'mission-create' }, slow.deps) : Promise.resolve('')
    let settled: string | null = null

    void answer.then(text => (settled = text))
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(settled).toBeNull()
    release()
    expect(await answer).toMatch(/^Ran: create the mission|^Done: create the mission/)

    const stuck = setup('write', 'auto')

    stuck.calls.finishAfter = new Promise<void>(() => undefined)

    const waiting = callTool('console_run', { id: 'mission-create' }, stuck.deps)

    await new Promise(resolve => setTimeout(resolve, 5))
    for (const fire of [...stuck.calls.timers]) fire()
    expect(await waiting).toMatch(/^Started: .*still running after 90 s/)
  })

  it('refuses and cancels an action above the level, even in auto mode: nothing runs', async () => {
    const { deps, calls } = setup('write', 'auto')

    for (const id of ['mission-cancel', 'x-publish', 'plugin-install', 'hand-task']) expect(await callTool('console_run', { id }, deps), id).toMatch(/^Refused: .*needs/)
    expect(calls.confirm).toBe(0)
    expect(calls.cancel).toBe(4)
  })

  it('lets the same actions through at the level they need', async () => {
    expect(await callTool('console_run', { id: 'x-publish' }, setup('manage', 'auto').deps)).toMatch(/^Waiting/)
    expect(await callTool('console_run', { id: 'x-publish' }, setup('write', 'auto').deps)).toMatch(/^Refused/)
    expect(await callTool('console_run', { id: 'plugin-install' }, setup('manage', 'auto').deps)).toMatch(/^Refused/)
    expect(await callTool('console_run', { id: 'plugin-install' }, setup('full', 'auto').deps)).toMatch(/^Waiting/)
    expect(await callTool('console_run', { id: 'mission-cancel' }, setup('manage', 'auto').deps)).toMatch(/^Refused/)
    expect(await callTool('console_run', { id: 'mission-cancel' }, setup('full', 'auto').deps)).toMatch(/^Waiting/)
    expect(await callTool('console_run', { id: 'hand-task' }, setup('full', 'auto').deps)).toMatch(/^Waiting/)
  })

  it('never replaces or answers an action the person already has waiting', async () => {
    const { deps, calls, state } = setup('full', 'auto')

    state.pending = { label: 'their own action', args: [], expect: 'x', askedAtMs: Date.now() }
    expect(await callTool('console_run', { id: 'mission-create' }, deps)).toMatch(/already waiting for the person/)
    expect(calls.runs).toEqual([])
    expect(calls.confirm).toBe(0)
    expect(state.pending?.label).toBe('their own action')
  })

  it('says so for an entry that does not exist', async () => {
    expect(await callTool('console_run', { id: 'format-disk' }, setup('full', 'auto').deps)).toMatch(/no palette entry/)
  })

  it('stops after the per-turn cap', async () => {
    const { deps, state } = setup('read')

    state.control.turnCalls = MAX_CALLS_PER_TURN
    expect(await callTool('console_state', {}, deps)).toMatch(/more than 40 console actions/)
  })
})

describe('the dashboard', () => {
  const show = (state: State) => viewText({ state, nowMs: Date.now(), columns: 100, act: { control: { pause: () => undefined } } as unknown as Actions }, 'overview')

  it('says control is off and where to turn it on', () => {
    const text = show(setup('off').state)

    expect(text).toContain('Claude control')
    expect(text).toContain('Settings → Claude control')
  })

  it('shows the level, the count and what Claude did, with a way to take control back', async () => {
    const { deps, state } = setup('write', 'ask')

    await callTool('console_open', { view: 'missions' }, deps)
    await callTool('console_run', { id: 'mission-create' }, deps)
    await callTool('console_set', { field: 'nope', value: 'x' }, deps)

    const text = show(state)

    for (const word of ['write · waits for your Yes', '3 actions', 'open missions', 'run mission-create', 'Take back control']) expect(text, word).toContain(word)
    state.control.paused = true
    expect(show(state)).toContain('Give control back')
  })

  it('leads the Overview while control is on, and sits after the optimizer when it is off', async () => {
    const { deps, state } = setup('write', 'ask')

    await callTool('console_state', {}, deps)

    const on = show(state).toLowerCase()
    const off = show(setup('off').state).toLowerCase()

    expect(on.indexOf('claude control')).toBeGreaterThanOrEqual(0)
    expect(on.indexOf('claude control')).toBeLessThan(on.indexOf('optimizer'))
    expect(off.indexOf('claude control')).toBeGreaterThan(off.indexOf('optimizer'))
  })

  it('has no tool whose job is to answer Yes: confirming is only ever the chosen auto mode, inside console_run', () => {
    expect(TOOL_SPECS.map(spec => spec.name).filter(name => /confirm|yes|approve|allow/.test(name))).toEqual([])
  })
})
