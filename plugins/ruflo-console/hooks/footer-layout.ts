/**
 * The footer's buttons, fitted to the width, pure (the footer that draws them is views/pane.ts). The row was a status text and seven
 * buttons with no budget, so below about 100 columns it ran off the edge and cut the last buttons in half. Now each button has a full
 * label, a short one and a priority, and the row shows as many in full as fit, shortens the least important first, and only then drops
 * them. A dropped button is not lost: the footer keeps it, hidden, so its hotkey still works (the console's rule: a key reaches a page or
 * an action from wherever the person is). Tested in tests/footer-layout.spec.ts.
 */
export type FooterItem = {
  id: string
  full: string
  short: string
  /** 1 is kept longest; the highest number is shortened and dropped first. */
  priority: number
}

export type FooterFit = {
  /** In the order given: what to draw, and whether in its short form. */
  shown: { id: string; label: string; isShort: boolean }[]
  /** Dropped to fit: drawn hidden by the footer, so their hotkeys still work. */
  hidden: string[]
  /** Columns the shown buttons take, so the status text knows what is left. */
  used: number
}

/** A button draws `[ label ]` and the row puts one column between buttons. */
export const buttonWidth = (label: string): number => label.length + 5

/**
 * Fits `items` in `room` columns, leaving `minStatus` for the status text. Shortens from the lowest priority up until they fit, then drops
 * from the lowest priority up. With no room, every button is hidden.
 */
export function fitFooter(items: readonly FooterItem[], room: number, minStatus = 10): FooterFit {
  const budget = Math.max(0, room - minStatus)
  const form = new Map<string, 'full' | 'short' | 'gone'>(items.map(item => [item.id, 'full']))
  const weakest = [...items].sort((a, b) => b.priority - a.priority)
  const width = (): number =>
    items.reduce((sum, item) => {
      const how = form.get(item.id)

      return how === 'gone' ? sum : sum + buttonWidth(how === 'short' ? item.short : item.full)
    }, 0)

  for (const item of weakest) {
    if (width() <= budget) break
    form.set(item.id, 'short')
  }

  for (const item of weakest) {
    if (width() <= budget) break
    form.set(item.id, 'gone')
  }

  return {
    shown: items.flatMap(item => {
      const how = form.get(item.id)

      return how === 'gone' ? [] : [{ id: item.id, label: how === 'short' ? item.short : item.full, isShort: how === 'short' }]
    }),
    hidden: items.filter(item => form.get(item.id) === 'gone').map(item => item.id),
    used: width(),
  }
}
