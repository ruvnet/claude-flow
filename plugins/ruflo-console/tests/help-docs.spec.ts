/**
 * The built-in help (ADR-436): every guide points at something that exists (a page, a start, a palette entry, another guide), is brief,
 * and is found by the way a person would ask; ruHelp answers from it for nothing and only asks Claude when told to, with the docs as quoted
 * data; and the Help page draws the index, an answer and a guide, with working buttons. Run with
 *   npx vitest run plugins/ruflo-console/tests/help-docs.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { helpActions } from '../hooks/help-actions'
import { helpPrompt, HELP_GROUPS, searchDocs, topicText, VIEW_TOPIC } from '../hooks/help-docs'
import { TOPICS, topicById } from '../hooks/help-topics'
import { mcOf } from '../hooks/mission-control'
import { paletteEntries } from '../hooks/palette'
import { START_LABEL } from '../hooks/starts'
import { newState, VIEWS, type State } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { helpView, wrap } from '../hooks/views/help'

type El = { props: Record<string, unknown> }

describe('the guides', () => {
  const viewIds = new Set<string>(VIEWS.map(view => view.id))
  const startIds = new Set(Object.keys(START_LABEL))
  const runIds = new Set(paletteEntries(newState({}), Date.now()).map(entry => entry.id))

  it('have unique ids, belong to a known group, and every group has at least one', () => {
    expect(new Set(TOPICS.map(topic => topic.id)).size).toBe(TOPICS.length)
    expect(TOPICS.every(topic => (HELP_GROUPS as readonly string[]).includes(topic.group))).toBe(true)
    for (const group of HELP_GROUPS) expect(TOPICS.some(topic => topic.group === group), group).toBe(true)
  })

  it('only point at pages, starts, palette entries and guides that exist', () => {
    const problems: string[] = []

    for (const topic of TOPICS) {
      for (const [i, step] of topic.steps.entries()) {
        const go = step.go

        if (go === undefined) continue
        if ('view' in go && !viewIds.has(go.view)) problems.push(`${topic.id} step ${i + 1}: no page ${go.view}`)
        if ('start' in go && !startIds.has(go.start)) problems.push(`${topic.id} step ${i + 1}: no start ${go.start}`)
        if ('run' in go && !runIds.has(go.run)) problems.push(`${topic.id} step ${i + 1}: no palette entry ${go.run}`)
      }

      for (const id of topic.related ?? []) if (topicById(id) === null) problems.push(`${topic.id}: related ${id} does not exist`)
    }

    for (const [view, id] of Object.entries(VIEW_TOPIC)) {
      if (!viewIds.has(view)) problems.push(`VIEW_TOPIC: no page ${view}`)
      if (topicById(id ?? null) === null) problems.push(`VIEW_TOPIC ${view}: no guide ${id}`)
    }

    expect(problems).toEqual([])
  })

  it('cover every page: opening help from it shows a guide (the main menu shows the index)', () => {
    const uncovered = VIEWS.filter(view => view.id !== 'menu' && VIEW_TOPIC[view.id] === undefined).map(view => view.id)

    expect(uncovered).toEqual([])
  })

  it('are brief: a short summary, at most seven steps, no step a wall of text', () => {
    for (const topic of TOPICS) {
      expect(topic.summary.length, `${topic.id} summary`).toBeLessThanOrEqual(90)
      expect(topic.steps.length, `${topic.id} steps`).toBeGreaterThan(0)
      expect(topic.steps.length, `${topic.id} steps`).toBeLessThanOrEqual(7)
      for (const step of topic.steps) expect(step.text.length, `${topic.id}: ${step.text.slice(0, 30)}`).toBeLessThanOrEqual(320)
    }
  })
})

describe('ruHelp finds the guide a person means', () => {
  const best = (question: string): string | undefined => searchDocs(TOPICS, question)[0]?.topic.id

  it.each([
    ['how do I start a swarm', 'swarm'],
    ['can claude control the console for me', 'control'],
    ['what does auto confirm do for claude control', 'control'],
    ['how do I set a budget', 'cost'],
    ['what is a claim', 'claims'],
    ['how do I connect codex', 'connect'],
    ['something is broken', 'troubleshoot'],
    ['join the federation', 'federation'],
    ['install a plugin', 'plugins'],
    ['scan for secrets', 'security'],
    ['why is it so expensive', 'cost'],
    ['how do I update the console', 'updates'],
    ['what is the difference between a skill and mcp', 'concepts'],
    ['what are the keyboard shortcuts', 'keys'],
    ['how do I know it works', 'verify'],
    ['run a mission', 'mission'],
  ])('“%s” → %s', (question, id) => {
    expect(best(question)).toBe(id)
  })

  it('answers nothing for an empty or all-filler question, and ranks best first', () => {
    expect(searchDocs(TOPICS, '')).toEqual([])
    expect(searchDocs(TOPICS, 'how do i the')).toEqual([])

    const hits = searchDocs(TOPICS, 'swarm agents')

    expect(hits.map(hit => hit.score)).toEqual([...hits.map(hit => hit.score)].sort((a, b) => b - a))
  })
})

describe('the prompt for asking Claude with the docs', () => {
  const hits = searchDocs(TOPICS, 'start a swarm', 2)

  it('puts the guides behind │ as data, and keeps the question on one line, cut to length', () => {
    const prompt = helpPrompt(`start\na swarm /exit ${'x'.repeat(400)}`, hits)
    const lines = prompt.split('\n')
    const guideLines = lines.filter(line => line.startsWith('│ '))

    expect(guideLines.length).toBeGreaterThan(2)
    expect(lines.filter(line => line.startsWith('Question: ')).length).toBe(1)
    // The whole question rides in (ADR-481): nothing is cut.
    expect(lines.find(line => line.startsWith('Question: '))?.length).toBeGreaterThan(400)
    expect(lines.filter(line => !line.startsWith('│ ') && line.startsWith('/'))).toEqual([])
    expect(prompt).toContain(topicText(hits[0]!.topic).split('\n')[0]!)
  })
})

describe('ruHelp actions', () => {
  const setup = () => {
    const state = newState({})
    const asked: { label: string; shows?: string; run?: () => Promise<void> }[] = []
    const sent: string[] = []
    const calls: string[] = []
    const host = { invalidate: () => undefined, submitPrompt: async (text: string) => void sent.push(text), fillPrompt: async () => undefined } as never
    const runner = { ask: (spec: { label: string; shows?: string; run?: () => Promise<void> }) => void asked.push(spec) } as never
    const act = { view: (id: string) => calls.push(`view ${id}`), run: (id: string) => calls.push(`run ${id}`), start: (id: string) => calls.push(`start ${id}`) } as never

    mcOf(state).isScreenOn = false

    return { state, asked, sent, calls, actions: helpActions(state, host, runner, () => act) }
  }

  it('answers from the guides without asking anything: a question only sets state', () => {
    const { state, asked, sent, actions } = setup()

    actions.query('how do I start a swarm')

    expect(state.help.query).toBe('how do I start a swarm')
    expect(asked).toEqual([])
    expect(sent).toEqual([])
  })

  it('asks Claude only on request, asks first with the exact words, and sends nothing until the ask is confirmed', async () => {
    const { asked, sent, actions } = setup()

    actions.ask('how do I start a swarm')

    expect(asked.length).toBe(1)
    expect(asked[0]?.shows).toContain('how do I start a swarm')
    expect(sent).toEqual([])

    await asked[0]?.run?.()

    expect(sent.length).toBe(1)
    expect(sent[0]).toContain('You are ruHelp')
    expect(sent[0]).toContain('│ ')
  })

  it('does not ask on an empty question, and a step button goes to a page, runs an entry or starts one', () => {
    const { asked, calls, actions } = setup()

    actions.ask('   ')
    expect(asked).toEqual([])

    actions.go({ view: 'swarm' })
    actions.go({ run: 'mem-stats' })
    actions.go({ start: 'init' })
    expect(calls).toEqual(['view swarm', 'run mem-stats', 'start init'])
  })
})

describe('the Help page', () => {
  const calls: string[] = []
  const recorder = (path: string): unknown =>
    new Proxy(() => undefined, {
      get: (_t, key) => (key === 'then' ? undefined : recorder(`${path}.${String(key)}`)),
      apply: (_t, _this, args) => void calls.push(`${path.slice(1)}(${args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(',')})`),
    })
  const kit = { Box: (props: Record<string, unknown>): El => ({ props }), Text: (props: Record<string, unknown>): El => ({ props }), Button: (props: Record<string, unknown>): El => ({ props }), Input: (props: Record<string, unknown>): El => ({ props }) }
  const draw = (mutate: (state: State) => void = () => undefined, columns = 110): El => {
    const state = newState({})

    state.isHelp = true
    mutate(state)

    return helpView({ kit, state, nowMs: Date.now(), columns, pictures: new Map(), act: recorder('') as never, cards: true } as unknown as Ctx) as unknown as El
  }
  const flat = (el: unknown): El[] => {
    const node = el as El

    if (typeof node !== 'object' || node === null) return []

    const kids = node.props.children

    return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
  }
  const words = (el: unknown): string => flat(el).map(node => String(node.props.children ?? '')).join('\n')
  const keyed = (el: unknown, key: string): El | undefined => flat(el).find(node => node.props.key === key)

  it('shows the ruHelp field, a start-here path of three guides, and every group, with Start open', () => {
    const tree = draw()
    const text = words(tree)

    expect(keyed(tree, 'help-input')).toBeDefined()
    expect(text).toContain('Start here')
    for (const id of ['tour', 'setup', 'mission']) expect(keyed(tree, `help-start-${id}`), id).toBeDefined()
    expect(keyed(tree, 'help-topic-concepts')).toBeDefined()
  })

  it('answers a typed question with the best guide, its first steps, and a way to ask Claude', () => {
    calls.length = 0

    const tree = draw(state => (state.help.query = 'how do I set a budget'))

    expect(words(tree)).toContain('Set a budget and watch spend')
    expect(keyed(tree, 'help-open-cost')).toBeDefined()

    ;(keyed(tree, 'help-ask-claude')?.props.onPress as () => void)()
    expect(calls).toEqual(['ruhelp.ask()'])
  })

  it('says so when no guide matches, and still offers Claude', () => {
    const tree = draw(state => (state.help.query = 'zzzqqq xxxyyy'))

    expect(words(tree)).toContain('could not find a guide')
    expect(keyed(tree, 'help-ask-claude')).toBeDefined()
  })

  it('shows one guide whole, with a button on each step that has a target, and a way back', () => {
    calls.length = 0

    const tree = draw(state => (state.help.topic = 'swarm'))

    expect(words(tree)).toContain('Start a swarm and spawn agents')
    expect(keyed(tree, 'help-go-swarm-0')).toBeDefined()
    expect(keyed(tree, 'help-index')).toBeDefined()

    ;(keyed(tree, 'help-go-swarm-1')?.props.onPress as () => void)()
    expect(calls).toEqual(['ruhelp.go({"start":"spawn-coder"})'])
  })

  it('wraps long steps instead of running them off the edge, at any width', () => {
    for (const columns of [50, 80, 120]) {
      const tree = draw(state => (state.help.topic = 'connect'), columns)
      const longest = Math.max(...flat(tree).flatMap(node => (typeof node.props.children === 'string' ? [node.props.children.length] : [])))

      expect(longest, `${columns} columns`).toBeLessThanOrEqual(columns)
    }

    expect(wrap('a bb ccc dddd', 6)).toEqual(['a bb', 'ccc', 'dddd'])
  })
})

describe('the guides\' text', () => {
  it('keeps the cost tags as written: $0, cpu, net, $$ (a string replace once collapsed $$ to $)', () => {
    const all = TOPICS.flatMap(topic => [topic.summary, ...topic.steps.map(step => step.text), ...(topic.tips ?? [])]).join('\n')

    expect(all).toContain('$0, cpu, net, $$.')
    expect(all).toContain('$$ may spend')
  })
})
