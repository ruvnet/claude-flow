/**
 * Layout helpers of the Workflows page (ADR-469). The engine lays a row out left to right and gives a Button the width of its label
 * plus the `[ ` and ` ]` it draws; a row that asks for more than the pane runs off the right edge (the `[ Close` cut, the stray
 * letters past the border), and a plain Text squeezed between buttons wraps one letter per row. So every row of buttons on this
 * page is packed here: it wraps to a new row instead of overflowing, a label too long for a row is clipped, never overrun, and
 * a breadcrumb folds its middle crumbs before it would wrap. A press handler never throws into the engine.
 */
import type { RenderElement } from 'claude-code'

import { button, clip, row, text, type Ctx } from './common'

/** Terminal cells of a string: emoji-presentation glyphs count two, so a row is never packed tighter than it draws. */
export function cells(value: string): number {
  let n = 0

  for (const ch of value) {
    const cp = ch.codePointAt(0) as number

    n += cp >= 0x1f000 || (cp >= 0x23e9 && cp <= 0x23fa) || cp === 0x2b50 || cp === 0x2705 || cp === 0x274c ? 2 : 1
  }

  return n
}

/** What a Button asks of a row: its label and the two brackets with their spaces. */
export const buttonWidth = (label: string): number => cells(label) + 4

/** A handler that cannot throw into the engine: a press whose closure fails (or whose page was redrawn away) changes nothing and says nothing. */
export const safe = (run: () => void): (() => void) => () => {
  try {
    run()
  } catch {
    // A press that fails costs that press only; the page stays as it was.
  }
}

export type Btn = { key: string; label: string; onPress: () => void; hotkey?: string; primary?: boolean }

/** `label` cut to what fits `room` cells as a button label, with an ellipsis. */
const fit = (label: string, room: number): string => (buttonWidth(label) <= room ? label : clip(label, Math.max(1, room - 4)))

/**
 * Buttons packed into rows no wider than the pane. `lead` (a word such as `tabs` or `view`) opens the first row. Every button is
 * kept, in order, and stays clickable: a row that is full wraps to the next one. Row keys are `key`, `key-2`, `key-3`…
 */
export function flow(ctx: Ctx, items: readonly Btn[], key: string, lead = ''): RenderElement[] {
  const avail = Math.max(8, ctx.columns)
  const rows: RenderElement[][] = [[]]
  let used = cells(lead)
  let inRow = 0

  if (lead !== '') rows[0]?.push(text(ctx, lead, { dimColor: true }))

  for (const item of items) {
    const label = fit(item.label, avail)
    const width = buttonWidth(label)
    let current = rows[rows.length - 1] as RenderElement[]

    if (used + width > avail && inRow > 0) {
      current = []
      rows.push(current)
      used = 0
      inRow = 0
    }

    current.push(button(ctx, item.key, label, safe(item.onPress), { ...(item.hotkey !== undefined && { hotkey: item.hotkey }), ...(item.primary === true && { primary: true }) }))
    used += width
    inRow += 1
  }

  return rows.map((parts, i) => row(ctx, parts, i === 0 ? key : `${key}-${i + 1}`))
}

export type Crumb = { key: string; label: string; isHere: boolean; onPress: () => void }

/**
 * The drill-down breadcrumb: every crumb a button that goes back to it, the last (where you are) bold text. When the whole trail is
 * wider than the pane the middle crumbs fold to one `…` (`Runs › … › Agent: x`), then the first goes too; only in the last resort is
 * the last crumb clipped. The Text never wraps, so it cannot fall to one letter per row.
 */
export function crumbRow(ctx: Ctx, crumbs: readonly Crumb[], key: string, style: { here: (label: string) => RenderElement }): RenderElement {
  const sep = ' › '
  const last = crumbs.length - 1
  const size = (crumb: Crumb): number => (crumb.isHere ? cells(crumb.label) : buttonWidth(crumb.label))
  const plans: (number | '…')[][] = [crumbs.map((_, i) => i)]

  if (crumbs.length > 2) plans.push([0, '…', last])
  if (crumbs.length > 1) plans.push(['…', last])

  const width = (plan: (number | '…')[]): number => plan.reduce<number>((sum, item, i) => sum + (item === '…' ? 1 : size(crumbs[item] as Crumb)) + (i > 0 ? cells(sep) : 0), 0)
  const plan = plans.find(candidate => width(candidate) <= ctx.columns) ?? (plans[plans.length - 1] as (number | '…')[])
  const parts: RenderElement[] = []

  for (const [i, item] of plan.entries()) {
    if (i > 0) parts.push(text(ctx, sep, { dimColor: true }))

    if (item === '…') parts.push(text(ctx, '…', { dimColor: true }))
    else {
      const crumb = crumbs[item] as Crumb

      // The last crumb is clipped only when even alone it is wider than the pane, and then to what is left after the folded trail.
      parts.push(crumb.isHere ? style.here(clip(crumb.label, Math.max(4, ctx.columns - (width(plan) - cells(crumb.label))))) : button(ctx, crumb.key, crumb.label, safe(crumb.onPress)))
    }
  }

  return row(ctx, parts, key)
}

/** A run's tag for a line of the page: its last word, or, when that is too short to tell runs apart, the last words whole (never a cut through the middle of a word: `le-btr`). */
export function runTag(id: string): string {
  const words = id.split(/[-_:]/).filter(word => word !== '')
  const tail = words[words.length - 1] ?? id

  if (tail.length >= 4) return tail.slice(-6)

  let out = tail

  for (let i = words.length - 2; i >= 0 && (words[i] as string).length + 1 + out.length <= 14; i -= 1) out = `${words[i]}-${out}`

  return out
}
