/**
 * The Plugins page, the Plugin Catalog and the Launch section are linked to each other (ADR-434): a plugin named on one opens in the
 * catalog, the catalog links back to the health page and to the section that launches a plugin, and Launch rows share one layout.
 * Buttons are pressed through a recording `act`. Run with
 *   npx vitest run plugins/ruflo-console/tests/plugin-links.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { homeOf } from '../hooks/plugin-map'
import { catalogOf } from '../hooks/plugin-catalog'
import { newState, type State } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { launchRows } from '../hooks/views/launch'
import { catalogView } from '../hooks/views/plugin-catalog'
import { pluginsView } from '../hooks/views/plugins'

type El = { props: Record<string, unknown> }

const calls: string[] = []
const recorder = (path: string): unknown =>
  new Proxy(() => undefined, {
    get: (_t, key) => (key === 'then' ? undefined : recorder(`${path}.${String(key)}`)),
    apply: (_t, _this, args) => void calls.push(`${path.slice(1)}(${args.join(',')})`),
  })
const act = recorder('') as never
const kit = { Box: (props: Record<string, unknown>): El => ({ props }), Text: (props: Record<string, unknown>): El => ({ props }), Button: (props: Record<string, unknown>): El => ({ props }), Input: (props: Record<string, unknown>): El => ({ props }) }
const ctxOf = (state: State, columns = 120): Ctx => ({ kit, state, nowMs: Date.now(), columns, pictures: new Map(), act, cards: true }) as unknown as Ctx
const flat = (el: unknown): El[] => {
  const node = el as El

  if (typeof node !== 'object' || node === null) return []

  const kids = node.props.children

  return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
}
const button = (tree: unknown, key: string): El | undefined => flat(tree).find(node => node.props.key === key)
const press = (node: El | undefined): void => (node?.props.onPress as () => void)()

const withPlugins = (): State => {
  const state = newState({})

  state.view = 'plugins'
  state.configDir = '/home/u/.claude'
  state.snapshot = {
    isRufloProject: false,
    plugins: {
      installed: [{ id: 'ruflo-core@ruflo', name: 'ruflo-core', marketplace: 'ruflo', version: '1.0.0', scope: 'user' }],
      enabled: new Set(['ruflo-core@ruflo']),
      markets: [{ name: 'ruflo', location: '/m/ruflo', updatedMs: Date.now(), isAutoUpdate: true }],
      rufloOffered: ['ruflo-core', 'ruflo-swarm'],
      missingFromClone: [],
    },
  } as never
  state.sections.add('plugins/plg-installed')
  state.sections.add('plugins/plg-available')

  return state
}

describe('the Plugins page links to the catalog', () => {
  it('a plugin name opens that plugin in the catalog, installed or not, and its home section opens', () => {
    calls.length = 0

    const tree = pluginsView(ctxOf(withPlugins()))

    press(button(tree, 'plg-open-ruflo-core'))
    press(button(tree, 'plg-avail-ruflo-swarm'))

    expect(calls).toEqual(['view(market)', 'catalog.select(ruflo-core)', 'view(market)', 'catalog.select(ruflo-swarm)'])
    expect(homeOf('ruflo-core')).not.toBeNull()
    expect(button(tree, 'plg-home-ruflo-core')).toBeDefined()
  })

  it('has no install, enable or disable of its own: those are the catalog\'s', () => {
    const keys = flat(pluginsView(ctxOf(withPlugins()))).map(node => String(node.props.key))

    expect(keys.filter(key => /^plg-(install|update|toggle)/.test(key))).toEqual([])
    expect(keys).toContain('plg-refresh')
  })
})

describe('the catalog links back', () => {
  const loaded = (): State => {
    const state = withPlugins()

    state.view = 'market'

    const catalog = catalogOf(state)

    catalog.plugins = [{ name: 'ruflo-core', description: 'core', skills: [], agents: [], commands: [], hasMcp: false, isMod: false, options: [] }] as never
    catalog.selected = 'ruflo-core'

    return state
  }

  it('shows the clone\'s health, with a way to the Plugins page and to update the marketplace', () => {
    calls.length = 0

    const tree = catalogView(ctxOf(loaded()))

    press(button(tree, 'cat-health'))
    press(button(tree, 'cat-refresh'))

    expect(calls).toEqual(['view(plugins)', 'plugin(refresh)'])
    expect(flat(tree).some(node => String(node.props.children ?? '').includes('clone pulled'))).toBe(true)
  })

  it('a plugin\'s detail links to the section that launches it and to the health page', () => {
    calls.length = 0

    const tree = catalogView(ctxOf(loaded()))

    press(button(tree, 'cat-home-ruflo-core'))
    press(button(tree, 'cat-health-ruflo-core'))

    expect(calls[1]).toBe('view(plugins)')
    expect(calls[0]).toMatch(/^view\(/)
  })
})

describe('the Launch section is laid out like the menu cards', () => {
  const launching = (): State => {
    const state = newState({})
    const view = homeOf('ruflo-plugin-creator')

    state.view = view ?? 'settings'
    state.commandNames = ['ruflo-plugin-creator:create-plugin', 'ruflo-plugin-creator:validate-plugin']
    state.sections.add(`${state.view}/launch`)

    return state
  }

  it('gives every command the same width, a primary run button, and a link to the plugin in the catalog', () => {
    calls.length = 0

    const tree = launchRows(ctxOf(launching()))
    const nodes = tree.flatMap(flat)
    const slashes = nodes.filter(node => String(node.props.key).startsWith('launch-/') || /^launch-ruflo-plugin-creator:/.test(String(node.props.key)))
    const runs = nodes.filter(node => String(node.props.key).startsWith('launch-run-'))

    expect(runs.length).toBe(2)
    expect(runs.every(node => node.props.variant === 'primary' && node.props.label === ' ▶ run ')).toBe(true)
    expect(new Set(slashes.map(node => String(node.props.label).length)).size).toBe(1)

    press(nodes.find(node => node.props.key === 'launch-cat-ruflo-plugin-creator'))
    expect(calls).toEqual(['view(market)', 'catalog.select(ruflo-plugin-creator)'])
  })
})
