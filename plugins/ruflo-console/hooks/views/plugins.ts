import type { RenderElement } from 'claude-code'

import { EXPECTED_IN_MARKET, RUFLO_MARKET } from '../data/snapshot'
import { PLUGIN_NAME } from '../state'
import { ago, button, col, kv, picture, row, rule, section, starts, text, THEME, type Ctx } from './common'
import { homeLink, openInCatalog } from './links'

const WEEK = 7 * 86_400_000

/**
 * Installed ruflo plugins and whether the marketplace clone they came from is current. A clone that does not list the
 * plugins this repository publishes (ruflo-mods first) is stale: `/plugin install ruflo-mods@ruflo` then fails with
 * "not found", a real report today. The fix is named, never run.
 */
export function pluginsView(ctx: Ctx): RenderElement {
  const { state, nowMs } = ctx
  const facts = state.snapshot?.plugins ?? null
  const rows: RenderElement[] = [rule(ctx, 'Marketplace', RUFLO_MARKET)]

  if (facts === null) {
    return text(ctx, 'reading plugin records…', { dimColor: true })
  }

  const market = facts.markets?.find(entry => entry.name === RUFLO_MARKET) ?? null

  if (state.configDir === null) {
    rows.push(text(ctx, 'n/a — neither CLAUDE_CONFIG_DIR nor HOME is readable to this mod, so the plugin records cannot be found', { dimColor: true }))
  } else if (market === null) {
    rows.push(kv(ctx, 'ruflo clone', facts.markets === null ? 'n/a — no known_marketplaces.json' : 'not added yet'))
    rows.push(starts(ctx, 'The ruflo marketplace is not added to Claude Code, so its plugins cannot be installed or updated.', ['marketplace']))
  } else {
    const isOld = market.updatedMs !== undefined && nowMs - market.updatedMs > WEEK

    rows.push(kv(ctx, 'ruflo clone', `pulled ${ago(market.updatedMs, nowMs)} · auto-update ${market.isAutoUpdate ? 'on' : 'off'} · lists ${facts.rufloOffered?.length ?? 'n/a'} plugins`, isOld ? THEME.warn : undefined))

    if (facts.missingFromClone.length > 0) {
      rows.push(text(ctx, `STALE: the clone does not list ${facts.missingFromClone.join(', ')} — run /plugin marketplace update ${RUFLO_MARKET}`, { bold: true, color: THEME.bad }))
    } else if (facts.rufloOffered === null) {
      rows.push(text(ctx, "n/a — the clone's marketplace.json is not readable, so freshness is unknown", { dimColor: true }))
    } else {
      rows.push(text(ctx, `current: lists ${EXPECTED_IN_MARKET.join(', ')}`, { color: THEME.ok }))
    }
  }

  if (market !== null) {
    const isStale = facts.missingFromClone.length > 0

    rows.push(row(ctx, [text(ctx, ' '), button(ctx, 'plg-refresh', isStale ? '▸ update the marketplace (the clone is stale)' : '▸ update the marketplace', () => ctx.act.plugin('refresh'), isStale ? { primary: true } : undefined)]))
  }

  const ruflo = (facts.installed ?? []).filter(plugin => plugin.marketplace === RUFLO_MARKET)
  const enabled = ruflo.filter(plugin => facts.enabled.has(plugin.id)).length

  rows.push(rule(ctx, 'Installed', facts.installed === null ? 'n/a' : `${ruflo.length} ruflo · ${enabled} enabled · ${(facts.installed ?? []).length} total`))

  rows.push(picture(ctx, 'health', `${ruflo.length} ruflo plugins installed`))
  rows.push(text(ctx, 'columns: I installed · E enabled · C listed by the marketplace clone · M mod loaded here — ■ yes (green) / no (red), · unknown', { dimColor: true }))

  const gone = ruflo.filter(plugin => facts.rufloOffered !== null && !facts.rufloOffered.includes(plugin.name))

  if (gone.length > 0) rows.push(text(ctx, `installed but gone from the clone: ${gone.map(plugin => plugin.name).join(', ')}`, { color: THEME.warn }))

  // Each installed ruflo plugin: its state, the console section that launches its commands, and a link to its entry in the Plugin Catalog,
  // where it is installed, updated, enabled, disabled or removed (this page is for the health of the setup, the catalog for the plugins).
  if (ruflo.length > 0) {
    rows.push(
      ...section(
        ctx,
        'plg-installed',
        'Installed plugins',
        `${ruflo.length} · open one in the catalog`,
        ruflo.map(plugin => {
          const isOn = facts.enabled.has(plugin.id)
          const home = homeLink(plugin.name)

          return row(
            ctx,
            [
              text(ctx, ` ${isOn ? '●' : '○'} `, { color: isOn ? THEME.ok : undefined, dimColor: !isOn }),
              ctx.kit.Button({ key: `plg-open-${plugin.name}`, label: `${plugin.name} `.padEnd(28, '.'), plain: true, onPress: () => openInCatalog(ctx, plugin.name) }),
              text(ctx, ` ${plugin.version.padEnd(10)}`, { dimColor: true }),
              ...(home === null ? [] : [ctx.kit.Button({ key: `plg-home-${plugin.name}`, label: ` → ${home.label} `, plain: true, dimColor: true, onPress: () => ctx.act.view(home.view) })]),
            ],
            `plg-row-${plugin.name}`,
          )
        }),
        false,
      ),
    )
  }

  const installedNames = new Set(ruflo.map(plugin => plugin.name))
  const available = (facts.rufloOffered ?? []).filter(name => !installedNames.has(name))

  if (market !== null && available.length > 0) {
    rows.push(
      ...section(ctx, 'plg-available', 'Available to install', `${available.length} in the marketplace`, [
        ...available.slice(0, 12).map(name => row(ctx, [text(ctx, ' ○ ', { dimColor: true }), ctx.kit.Button({ key: `plg-avail-${name}`, label: `${name} `.padEnd(30, '.'), plain: true, onPress: () => openInCatalog(ctx, name) }), text(ctx, ' ▸ install it there', { dimColor: true })], `plg-avail-row-${name}`)),
        ...(available.length > 12 ? [text(ctx, ` +${available.length - 12} more in the Plugin Catalog`, { dimColor: true })] : []),
      ], ruflo.length === 0),
    )
  }

  rows.push(rule(ctx, 'Mods', 'function hooks'))
  rows.push(kv(ctx, PLUGIN_NAME, 'loaded (you are reading it)', THEME.ok))
  rows.push(kv(ctx, 'ruflo-mods', state.ruflo.snapshot !== null ? 'seated ($.ruflo answers)' : 'not seated in this session', state.ruflo.snapshot !== null ? THEME.ok : undefined))

  for (const mod of state.mods.slice(-5)) {
    rows.push(kv(ctx, mod.name, `${mod.isLoaded ? 'loaded' : `REFUSED: ${mod.reason ?? 'no reason given'}`} · ${mod.provenance} · ${ago(mod.atMs, nowMs)}`, mod.isLoaded ? undefined : THEME.bad))
  }

  rows.push(button(ctx, 'plg-catalog', '▸ open the Plugin Catalog: every ruflo plugin, mod and skill', () => ctx.act.view('market')))
  rows.push(text(ctx, 'mods list: those registered after the console loaded (the engine admits earlier ones unseen)', { dimColor: true }))

  return col(ctx, rows, 'plugins')
}
