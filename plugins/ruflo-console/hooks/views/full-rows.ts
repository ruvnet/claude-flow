import type { RenderElement } from 'claude-code'

import { SHOW_LINES, showFull } from '../full-text'
import { row, text, type Ctx } from './common'

type Opts = {
  /** The key the rows are addressed by: `<key>-0`, `<key>-1`, and `<key>-more` for the marker. */
  key: string
  color?: string
  bold?: boolean
  dimColor?: boolean
  /** What sits after the last line (an ✎ edit button), so it reads as part of the text. */
  after?: RenderElement
  maxLines?: number
  /** Where the lines hidden by the marker can be read or edited; default names the ✎ edit button. */
  hint?: string
}

/**
 * A person's text in full (ADR-481): `lead` before the first line (`goal: `), the following lines indented to match, each wrapped to the pane's
 * width. Beyond `maxLines` the block ends in an explicit marker with the hidden line count, never a silent cut.
 */
export function fullRows(ctx: Ctx, lead: string, value: string, opts: Opts): RenderElement[] {
  const indent = ' '.repeat(lead.length)
  const width = Math.max(12, ctx.columns - lead.length - 4)
  const shown = showFull(value, width, { maxLines: opts.maxLines ?? SHOW_LINES, ...(opts.hint !== undefined && { hint: opts.hint }) })
  const style = { ...(opts.color !== undefined && { color: opts.color }), ...(opts.bold === true && { bold: true }), ...(opts.dimColor === true && { dimColor: true }) }
  const last = shown.lines.length - 1

  return shown.lines.map((line, i) => {
    const isMarker = shown.marker !== null && i === last
    const piece = text(ctx, `${i === 0 ? lead : indent}${line}`, isMarker ? { dimColor: true } : style)

    return i === last && opts.after !== undefined ? row(ctx, [piece, opts.after], `${opts.key}-${isMarker ? 'more' : i}`) : isMarker ? row(ctx, [piece], `${opts.key}-more`) : row(ctx, [piece], `${opts.key}-${i}`)
  })
}
