/**
 * Elements the page builders mark as they build them, by identity: a section's header (`rule`, `section`) and the blank spacer drawn
 * above it. The card wrapper (views/card.ts) reads the marks to regroup a column's rows into bordered cards, one per header, without
 * reading anything of the engine's element shapes.
 */
export const HEADS = new WeakSet<object>()
export const SPACERS = new WeakSet<object>()

export function mark<T>(set: WeakSet<object>, element: T): T {
  if (typeof element === 'object' && element !== null) set.add(element)

  return element
}
