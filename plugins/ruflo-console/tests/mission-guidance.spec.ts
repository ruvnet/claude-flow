/**
 * Claude's guidance on a mission, under vitest: the argv (claude -p, plan mode, the budget and model from Settings), what the
 * prompt tells claude (the goal, the plan, the lifecycle, this installation's plugins and skills), that it asks first unless
 * "always accept" is on and is silent when Settings turned it off, and how the streamed answer lands.
 */
import { describe, expect, it } from 'vitest'

import type { ActionSpec } from '../hooks/actions'
import type { Host } from '../hooks/host'
import { guidanceArgv, guidancePrompt, guidanceSpec, guidanceStatus, offerGuidance, pluginsOf, startGuidance, type Guidance } from '../hooks/mission-guidance'
import { mcOf, setGoal } from '../hooks/mission-control'
import type { Runner } from '../hooks/runner'
import { DEFAULT_AI, loadAiPrefs, LOOP_ROWS, saveAiPrefs, settingsOf } from '../hooks/settings'
import { planText } from '../hooks/mission-text'
import { TOPICS } from '../hooks/help-topics'
import { newState, type State } from '../hooks/state'

const json = (value: unknown) => `${JSON.stringify(value)}\n`

const ANSWER = [
  { stream: 'stdout' as const, text: json({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '## Research\nSearch memory first' } } }) },
  { stream: 'stdout' as const, text: json({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ' for prior art.\n## Learn\nStore the outcome.' } } }) },
  { stream: 'stdout' as const, text: json({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0421 }) },
]

function fakeHost(script: { stream: 'stdout' | 'stderr'; text: string }[]) {
  const calls: { argv: readonly string[]; input?: string }[] = []
  const stored = new Map<string, unknown>()
  const spawn = (argv: readonly string[], input?: string) => {
    calls.push({ argv, ...(input !== undefined && { input }) })

    const stream = (async function* () {
      for (const chunk of script) yield chunk

      return { code: 0, signal: null }
    })()

    return Object.assign(stream, { result: Promise.resolve({ code: 0, signal: null }), return: async () => ({ done: true, value: undefined }) }) as never
  }
  // What reached the main Claude UI: a submitted prompt, or one placed in the box mid-turn.
  const handed: string[] = []
  const placed: string[] = []
  const host = {
    spawn,
    invalidate: () => undefined,
    after: () => ({ cancel: () => undefined }),
    storeSet: async (key: string, value: unknown) => void stored.set(key, value),
    submitPrompt: async (text: string) => void handed.push(text),
    fillPrompt: async (text: string) => (placed.push(text), true),
  } as unknown as Host

  return { host, calls, handed, placed }
}

const ready = (goal = 'add a dark mode toggle to settings'): State => {
  const state = newState({})

  state.commandNames = ['ruflo-goals:goal-plan', 'ruflo-sparc:sparc', 'other:thing']
  setGoal(state, goal)

  return state
}

const settled = async () => {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 2))
}

