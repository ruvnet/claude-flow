/**
 * The main menu wraps at small widths: no text and no row of it is wider than the pane, at any width from 30 to 120 columns (the mission
 * strip's stage line wraps; the status bar drops its modem text before it overflows). Run with
 *   npx vitest run plugins/ruflo-console/tests/menu-wrap.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { newState } from '../hooks/state'
import { setLook, type Ctx } from '../hooks/views/common'
import { GROUPS, menuView } from '../hooks/views/menu'
import { wrap } from '../hooks/views/common'

type El = { props: Record<string, unknown>; kind: string }

const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input'), Raster: make('Raster') }
const act = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy
})() as never

/** How wide an element draws: a row is the sum of its parts, a column its widest part, a button its label and a gap. */
function widthOf(el: unknown): number {
  const node = el as El

  if (typeof node !== 'object' || node === null) return 0

  const kids = node.props.children

  if (node.kind === 'Button') return String(node.props.label).length + 1
  if (typeof kids === 'string') return kids.length
  if (Array.isArray(kids)) return node.props.flexDirection === 'row' ? kids.reduce((sum: number, kid) => sum + widthOf(kid), 0) : Math.max(0, ...kids.map(widthOf))

  return kids === undefined ? 0 : widthOf(kids)
}

/** Every row and text in the tree wider than `columns`, as a short description. */
function overflow(columns: number): string[] {
  const state = newState({})

  state.options.look = 'bbs'
  state.view = 'menu'
  setLook('bbs')

  const found: string[] = []
  const walk = (el: unknown): void => {
    const node = el as El

    if (typeof node !== 'object' || node === null) return

    // A box with its own width clips what is inside it (the group cards): they are checked by their own widths below.
    if (node.kind === 'Text' || node.props.flexDirection === 'row') {
      const width = widthOf(node)

      if (width > columns) found.push(`${width} > ${columns}: ${String(node.props.key ?? (typeof node.props.children === 'string' ? node.props.children.slice(0, 24) : node.kind))}`)
    }

    const kids = node.props.children

    if (Array.isArray(kids)) kids.forEach(walk)
    else if (typeof kids === 'object') walk(kids)
  }

  walk(menuView({ kit, state, nowMs: 5_000, columns, pictures: new Map(), act, cards: false } as unknown as Ctx))

  return found
}

/** Every string the menu draws, joined: what a person can read of it. */
function readable(columns: number): string {
  const state = newState({})

  state.options.look = 'bbs'
  state.view = 'menu'
  setLook('bbs')

  const out: string[] = []
  const walk = (el: unknown): void => {
    const node = el as El

    if (typeof node !== 'object' || node === null) return

    const kids = node.props.children

    if (typeof kids === 'string') out.push(kids)
    else if (Array.isArray(kids)) kids.forEach(walk)
    else if (typeof kids === 'object') walk(kids)
  }

  walk(menuView({ kit, state, nowMs: 5_000, columns, pictures: new Map(), act, cards: false } as unknown as Ctx))

  return out.join('\n')
}

afterEach(() => setLook('plain'))

describe('the main menu at small widths', () => {
  it('has no text or row wider than the pane, at any width from 30 to 120 columns', () => {
    const problems: string[] = []

    for (let columns = 30; columns <= 120; columns++) problems.push(...overflow(columns).map(problem => `${columns} columns: ${problem}`))

    expect(problems).toEqual([])
  })

  it('wraps the mission stages instead of cutting them off: every stage is readable at every width', () => {
    for (let columns = 30; columns <= 120; columns++) {
      const text = readable(columns)

      for (const stage of ['research', 'create', 'build', 'test', 'validate', 'secure', 'benchmark', 'learn']) expect(text, `${columns} columns: ${stage}`).toContain(stage)
      expect(text, `${columns} columns`).not.toContain('SOP…')
    }
  })

  it('wraps the stage line into several lines when the pane is narrow, and keeps every stage', () => {
    expect(wrap('research → create (ADRs, SOP) → build → test → validate → secure → benchmark → learn', 30).length).toBeGreaterThan(2)
    expect(wrap('research → create (ADRs, SOP) → build → test → validate → secure → benchmark → learn', 30).join(' ')).toContain('benchmark → learn')
  })
})

const GROUP_COUNT = GROUPS.length

