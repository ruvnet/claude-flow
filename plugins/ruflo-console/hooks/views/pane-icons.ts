/** The pane's icon row (menu, palette, help, settings, refresh) and where it sits beside the header art; split out of pane.ts to keep both under 500 lines. */
import type { RenderElement } from 'claude-code'

import { ICON_MARGIN, ICONS, iconsSpellWords } from '../icon-layout'
import { THEME, type Ctx } from './common'

/**
 * The icons on one line, at the right of the first row, beside the host's ✕: the main menu, the palette, help, settings and refresh (hooks/icon-layout.ts
 * says which glyphs and why). Each says its word as well when the pane is wide and the header art beside it leaves room for the whole row; otherwise it
 * is a glyph and a cell. The one for the page you are on is lit: coloured text of exactly the width of a button (a plain Button draws exactly its label).
 */
export function iconRow(ctx: Ctx): RenderElement {
  const { state } = ctx
  const header = ctx.pictures.get(state.view === 'menu' ? 'header' : 'title')
  const withWords = iconsSpellWords(ctx.columns, header?.columns ?? 0)
  const press: Record<(typeof ICONS)[number]['id'], { isCurrent: boolean; run: () => void }> = {
    menu: { isCurrent: state.view === 'menu' && !state.isHelp && !state.palette.isOpen, run: () => ctx.act.view('menu') },
    palette: { isCurrent: state.palette.isOpen, run: () => ctx.act.palette('all') },
    help: { isCurrent: state.isHelp, run: ctx.act.help },
    settings: { isCurrent: state.view === 'settings' && !state.isHelp && !state.palette.isOpen, run: () => ctx.act.view('settings') },
    // Refresh re-reads everything and replays the intro, as the footer's Refresh and the r key do; it is an action, never the page you are on.
    refresh: { isCurrent: false, run: ctx.act.restart },
  }

  return ctx.kit.Box({
    flexDirection: 'row',
    flexShrink: 0,
    key: 'pane-icons',
    children: [
      ...ICONS.map(icon => {
        const key = `pane-icon-${icon.id}`
        const label = withWords ? `${icon.glyph} ${icon.word} ` : `${icon.glyph} `
        const entry = press[icon.id]

        return entry.isCurrent
          ? ctx.kit.Box({ key, flexShrink: 0, children: [ctx.kit.Text({ bold: true, color: THEME.head, children: label })] })
          : ctx.kit.Button({ key, label, plain: true, dimColor: true, onPress: entry.run })
      }),
      ctx.kit.Text({ children: ' '.repeat(ICON_MARGIN) }),
    ],
  })
}

/** Puts the icon row at the right of the first line of the pane, beside the header art and its purpose line; with no header, on a row of its own. */
export function withIcons(ctx: Ctx, parts: RenderElement[], lead: number): RenderElement[] {
  if (ctx.columns < 40) return parts

  if (lead === 0) {
    return [ctx.kit.Box({ flexDirection: 'row', key: 'pane-top', children: [ctx.kit.Box({ flexGrow: 1, key: 'pane-top-gap', children: [ctx.kit.Text({ children: ' ' })] }), iconRow(ctx)] }), ...parts]
  }

  return [ctx.kit.Box({ flexDirection: 'row', key: 'pane-top', children: [ctx.kit.Box({ flexDirection: 'column', flexGrow: 1, key: 'pane-lead', children: parts.slice(0, lead) }), iconRow(ctx)] }), ...parts.slice(lead)]
}
