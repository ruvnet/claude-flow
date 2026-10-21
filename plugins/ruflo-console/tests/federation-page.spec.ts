import { describe, expect, it } from 'vitest'

import { newState, type State } from '../hooks/state'
import type { Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'

const shown = (state: State, columns = 60) => viewText({ state, nowMs: 5, columns, act: {} as Actions }, 'federation')

describe('the Federation page map', () => {
  it('says why the map is empty, and keeps its legend on lines short enough for a narrow pane', () => {
    const text = shown(newState({}))

    expect(text).toContain('Nothing to draw yet')
    expect(text).toContain('solid')
    expect(text).toContain('dashed')
    expect(text).toContain('roster member: sparse, unvetted')
    for (const line of text.split('\n')) if (/solid|sparse/.test(line)) expect(line.length, line).toBeLessThanOrEqual(60)
  })

  it('does not say the map is empty once there is a key to draw', () => {
    const state = newState({})

    state.snapshot = { federationNodes: ['hub-1', 'worker-a'], hasNostrKey: true, plugins: { installed: [] } } as unknown as State['snapshot']
    expect(shown(state)).not.toContain('Nothing to draw yet')
  })
})
