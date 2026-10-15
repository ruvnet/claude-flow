/**
 * Where the icon row fits, pure: the row sits at the right of the pane's first line, beside the page's header art (the title art on a page,
 * the logo banner on the menu), and must never run under it. The row spells a word beside each glyph only when the pane is wide and the art
 * leaves room for the whole row; otherwise it is a glyph and a cell each. Tested in tests/pane-icons.spec.ts.
 */
export const ICON_WORDS_FROM = 110

/**
 * The icons, in order: id, glyph, word. Each glyph is one cell wide and none is an emoji or has an emoji form: a glyph that is also an emoji (⚙, ℹ) can be
 * drawn two cells wide when a terminal switches to its emoji font for it, as it can when the glyph is bold (how the page you are on is drawn), and the row
 * then jumps when that page is selected. A plain ? draws visibly larger than the small symbols beside it, so help is ʔ (a small question-mark shape).
 * Settings is ⛭, a gear with no emoji form; refresh is ⟳, a little larger than ↻, and last, beside the close mark.
 */
export const ICONS = [
  { id: 'menu', glyph: '⌂', word: 'menu' },
  { id: 'palette', glyph: '⌘', word: 'palette' },
  { id: 'help', glyph: 'ʔ', word: 'help' },
  { id: 'settings', glyph: '⛭', word: 'settings' },
  { id: 'refresh', glyph: '⟳', word: 'refresh' },
] as const

/** Cells after the last icon, so the row does not touch the host's ✕ at the edge. */
export const ICON_MARGIN = 2

/**
 * Cells kept free beside the row. The pane's body is a few cells narrower than its column count (the frame and the close mark), and the host's flex
 * layout shrinks whatever does not fit: a lit icon (a text box) collapsed to nothing and the last word wrapped onto a second line when the row was
 * sized to the exact count. Found by recording the real pane.
 */
export const ICON_SLACK = 4

/** The row's width in cells: glyph and a cell each, or glyph, word and a cell each; then the margin. */
export const iconCells = (withWords: boolean): number => ICONS.reduce((sum, icon) => sum + (withWords ? icon.glyph.length + 1 + icon.word.length + 1 : icon.glyph.length + 1), 0) + ICON_MARGIN

/** Whether each icon spells its word, given the pane's width and how many cells the header art uses of the first line. */
export const iconsSpellWords = (columns: number, headerCells: number): boolean => columns >= ICON_WORDS_FROM && headerCells + iconCells(true) + ICON_SLACK <= columns

/** How many columns of a cell grid hold anything: the right edge of what is drawn. `glyphs` is the grid's first cell of each three (glyph, fg, bg). */
export function usedColumns(cells: Uint32Array, columns: number, rows: number): number {
  let used = 0

  for (let y = 0; y < rows; y++) {
    for (let x = columns - 1; x >= used; x--) {
      if ((cells[(y * columns + x) * 3] as number) !== 0x20) {
        used = x + 1

        break
      }
    }
  }

  return used
}
