/**
 * The menu's design carried through the pages, without the Claude Code test kit: a fake kit records what is drawn. A cost tag is a solid
 * chip in the BBS look and coloured text in the plain one; the nav's open page and group are solid chips in the page's accent, and its
 * page buttons carry the same badges as the menu, without ever pushing a row past its width. Run with
 *   npx vitest run plugins/ruflo-console/tests/design.spec.ts
 */
import { afterEach, describe, expect, it } from 'vitest'

import { COST_CHIP, NAV_ACCENT } from '../hooks/menu-colors'
import { newState, type State, type ViewId } from '../hooks/state'
import { CARD_COLUMNS } from '../hooks/views/card'
import { setLook, tagChip, THEME, type Actions, type Ctx } from '../hooks/views/common'
import { menuView } from '../hooks/views/menu'
import { missionStrip } from '../hooks/views/mission-control'
import { groupedTabs } from '../hooks/views/nav'

type El = { kind: string; props: Record<string, unknown> }

const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }), Input: (props: Record<string, unknown>): El => ({ kind: 'Input', props }) }
const act: Actions = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy as Actions
})()
const ctxOf = (state: State, columns = 120): Ctx => ({ kit, state, nowMs: 5_000, columns, pictures: new Map(), act, cards: true }) as unknown as Ctx
const flat = (el: unknown): El[] => {
  const node = el as El

  if (typeof node !== 'object' || node === null) return []

  const kids = node.props.children

  return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
}
const texts = (el: unknown): El[] => flat(el).filter(node => node.kind === 'Text')
const tab = (el: unknown, view: ViewId): El | undefined => flat(el).find(node => node.props.key === `tab-${view}`)

afterEach(() => setLook('plain'))

describe('a cost tag', () => {
  const chip = (color: string): El => tagChip(ctxOf(newState({})), ' $0 ', color) as unknown as El

  it('is a solid chip in the BBS look, on a ground by how much the run asks', () => {
    setLook('bbs')

    for (const [color, ground] of [[THEME.ok, COST_CHIP.ok], [THEME.info, COST_CHIP.info], [THEME.warn, COST_CHIP.warn], [THEME.bad, COST_CHIP.bad]] as const) {
      const shown = texts(chip(color)).find(node => node.props.inverse === true)

      expect(shown?.props, color).toMatchObject({ color: ground, inverse: true, bold: true, children: ' $0 ' })
    }
  })

  it('stays coloured text in the plain look, as it always was, and a colour that is none of the four is text in either', () => {
    setLook('plain')
    expect(chip(THEME.ok)).toMatchObject({ kind: 'Text', props: { color: THEME.ok, children: '  $0 ' } })
    expect(flat(chip(THEME.ok)).some(node => node.props.backgroundColor !== undefined || node.props.inverse === true)).toBe(false)

    setLook('bbs')
    expect(chip(THEME.head)).toMatchObject({ kind: 'Text' })
  })
})

describe('the nav card', () => {
  const open = (view: ViewId, columns = 120, mutate: (state: State) => void = () => undefined): { card: El; state: State } => {
    const state = newState({})

    state.view = view
    mutate(state)

    return { card: groupedTabs(ctxOf(state, columns), () => true) as unknown as El, state }
  }

  it('draws the open page as a solid chip in its group\'s accent in the BBS look, and as text in the plain one', () => {
    setLook('bbs')

    const bbs = tab(open('secure').card, 'secure')
    const chipText = texts(bbs).find(node => String(node.props.children).includes('SECURITY & DOCTOR'))

    expect(chipText?.props).toMatchObject({ color: NAV_ACCENT.SAFETY, inverse: true, bold: true, children: '[u: 🔒 SECURITY & DOCTOR]' })

    setLook('plain')

    const plain = texts(tab(open('secure').card, 'secure')).find(node => String(node.props.children).includes('Security & Doctor'))

    expect(plain?.props.backgroundColor).toBeUndefined()
    expect(plain?.props.inverse).toBeUndefined()
    expect(plain?.props.children).toBe('u: 🔒 Security & Doctor')
  })

  it('draws the open group as a solid chip in its accent', () => {
    setLook('bbs')

    const group = texts(open('secure').card).find(node => String(node.props.children).includes('SAFETY ▾'))

    expect(group?.props).toMatchObject({ color: NAV_ACCENT.SAFETY, inverse: true })
  })

  it('puts the menu\'s badges on the page buttons: spend on Cost, an update on Settings', () => {
    const cost = open('secure', 140, state => {
      state.usage = { costUsd: 19.81 }
    })
    const settings = open('terminal', 140, state => {
      state.updateAvailable = '0.27.0'
    })

    expect(String(tab(cost.card, 'cost')?.props.label)).toContain('$19.81')
    expect(String(tab(settings.card, 'settings')?.props.label)).toContain('⬆ 0.27.0')
    // And none where there is nothing to say.
    expect(String(tab(open('secure', 140).card, 'cost')?.props.label)).not.toMatch(/\$\d/)
  })

  it('never lets a badge push a row of pages past the width, at any width the nav draws', () => {
    // Every width, not a few: the auto form is chosen by whether the widest row fits, so an uncounted badge only overruns in the narrow
    // window of widths where that choice is on the edge.
    for (const view of ['learning', 'secure', 'swarm', 'settings', 'federation'] as const) for (let columns = 44; columns <= 200; columns++) {
      const { card } = open(view, columns, state => {
        state.usage = { costUsd: 1234.5 }
        state.updateAvailable = '10.20.30'
      })
      const inner = columns - CARD_COLUMNS

      for (const row of flat(card).filter(node => String(node.props.key).startsWith('tabs-row-'))) {
        // A button draws its label with a space of gap beside it, and the engine puts "k: " in front of one that has a hotkey.
        const used = flat(row).reduce((sum, node) => sum + (node.kind === 'Button' ? String(node.props.label).length + (node.props.hotkey === undefined ? 0 : 3) + 1 : node.kind === 'Text' && typeof node.props.children === 'string' ? node.props.children.length + 1 : 0), 0)

        expect(used, `${columns} columns, ${String(row.props.key)}`).toBeLessThanOrEqual(inner)
      }
    }
  })
})

