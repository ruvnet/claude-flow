/** Longest text folded in one pass, the same bound the shared screen reads in one pass; a longer one keeps its head and tail halves. */
export const MAX_FOLD = 200_000

/**
 * Recalled text as the screen should read it: NFKC-normalised, so fullwidth, circled, mathematical and ligature forms become the plain letters a
 * phrase or secret rule expects. Recall only; the shared screen region is left as it is. Bounded, never throws; a non-string folds to ''.
 */
export function fold(text: string): string {
  if (typeof text !== 'string') return ''
  try {
    const bounded = text.length > MAX_FOLD ? `${text.slice(0, MAX_FOLD / 2)}\n${text.slice(-MAX_FOLD / 2)}` : text
    return bounded.normalize('NFKC')
  } catch {
    return ''
  }
}
