/** Small layout pieces for views that group their rows into labelled blocks: a heading rule and a wrapped, dim explanation. */
import type { RenderElement } from 'claude-code'

import { row, THEME, type Ctx } from './common'

/** A sub-heading inside a card: the title, a rule, and what the block summarises at the right, so each block reads on its own. */
export function subhead(ctx: Ctx, title: string, right = ''): RenderElement {
  const head = ` ${title} `
  const tail = right === '' ? '' : ` ${right} `
  const fill = Math.max(2, ctx.columns - 12 - head.length - tail.length)

  return row(ctx, [ctx.kit.Text({ bold: true, color: THEME.head, children: head }), ctx.kit.Text({ dimColor: true, children: '─'.repeat(fill) }), ...(tail === '' ? [] : [ctx.kit.Text({ dimColor: true, children: tail })])])
}

/** An explanation under a block: dim, wrapped (never clipped), indented one column. */
export const note = (ctx: Ctx, words: string): RenderElement => ctx.kit.Text({ dimColor: true, wrap: 'wrap', children: ` ${words}` })
