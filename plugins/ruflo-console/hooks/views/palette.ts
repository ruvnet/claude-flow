import type { RenderElement } from 'claude-code'

import { filterPalette, isUnavailable, paletteEntries, type PaletteEntry } from '../palette'
import { button, clip, col, row, rule, tagChip, text, THEME, type Ctx } from './common'

export const PALETTE_ROWS = 12

/** What pressing an entry does, as the tag it wears: a page to go to, a read that runs at once, a change that asks first, a command that takes text. */
export function entryTag(entry: PaletteEntry): { text: string; color: string } {
  const run = entry.run

  switch (run.kind) {
    case 'view':
      return { text: ' go ', color: THEME.info }
    case 'drill':
      return { text: 'drill', color: THEME.info }
    case 'command':
      return { text: ' cmd ', color: THEME.info }
    case 'text':
      return { text: 'text ', color: THEME.warn }
    case 'spec':
      return isUnavailable(entry) || run.spec === null ? { text: ' n/a ', color: THEME.bad } : run.spec.isReadOnly === true ? { text: ' $0 ', color: THEME.ok } : { text: 'ask ', color: THEME.warn }
  }
}

/** The text commands the palette takes (`route <words>`, `store <text>`…), one chip each, so they can be started by a click. */
const keywordsOf = (all: readonly PaletteEntry[]): string[] => [...new Set(all.flatMap(entry => (entry.run.kind === 'text' ? [entry.run.keyword] : [])))].slice(0, 8)

/**
 * The command palette over the view, laid out like the other pages: a card with the filter field and the keywords that take text, and a
 * card of matches. Each match is a dotted-leader row ending in what pressing it does (a tag: go, $0 read, ask first, takes text); the
 * first, which Enter runs, is marked ▶ and primary. With nothing typed the matches are grouped under dim `── group ──` rules, as the menu
 * groups its entries; once a query ranks them the group moves to the end of each row. `x` opens it scoped to the selection's actions.
 * While it is open the view's own buttons are not drawn, so Tab and the arrows walk the matches.
 */
export function paletteView(ctx: Ctx): RenderElement {
  const { state } = ctx
  const all = paletteEntries(state, ctx.nowMs)
  const matches = filterPalette(all, state.palette.query, state.palette.context)
  const shown = matches.slice(0, PALETTE_ROWS)
  const isGrouped = state.palette.query.trim() === ''
  const lead = Math.max(22, Math.min(44, ctx.columns - 34))
  const rows: RenderElement[] = [rule(ctx, state.palette.context === 'selection' ? 'Actions for the selection' : 'Palette', `${matches.length} of ${all.length}`)]

  if (ctx.kit.Input !== undefined) {
    rows.push(
      ctx.kit.Input({
        key: 'palette-input',
        label: '› ',
        placeholder: 'type to filter: spawn, claim, vote, worker, route <words>, store <text>, search <query>…',
        value: state.palette.query,
        submitLabel: 'run best match',
        autoFocus: true,
        onInput: value => ctx.act.paletteQuery(value),
        onSubmit: value => {
          ctx.act.paletteQuery(value)
          ctx.act.paletteSubmit()
        },
      }),
    )
  } else {
    rows.push(text(ctx, 'this surface has no text field: pick an entry below, or use /ruflo run <entry> [text]', { dimColor: true }))
  }

  const keywords = state.palette.context === 'selection' ? [] : keywordsOf(all)

  if (keywords.length > 0) {
    rows.push(row(ctx, [text(ctx, ' takes text ', { dimColor: true }), ...keywords.map(word => ctx.kit.Button({ key: `pal-kw-${word}`, label: ` ${word} `, plain: true, onPress: () => ctx.act.paletteQuery(`${word} `) }))], 'pal-keywords'))
  }

  rows.push(rule(ctx, 'Matches', matches.length === 0 ? 'none' : `${shown.length} shown · ▶ is what Enter runs`))

  let previous = ''

  shown.forEach((entry, i) => {
    const tag = entryTag(entry)
    const isFirst = i === 0

    if (isGrouped && entry.group !== previous) rows.push(text(ctx, clip(`── ${entry.group} ${'─'.repeat(Math.max(0, ctx.columns - entry.group.length - 8))}`, ctx.columns - 2), { color: THEME.info, dimColor: true }))

    previous = entry.group
    rows.push(
      row(
        ctx,
        [
          text(ctx, isFirst ? ' ▶' : '  ', { bold: true, color: THEME.ok }),
          ctx.kit.Button({ key: `pal-${entry.id}`, label: ` ${clip(entry.label, lead - 1)}`.padEnd(lead, '.'), plain: true, ...(isFirst && { variant: 'primary' as const }), onPress: () => ctx.act.paletteRun(entry.id) }),
          tagChip(ctx, tag.text, tag.color),
          ...(isGrouped || ctx.columns < 80 ? [] : [text(ctx, `  ${entry.group}`, { dimColor: true })]),
        ],
        `pal-row-${entry.id}`,
      ),
    )
  })

  if (matches.length > PALETTE_ROWS) rows.push(text(ctx, ` +${matches.length - PALETTE_ROWS} more: keep typing`, { dimColor: true }))
  if (matches.length === 0) rows.push(text(ctx, ' no match: try fewer letters, or a word from the entry’s name', { color: THEME.warn }))

  rows.push(rule(ctx, 'How it runs'))
  rows.push(text(ctx, ' $0 reads run at once · ask changes ask y/n first · go opens a page · text takes the words you type after its keyword', { dimColor: true }))
  rows.push(text(ctx, ' every entry is also /ruflo run <id>, from any session', { dimColor: true }))
  rows.push(row(ctx, [button(ctx, 'palette-close', 'Close palette', () => ctx.act.palette(state.palette.context), { hotkey: state.palette.context === 'selection' ? 'x' : 'p' })]))

  return col(ctx, rows, 'palette')
}
