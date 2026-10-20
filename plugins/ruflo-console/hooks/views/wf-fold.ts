/**
 * The fold every replay-family board slot (ADR-461) opens with: the page already draws the slot's rule, so the body is one
 * line and a button while it is closed (the page stays short), the full body once opened. Kept per slot id for the session.
 */
import type { RenderElement } from 'claude-code'

import { button, row, text, type Ctx } from './common'

const open = new Set<string>()

/** For tests. */
export const resetFolds = (): void => open.clear()

/** The closed line and its button, or the opened body under a "close" button. `redraw` runs after the flip. */
export function fold(ctx: Ctx, id: string, summary: string, body: () => RenderElement[]): RenderElement[] {
  const isOpen = open.has(id)
  const flip = (): void => {
    if (isOpen) open.delete(id)
    else open.add(id)
    ctx.act.workflows.setUi({})
  }

  return isOpen
    ? [row(ctx, [button(ctx, `wf-${id}-fold`, '▾ close', flip), text(ctx, ` ${summary}`, { dimColor: true })], `wf-${id}-head`), ...body()]
    : [row(ctx, [button(ctx, `wf-${id}-fold`, '▸ open', flip), text(ctx, ` ${summary}`, { dimColor: true })], `wf-${id}-head`)]
}

/** Asks the page to draw again (merging an empty change into the cursor invalidates the frame). */
export const redraw = (ctx: Ctx): void => ctx.act.workflows.setUi({})
