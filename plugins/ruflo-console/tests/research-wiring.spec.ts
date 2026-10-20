import { describe, expect, it } from 'vitest'

import { filterPalette, paletteEntries } from '../hooks/palette'
import { newState } from '../hooks/state'
import type { Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'

const shown = (view: 'missions' | 'settings') => viewText({ state: newState({}), nowMs: 5, columns: 110, act: {} as Actions }, view)

describe('the research and loop wiring on the pages', () => {
  it('Missions draws the deep research form with its depth and cap choices and the warning', () => {
    const text = shown('missions')

    expect(text).toContain('Deep research')
    for (const word of ['quick', 'standard', 'deep', 'Start research', 'Bills a Claude turn']) expect(text).toContain(word)
    for (const cap of ['1', '2', '5', '10']) expect(text).toMatch(new RegExp(`[●○] ${cap} `))
  })

  it('Settings lists every loop row, so the loop approach is a setting and not only prose', () => {
    const text = viewText({ state: newState({}), nowMs: 5, columns: 110, act: {} as Actions }, 'settings')

    for (const title of ['Mission loop interval', 'Worktree per writer', 'Loop may commit', 'Loop may push', 'Loop may publish', 'Max concurrent writers']) expect(text, title).toContain(title)
  })

  it('the palette finds the research start by its words, and it runs the typed draft (not text after a keyword)', () => {
    const all = paletteEntries(newState({}), 1)

    expect(filterPalette(all, 'research', 'all').map(entry => entry.id)).toContain('mission-research')
    expect(all.find(entry => entry.id === 'mission-research')?.run.kind).not.toBe('text')
  })
})
