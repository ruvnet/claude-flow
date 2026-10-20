/**
 * The ask-first confirm is one bordered card in the warning colour: a header, a rule, what is being asked, the exact command, the effect, and
 * the buttons set apart. Layout only: the strings the kit tests read (CONFIRM NEEDED, Confirm: …?, runs: …) are unchanged.
 */
import { describe, expect, it } from 'vitest'

import { newState } from '../hooks/state'
import { confirmRow, THEME, type Ctx } from '../hooks/views/common'

type El = { kind: string; props: Record<string, unknown> }
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
const act = new Proxy({}, { get: () => () => undefined }) as unknown as Ctx['act']
const flat = (node: unknown): El[] => {
  if (typeof node !== 'object' || node === null) return []
  const el = node as El
  const children = el.props.children

  return [el, ...(Array.isArray(children) ? children.flatMap(flat) : flat(children))]
}
const draw = (note?: string, columns = 100): El => {
  const state = newState({ boot: false })

  state.pending = { label: 'start a loop in the main Claude UI: /loop do things', args: ['x'], expect: 'e', askedAtMs: 1, ...(note !== undefined && { note }) }

  return confirmRow({ kit, state, act, columns, nowMs: 1_000, pictures: new Map() } as unknown as Ctx) as unknown as El
}
const texts = (card: El): string[] => flat(card).filter(el => el.kind === 'Text').map(el => String(el.props.children))

describe('the confirm card', () => {
  it('is one round bordered box in the warning colour', () => {
    const card = draw()

    expect(card.kind).toBe('Box')
    expect(card.props).toMatchObject({ key: 'confirm', borderStyle: 'round', borderColor: THEME.warn })
  })

  it('keeps the strings the kit tests read, and puts a rule under the header', () => {
    const lines = texts(draw('Starts a recurring loop; edits nothing.'))

    expect(lines).toContain('▶ CONFIRM NEEDED')
    expect(lines.some(line => line.startsWith('Confirm: start a loop in the main Claude UI'))).toBe(true)
    expect(lines).toContain('runs: ruflo x')
    expect(lines).toContain('Effect: Starts a recurring loop; edits nothing.')
    expect(lines.some(line => /^─+$/.test(line))).toBe(true)
  })

  it('clips its lines to the width inside the border, and sets the buttons apart', () => {
    const card = draw(undefined, 60)
    const rule = texts(card).find(line => /^─+$/.test(line)) ?? ''
    const buttons = flat(card).filter(el => el.kind === 'Button').map(el => String(el.props.key))
    const buttonBox = flat(card).find(el => el.kind === 'Box' && el.props.marginTop === 1)

    expect(rule.length).toBeLessThanOrEqual(56)
    expect(buttons).toEqual(expect.arrayContaining(['confirm', 'cancel']))
    expect(buttonBox).toBeDefined()
  })

  it('shows a money or model effect in the alarm colour', () => {
    const effect = flat(draw('Spends money on a model turn.')).find(el => el.kind === 'Text' && String(el.props.children).startsWith('Effect:'))

    expect(effect?.props).toMatchObject({ bold: true, color: THEME.bad })
  })
})