describe('the menu folds, and narrow panes keep their styling', () => {
  const calls: string[] = []
  const recorder = (path: string): unknown =>
    new Proxy(() => undefined, {
      get: (_t, key) => (key === 'then' ? undefined : recorder(`${path}.${String(key)}`)),
      apply: (_t, _this, args) => void calls.push(`${path.slice(1)}(${args.join(',')})`),
    })
  const draw = (columns: number, folded: string[] = []): { tree: El; text: string } => {
    const state = newState({})

    state.options.look = 'bbs'
    state.view = 'menu'
    for (const key of folded) state.sections.add(key)
    setLook('bbs')

    const tree = menuView({ kit, state, nowMs: 5_000, columns, pictures: new Map(), act: recorder('') as never, cards: false } as unknown as Ctx) as unknown as El
    const strings: string[] = []
    const walk = (el: unknown): void => {
      const node = el as El

      if (typeof node !== 'object' || node === null) return

      const kids = node.props.children

      if (typeof kids === 'string') strings.push(kids)
      else if (Array.isArray(kids)) kids.forEach(walk)
      else if (typeof kids === 'object') walk(kids)
    }

    walk(tree)

    return { tree, text: strings.join('\n') }
  }
  const flat = (el: unknown): El[] => {
    const node = el as El

    if (typeof node !== 'object' || node === null) return []

    const kids = node.props.children

    return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
  }
  const entries = (tree: El): number => flat(tree).filter(node => String(node.props.key).startsWith('menu-go-')).length

  it('opens every group on a wide pane, and only the first on a narrow one', () => {
    const wide = draw(100)
    const narrow = draw(50)

    expect(entries(narrow.tree)).toBeGreaterThan(0)
    expect(entries(wide.tree)).toBeGreaterThan(entries(narrow.tree))
    expect(narrow.text).toContain('entries · ▸ opens')
    expect(wide.text).not.toContain('entries · ▸ opens')
  })

  it('folds an open group and opens a closed one when its ▾ / ▸ is pressed (the section state is the toggle)', () => {
    calls.length = 0

    const { tree } = draw(100)
    const fold = flat(tree).find(node => String(node.props.key).startsWith('menu-fold-') && !String(node.props.key).includes('all'))

    ;(fold?.props.onPress as () => void)()
    expect(calls[0]).toMatch(/^toggle\(menu\//)

    // The toggled group is folded on a wide pane, and opened on a narrow one.
    const title = String(fold?.props.key).replace('menu-fold-', '')

    expect(entries(draw(100, [`menu/${title}`]).tree)).toBeLessThan(entries(draw(100).tree))
    expect(entries(draw(50, GROUPS.map(group => `menu/${group.title}`)).tree)).toBeGreaterThan(entries(draw(50).tree))
  })

  it('expand all and collapse all toggle only the groups that need it', () => {
    calls.length = 0

    const wide = draw(100)

    ;(flat(wide.tree).find(node => node.props.key === 'menu-expand-all')?.props.onPress as () => void)()
    expect(calls).toEqual([])
    ;(flat(wide.tree).find(node => node.props.key === 'menu-collapse-all')?.props.onPress as () => void)()
    expect(calls.length).toBe(GROUP_COUNT)
  })

  it('keeps its colours when very narrow: the page is a solid chip in its group accent', async () => {
    const { paneView } = await import('../hooks/views/pane')
    const state = newState({})

    state.options.look = 'bbs'
    state.options.boot = false
    state.view = 'swarm'
    state.snapshot = null

    const tree = paneView({ kit, state, nowMs: 5_000, columns: 40, pictures: new Map(), act: recorder('') as never, cards: false } as unknown as Ctx) as unknown as El
    const chip = flat(tree).find(node => node.props.inverse === true && String(node.props.children).includes('Swarm'))

    expect(chip).toBeDefined()
    expect(chip?.props.color).toMatch(/^#/)
  })
})

describe('the menu\'s sub-sections', () => {
  const pages = GROUPS.flatMap(group => group.sections.flatMap(section => section.items.map(item => item.go)))

  const flat = (el: unknown): El[] => {
    const node = el as El

    if (typeof node !== 'object' || node === null) return []

    const kids = node.props.children

    return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
  }

  it('list every page once: nothing repeats across the cards', () => {
    expect(new Set(pages).size).toBe(pages.length)
    for (const key of ['overview', 'missions', 'swarm', 'settings']) expect(pages, key).toContain(key)
  })

  it('earn their rule: a card with one section has no rule of its own, and a card with several has at least two entries in each', () => {
    for (const group of GROUPS) {
      if (group.sections.length > 1) for (const section of group.sections) expect(section.items.length, `${group.title}/${section.name}`).toBeGreaterThanOrEqual(2)
    }

    const state = newState({})

    state.options.look = 'bbs'
    state.view = 'menu'
    setLook('bbs')

    const tree = menuView({ kit, state, nowMs: 5_000, columns: 100, pictures: new Map(), act, cards: false } as unknown as Ctx) as unknown as El
    const rules = flat(tree).filter(node => typeof node.props.children === 'string' && node.props.children.startsWith('── '))
    const wanted = GROUPS.filter(group => group.sections.length > 1).reduce((sum, group) => sum + group.sections.length, 0)

    expect(rules.length).toBe(wanted)
  })
})
