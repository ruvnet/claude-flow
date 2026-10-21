/** Palette entries for Settings, so `/ruflo run settings-set ruflo-console look plain` works headless (it still asks first). */
import { plain } from './data/parse'
import type { PaletteEntry } from './palette'
import { setCore, setOption } from './settings'
import type { State } from './state'

export function settingsPalette(state: State): PaletteEntry[] {
  const entries: PaletteEntry[] = [
    {
      id: 'settings-set',
      group: 'settings',
      label: 'settings-set <plugin> <option> <value>: set a plugin option (asks first)',
      run: {
        kind: 'text',
        keyword: 'settings-set',
        make: text => {
          const [plugin, key, ...rest] = text.trim().split(/\s+/)

          return plugin === undefined || key === undefined ? null : setOption(state, plugin, key, rest.join(' '), () => undefined)
        },
        why: text => `open Settings first so ${plain(text.split(/\s+/)[0] ?? 'the plugin', 40)}’s options are read, then name a plugin, an option and a value it accepts`,
      },
    },
    {
      id: 'settings-core',
      group: 'settings',
      label: 'settings-core <key> <value>: set a ruflo config key from the curated list (asks first)',
      run: {
        kind: 'text',
        keyword: 'settings-core',
        make: text => {
          const [key, ...rest] = text.trim().split(/\s+/)

          return key === undefined ? null : setCore(state, key, rest.join(' '), () => undefined)
        },
        why: () => 'a ruflo config key from Settings (swarm.topology, swarm.maxAgents, memory.backend, …) and a value it accepts',
      },
    },
    { id: 'settings-open', group: 'settings', label: 'open Settings', run: { kind: 'view', view: 'settings' } },
  ]

  return entries
}
