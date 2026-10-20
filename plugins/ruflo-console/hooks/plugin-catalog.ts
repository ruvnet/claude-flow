/**
 * The Plugin Catalog: every plugin in the ruflo marketplace, with the skills, agents, commands, MCP config and mods
 * (function hooks) each ships, and the buttons to install, enable, disable, update and remove one. The list is read from
 * the marketplace clone on disk (data/catalog.ts); nothing is run to draw it. A change is one fixed `claude plugin <verb>
 * <name>@ruflo --scope user` argv on the confirm row with its cost in words, and only a name in this catalog is ever put
 * in an argv. ▸ view reads a skill, agent or command file from disk (bounded, read-only) into the result lines; ▸ use
 * types `/<plugin>:<skill>` into the AI terminal draft and never sends it.
 */
import type { ActionSpec } from './actions'
import { type CatalogMode, type CatalogPlugin, readCatalog, readDoc, visible } from './data/plugin-catalog'
import { plain } from './data/parse'
import { RUFLO_MARKET } from './data/snapshot'
import type { Host } from './host'
import type { PaletteEntry } from './palette'
import type { Runner } from './runner'
import type { State } from './state'

export type Verb = 'install' | 'uninstall' | 'enable' | 'disable' | 'update'

export const VERBS: readonly Verb[] = ['install', 'uninstall', 'enable', 'disable', 'update']
export const MODES: readonly { id: CatalogMode; label: string }[] = [
  { id: 'all', label: 'all' },
  { id: 'installed', label: 'installed' },
  { id: 'missing', label: 'not installed' },
  { id: 'mods', label: 'mods' },
  { id: 'skills', label: 'has skills' },
  { id: 'agents', label: 'has agents' },
]
export const PAGE = 12

export type CatalogState = {
  plugins: CatalogPlugin[] | null
  /** Why there is no list: the clone is not added, or its manifest is unreadable. */
  why: string
  loading: boolean
  mode: CatalogMode
  filter: string
  page: number
  selected: string | null
  /** The selected plugin's skill descriptions, by skill name. */
  described: Map<string, string>
  /** The last ▸ view or change: a label and the lines it showed. */
  last: { label: string; ok: boolean; lines: string[] } | null
}

const states = new WeakMap<State, CatalogState>()
const wired = new WeakMap<State, { host: Host; load: (text: string) => void }>()

export function catalogOf(state: State): CatalogState {
  let found = states.get(state)

  if (found === undefined) {
    found = { plugins: null, why: 'not read yet', loading: false, mode: 'all', filter: '', page: 0, selected: null, described: new Map(), last: null }
    states.set(state, found)
  }

  return found
}

/** The ruflo plugins Claude Code reports installed, by bare name; the enabled ones apart. */
export function installedOf(state: State): { installed: Set<string>; enabled: Set<string>; version: Map<string, string> } {
  const facts = state.snapshot?.plugins
  const mine = (facts?.installed ?? []).filter(plugin => plugin.marketplace === RUFLO_MARKET)

  return {
    installed: new Set(mine.map(plugin => plugin.name)),
    enabled: new Set(mine.filter(plugin => facts?.enabled.has(plugin.id) === true).map(plugin => plugin.name)),
    version: new Map(mine.map(plugin => [plugin.name, plugin.version])),
  }
}

/**
 * The catalog plugins whose mod Claude Code loaded in this session without installing the plugin (mod sync: the provenance reads
 * `<plugin>@synced` or `<plugin>@inline`). Installed plugins are left out: they are already shown by their install state.
 */
export function syncedOf(state: State): Set<string> {
  const { installed } = installedOf(state)
  const names = new Set<string>()

  for (const mod of state.mods) {
    if (!mod.isLoaded) continue

    const bare = /^(.+)@(?:synced|inline)$/.exec(mod.provenance)?.[1]

    if (bare !== undefined && !installed.has(bare)) names.add(bare)
  }

  return names
}

export const listOf = (state: State): CatalogPlugin[] => {
  const catalog = catalogOf(state)
  const { installed } = installedOf(state)

  return visible(catalog.plugins ?? [], installed, catalog.mode, catalog.filter)
}

const NOTES: Record<Verb, string> = {
  install: 'network: clones the plugin from the ruflo marketplace on GitHub, then writes it into ~/.claude/plugins and settings',
  uninstall: 'removes the plugin from this machine (its settings entry too); its data folder goes unless kept',
  enable: 'writes enabledPlugins in your user settings; reload plugins (/reload-plugins) to load it',
  disable: 'writes enabledPlugins in your user settings; reload plugins (/reload-plugins) to unload it',
  update: 'network: pulls the plugin’s newest version from the marketplace; restart Claude Code to apply it',
}

/** One change as a fixed argv, or null when the name is not in the catalog (never a name typed in freely). */
export function changeSpec(state: State, verb: Verb, name: string): ActionSpec | null {
  const plugins = catalogOf(state).plugins

  if (plugins === null || !plugins.some(plugin => plugin.name === name)) return null

  const argv = ['claude', 'plugin', verb, `${name}@${RUFLO_MARKET}`, '--scope', 'user'] as const

  return { label: `${verb} plugin ${name}`, args: [], argv, shows: argv.join(' '), expect: `${name} ${verb === 'install' ? 'installed' : verb === 'uninstall' ? 'removed' : verb === 'update' ? 'updated' : verb + 'd'}`, note: NOTES[verb], timeoutMs: 180_000 }
}

