/**
 * The Plugins page's operations (ADR-434): each is one fixed `claude plugin` argv, always qualified with the ruflo marketplace, and a
 * name that is not one plugin-shaped word is refused. The page's "Start here" card sees an added marketplace as done. Run with
 *   npx vitest run plugins/ruflo-console/tests/plugin-ops.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { pluginSpec } from '../hooks/plugin-ops'
import { newState } from '../hooks/state'
import { viewText } from '../hooks/views/pane'
import { stepsRows } from '../hooks/views/steps'

const act = (() => {
  const proxy: unknown = new Proxy(() => undefined, { get: (_t, key) => (key === 'then' ? undefined : proxy), apply: () => undefined })

  return proxy
})() as never

describe('pluginSpec', () => {
  it('is one fixed claude plugin marketplace update argv, asks first, and says it uses the network', () => {
    const spec = pluginSpec('refresh')

    expect(spec.argv).toEqual(['claude', 'plugin', 'marketplace', 'update', 'ruflo'])
    expect(spec.shows).toBe('claude plugin marketplace update ruflo')
    expect(spec.isReadOnly).toBeUndefined()
    expect(spec.note).toContain('NETWORK')
  })
})

describe('the Plugins page', () => {
  const withMarket = (installed: string[]) => {
    const state = newState({})

    state.view = 'plugins'
    state.configDir = '/home/u/.claude'
    state.snapshot = {
      isRufloProject: false,
      plugins: {
        installed: installed.map(name => ({ id: `${name}@ruflo`, name, marketplace: 'ruflo', version: '1.0.0', scope: 'user' })),
        enabled: new Set(installed.map(name => `${name}@ruflo`)),
        markets: [{ name: 'ruflo', location: '/m/ruflo', updatedMs: Date.now(), isAutoUpdate: true }],
        rufloOffered: ['ruflo-core', 'ruflo-swarm', 'ruflo-mods'],
        missingFromClone: [],
      },
    } as never

    return state
  }

  it('does not offer to add a marketplace that is added, and lists what can be installed', () => {
    const text = viewText({ state: withMarket(['ruflo-core']), nowMs: Date.now(), columns: 120, act }, 'plugins')

    expect(text).not.toContain('not added yet')
    expect(text).toContain('Available to install')
    expect(text).toContain('ruflo-swarm')
  })

  it('the Start here card marks the marketplace step done when it is added, and next when it is not', () => {
    type El = { props: Record<string, unknown> }
    const kit = { Box: (props: Record<string, unknown>): El => ({ props }), Text: (props: Record<string, unknown>): El => ({ props }), Button: (props: Record<string, unknown>): El => ({ props }), Input: (props: Record<string, unknown>): El => ({ props }) }
    const flat = (el: unknown): El[] => {
      const node = el as El

      if (typeof node !== 'object' || node === null) return []

      const kids = node.props.children

      return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
    }
    const lines = (state: ReturnType<typeof withMarket>): string[] => stepsRows({ kit, state, nowMs: 1, columns: 120, pictures: new Map(), act, cards: true } as never).flatMap(flat).map(node => String(node.props.children ?? ''))
    const added = withMarket([])
    const missing = withMarket([])

    ;(missing.snapshot as { plugins: { markets: unknown } }).plugins.markets = []

    expect(lines(added).join('|')).toMatch(/✔ 1\. Add the ruflo marketplace/)
    expect(lines(missing).join('|')).toMatch(/▶ 1\. Add the ruflo marketplace/)
  })
})
