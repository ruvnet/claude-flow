import { homeOf } from '../plugin-map'
import { VIEWS, type ViewId } from '../state'
import type { Ctx } from './common'

/** Opens the Plugin Catalog with `plugin` selected: the one way every page that names a plugin links to it. */
export function openInCatalog(ctx: Ctx, plugin: string): void {
  ctx.act.view('market')
  ctx.act.catalog.select(plugin)
}

/** The console section that launches a plugin's commands (Swarm, Security, …), or null for a plugin no section owns. */
export function homeLink(plugin: string): { view: ViewId; label: string } | null {
  const view = homeOf(plugin)
  const entry = view === null ? undefined : VIEWS.find(candidate => candidate.id === view)

  return view === null || entry === undefined ? null : { view, label: entry.label }
}
