import type { RenderElement } from 'claude-code'

import { catalogOf, installedOf, listOf, MODES, PAGE, syncedOf, type Verb } from '../plugin-catalog'
import type { CatalogPlugin } from '../data/plugin-catalog'
import { RUFLO_MARKET } from '../data/snapshot'
import { ago, button, clip, col, kv, row, rule, section, text, THEME, type Ctx } from './common'
import { frameResult } from './status-card'
import { homeLink } from './links'

/** The ▸ verb a row ends with: install when absent, else enable or disable. */
function verbOf(ctx: Ctx, plugin: CatalogPlugin): { verb: Verb; label: string } {
  const { installed, enabled } = installedOf(ctx.state)

  return !installed.has(plugin.name) ? { verb: 'install', label: 'install' } : enabled.has(plugin.name) ? { verb: 'disable', label: 'disable' } : { verb: 'enable', label: 'enable' }
}

function counts(plugin: CatalogPlugin): string {
  return [plugin.skills.length > 0 ? `S${plugin.skills.length}` : '', plugin.agents.length > 0 ? `A${plugin.agents.length}` : '', plugin.commands.length > 0 ? `C${plugin.commands.length}` : '', plugin.hasMcp ? 'MCP' : '', plugin.isMod ? 'MOD' : ''].filter(Boolean).join(' ')
}

/** One plugin row: the whole row selects it, the trailing button changes it. */
function pluginRow(ctx: Ctx, plugin: CatalogPlugin, lead: number): RenderElement {
  const { installed, enabled } = installedOf(ctx.state)
  const badge = enabled.has(plugin.name) ? '■' : installed.has(plugin.name) ? '□' : syncedOf(ctx.state).has(plugin.name) ? '◇' : '·'
  const act = verbOf(ctx, plugin)
  const isPicked = catalogOf(ctx.state).selected === plugin.name
  const press = () => ctx.act.catalog.select(isPicked ? null : plugin.name)

  return row(
    ctx,
    [
      ctx.kit.Button({ key: `cat-name-${plugin.name}`, label: ` ${badge} ${plugin.name} `.padEnd(lead, '.'), plain: true, ...(isPicked && { variant: 'primary' as const }), onPress: press }),
      ctx.kit.Button({ key: `cat-about-${plugin.name}`, label: clip(`${counts(plugin).padEnd(18)} ${plugin.description}`, Math.max(4, ctx.columns - lead - 14)), plain: true, dimColor: true, onPress: press }),
      ctx.kit.Button({ key: `cat-${act.verb}-${plugin.name}`, label: ` ▸ ${act.label}`, plain: true, dimColor: true, onPress: () => ctx.act.catalog.change(act.verb, plugin.name) }),
    ],
    `cat-row-${plugin.name}`,
  )
}

/** One skill, agent or command in the selected plugin: its name and what it says it is, with ▸ view and ▸ use. */
function itemRow(ctx: Ctx, kind: 'skill' | 'agent' | 'command', plugin: CatalogPlugin, item: string): RenderElement {
  const about = kind === 'skill' ? (catalogOf(ctx.state).described.get(`${plugin.name}/${item}`) ?? '') : ''
  const view = () => ctx.act.catalog.view(kind, plugin.name, item)

  return row(
    ctx,
    [
      ctx.kit.Button({ key: `cat-${kind}-${plugin.name}-${item}`, label: `   ${item}`.padEnd(30, ' '), plain: true, onPress: view }),
      ctx.kit.Button({ key: `cat-${kind}-about-${plugin.name}-${item}`, label: clip(about, Math.max(4, ctx.columns - 50)), plain: true, dimColor: true, onPress: view }),
      ...(kind === 'agent' ? [] : [ctx.kit.Button({ key: `cat-use-${plugin.name}-${item}`, label: ' ▸ use', plain: true, dimColor: true, onPress: () => ctx.act.catalog.use(plugin.name, item) })]),
    ],
    `cat-${kind}-row-${plugin.name}-${item}`,
  )
}

