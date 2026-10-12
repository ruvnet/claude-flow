/**
 * The nav's groups and its search: which pages belong together, which group is showing its pages, and which pages a few typed words
 * find. Pure and view-free (the nav card that draws it is views/nav.ts), so the page list, the grouping and the matching are tested
 * without a screen.
 */
import { NAV_ACCENT } from './menu-colors'
import { VIEWS, type State, type ViewId } from './state'

/** The nav's groups, the main menu's own, each in rows short enough to spell their names: every view but the menu is in exactly one. */
export const NAV_GROUPS: readonly { title: string; icon: string; rows: readonly (readonly ViewId[])[] }[] = [
  { title: 'SWARM', icon: '🐝', rows: [['missions', 'overview', 'swarm', 'workflows'], ['hive', 'claims', 'approvals']] },
  { title: 'MIND', icon: '🧠', rows: [['learning', 'neural', 'metaharness', 'evolve', 'memory', 'vector']] },
  { title: 'SAFETY', icon: '🛡️', rows: [['secure', 'cost', 'perf', 'timeline', 'events', 'room']] },
  { title: 'NETWORK', icon: '🌐', rows: [['federation', 'xruv', 'sandbox', 'skills', 'market']] },
  { title: 'TOOLS', icon: '🛠️', rows: [['terminal', 'automate', 'devtools', 'plugins'], ['adrs', 'whatsnew', 'settings']] },
]

export const groupOf = (view: ViewId): string | null => NAV_GROUPS.find(group => group.rows.some(row => row.includes(view)))?.title ?? null

/** The accent of a page's group, or null for a page in none (the menu): the colour its cards and section rules wear in the BBS look. */
export const accentOfView = (view: ViewId): string | null => NAV_ACCENT[groupOf(view) ?? ''] ?? null

/** The group whose pages the nav shows: the one the person picked while on this page, else the open page's own. */
export function shownGroup(state: State): string {
  const open = state.view === 'agent' ? state.back : state.view

  if (state.navPick !== null && state.navPick.view === state.view) return state.navPick.group

  return groupOf(open) ?? (NAV_GROUPS[0] as (typeof NAV_GROUPS)[number]).title
}

const MAX_FOUND = 12

/** The pages a search finds: every word must appear in the page's name, its group, or its description; names rank first. */
export function findPages(query: string): ViewId[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word !== '')

  if (words.length === 0) return []

  const scored = VIEWS.filter(view => view.id !== 'menu').flatMap(view => {
    const name = `${view.label} ${view.short} ${view.id} ${view.key}`.toLowerCase()
    const rest = `${groupOf(view.id) ?? ''} ${view.blurb}`.toLowerCase()

    if (!words.every(word => name.includes(word) || rest.includes(word))) return []

    return [{ id: view.id, rank: words.every(word => name.includes(word)) ? 0 : 1 }]
  })

  return scored.sort((a, b) => a.rank - b.rank).slice(0, MAX_FOUND).map(entry => entry.id)
}

export type NavActions = {
  /** Shows a group's pages (while this page stays open). */
  group: (title: string) => void
  /** Applies the search words: one match opens it, several are listed, none says so. */
  find: (text: string) => void
  clear: () => void
}

export function navActions(state: State, invalidate: () => void, open: (view: ViewId) => void): NavActions {
  return {
    group: title => {
      // On the main menu, picking the group that is already picked closes its row of pages again.
      const isPicked = state.view === 'menu' && state.navPick !== null && state.navPick.view === 'menu' && state.navPick.group === title

      state.navPick = isPicked ? null : { group: title, view: state.view }
      state.navQuery = ''
      invalidate()
    },
    find: text => {
      const query = text.trim()
      const found = findPages(query)

      state.navQuery = query
      if (found.length === 1) {
        state.navQuery = ''
        open(found[0] as ViewId)
      }

      invalidate()
    },
    clear: () => {
      state.navQuery = ''
      invalidate()
    },
  }
}
