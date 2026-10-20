/**
 * The Learning page's pulse is text drawn from the clock, so the page needs to be redrawn while it is in front: about three times a
 * second (every 350 ms), from the frame loop, which only runs while the pane is shown and focused. No other page asks.
 */
let last = 0

export function pulseDue(view: string, nowMs: number): boolean {
  if (view !== 'learning') return false

  const slot = Math.floor(nowMs / 350)

  if (slot === last) return false

  last = slot

  return true
}
