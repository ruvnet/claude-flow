/**
 * Cards and the grouped nav, pure: a column that holds section headers is regrouped into one bordered card per header, the blank
 * spacer above a header is dropped, a column with no header is left alone, and every view but the menu is in exactly one nav group.
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/card.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { BOOT_MODULES } from '../hooks/gfx/boot'
import { VIEWS } from '../hooks/state'
import { CARD_COLUMNS, hasCards, withCards } from '../hooks/views/card'
import { HEADS, mark, SPACERS } from '../hooks/views/marks'
import { NAV_GROUPS } from '../hooks/nav-state'

type Made = { type: string; props: { key?: string; flexDirection?: string; borderStyle?: string; children?: unknown[] } }

const kit = { Box: (props: Made['props']) => ({ type: 'Box', props }) as unknown as never, Text: (props: { children: string }) => ({ type: 'Text', props }) as never, Button: (props: object) => ({ type: 'Button', props }) as never }
const cards = withCards(kit as never)
const made = (element: unknown) => element as Made
const text = (children: string) => kit.Text({ children })

describe('cards', () => {
  it('groups the rows of a column into one bordered card per section header', () => {
    const intro = text('intro')
    const headA = mark(HEADS, text('A'))
    const rowA = text('row a')
    const spacer = mark(SPACERS, text(' '))
    const headB = mark(HEADS, text('B'))
    const rowB = text('row b')
    const page = made(cards.Box({ flexDirection: 'column', key: 'page', children: [intro, headA, rowA, spacer, headB, [rowB]] } as never))
    const [first, second, third] = page.props.children as Made[]

    expect(page.props.key).toBe('page')
    expect(page.props.children).toHaveLength(3)
    expect(first).toBe(intro)
    expect(second?.props).toMatchObject({ flexDirection: 'column', borderStyle: 'round' })
    expect(second?.props.children).toEqual([headA, rowA])
    expect(third?.props.children).toEqual([headB, rowB])
    expect(second?.props.key).not.toBe(third?.props.key)
  })

  it('leaves a column with no header, and a row, exactly as it was', () => {
    const plain = { flexDirection: 'column', children: [text('a'), text('b')] }
    const row = { flexDirection: 'row', children: [mark(HEADS, text('A')), text('x')] }

    expect(made(cards.Box(plain as never)).props).toEqual(plain)
    expect(made(cards.Box(row as never)).props).toEqual(row)
  })

  it('draws cards in a page of 44 columns or more, in a compact (short) pane too', () => {
    expect(hasCards(100, false)).toBe(true)
    expect(hasCards(43, false)).toBe(false)
    expect(hasCards(44, false)).toBe(true)
    expect(hasCards(100, true)).toBe(true)
    expect(CARD_COLUMNS).toBe(4)
  })
})

describe('the grouped nav', () => {
  it('has every view but the menu in exactly one group', () => {
    const grouped = NAV_GROUPS.flatMap(group => group.rows.flat())
    const expected = VIEWS.filter(view => view.id !== 'menu').map(view => view.id)

    expect([...grouped].sort()).toEqual([...expected].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('has one boot-log line for every view but the menu, so the boot never leaves an area out', () => {
    expect(BOOT_MODULES).toHaveLength(VIEWS.filter(view => view.id !== 'menu').length)
  })
})
