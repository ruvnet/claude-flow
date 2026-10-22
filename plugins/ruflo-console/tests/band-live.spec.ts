/** The band's live signals: how long Claude has been working, the tool-call rhythm of the last ten minutes, and the context window filling. */
import { describe, expect, it } from 'vitest'

import { newState } from '../hooks/state'
import { activityBars, barParts, barView } from '../hooks/views/bar'

const NOW = 100 * 60_000
const tools = (...minutesAgo: number[]) => minutesAgo.map(m => ({ atMs: NOW - m * 60_000 + 1_000, kind: 'tools' as const, text: 'claude: Bash' }))

describe('the working timer', () => {
  it('says how long Claude has been on this turn, only while one runs', () => {
    const state = newState({})

    expect(barParts(state, NOW).some(part => part.text.includes('Claude working'))).toBe(false)

    state.turnActive = true
    state.turnStartedMs = NOW - 41_000
    expect(barParts(state, NOW).find(part => part.text.includes('Claude working'))).toMatchObject({ text: '▶ Claude working 41s', tone: 'live', go: 'events' })

    state.turnActive = false
    expect(barParts(state, NOW).some(part => part.text.includes('Claude working'))).toBe(false)
  })

  it('does not count a turn that has no start time (a band opened mid-turn)', () => {
    const state = newState({})

    state.turnActive = true
    expect(barParts(state, NOW).some(part => part.text.includes('Claude working'))).toBe(false)
  })
})

describe('the activity sparkline', () => {
  it('draws one bar a minute over the last ten, oldest left, tallest where most calls fell', () => {
    // A call "m minutes ago" lands in bar 10 - m (m = 10 is the oldest bar, m = 1 the newest): 1 call in bar 1, 6 in bar 5, 3 in bar 9.
    const bars = Array.from(activityBars([...tools(9), ...tools(5, 5, 5, 5, 5, 5), ...tools(1, 1, 1)], NOW) ?? '')

    expect(bars).toHaveLength(10)
    expect(bars.map((bar, i) => (bar === '·' ? '' : String(i))).filter(Boolean)).toEqual(['1', '5', '9'])
    expect(bars[5]).toBe('█')
    expect(bars[1]).not.toBe('█')
    expect(bars[9]).not.toBe('█')
  })

  it('stays silent for a blip, other events, and calls outside the window', () => {
    expect(activityBars(tools(2, 3), NOW)).toBeNull()
    expect(activityBars(Array.from({ length: 8 }, () => ({ atMs: NOW - 1_000, kind: 'swarm', text: 'x' })), NOW)).toBeNull()
    expect(activityBars(tools(11, 12, 13, 14), NOW)).toBeNull()
  })

  it('is a standing part with a short form for a narrow band', () => {
    const state = newState({})

    state.events = [...tools(4, 3, 2, 1)]

    const part = barParts(state, NOW).find(candidate => candidate.text.endsWith('tool calls, 10m'))

    expect(part).toMatchObject({ tone: 'plain', go: 'events', row: 'standing' })
    expect(part?.compact).toHaveLength(10)
  })
})

describe('the context gauge', () => {
  const part = (percent: number | undefined) => {
    const state = newState({})

    state.usage = percent === undefined ? null : { contextPercent: percent }

    return barParts(state, NOW).find(candidate => candidate.text.startsWith('ctx'))
  }

  it('is quiet below 60%, plain to 79%, amber from 80%, and says so when it is time to compact', () => {
    expect(part(undefined)).toBeUndefined()
    expect(part(59.9)).toBeUndefined()
    expect(part(62)).toMatchObject({ text: 'ctx 62%', tone: 'plain', row: 'standing', compact: 'ctx 62%' })
    expect(part(82)).toMatchObject({ text: 'ctx 82%', tone: 'attention' })
    expect(part(91)).toMatchObject({ text: 'ctx 91% · /compact soon', tone: 'attention', compact: 'ctx 91%' })
  })
})

describe('the standing row', () => {
  type El = { kind: string; props: Record<string, unknown> }
  const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
  const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
  const flat = (node: unknown): El[] => (Array.isArray(node) ? node.flatMap(flat) : node !== null && typeof node === 'object' ? [node as El, ...flat((node as El).props.children)] : [])
  const rowsOf = (state: ReturnType<typeof newState>, columns: number): string[] =>
    flat(barView(kit as never, state, columns, null, () => undefined, () => undefined))
      .filter(el => el.kind === 'Box' && el.props.flexDirection === 'row')
      .map(box => flat(box.props.children).filter(el => el.kind === 'Text' || el.kind === 'Button').map(el => String(el.props.children ?? el.props.label)).join(''))

  it('starts with its marker and its first fact, with no doubled separator, and shows the live signals', () => {
    const state = newState({})

    state.usage = { costUsd: 397, contextPercent: 83 }
    // barView reads the real clock, so the calls are dated from now.
    state.events = [5, 4, 3, 2, 1].map(m => ({ atMs: Date.now() - m * 60_000 + 1_000, kind: 'tools' as const, text: 'claude: Bash' }))

    const standing = rowsOf(state, 150)[1] ?? ''

    expect(standing).toMatch(/^↳ \S/)
    expect(standing).not.toMatch(/^↳ {2}/)
    expect(standing).toContain('tool calls, 10m')
    expect(standing).toContain('$397 this session · ctx 83%')
  })
})
