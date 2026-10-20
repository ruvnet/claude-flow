/**
 * Plugin coverage: every ruflo plugin directory has a home section in the console, no entry names a plugin that is gone, every
 * home is a real view, and a plugin that has no surface of its own says why. A new plugin added without a line fails here.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { homeOf, PLUGIN_MAP, pluginsOfView } from '../hooks/plugin-map'
import { VIEWS } from '../hooks/state'

const PLUGINS = join(__dirname, '..', '..')
const onDisk = readdirSync(PLUGINS, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(PLUGINS, entry.name, '.claude-plugin', 'plugin.json')))
  .map(entry => entry.name)
  .sort()

describe('plugin coverage', () => {
  it('finds the plugin directories (the guard is not checking nothing)', () => {
    expect(onDisk.length).toBeGreaterThan(40)
    expect(onDisk).toContain('ruflo-console')
  })

  it('every plugin directory has a home section, and no home is for a plugin that is gone', () => {
    expect(onDisk.filter(name => PLUGIN_MAP[name] === undefined), 'unmapped plugins: add a line to hooks/plugin-map.ts').toEqual([])
    expect(Object.keys(PLUGIN_MAP).filter(name => !onDisk.includes(name)), 'stale entries').toEqual([])
  })

  it('every home is a real section, and a plugin without a surface of its own says why', () => {
    const views = new Set(VIEWS.map(view => view.id))

    for (const [plugin, entry] of Object.entries(PLUGIN_MAP)) {
      expect(views.has(entry.view), plugin).toBe(true)
      if (entry.catalogOnly !== undefined) {
        expect(entry.view, plugin).toBe('market')
        expect(entry.catalogOnly.length, plugin).toBeGreaterThan(20)
      }
    }
  })

  it('homeOf reads a plugin name or a slash name; pluginsOfView lists what a section owns', () => {
    expect(homeOf('ruflo-cost-tracker')).toBe('cost')
    expect(homeOf('ruflo-ruos:deploy')).toBe('swarm')
    expect(homeOf('not-a-plugin:thing')).toBeNull()
    expect(pluginsOfView('secure')).toEqual(['ruflo-aidefence', 'ruflo-protector', 'ruflo-security-audit'])
  })

  it('every section that owns a plugin has an ask entry (so each home can also be asked about)', async () => {
    const { VIEW_ASK } = await import('../hooks/ask-claude')

    for (const entry of Object.values(PLUGIN_MAP)) expect(VIEW_ASK[entry.view], entry.view).toBeDefined()
  })
})
