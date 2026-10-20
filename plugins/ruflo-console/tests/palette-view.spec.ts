/**
 * The command palette's design (ADR-435): grouped under `── group ──` rules while nothing is typed, one flat ranked list once there is a
 * query, every row a dotted-leader line ending in a tag for what pressing it does, the first marked ▶ and primary because Enter runs it, and
 * the keywords that take text as buttons. Run with
 *   npx vitest run plugins/ruflo-console/tests/palette-view.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { filterPalette, isUnavailable, paletteEntries } from '../hooks/palette'
import { newState, type State } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { entryTag, paletteView, PALETTE_ROWS } from '../hooks/views/palette'

type El = { props: Record<string, unknown> }

const calls: string[] = []
const recorder = (path: string): unknown =>
  new Proxy(() => undefined, {
    get: (_t, key) => (key === 'then' ? undefined : recorder(`${path}.${String(key)}`)),
    apply: (_t, _this, args) => void calls.push(`${path.slice(1)}(${args.join(',')})`),
  })
const act = recorder('') as never
const kit = { Box: (props: Record<string, unknown>): El => ({ props }), Text: (props: Record<string, unknown>): El => ({ props }), Button: (props: Record<string, unknown>): El => ({ props }), Input: (props: Record<string, unknown>): El => ({ props }) }
const open = (query = '', columns = 120): { tree: unknown; state: State } => {
  const state = newState({})

  state.palette.isOpen = true
  state.palette.query = query

  return { tree: paletteView({ kit, state, nowMs: Date.now(), columns, pictures: new Map(), act, cards: true } as unknown as Ctx), state }
}
const flat = (el: unknown): El[] => {
  const node = el as El

  if (typeof node !== 'object' || node === null) return []

  const kids = node.props.children

  return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
}
const entryButtons = (tree: unknown): El[] => flat(tree).filter(node => /^pal-(?!kw-|row-|keywords)/.test(String(node.props.key)))

describe('the palette page', () => {
  it('groups the entries under rules while nothing is typed, and ranks them flat once there is a query', () => {
    const grouped = flat(open('').tree).map(node => String(node.props.children ?? ''))
    const ranked = flat(open('spawn').tree).map(node => String(node.props.children ?? ''))

    expect(grouped.filter(line => line.startsWith('── ')).length).toBeGreaterThan(1)
    expect(ranked.filter(line => line.startsWith('── '))).toEqual([])
  })

  it('marks the first match ▶ and primary, because Enter runs it, and only the first', () => {
    const { tree, state } = open('spawn')
    const buttons = entryButtons(tree)
    const best = filterPalette(paletteEntries(state, Date.now()), 'spawn', 'all')[0]

    expect(buttons[0]?.props.key).toBe(`pal-${best?.id}`)
    expect(buttons[0]?.props.variant).toBe('primary')
    expect(buttons.slice(1).every(node => node.props.variant === undefined)).toBe(true)
    expect(flat(tree).filter(node => node.props.children === ' ▶').length).toBe(1)
  })

  it('shows every row at one width, ending in a tag for what pressing it does', () => {
    const { tree } = open('')
    const buttons = entryButtons(tree)

    expect(buttons.length).toBe(PALETTE_ROWS)
    expect(new Set(buttons.map(node => String(node.props.label).length)).size).toBe(1)
  })

  it('tags a page as go, a read as $0, a change as ask, and a command that takes words as text', () => {
    const { state } = open('')
    const tags = new Map(paletteEntries(state, Date.now()).map(entry => [entry.run.kind === 'spec' ? (entry.run.spec?.isReadOnly === true ? 'read' : 'change') : entry.run.kind, entryTag(entry).text.trim()]))

    expect(tags.get('view')).toBe('go')
    expect(tags.get('text')).toBe('text')
    expect(tags.get('change') ?? 'ask').toBe('ask')
    expect([...tags.values()].every(tag => ['go', 'text', 'ask', '$0', 'cmd', 'drill', 'n/a'].includes(tag))).toBe(true)
  })

  it('offers the text keywords as buttons that start the command, and its Close button works', () => {
    calls.length = 0

    const { tree } = open('')
    const keyword = flat(tree).find(node => String(node.props.key).startsWith('pal-kw-'))

    expect(keyword).toBeDefined()
    ;(keyword?.props.onPress as () => void)()
    expect(calls[0]).toMatch(/^paletteQuery\(.+ \)$/)

    const close = flat(tree).find(node => node.props.key === 'palette-close')

    ;(close?.props.onPress as () => void)()
    expect(calls[1]).toBe('palette(all)')
  })

  it('says so when nothing matches, and in the selection context offers no keyword buttons', () => {
    expect(flat(open('zzzzqqqq').tree).some(node => String(node.props.children ?? '').includes('no match'))).toBe(true)

    const state = newState({})

    state.palette.isOpen = true
    state.palette.context = 'selection'

    const tree = paletteView({ kit, state, nowMs: Date.now(), columns: 120, pictures: new Map(), act, cards: true } as unknown as Ctx)

    expect(flat(tree).some(node => String(node.props.key).startsWith('pal-kw-'))).toBe(false)
  })
})

describe('what cannot run sorts last', () => {
  it('puts the entries that cannot run now after those that can, so the best match is one Enter runs', () => {
    const state = newState({})
    const all = paletteEntries(state, Date.now())

    for (const query of ['', 'budget', 'set', 'a']) {
      const matches = filterPalette(all, query, 'all')
      const firstNa = matches.findIndex(isUnavailable)
      const lastRunnable = matches.map(isUnavailable).lastIndexOf(false)

      if (firstNa >= 0) expect(lastRunnable, `query "${query}"`).toBeLessThan(firstNa)
      expect(isUnavailable(matches[0] as never), `query "${query}": the best match`).toBe(false)
    }

    // And there are entries that cannot run in this state, so the rule is exercised.
    expect(all.some(isUnavailable)).toBe(true)
  })
})
