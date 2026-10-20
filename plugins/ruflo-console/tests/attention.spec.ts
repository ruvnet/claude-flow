import { afterEach, describe, expect, it } from 'vitest'

import { newState, type State } from '../hooks/state'
import { setLook, type Ctx } from '../hooks/views/common'
import { paneView } from '../hooks/views/pane'

type El = { kind: string; props: Record<string, unknown> }
const make = (kind: string) => (props: Record<string, unknown>): El => ({ kind, props })
const kit = { Box: make('Box'), Text: make('Text'), Button: make('Button'), Input: make('Input') }
const act = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_target, key) => key === 'then' ? undefined : proxy, apply: () => undefined })

  return proxy
})() as Ctx['act']
const flat = (node: unknown): El[] => {
  if (typeof node !== 'object' || node === null) return []

  const el = node as El
  const children = el.props.children

  return [el, ...(Array.isArray(children) ? children.flatMap(flat) : flat(children))]
}
const keys = (tree: unknown): string[] => flat(tree).filter(el => el.kind === 'Button').map(el => String(el.props.key))
const draw = (state: State, columns: number) => paneView({ kit, state, act, columns, nowMs: 1_000, pictures: new Map() } as unknown as Ctx)
const asking = (origin: string | null): State => {
  const state = newState({ boot: false })

  state.view = 'memory'
  state.origin = origin
  state.memoryLab.origin = 'agentdb'
  state.pending = { view: 'memory', scope: 'mem:agentdb', label: 'consolidate memories', args: ['mcp', 'exec', '-t', 'agentdb_consolidate'], expect: 'the result', askedAtMs: 1_000 }

  return state
}

afterEach(() => setLook('plain'))

describe('an inline ask is always reachable', () => {
  for (const origin of [null, 'mem-lab-mem-consolidate']) {
    for (const columns of [36, 120]) {
      it(`draws one confirm while the memory group is open or folded, origin ${origin}, at ${columns} columns`, () => {
        const state = asking(origin)

        expect(keys(draw(state, columns)).filter(key => key === 'confirm')).toHaveLength(1)
        state.sections.add('memory/mem-g-agentdb')

        const folded = keys(draw(state, columns))

        expect(folded).not.toContain('mem-lab-mem-consolidate')
        expect(folded.filter(key => key === 'confirm')).toHaveLength(1)
        expect(folded.filter(key => key === 'cancel')).toHaveLength(1)
      })
    }
  }

  it('keeps the ask reachable while Help covers the view, then restores its inline placement once', () => {
    const state = asking('mem-lab-mem-consolidate')

    state.isHelp = true
    expect(keys(draw(state, 120)).filter(key => key === 'confirm')).toHaveLength(1)
    state.isHelp = false
    expect(keys(draw(state, 120)).filter(key => key === 'confirm')).toHaveLength(1)
  })

  it('shows a way back to the pending ask when the new view normally draws its own confirms', () => {
    const state = asking('mem-lab-mem-consolidate')

    state.view = 'missions'

    const away = keys(draw(state, 120))

    expect(away).toContain('confirm-go')
    expect(away).not.toContain('confirm')
    expect(away.filter(key => key === 'cancel')).toHaveLength(1)
  })
})