/** Reads the marketplace clone's list and each plugin's contents from disk (local, nothing run); a no-op while reading. */
export function loadCatalog(state: State, host: Host): void {
  const catalog = catalogOf(state)

  if (catalog.loading) return

  const market = state.snapshot?.plugins.markets?.find(entry => entry.name === RUFLO_MARKET)

  if (market?.location === undefined) {
    catalog.why = market === undefined ? 'the ruflo marketplace is not added to Claude Code yet' : 'the ruflo marketplace clone has no readable location'
    host.invalidate()

    return
  }

  catalog.loading = true
  host.invalidate()
  void readCatalog(host.fs, market.location)
    .then(plugins => {
      catalog.plugins = plugins
      catalog.why = plugins === null ? 'the clone’s marketplace.json is not readable' : plugins.length === 0 ? 'the clone lists no plugins' : ''
    })
    .catch(() => {
      catalog.why = 'reading the clone was refused'
    })
    .finally(() => {
      catalog.loading = false
      host.invalidate()
    })
}

export type CatalogActions = {
  /** Reads the marketplace clone (again): the whole list, with each plugin's contents. */
  load: () => void
  mode: (mode: CatalogMode) => void
  filter: (text: string) => void
  page: (delta: number) => void
  select: (name: string | null) => void
  /** Reads a skill, agent or command file from disk into the result lines. */
  view: (kind: 'skill' | 'agent' | 'command', plugin: string, item: string) => void
  /** Types `/<plugin>:<item>` into the AI terminal draft: reviewed, never sent. */
  use: (plugin: string, item: string) => void
  change: (verb: Verb, name: string) => void
}

export function catalogActions(state: State, host: Host, runner: Runner, load: (text: string) => void): CatalogActions {
  wired.set(state, { host, load })

  const catalog = catalogOf(state)
  const say = (label: string, ok: boolean, lines: string[]) => {
    catalog.last = { label, ok, lines }
    host.invalidate()
  }
  const find = (name: string) => catalog.plugins?.find(plugin => plugin.name === name) ?? null

  const describe = async (plugin: CatalogPlugin) => {
    await Promise.all(
      plugin.skills.slice(0, 40).map(async skill => {
        const key = `${plugin.name}/${skill}`

        if (catalog.described.has(key)) return

        const doc = await readDoc(host.fs, plugin, 'skill', skill).catch(() => null)

        catalog.described.set(key, doc?.description ?? '')
      }),
    )
    host.invalidate()
  }

  return {
    load: () => loadCatalog(state, host),
    mode: mode => {
      catalog.mode = mode
      catalog.page = 0
      host.invalidate()
    },
    filter: text => {
      catalog.filter = plain(text, Number.MAX_SAFE_INTEGER)
      catalog.page = 0
      host.invalidate()
    },
    page: delta => {
      const pages = Math.max(1, Math.ceil(listOf(state).length / PAGE))

      catalog.page = Math.max(0, Math.min(pages - 1, catalog.page + delta))
      host.invalidate()
    },
    select: name => {
      catalog.selected = name

      const plugin = name === null ? null : find(name)

      if (plugin !== null) void describe(plugin)

      host.invalidate()
    },
    view: (kind, pluginName, item) => {
      const plugin = find(pluginName)

      if (plugin === null) return say(`view ${item}`, false, [`${pluginName} is not in the catalog`])

      void readDoc(host.fs, plugin, kind, item).then(
        doc => say(`${pluginName} · ${kind} ${item}`, doc !== null, doc === null ? ['not readable: missing, too large, or refused'] : doc.lines),
        () => say(`${pluginName} · ${kind} ${item}`, false, ['refused']),
      )
    },
    use: (pluginName, item) => {
      if (find(pluginName) === null || !/^[A-Za-z0-9._-]{1,80}$/.test(item)) return say(`use ${item}`, false, [`${pluginName} is not in the catalog`])

      load(`/${pluginName}:${item}`)
      say(`use ${pluginName}:${item}`, true, [`/${pluginName}:${item} is typed in the AI terminal: read it, then Enter twice sends it to claude`])
    },
    change: (verb, name) => runner.ask(changeSpec(state, verb, name), `${name} is not in the ruflo catalog`),
  }
}

/** Palette entries so `/ruflo run catalog-install <name>` works headless; a name outside the catalog is refused. */
export function catalogPalette(state: State): PaletteEntry[] {
  const entries: PaletteEntry[] = VERBS.map(verb => ({
    id: `catalog-${verb}`,
    group: 'plugins',
    label: `catalog-${verb} <plugin>: ${verb} a ruflo plugin (asks first)`,
    run: { kind: 'text', keyword: `catalog-${verb}`, make: (text: string) => changeSpec(state, verb, text.trim()), why: () => 'a plugin name from the catalog (the Plugin Catalog view lists them)' },
  }))

  return [...entries, { id: 'catalog-open', group: 'plugins', label: 'open the Plugin Catalog', run: { kind: 'view', view: 'market' } }]
}

export const wiredFor = (state: State) => wired.get(state)
