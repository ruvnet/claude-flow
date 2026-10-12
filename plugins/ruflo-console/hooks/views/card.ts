/**
 * Cards: every section of a page (a header from `rule` or `section`, and the rows after it) drawn inside its own bordered box, so
 * the groups of a page are obvious and each one reads as a unit. Done by wrapping the kit's Box: a column that holds section headers
 * is regrouped, the rows before the first header stay as they are, and each header starts a card. The kit it wraps is the attention
 * kit, so a confirm or an answer is still placed inside the card that holds the clicked row, right under it.
 *
 * A card spends two columns on its border and two on its padding: the page is drawn with `columns` narrowed by `CARD_COLUMNS`, so
 * nothing a view clips to its width overflows the frame.
 */
import type { Ctx } from './common'
import { THEME } from './common'
import { HEADS, SPACERS } from './marks'

/** Columns a card takes from the page width: border and padding, both sides. */
export const CARD_COLUMNS = 4

const flat = (children: unknown): unknown[] => (Array.isArray(children) ? children.flatMap(flat) : children === null || children === undefined || typeof children === 'boolean' ? [] : [children])

function holdsHead(children: unknown): boolean {
  if (Array.isArray(children)) return children.some(holdsHead)

  return typeof children === 'object' && children !== null && HEADS.has(children)
}

/** The narrowest pane still drawn in cards: the nav card, the section cards and their accents keep their styling down to here, in a short pane too. */
export const MIN_CARD_COLUMNS = 44

/** Whether a page of this width is drawn in cards. A short (compact) inline pane has them too: it scrolls, and it should not lose its styling. */
export const hasCards = (columns: number, _isCompact = false): boolean => columns >= MIN_CARD_COLUMNS

/** `accent` is the border's colour in the BBS look (the page's group colour); without it, the theme's. */
export function withCards(kit: Ctx['kit'], accent?: string): Ctx['kit'] {
  let made = 0

  const Box: Ctx['kit']['Box'] = props => {
    const children = (props as { children?: unknown }).children

    // Most Boxes hold no section header: found without flattening anything.
    if ((props as { flexDirection?: string }).flexDirection !== 'column' || !holdsHead(children)) return kit.Box(props)

    const kids = flat(children)
    const out: unknown[] = []
    let card: unknown[] | null = null
    const close = () => {
      if (card !== null) out.push(kit.Box({ key: `card-${made++}`, flexDirection: 'column', borderStyle: 'round', borderColor: accent ?? THEME.info, paddingX: 1, children: card as never }))
      card = null
    }

    for (const kid of kids) {
      const isObject = typeof kid === 'object' && kid !== null

      // The blank row a header carries above it is the gap between cards now.
      if (isObject && SPACERS.has(kid)) continue

      if (isObject && HEADS.has(kid)) {
        close()
        card = [kid]
      } else if (card !== null) card.push(kid)
      else out.push(kid)
    }

    close()

    return kit.Box({ ...props, children: out as never })
  }

  return { ...kit, Box }
}
