import { describe, expect, it } from 'vitest'

import { VIEWS, viewOf } from '../hooks/state'

/** Keys the footer, the confirm row, the scroll keys and the menu prompt already use. */
const RESERVED = ['p', 'x', 'r', 'h', 'j', 'k', 'y', 'n', 'o']

describe('main nav hotkeys', () => {
  it('every view has one (a single digit or lowercase letter) or none (reached by name), and no two share one', () => {
    // Every letter is a view key or reserved, so Sandbox has no key: it is reached from the menu, the nav or by typing `sandbox`.
    const keys = VIEWS.map(view => view.key).filter(key => key !== '')

    expect(keys.every(key => /^[0-9a-z]$/.test(key))).toBe(true)
    expect(new Set(keys).size).toBe(keys.length)
    expect(VIEWS.filter(view => view.key === '').map(view => view.id)).toEqual(['workflows', 'room', 'sandbox', 'adrs', 'whatsnew'])
  })

  it('none takes a key the footer, the confirm row, scrolling or the menu prompt owns', () => {
    for (const view of VIEWS) expect(RESERVED, view.id).not.toContain(view.key)
  })

  it('the Main Menu is 0 and Missions is 1, the first option after it; the digits run on in order', () => {
    expect(VIEWS[0]?.key).toBe('0')
    expect(VIEWS[1]?.id).toBe('missions')
    expect(VIEWS[1]?.key).toBe('1')
    expect(viewOf('1')).toBe('missions')
    expect(VIEWS.filter(view => /^[0-9]$/.test(view.key)).map(view => view.key)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
  })

  it('a view is reached by its key and by its id', () => {
    for (const view of VIEWS) {
      if (view.key !== '') expect(viewOf(view.key), view.id).toBe(view.id)
      expect(viewOf(view.id), view.id).toBe(view.id)
    }
  })
})
