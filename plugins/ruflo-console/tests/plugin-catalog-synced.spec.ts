/**
 * #3979 item 2: Claude Code's mod sync loads a marketplace mod without installing its plugin (`ruflo-arena@synced`). The Plugins page said
 * "loaded"; the Plugin Catalog read only installed_plugins.json and said "not installed". It now says the mod is synced here and the plugin
 * is not installed, and keeps the install button.
 *   npx vitest run plugins/ruflo-console/tests/plugin-catalog-synced.spec.ts
 */
import { describe, expect, it } from 'vitest'

import type { CatalogPlugin } from '../hooks/data/plugin-catalog'
import { catalogOf, syncedOf } from '../hooks/plugin-catalog'
import { newState } from '../hooks/state'
import { catalogView } from '../hooks/views/plugin-catalog'
import { linesOf, plainKit } from '../hooks/views/pane'
import type { Actions, Ctx } from '../hooks/views/common'

const plugin = (name: string): CatalogPlugin => ({ name, description: `the ${name} plugin`, version: '1.0.0', skills: [], agents: [], commands: [], hasMcp: false, isMod: true }) as CatalogPlugin

function world() {
  const state = newState({})

  state.snapshot = { plugins: { missingFromClone: [], installed: [{ id: 'ruflo-installed@ruflo', name: 'ruflo-installed', marketplace: 'ruflo', version: '1.0.0' }], enabled: new Set(['ruflo-installed@ruflo']), markets: [] } } as never
  catalogOf(state).plugins = [plugin('ruflo-arena'), plugin('ruflo-installed'), plugin('ruflo-absent'), plugin('ruflo-refused')]
  state.mods.push(
    { name: 'ruflo-arena', provenance: 'ruflo-arena@synced', isLoaded: true, atMs: 1 },
    { name: 'ruflo-installed', provenance: 'ruflo-installed@synced', isLoaded: true, atMs: 1 },
    { name: 'ruflo-refused', provenance: 'ruflo-refused@synced', isLoaded: false, reason: 'trust', atMs: 1 },
    { name: 'someone-else', provenance: 'ruflo-absent@ruflo', isLoaded: true, atMs: 1 },
  )

  return state
}

const draw = (state: ReturnType<typeof world>): string => {
  const out: string[] = []
  const ctx = { kit: plainKit(), state, nowMs: 1_000_000, columns: 140, pictures: new Map(), act: new Proxy({}, { get: () => new Proxy(() => undefined, { get: () => () => undefined }) }) as unknown as Actions } as Ctx

  linesOf(catalogView(ctx), out)

  return out.join('\n')
}

describe('Plugin Catalog and mods loaded by sync', () => {
  it('a synced mod whose plugin is not installed is named, an installed or refused or marketplace-loaded one is not', () => {
    expect([...syncedOf(world())]).toEqual(['ruflo-arena'])
  })

  it('the row and the detail say so instead of "not installed"', () => {
    const state = world()

    expect(draw(state)).toMatch(/◇ ruflo-arena/)
    expect(draw(state)).toMatch(/· ruflo-absent/)
    catalogOf(state).selected = 'ruflo-arena'
    expect(draw(state)).toContain('mod synced here, plugin not installed')
    expect(draw(state)).toMatch(/install/)
  })
})
