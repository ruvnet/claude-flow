/**
 * The footer's fit and the mission strip's words, pure. Run with
 *   npx vitest run plugins/ruflo-console/tests/footer-layout.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { buttonWidth, fitFooter, type FooterItem } from '../hooks/footer-layout'

const ITEMS: FooterItem[] = [
  { id: 'palette', full: 'Palette', short: 'p', priority: 1 },
  { id: 'actions', full: 'Actions', short: 'x', priority: 5 },
  { id: 'ask', full: '✦ Ask Claude', short: '✦', priority: 2 },
  { id: 'slash', full: '▸ /ruflo-swarm:swarm', short: '▸', priority: 7 },
  { id: 'refresh', full: 'Refresh', short: 'r', priority: 6 },
  { id: 'help', full: 'Help', short: 'h', priority: 3 },
  { id: 'close', full: 'Close', short: '×', priority: 4 },
]
const full = ITEMS.reduce((sum, item) => sum + buttonWidth(item.full), 0)

describe('the footer fit', () => {
  it('shows every button in full when there is room, with room left for the status', () => {
    const fit = fitFooter(ITEMS, full + 30)

    expect(fit.shown.map(entry => entry.id)).toEqual(ITEMS.map(item => item.id))
    expect(fit.shown.every(entry => !entry.isShort)).toBe(true)
    expect(fit.hidden).toEqual([])
    expect(fit.used).toBe(full)
  })

  it('shortens the least important first and keeps the most important in full', () => {
    const fit = fitFooter(ITEMS, full - 5 + 10)
    const shortened = fit.shown.filter(entry => entry.isShort).map(entry => entry.id)

    expect(shortened).toContain('slash')
    expect(fit.shown.find(entry => entry.id === 'palette')?.isShort).toBe(false)
    expect(fit.used).toBeLessThanOrEqual(full - 5)
  })

  it('never uses more than the room it was given, at any width', () => {
    for (let room = 0; room <= full + 40; room++) {
      const fit = fitFooter(ITEMS, room)

      expect(fit.used, `room ${room}`).toBeLessThanOrEqual(Math.max(0, room - 10))
      expect(fit.shown.length + fit.hidden.length, `room ${room}`).toBe(ITEMS.length)
    }
  })

  it('drops from the least important up once even the short forms do not fit, keeping the first buttons', () => {
    const fit = fitFooter(ITEMS, 10 + buttonWidth('p') + buttonWidth('✦'))

    expect(fit.shown.map(entry => entry.id)).toEqual(['palette', 'ask'])
    expect(fit.hidden.sort()).toEqual(['actions', 'close', 'help', 'refresh', 'slash'])
  })

  it('hides everything when there is no room, and every dropped button is named so its hotkey can be kept', () => {
    const fit = fitFooter(ITEMS, 4)

    expect(fit.shown).toEqual([])
    expect(fit.hidden.sort()).toEqual(ITEMS.map(item => item.id).sort())
  })

  it('keeps the order it was given', () => {
    // Four short buttons fit: the four of highest priority (palette, ask, help, close), drawn in the order given.
    expect(fitFooter(ITEMS, 10 + 4 * buttonWidth('p')).shown.map(entry => entry.id)).toEqual(['palette', 'ask', 'help', 'close'])
  })
})