function detailRows(ctx: Ctx, plugin: CatalogPlugin): RenderElement[] {
  const { installed, enabled, version } = installedOf(ctx.state)
  const state = enabled.has(plugin.name) ? 'installed and enabled' : installed.has(plugin.name) ? 'installed, disabled' : syncedOf(ctx.state).has(plugin.name) ? 'mod synced here, plugin not installed' : 'not installed'
  const rows: RenderElement[] = [rule(ctx, plugin.name, state), text(ctx, ` ${plugin.description}`, { color: THEME.info })]

  rows.push(kv(ctx, 'version', `${plugin.version ?? 'n/a'}${installed.has(plugin.name) ? ` (installed ${version.get(plugin.name) ?? '?'})` : ''}`))

  const verbs: Verb[] = !installed.has(plugin.name) ? ['install'] : ['update', enabled.has(plugin.name) ? 'disable' : 'enable', 'uninstall']

  rows.push(row(ctx, verbs.map(verb => button(ctx, `cat-do-${verb}-${plugin.name}`, verb, () => ctx.act.catalog.change(verb, plugin.name))), `cat-verbs-${plugin.name}`))

  // How this plugin relates to the rest of the console: the section that launches its commands, and the setup's health.
  const home = homeLink(plugin.name)

  rows.push(
    row(ctx, [text(ctx, ' related ', { dimColor: true }), ...(home === null ? [] : [button(ctx, `cat-home-${plugin.name}`, `→ ${home.label}: its commands (Launch)`, () => ctx.act.view(home.view))]), button(ctx, `cat-health-${plugin.name}`, '→ Plugins: setup health', () => ctx.act.view('plugins'))], `cat-related-${plugin.name}`),
  )

  if (plugin.isMod) rows.push(text(ctx, ' MOD: function hooks run in the engine once this plugin is loaded (trust it like code you run)', { color: THEME.warn }))
  if (plugin.hasMcp) rows.push(text(ctx, ' MCP: ships an .mcp.json: its servers start with the plugin', { dimColor: true }))

  const group = (title: string, kind: 'skill' | 'agent' | 'command', items: string[]) => {
    if (items.length === 0) return

    rows.push(...section(ctx, `${kind}s`, title, `${items.length}${items.length > 12 ? ' · first 12 shown' : ''}`, items.slice(0, 12).map(item => itemRow(ctx, kind, plugin, item))))
  }

  group('Skills', 'skill', plugin.skills)
  group('Agents', 'agent', plugin.agents)
  group('Commands', 'command', plugin.commands)

  return rows
}

/** The last ▸ view or change: what a skill file says, or why it could not be read. */
function lastRows(ctx: Ctx): RenderElement[] {
  const { last } = catalogOf(ctx.state)

  if (last === null) return []

  return [frameResult(ctx, [rule(ctx, 'Result', last.ok ? '✓' : '✗'), text(ctx, ` ${last.label}`, { bold: true, color: last.ok ? THEME.ok : THEME.bad }), ...last.lines.slice(0, 40).map(line => text(ctx, `   ${line}`))], last.ok ? 'ok' : 'bad')]
}

/**
 * Every plugin the ruflo marketplace offers: what it ships (skills, agents, commands, MCP, mod), its state here, and the
 * buttons to install, enable, disable, update or remove it, each asking first with its exact argv. The whole row selects
 * a plugin and opens its contents; ▸ view reads a skill, ▸ use types it into the AI terminal.
 */
