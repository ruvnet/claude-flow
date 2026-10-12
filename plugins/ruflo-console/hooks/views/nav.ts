/**
 * The nav, drawn when the page is in cards: a short, bordered card of two or three rows instead of every page at once.
 *   row 1   [0: MAIN]  the five groups (the open one marked)  a search field
 *   row 2+  the pages of the open group (or what the search found), each `[k: icon NAME]`
 * Picking another group shows its pages while the page stays open; searching lists the pages whose name, group or description holds
 * the words (one match opens it). A page's hotkey is the one it had in the flat tab bar, and it keeps working wherever it is
 * drawn: the pages that are not showing are in the card as hidden buttons, so a number or letter reaches any page from any page.
 */
import type { RenderElement } from 'claude-code'

import { chip, NAV_ACCENT } from '../menu-colors'
import { badgesOf } from '../menu-style'
import { accentOfView, findPages, groupOf, NAV_GROUPS, shownGroup } from '../nav-state'
import { VIEWS, type ViewId } from '../state'
import { CARD_COLUMNS } from './card'
import { isBbs, THEME, type Ctx } from './common'

type View = (typeof VIEWS)[number]

const PER_ROW = 6

export function groupedTabs(ctx: Ctx, hasHotkey: (view: View) => boolean): RenderElement {
  const { state } = ctx
  const inner = ctx.columns - CARD_COLUMNS
  const open = state.view === 'agent' ? state.back : state.view
  const shown = shownGroup(state)
  const query = state.navQuery
  const find = (id: ViewId) => VIEWS.find(entry => entry.id === id)
  const found = query === '' ? null : findPages(query)
  // On the main menu the cards below already list every page, so the card up here is just the groups and the search: no row of pages repeating
  // them (and wrapping across the border in a narrow pane) until a group is picked.
  const isMenuIdle = open === 'menu' && !(state.navPick !== null && state.navPick.view === 'menu')
  const pages: ViewId[][] = isMenuIdle && found === null ? [] : found !== null ? Array.from({ length: Math.ceil(found.length / PER_ROW) }, (_, i) => found.slice(i * PER_ROW, (i + 1) * PER_ROW)) : (NAV_GROUPS.find(group => group.title === shown)?.rows ?? []).map(ids => [...ids])

  // What a page spells: its icon, and from `brief` a short name, from `full` the whole name. The engine puts a hotkey in front ("3: ").
  const spell = (view: View, form: string) => (form === 'icons' ? view.icon : form === 'brief' ? `${view.icon} ${view.short}` : `${view.icon} ${view.label}`)
  // The same badges the menu carries (approvals waiting, findings, an update ...), so the nav says what is going on behind a page too.
  const badges = badgesOf(state, ctx.nowMs)
  // A group whose page has something new carries a dot while its pages are not showing (the page's own entry says `new` once the group is open).
  const newGroup = badges.whatsnew === undefined ? null : groupOf('whatsnew')
  const badgeText = (view: View): string => (badges[view.id] === undefined ? '' : ` ${badges[view.id]?.text}`)
  // The open page always spells out its whole name, whatever the form (see `tab`), so that is how wide it is.
  // (On the main menu of a narrow card the chip says MENU, so it is not cut to "MAIN M…" beside the groups.)
  const nameOf = (view: View) => (view.id === 'menu' && inner < 72 ? 'Menu' : view.label)
  const openName = (view: View) => (isBbs() ? `[${view.key === '' ? '' : `${view.key}: `}${view.icon} ${nameOf(view).toUpperCase()}]` : `${view.key === '' ? '' : `${view.key}: `}${view.icon} ${nameOf(view)}`)
  const cells = (view: View, form: string) => (view.id === open ? openName(view).length + 1 : (hasHotkey(view) && view.key !== '' ? 3 : 0) + spell(view, form).length + badgeText(view).length + 3)
  const widest = (form: string) => Math.max(0, ...pages.map(ids => ids.reduce((sum, id) => sum + (find(id) === undefined ? 0 : cells(find(id) as View, form)), 0)))
  // auto: the richest form whose widest row fits the page; the others are the person's choice (Settings).
  const form = state.nav === 'auto' ? (['full', 'brief'].find(candidate => widest(candidate) <= inner) ?? 'icons') : state.nav

  // A row of pages too wide even in the narrowest form wraps onto further rows, greedily, rather than running off the edge.
  const laid: ViewId[][] =
    widest(form) <= inner
      ? pages
      : pages.flat().reduce<ViewId[][]>((rows, id) => {
          const last = rows.at(-1)
          const width = (ids: readonly ViewId[]) => ids.reduce((sum, each) => sum + (find(each) === undefined ? 0 : cells(find(each) as View, form)), 0)

          if (last !== undefined && width([...last, id]) <= inner) last.push(id)
          else rows.push([id])

          return rows
        }, [])

  const tab = (view: View): RenderElement => {
    const words = spell(view, form)
    const prefix = view.key === '' ? '' : `${view.key}: `

    // The open page names itself whatever the style, as the flat tab bar did: [3: 📌 CLAIMS], [0: 📟 MAIN MENU].
    const accent = isBbs() ? accentOfView(view.id) : null

    if (view.id === open) return ctx.kit.Box({ key: `tab-${view.id}`, children: [ctx.kit.Text({ ...(accent === null ? { bold: true, color: THEME.head } : chip(accent)), wrap: 'truncate-end', children: isBbs() ? `[${prefix}${view.icon} ${nameOf(view).toUpperCase()}]` : `${prefix}${view.icon} ${nameOf(view)}` })] })

    return ctx.kit.Button({ key: `tab-${view.id}`, label: ` ${words}${badgeText(view)} `, ...(hasHotkey(view) && view.key !== '' && { hotkey: view.key }), plain: true, dimColor: true, onPress: () => ctx.act.view(view.id) })
  }

  const menu = find('menu')
  // The group chips spell their icon only where the row has room; the search field shares their row only where it fits, else it has its own.
  const icons = inner >= 130
  const chipCells = NAV_GROUPS.reduce((sum, group) => sum + group.title.length + (icons ? 5 : 3), 12)
  const isSearchInline = inner - chipCells >= 28
  const chips = NAV_GROUPS.map(group =>
    group.title === shown && found === null && !isMenuIdle
      ? ctx.kit.Box({ key: `nav-group-${group.title}`, children: [ctx.kit.Text({ ...(isBbs() ? chip(NAV_ACCENT[group.title] ?? THEME.head) : { bold: true, color: THEME.head }), children: `[${icons ? `${group.icon} ` : ''}${group.title}${inner < 72 ? '' : ' ▾'}]` })] })
      : ctx.kit.Button({ key: `nav-group-${group.title}`, label: ` ${icons ? `${group.icon} ` : ''}${group.title}${group.title === newGroup ? ' •' : ''} `, plain: true, dimColor: true, onPress: () => ctx.act.navigator.group(group.title) }),
  )
  // On the main menu a picked group's pages are open: a ✕ beside the chips closes them again.
  const closePick = open === 'menu' && !isMenuIdle ? [ctx.kit.Button({ key: 'nav-pick-close', label: ' ✕ ', plain: true, dimColor: true, onPress: () => ctx.act.navigator.group(shown) })] : []
  const Input = ctx.kit.Input
  const search = Input === undefined ? [] : [Input({ key: 'nav-find', label: '🔎', placeholder: 'find a page', submitLabel: 'go', onSubmit: (value: string) => ctx.act.navigator.find(value) })]
  const clear = query === '' ? [] : [ctx.kit.Button({ key: 'nav-find-clear', label: ' ✕ ', plain: true, dimColor: true, onPress: () => ctx.act.navigator.clear() })]
  const head = ctx.kit.Box({
    flexDirection: 'row',
    gap: 1,
    key: 'tabs-groups',
    children: [menu === undefined ? ctx.kit.Text({ children: '' }) : open === 'menu' ? tab(menu) : ctx.kit.Button({ key: 'tab-menu', label: ' 📟 MAIN ', plain: true, hotkey: '0', onPress: () => ctx.act.view('menu') }), ...chips, ...(isSearchInline ? closePick : []), ...(isSearchInline ? [...search, ...clear] : [])],
  })
  const findRow = isSearchInline ? [] : [ctx.kit.Box({ flexDirection: 'row', gap: 1, key: 'tabs-find', children: [...search, ...clear, ...closePick] })]
  const lines =
    found !== null && found.length === 0
      ? [ctx.kit.Text({ dimColor: true, children: ` no page matches “${query}” — try a name, a group or what it does` })]
      : laid.map((ids, i) =>
          ctx.kit.Box({ flexDirection: 'row', gap: 1, key: `tabs-row-${i}`, children: ids.flatMap(id => (find(id) === undefined ? [] : [tab(find(id) as View)])) }),
        )
  const note = found === null ? [] : [ctx.kit.Text({ dimColor: true, children: ` ${found.length} found for “${query}”${found.length === 1 ? '' : ' — Enter again on one name opens it'}` })]

  // Every other page with a hotkey stays in the card, hidden: its number or letter works from this page too.
  const visible = new Set<ViewId>(pages.flat())
  const hidden = VIEWS.filter(view => view.id !== 'menu' && view.id !== open && !visible.has(view.id) && hasHotkey(view) && view.key !== '')
  const keys = hidden.length === 0 ? [] : [ctx.kit.Box({ key: 'tabs-keys', display: 'none', children: hidden.map(view => ctx.kit.Button({ key: `tab-${view.id}`, label: view.short, hotkey: view.key, plain: true, onPress: () => ctx.act.view(view.id) })) } as never)]

  return ctx.kit.Box({ key: 'tabs', flexDirection: 'column', borderStyle: 'round', borderColor: THEME.info, paddingX: 1, children: [head, ...findRow, ...lines, ...note, ...keys] })
}
