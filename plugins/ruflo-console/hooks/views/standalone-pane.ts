/**
 * The page on the standalone terminal host (ADR-489): the view's own body in its cards, under one line that says what the page is
 * for. Everything else paneView draws is Claude Code's surface and is left out here: the tab bar, the icon row, the footer buttons,
 * the BBS furniture and the plugin Launch section are all mouse controls or Claude turns, and this host has neither. The terminal
 * shell (tui/run.ts) draws its own page bar and key line in their place.
 */
import type { RenderElement } from 'claude-code'

import { isBooting, isCompactPane, VIEWS } from '../state'
import { CARD_COLUMNS, hasCards, withCards } from './card'
import { activeTheme } from '../themes'
import { art, col, setLook, text, THEME, type Ctx } from './common'
import { stepsRows } from './steps'

export function standalonePane(base: Ctx, body: (ctx: Ctx) => RenderElement): RenderElement {
  setLook(base.state.options.look, activeTheme(base.state).palette)

  const ctx = base

  // The selected boot screen (opt in with --boot): a bounded intro while the first snapshot arrives, as in the console; nothing else is drawn under it.
  if (isBooting(ctx.state, ctx.nowMs)) {
    const intro = art(ctx, ctx.pictures.get('boot'), 'boot', 'RUFLO AGENT SWARM CONSOLE · loading…')

    return col(ctx, [intro ?? text(ctx, 'RUFLO AGENT SWARM CONSOLE · loading…', { bold: true, color: THEME.head })], 'boot')
  }
  const cardsOn = hasCards(ctx.columns, isCompactPane(ctx.state))
  const bodyCtx: Ctx = cardsOn ? { ...ctx, columns: ctx.columns - CARD_COLUMNS, cards: true, kit: withCards(ctx.kit, undefined) } : ctx
  const view = VIEWS.find(entry => entry.id === ctx.state.view)
  // The purpose line, minus what only Claude Code can do: Missions here is the record, and Events has no filter key.
  const purpose = view === undefined ? '' : view.id === 'missions' ? 'the mission record ruflo wrote: state, tasks and evidence as recorded (read-only)' : view.blurb.replace(/\s*\(f filters them\)/, '')
  const about = view === undefined ? [] : [text(ctx, `${view.icon} ${view.label} — ${purpose}`, { color: THEME.head, bold: true })]

  // The page's own title art (BBS: the page's name in block letters; Orbital: the shaded masthead with its globe) when the host draws pictures: the same
  // picture the Claude Code pane leads with, without the icon row beside it. A host with no Raster gets the plain purpose line alone.
  const key = ctx.state.view === 'menu' ? 'header' : 'title'
  const banner = art(ctx, ctx.pictures.get(key), key, `ruflo console: ${ctx.state.view}`)

  return col(ctx, [...(banner === null ? [] : [banner]), ...about, ...(cardsOn ? stepsRows(bodyCtx) : []), body(bodyCtx)], 'standalone-pane')
}