export function catalogView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const catalog = catalogOf(state)
  const rows: RenderElement[] = []

  if (catalog.plugins === null) {
    return col(ctx, [rule(ctx, 'Plugin Catalog', catalog.loading ? 'reading the marketplace clone…' : 'not read yet'), text(ctx, ` ${catalog.loading ? 'reading…' : catalog.why}`, { dimColor: true }), button(ctx, 'cat-load', '▸ read the catalog', () => ctx.act.catalog.load())], 'catalog')
  }

  const { installed, enabled } = installedOf(state)
  const all = catalog.plugins
  const list = listOf(state)
  const pages = Math.max(1, Math.ceil(list.length / PAGE))
  const page = Math.min(catalog.page, pages - 1)
  const total = (pick: (plugin: CatalogPlugin) => number) => all.reduce((sum, plugin) => sum + pick(plugin), 0)
  const lead = Math.max(24, Math.min(34, ctx.columns - 60))

  rows.push(rule(ctx, 'Plugin Catalog', `${all.length} plugins · ${installed.size} installed · ${enabled.size} enabled`))
  rows.push(text(ctx, ` ${total(plugin => plugin.skills.length)} skills · ${total(plugin => plugin.agents.length)} agents · ${total(plugin => plugin.commands.length)} commands · ${all.filter(plugin => plugin.hasMcp).length} MCP · ${all.filter(plugin => plugin.isMod).length} mods · ■ enabled □ installed ◇ mod synced, plugin not installed · not installed`, { dimColor: true }))
  // The marketplace these come from: how fresh the clone is, with the way back to the Plugins page (the setup's health) and the update.
  const market = state.snapshot?.plugins.markets?.find(entry => entry.name === RUFLO_MARKET)
  const isStale = (state.snapshot?.plugins.missingFromClone.length ?? 0) > 0

  rows.push(
    row(
      ctx,
      [
        text(ctx, market === undefined ? ' marketplace not added ' : ` clone pulled ${ago(market.updatedMs, ctx.nowMs)}${isStale ? ' · STALE' : ''} `, { color: market === undefined || isStale ? THEME.warn : THEME.ok }),
        button(ctx, 'cat-health', '◂ Plugins: health', () => ctx.act.view('plugins')),
        button(ctx, 'cat-refresh', '↻ update marketplace', () => ctx.act.plugin('refresh'), isStale ? { primary: true } : {}),
      ],
      'cat-health-row',
    ),
  )
  rows.push(
    row(
      ctx,
      MODES.map(mode => ctx.kit.Button({ key: `cat-mode-${mode.id}`, label: ` ${catalog.mode === mode.id ? '●' : '○'} ${mode.label}`, plain: true, ...(catalog.mode === mode.id && { variant: 'primary' as const }), onPress: () => ctx.act.catalog.mode(mode.id) })),
      'cat-modes',
    ),
  )

  const Input = ctx.kit.Input

  rows.push(
    Input === undefined
      ? text(ctx, ' filter: from the palette (p): catalog filters need a surface with text fields', { dimColor: true })
      : Input({ key: 'cat-filter', label: '  ▸ filter', placeholder: 'a name, a skill, an agent or a word from a description: Enter filters', submitLabel: 'filter', onSubmit: value => ctx.act.catalog.filter(value) }),
  )

  // The result of a ▸ view or a change sits above the list: a click far down a long catalog answers where it can be seen.
  rows.push(...lastRows(ctx))
  // The selected plugin's contents sit above the list too: opening one on a short screen must not push them off it.
  const picked = all.find(plugin => plugin.name === catalog.selected)

  if (picked !== undefined) rows.push(...detailRows(ctx, picked))

  rows.push(rule(ctx, 'Plugins', `${list.length} shown · page ${page + 1} of ${pages}${catalog.filter !== '' ? ` · filter “${catalog.filter}”` : ''}`))
  for (const plugin of list.slice(page * PAGE, page * PAGE + PAGE)) rows.push(pluginRow(ctx, plugin, lead))
  if (list.length === 0) rows.push(text(ctx, ' nothing matches this mode and filter', { dimColor: true }))

  rows.push(
    row(ctx, [button(ctx, 'cat-prev', '◂ prev', () => ctx.act.catalog.page(-1), { hotkey: 'k' }), button(ctx, 'cat-next', 'next ▸', () => ctx.act.catalog.page(1), { hotkey: 'j' }), button(ctx, 'cat-reload', '↻ read again', () => ctx.act.catalog.load())], 'cat-pages'),
  )

  return col(ctx, rows, 'catalog')
}