describe('a chip cannot vanish', () => {
  it('is drawn inverse, never in a fixed colour on an explicit background, so it stays there if the host does not draw that background', () => {
    setLook('bbs')

    const state = newState({})

    state.view = 'menu'

    const trees: unknown[] = [menuView(ctxOf(state, 120)), groupedTabs(ctxOf(state, 120), () => true), ...missionStrip(ctxOf(state, 120)), tagChip(ctxOf(state), ' $0 ', THEME.ok), tagChip(ctxOf(state), ' $$ ', THEME.bad)]

    for (const tree of trees) {
      for (const node of texts(tree)) expect(node.props.backgroundColor, String(node.props.children)).toBeUndefined()
    }

    // And there are chips to be checked: the menu's group bars and key chips, the nav's open page and group, the cost tags.
    expect(trees.flatMap(texts).filter(node => node.props.inverse === true).length).toBeGreaterThan(10)
  })
})

describe('the nav card on the main menu', () => {
  const draw = (pick: boolean): El => {
    const state = newState({})

    state.view = 'menu'
    if (pick) state.navPick = { group: 'MIND', view: 'menu' }
    setLook('bbs')

    return groupedTabs(ctxOf(state, 100), () => true) as unknown as El
  }
  const rows = (card: El): El[] => flat(card).filter(node => String(node.props.key).startsWith('tabs-row-'))

  it('has no row of pages while idle (the cards below list them), and shows a group\'s pages once it is picked', () => {
    expect(rows(draw(false))).toEqual([])
    expect(flat(draw(false)).some(node => node.props.key === 'nav-group-SWARM')).toBe(true)

    const picked = rows(draw(true))

    expect(picked.length).toBeGreaterThan(0)
    expect(flat(picked[0]).some(node => node.props.key === 'tab-learning')).toBe(true)
  })

  it('offers a ✕ beside the chips once a group is picked, which closes its pages again, and none while idle', () => {
    expect(flat(draw(false)).some(node => node.props.key === 'nav-pick-close')).toBe(false)

    const close = flat(draw(true)).find(node => node.props.key === 'nav-pick-close')

    expect(close).toBeDefined()
  })

  it('puts the ✕ on the search line in a narrow card, so the chips keep their row, and beside the chips in a wide one', () => {
    const where = (columns: number): string => {
      const state = newState({})

      state.view = 'menu'
      state.navPick = { group: 'MIND', view: 'menu' }
      setLook('bbs')

      const card = groupedTabs(ctxOf(state, columns), () => true) as unknown as El
      const holder = flat(card).find(node => Array.isArray(node.props.children) && (node.props.children as El[]).some(child => child?.props?.key === 'nav-pick-close'))

      return String(holder?.props.key)
    }

    expect(where(56)).toBe('tabs-find')
    expect(where(140)).toBe('tabs-groups')
  })

  it('keeps every page reachable by its key from the menu: they are hidden buttons, not gone', () => {
    const keys = flat(draw(false)).filter(node => String(node.props.key).startsWith('tab-') && node.props.hotkey !== undefined).map(node => String(node.props.key))

    for (const page of ['missions', 'overview', 'swarm', 'hive', 'claims', 'approvals']) expect(keys, page).toContain(`tab-${page}`)
  })
})