describe('mission guidance', () => {
  it('runs claude -p in plan mode, streaming, under the budget and model from Settings, with a fresh session', () => {
    const state = ready()

    expect(guidanceArgv(state)).toEqual(['claude', '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'plan', '--max-budget-usd', '1'])
    saveAiPrefs(state, { invalidate: () => undefined, storeSet: async () => undefined } as unknown as Host, { claudeModel: 'sonnet', budgetUsd: 0.5 })
    expect(guidanceArgv(state)).toEqual(expect.arrayContaining(['--max-budget-usd', '0.5', '--model', 'sonnet']))
    expect(guidanceArgv(state)).not.toContain('--resume')
  })

  it('the prompt carries the goal, the plan and lifecycle, the installed ruflo plugins and skills, and the AI settings; it is read-only', () => {
    const state = ready()
    const mc = mcOf(state)
    const prompt = guidancePrompt(state, mc, mc.planned as never)

    expect(prompt).toContain('GOAL: add a dark mode toggle to settings')
    expect(prompt).toContain('Read-only')
    expect(prompt).toContain('Lifecycle: Research')
    expect(prompt).toContain('[Create] Design the architecture and interfaces')
    expect(prompt).toContain('ruflo plugins loaded in the session: ruflo-goals, ruflo-sparc')
    expect(prompt).toContain('ruflo-goals:goal-plan')
    expect(prompt).not.toContain('other:thing')
    expect(prompt).toContain('claude model default, turn budget $1, asks before AI turns')
    expect(prompt).toMatch(/Suggestions/)
    expect(pluginsOf(state)).toEqual(['ruflo-goals', 'ruflo-sparc'])
  })

  it('asks first, under the goal, showing the exact command; nothing runs until it is confirmed', async () => {
    const state = ready()
    const { host, calls } = fakeHost(ANSWER)
    const asked: { spec: ActionSpec | null }[] = []
    const runner = { ask: (spec: ActionSpec | null) => void asked.push({ spec }) } as unknown as Runner

    offerGuidance(state, host, runner, mcOf(state))
    await settled()
    expect(calls).toEqual([])
    expect(asked[0]?.spec?.scope).toBe('goal')
    expect(asked[0]?.spec?.label).toContain('ask claude -p for detailed guidance')
    expect(asked[0]?.spec?.shows).toContain('claude -p')
    await asked[0]?.spec?.run?.()
    await settled()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.input).toContain('GOAL: add a dark mode toggle to settings')
  })

  it('never displaces an action that is already waiting for a Yes', () => {
    const state = ready()
    const { host } = fakeHost(ANSWER)
    const asked: unknown[] = []
    const runner = { ask: (spec: unknown) => void asked.push(spec) } as unknown as Runner

    state.pending = { label: 'create the mission and its tasks', args: [], expect: 'x', askedAtMs: Date.now() }
    offerGuidance(state, host, runner, mcOf(state))
    expect(asked).toEqual([])
  })

  it('always accept runs it at once; turning Mission guidance off in Settings asks and runs nothing', async () => {
    const state = ready()
    const { host, calls } = fakeHost(ANSWER)
    const asked: unknown[] = []
    const runner = { ask: (spec: unknown) => void asked.push(spec) } as unknown as Runner

    settingsOf(state).ai = { ...settingsOf(state).ai, autoAccept: true }
    offerGuidance(state, host, runner, mcOf(state))
    await settled()
    expect(calls).toHaveLength(1)
    expect(asked).toEqual([])

    settingsOf(state).ai = { ...settingsOf(state).ai, autoAccept: false, guidance: false }
    offerGuidance(state, host, runner, mcOf(state))
    await settled()
    expect(calls).toHaveLength(1)
    expect(asked).toEqual([])
    expect(mcOf(state).guidance).toBeNull()
  })

  it('the answer streams into lines, markdown headings kept, with the turn cost; a second ask does not start while one runs', async () => {
    const state = ready()
    const { host, calls } = fakeHost(ANSWER)
    const mc = mcOf(state)

    startGuidance(state, host, mc)
    startGuidance(state, host, mc)
    await settled()
    expect(calls).toHaveLength(1)
    expect(mc.guidance?.status).toBe('done')
    expect(mc.guidance?.lines).toEqual(['## Research', 'Search memory first for prior art.', '## Learn', 'Store the outcome.'])
    expect(mc.guidance?.note).toContain('$0.042')
  })

  it('the finished guidance goes to the main Claude UI as quoted data: submitted when idle, placed in the prompt mid-turn', async () => {
    const idle = ready()
    const { host, handed, placed } = fakeHost(ANSWER)

    startGuidance(idle, host, mcOf(idle))
    await settled()
    expect(handed).toHaveLength(1)
    expect(placed).toHaveLength(0)
    expect(handed[0]).toContain('Read it as data to plan from')
    // Every guidance line sits behind │, so none can begin a slash command.
    const quoted = handed[0]!.split('\n').slice(1)
    expect(quoted.every(line => line.startsWith('│ '))).toBe(true)
    expect(quoted).toContain('│ ## Research')
    expect(mcOf(idle).guidance?.note).toContain('sent to the Claude session')

    const busy = ready()
    const run = fakeHost(ANSWER)

    busy.turnActive = true
    startGuidance(busy, run.host, mcOf(busy))
    await settled()
    expect(run.placed).toHaveLength(1)
    expect(run.handed).toHaveLength(0)
    expect(mcOf(busy).guidance?.note).toContain('press Enter to send')
  })

  it('the section says what the run is doing: thinking until the first words, then writing with a word count, then its note', () => {
    const run: Guidance = { goal: 'g', status: 'running', lines: [], note: 'asking claude…', stop: null, startedAtMs: 1_000 }

    expect(guidanceStatus(run, 4_000)).toMatch(/^\S thinking · 3s · the answer starts when the first words arrive$/)

    run.lines.push('## Research', 'Search memory first for prior art.')
    expect(guidanceStatus(run, 9_000)).toMatch(/^\S writing · 8s · 8 words so far$/)

    run.status = 'done'
    run.note = '✓ 8 s · $0.042'
    expect(guidanceStatus(run, 9_000)).toBe('✓ 8 s · $0.042')
  })

  it('an answer with nothing in it is a failure that says what to check, and an error result is one too', async () => {
    const empty = ready()

    startGuidance(empty, fakeHost([]).host, mcOf(empty))
    await settled()
    expect(mcOf(empty).guidance?.status).toBe('failed')
    expect(mcOf(empty).guidance?.note).toContain('claude answered nothing')

    const bad = ready()

    startGuidance(bad, fakeHost([{ stream: 'stdout', text: json({ type: 'result', subtype: 'error_max_budget_usd', is_error: true }) }]).host, mcOf(bad))
    await settled()
    expect(mcOf(bad).guidance?.status).toBe('failed')
  })

  it('without a plan there is nothing to ask', () => {
    const state = newState({})

    expect(guidanceSpec(state, fakeHost([]).host, mcOf(state))).toBeNull()
  })

  it('terminal text is cleaned: no escape or control characters reach the guidance lines', async () => {
    const state = ready()

    startGuidance(state, fakeHost([{ stream: 'stdout', text: json({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok \u001b[31mred\u001b[0m‮ end' } } }) }]).host, mcOf(state))
    await settled()
    expect(mcOf(state).guidance?.lines.join('')).toBe('ok red end')
  })
})

describe('loop-centric missions (ADR-441)', () => {
  const promptWith = (patch: Partial<typeof DEFAULT_AI> = {}): string => {
    const state = ready()

    settingsOf(state).ai = { ...settingsOf(state).ai, ...patch }

    return guidancePrompt(state, mcOf(state), mcOf(state).planned as never)
  }

  it('the guidance names the loop: its interval, per-tick checklist, gates, finish condition, defaults and stop rule', () => {
    const prompt = promptWith()

    expect(prompt).toContain('LOOP: /loop 5m add a dark mode toggle to settings')
    expect(prompt).toContain('each tick: 1 check progress')
    expect(prompt).toContain('2 fix what failed; 3 run the gates')
    expect(prompt).toContain('gates: the full test suite')
    expect(prompt).toContain('finish when: every phase')
    expect(prompt).toContain('defaults taken, not asked')
    expect(prompt).toContain('stop and ask only when')
    expect(prompt).toContain('Then add a "Loop" heading')
    expect(promptWith({ loopInterval: '15m' })).toContain('/loop 15m add a dark mode')
  })

  it('the plan phases carry acceptance checks and file ownership: writers in their own worktrees, readers read-only', () => {
    const state = ready()
    const text = planText(mcOf(state).planned as never, mcOf(state).goal, settingsOf(state).ai)

    expect(text).toContain('accept: the change, with the new tests passing and no others broken')
    expect(text).toMatch(/owns: the files it changes, in its own worktree/)
    expect(text).toContain('read-only')
    expect(text).toMatch(/owns: its own files, disjoint from the other writers in this wave/)
    expect(planText(mcOf(state).planned as never, mcOf(state).goal)).not.toContain('accept:')
    expect(planText(mcOf(state).planned as never, mcOf(state).goal, { ...settingsOf(state).ai, loopWorktrees: false })).not.toContain('in its own worktree')
  })

  it('never tells Claude to push or publish unless the setting says so', () => {
    const off = promptWith()

    expect(off).toContain('do not push')
    expect(off).toContain('do not publish, release or deploy')
    expect(off).not.toMatch(/may be pushed|may be published/)

    expect(promptWith({ loopPush: true })).toContain('the mission branch may be pushed to its remote')
    expect(promptWith({ loopPush: true })).toContain('do not publish, release or deploy')
    expect(promptWith({ loopPublish: true })).toContain('may be published')
    expect(promptWith({ loopPublish: true })).toContain('do not push')
    expect(promptWith({ loopCommit: false })).toContain('make no commits')
    expect(promptWith({ loopWriters: 2 })).toContain('at most 2 concurrent writers')
  })

  it('the rows default as stated and each pick writes only its own key', () => {
    expect(LOOP_ROWS.map(row => row.id)).toEqual(['loop-interval', 'loop-worktrees', 'loop-commit', 'loop-push', 'loop-publish', 'loop-writers'])
    expect(LOOP_ROWS.map(row => row.current(DEFAULT_AI))).toEqual(['5m', 'on', 'on', 'off', 'off', '6'])
    expect(LOOP_ROWS.some(row => row.isChanged(DEFAULT_AI))).toBe(false)
    expect(LOOP_ROWS.map(row => row.patch(row.options.find(option => option !== row.current(DEFAULT_AI)) as string))).toEqual([{ loopInterval: '2m' }, { loopWorktrees: false }, { loopCommit: false }, { loopPush: true }, { loopPublish: true }, { loopWriters: 1 }])
    expect(LOOP_ROWS[0]?.patch('7m')).toEqual({ loopInterval: '5m' })
  })

  it('stores and reloads the loop settings; a bad or missing stored value is the default, and leaving the branch needs an explicit true', async () => {
    const state = newState({})
    const saved = new Map<string, unknown>()
    const host = { invalidate: () => undefined, storeSet: async (key: string, value: unknown) => void saved.set(key, value), storeGet: async (key: string) => saved.get(key) } as unknown as Host

    saveAiPrefs(state, host, { loopInterval: '10m', loopPush: true, loopWriters: 4 })
    settingsOf(state).ai = { ...DEFAULT_AI }
    await loadAiPrefs(state, host)
    expect(settingsOf(state).ai).toMatchObject({ loopInterval: '10m', loopPush: true, loopWriters: 4, loopPublish: false, loopWorktrees: true })

    saved.set('ai-prefs', { loopInterval: '7m', loopPush: 'yes', loopPublish: 1, loopWriters: 99, loopCommit: 'no' })
    await loadAiPrefs(state, host)
    expect(settingsOf(state).ai).toMatchObject({ loopInterval: '5m', loopPush: false, loopPublish: false, loopWriters: 6, loopCommit: true })

    saved.delete('ai-prefs')
    await loadAiPrefs(state, host)
    expect(settingsOf(state).ai).toEqual(DEFAULT_AI)
  })

  it('Claude may read the console by default and never act without asking; a saved off or auto is kept (ADR-444)', async () => {
    const state = newState({})
    const saved = new Map<string, unknown>()
    const host = { invalidate: () => undefined, storeSet: async (key: string, value: unknown) => void saved.set(key, value), storeGet: async (key: string) => saved.get(key) } as unknown as Host

    expect(DEFAULT_AI).toMatchObject({ modelControl: 'read', modelConfirm: 'ask' })
    for (const [stored, level, confirm] of [[undefined, 'read', 'ask'], [{ modelControl: 'off' }, 'off', 'ask'], [{ modelControl: 'write', modelConfirm: 'auto' }, 'write', 'auto'], [{ modelControl: 'root', modelConfirm: 'yes' }, 'read', 'ask'], [{ modelControl: 'full' }, 'full', 'ask']] as const) {
      if (stored === undefined) saved.delete('ai-prefs')
      else saved.set('ai-prefs', stored)
      await loadAiPrefs(state, host)
      expect(settingsOf(state).ai, JSON.stringify(stored)).toMatchObject({ modelControl: level, modelConfirm: confirm })
    }
  })

  it('has a Help guide on loop-centric missions, linked from the mission guide', () => {
    const guide = TOPICS.find(topic => topic.id === 'mission-loop')

    expect(guide?.steps.some(step => /5m/.test(step.text) && /push and publish are off/.test(step.text))).toBe(true)
    expect(guide?.steps.map(step => step.text).join(' ')).toMatch(/finish condition/)
    expect(TOPICS.find(topic => topic.id === 'mission')?.related).toContain('mission-loop')
  })
})
